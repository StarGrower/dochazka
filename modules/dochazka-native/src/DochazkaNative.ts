// JS rozhraní lokálního nativního modulu (ios/DochazkaNativeModule.swift).

import { NativeModule, requireNativeModule } from 'expo';

export interface BackupFolderInfo {
  configured: boolean;
  accessible: boolean;
  name: string;
  error: string;
}

export interface BackupFileInfo {
  name: string;
  size: number;
  modifiedMs: number;
}

export interface NotificationAction {
  id: string;
  title: string;
  destructive?: boolean;
  foreground?: boolean; // otevře appku
}

export interface NotificationResponse {
  notificationId: string;
  actionId: string; // id akce, 'open' (klepnutí), 'dismiss'
  data: string; // JSON předaný při plánování
  receivedAt: string;
}

type DochazkaNativeEvents = {
  onNotificationResponse: (response: NotificationResponse) => void;
};

declare class DochazkaNativeModule extends NativeModule<DochazkaNativeEvents> {
  // --- záloha: složka v Souborech (security-scoped bookmark) ---
  pickBackupFolder(): Promise<string>; // vrací název složky; zrušení = chyba
  getBackupFolder(): BackupFolderInfo;
  clearBackupFolder(): void;
  listBackupFiles(): Promise<BackupFileInfo[]>;
  deleteBackupFile(name: string): Promise<void>;
  // Zašifruje lokální soubor klíčem z Klíčenky a zapíše do složky; vrací velikost.
  writeEncryptedBackup(sourcePath: string, fileName: string): Promise<number>;
  copyBackupFileToTemp(name: string): Promise<string>;
  pickBackupFileToTemp(): Promise<string>;
  // keyBase64 '' = klíč z Klíčenky, jinak obnovovací klíč.
  decryptBackup(sourcePath: string, destinationPath: string, keyBase64: string): Promise<void>;
  // --- místní soubory ---
  tempFilePath(name: string): string; // cesta v dočasné složce appky
  deleteLocalFile(path: string): void;
  replaceDatabaseFile(sourcePath: string, databasePath: string): Promise<void>;
  // --- klíč (Klíčenka, iCloud synchronizace) ---
  getKeyStatus(): { exists: boolean; synchronizable: boolean };
  createKeyIfMissing(): { created: boolean; key: string };
  exportKey(): string;
  importKey(base64: string): void;
  // --- stav zařízení ---
  provisioningExpiry(): string; // ISO, '' = nelze zjistit
  backgroundRefreshStatus(): Promise<'available' | 'denied' | 'restricted' | 'unknown'>;
  // --- snímek mapy (PDF výkaz) - PNG v base64; bez internetu chyba ---
  mapSnapshot(routes: number[][][], stops: number[][], labels: string[], width: number, height: number): Promise<string>;
  // --- vzdálenost po silnici (metry, -1 = trasa nenalezena; chyba = bez sítě) ---
  roadDistance(fromLat: number, fromLon: number, toLat: number, toLon: number): Promise<number>;
  // --- etapy 6 a 7 ---
  recognizeText(base64Jpeg: string): Promise<string[]>; // Apple Vision, offline
  nearbyGasStation(latitude: number, longitude: number, radiusM: number): Promise<string>; // '' = žádná
  bluetoothAudioRoute(): string; // název Bluetooth/CarPlay výstupu, '' = žádný
  // doplněk etapy 5 - hledání adresy / obce pro místo bez přítomnosti (MapKit)
  searchPlaces(query: string, nearLatitude: number, nearLongitude: number): Promise<{ name: string; subtitle: string; latitude: number; longitude: number }[]>;
  // --- místní upozornění ---
  requestNotificationPermission(): Promise<boolean>;
  getNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined'>;
  scheduleNotification(
    id: string,
    title: string,
    body: string,
    fireAtMs: number,
    actions: NotificationAction[],
    data: string
  ): void;
  cancelNotification(id: string): void;
  pendingNotificationIds(): Promise<string[]>;
  drainNotificationResponses(): NotificationResponse[];
}

export default requireNativeModule<DochazkaNativeModule>('DochazkaNative');
