// Automatická šifrovaná záloha (etapa 4.1).
//
// - soubor Dochazka-zaloha-RRRR-MM-DD.dochazka ve složce vybrané v
//   Souborech (doporučeno iCloud Drive/Docházka), šifrování a klíč řeší
//   nativní modul (modules/dochazka-native, CryptoKit + Klíčenka)
// - automaticky max. 1× denně při probuzení appky (otevření i probuzení
//   polohou) a před každou migrací DB; navíc "Zálohovat teď"
// - rotace 7 denních / 4 týdenních / 12 měsíčních
// - obnova vždy nahradí celý stav (před ní záloha aktuálního stavu)
//
// Každý pokus se zapíše do ladicího deníku i se stavem appky (popředí /
// pozadí) - je to zároveň pokus pro etapu 8: jestli zápis do iCloud
// Drive funguje s bezplatným podpisem i při probuzení na pozadí.

import { reloadAppAsync } from 'expo';
import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import DochazkaNative, { type BackupFileInfo } from '../modules/dochazka-native/src/DochazkaNative';
import {
  addDebugLogEntry,
  closeDatabaseForRestore,
  getDatabasePath,
  getInternalValue,
  setInternalValue,
  snapshotDatabaseTo,
} from './db';
import {
  BACKUP_DAILY_PREFIX as DAILY_PREFIX,
  BACKUP_EXTENSION as EXTENSION,
  backupsToDelete,
  formatRecoveryKey,
  parseRecoveryKey,
} from './backupKey';
import { toIsoDate } from './format';
import { FONT_SCALE_STORAGE_KEY } from '@/theme';

const PRE_MIGRATION_PREFIX = 'Dochazka-pred-migraci-';

const KEY_LAST_BACKUP = 'backup.last'; // JSON BackupRecord
const KEY_LAST_ATTEMPT = 'backup.last_attempt'; // JSON { at, ok, error, background }
const KEY_RECOVERY_SHOWN = 'backup.recovery_key_shown';

export interface BackupRecord {
  at: string;
  fileName: string;
  size: number;
  folderName: string;
}

export interface BackupAttempt {
  at: string;
  ok: boolean;
  error: string;
  background: boolean;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getInternalValue(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getLastBackup(): Promise<BackupRecord | null> {
  return readJson<BackupRecord>(KEY_LAST_BACKUP);
}

export function getLastBackupAttempt(): Promise<BackupAttempt | null> {
  return readJson<BackupAttempt>(KEY_LAST_ATTEMPT);
}

export function isBackupConfigured(): boolean {
  try {
    return DochazkaNative.getBackupFolder().configured && DochazkaNative.getKeyStatus().exists;
  } catch {
    return false; // nativní modul chybí (Expo Go) - zálohování nejde
  }
}

export const RECOVERY_QR_PREFIX = 'DOCHAZKA-KEY:';

// --- nastavení zálohy ---

// Výběr složky + vytvoření klíče. Vrací obnovovací klíč (zobrazit jednou).
export async function setUpBackupFolder(): Promise<{ folderName: string; recoveryKey: string; keyCreated: boolean }> {
  const folderName = await DochazkaNative.pickBackupFolder();
  const { created, key } = DochazkaNative.createKeyIfMissing();
  return { folderName, recoveryKey: formatRecoveryKey(key), keyCreated: created };
}

export function currentRecoveryKey(): string {
  const key = DochazkaNative.exportKey();
  return key ? formatRecoveryKey(key) : '';
}

export async function markRecoveryKeyShown(): Promise<void> {
  await setInternalValue(KEY_RECOVERY_SHOWN, new Date().toISOString());
}

export async function wasRecoveryKeyShown(): Promise<boolean> {
  return (await getInternalValue(KEY_RECOVERY_SHOWN)) !== null;
}

// --- záloha ---

let running: Promise<BackupRecord | null> | null = null;

async function writeBackup(fileName: string, reason: string, db?: SQLite.SQLiteDatabase): Promise<BackupRecord> {
  const background = AppState.currentState === 'background';
  const tempPath = DochazkaNative.tempFilePath(`snimek-${Date.now()}.db`);
  try {
    await snapshotDatabaseTo(tempPath, db);
    const size = await DochazkaNative.writeEncryptedBackup(tempPath, fileName);
    const record: BackupRecord = {
      at: new Date().toISOString(),
      fileName,
      size,
      folderName: DochazkaNative.getBackupFolder().name,
    };
    await setInternalValue(KEY_LAST_ATTEMPT, JSON.stringify({ at: record.at, ok: true, error: '', background }));
    await addDebugLogEntry({
      timestamp: record.at,
      eventType: 'backup',
      detail: `záloha OK (${reason}, ${background ? 'na pozadí' : 'v popředí'}) · ${fileName} · ${Math.round(size / 1024)} kB`,
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    return record;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await setInternalValue(KEY_LAST_ATTEMPT, JSON.stringify({ at: new Date().toISOString(), ok: false, error, background }));
    await addDebugLogEntry({
      timestamp: new Date().toISOString(),
      eventType: 'backup',
      detail: `záloha SELHALA (${reason}, ${background ? 'na pozadí' : 'v popředí'}): ${error}`,
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    throw err;
  } finally {
    DochazkaNative.deleteLocalFile(tempPath);
  }
}

export function backupNow(reason: string): Promise<BackupRecord | null> {
  if (running) return running;
  running = (async () => {
    try {
      if (!isBackupConfigured()) return null;
      const record = await writeBackup(`${DAILY_PREFIX}${toIsoDate(new Date())}${EXTENSION}`, reason);
      await setInternalValue(KEY_LAST_BACKUP, JSON.stringify(record));
      await rotateBackups().catch(() => {});
      return record;
    } finally {
      running = null;
    }
  })();
  return running;
}

// Max. 1× denně - volá se při každém probuzení appky (levná kontrola).
export async function runDailyBackupIfDue(reason: string): Promise<void> {
  if (!isBackupConfigured()) return;
  const last = await getLastBackup();
  if (last && toIsoDate(new Date(last.at)) === toIsoDate(new Date())) return;
  // Po chybě nezkoušet při každé události znovu - nejdřív za hodinu.
  const attempt = await getLastBackupAttempt();
  if (attempt && !attempt.ok && Date.now() - Date.parse(attempt.at) < 60 * 60 * 1000) return;
  await backupNow(reason).catch(() => {});
}

// Před migrací DB (registruje se v app/_layout.tsx přes setPreMigrationHook).
export async function backupBeforeMigration(db: SQLite.SQLiteDatabase, fromVersion: number): Promise<void> {
  if (!isBackupConfigured()) return;
  await writeBackup(`${PRE_MIGRATION_PREFIX}v${fromVersion}-${toIsoDate(new Date())}${EXTENSION}`, `před migrací z v${fromVersion}`, db);
}

async function rotateBackups(): Promise<void> {
  const files = await DochazkaNative.listBackupFiles();
  for (const name of backupsToDelete(files.map((f) => f.name))) {
    await DochazkaNative.deleteBackupFile(name);
  }
}

export async function listBackups(): Promise<BackupFileInfo[]> {
  const files = await DochazkaNative.listBackupFiles();
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

// --- obnova ---

export interface RestorePreview {
  tempDbPath: string;
  sourceName: string;
  firstDate: string | null;
  lastDate: string | null;
  dayCount: number;
  recordCount: number;
  placeCount: number;
  visitCount: number;
}

export class MissingKeyError extends Error {}

// Dešifrování do dočasné DB + náhled (nic se zatím nenahrazuje).
// `source`: název souboru ve složce záloh, nebo 'pick' = výběr v Souborech.
export async function prepareRestore(source: string, recoveryKeyText?: string): Promise<RestorePreview> {
  const encryptedPath = source === 'pick' ? await DochazkaNative.pickBackupFileToTemp() : await DochazkaNative.copyBackupFileToTemp(source);
  const keyBase64 = recoveryKeyText ? parseRecoveryKey(recoveryKeyText) : '';
  if (keyBase64 === null) throw new MissingKeyError('Neplatný obnovovací klíč.');
  const dbName = `obnova-${Date.now()}.db`;
  const tempDbPath = DochazkaNative.tempFilePath(dbName);
  try {
    await DochazkaNative.decryptBackup(encryptedPath, tempDbPath, keyBase64);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/klíč/i.test(message)) throw new MissingKeyError(message);
    throw err;
  } finally {
    DochazkaNative.deleteLocalFile(encryptedPath);
  }

  const dir = tempDbPath.substring(0, tempDbPath.lastIndexOf('/'));
  const temp = await SQLite.openDatabaseAsync(dbName, undefined, dir);
  try {
    const row = await temp.getFirstAsync<{ first: string | null; last: string | null; days: number; records: number; places: number; visits: number }>(
      `SELECT MIN(date) as first, MAX(date) as last, COUNT(DISTINCT date) as days, COUNT(*) as records,
              (SELECT COUNT(*) FROM places WHERE is_deleted = 0) as places,
              (SELECT COUNT(*) FROM visits WHERE is_deleted = 0) as visits
       FROM day_work_records`
    );
    // Když se klíč obnovil z obnovovacího klíče, uložit ho zpět do Klíčenky.
    if (keyBase64) DochazkaNative.importKey(keyBase64);
    return {
      tempDbPath,
      sourceName: source === 'pick' ? 'vybraný soubor' : source,
      firstDate: row?.first ?? null,
      lastDate: row?.last ?? null,
      dayCount: row?.days ?? 0,
      recordCount: row?.records ?? 0,
      placeCount: row?.places ?? 0,
      visitCount: row?.visits ?? 0,
    };
  } finally {
    await temp.closeAsync();
  }
}

// Nahrazení celého stavu zálohou: nejdřív záloha aktuálního stavu, pak
// výměna souboru DB a znovunačtení appky (migrace proběhnou při startu).
export async function performRestore(preview: RestorePreview): Promise<void> {
  if (isBackupConfigured()) {
    await writeBackup(`${PRE_MIGRATION_PREFIX}pred-obnovou-${Date.now()}${EXTENSION}`, 'před obnovou');
  } else {
    // Bez složky aspoň místní kopie vedle DB.
    const dbPath = await getDatabasePath();
    await snapshotDatabaseTo(`${dbPath.substring(0, dbPath.lastIndexOf('/'))}/dochazka-pred-obnovou-${Date.now()}.db`);
  }
  const dbPath = await getDatabasePath();
  await closeDatabaseForRestore();
  await DochazkaNative.replaceDatabaseFile(preview.tempDbPath, dbPath);
  DochazkaNative.deleteLocalFile(preview.tempDbPath);
  try {
    Storage.setItemSync(FONT_SCALE_STORAGE_KEY, 'normal'); // dorovná se z nastavení při startu
  } catch {
    // nevadí
  }
  await reloadAppAsync('obnova zálohy');
}
