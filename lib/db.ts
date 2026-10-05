// Datová vrstva - SQLite v telefonu (viz zadání "Data jen v telefonu"),
// žádný server. Otevírá se JEDNA databáze (dochazka.db) a inicializuje
// se jednou při startu aplikace (viz app/_layout.tsx -> initDb()).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - "kategorie prací" a "stroje" jsou JEDNA
// tabulka (work_categories), ne dvě: zadání je mluví o obojím dost
// zaměnitelně ("kategorie prací (výchozí: Tatra, bagr, ruční práce)" a
// hned pod tím "přidat další stroje nebo položky ze seznamu strojů") -
// Tatra a bagr JSOU stroje, "ruční práce" je jen další položka téhož
// seznamu bez stroje. Jeden ceník (hodinová/denní sazba) pro všechno,
// co se ke dni přiřazuje, je jednodušší a odpovídá tomu, jak to zadání
// popisuje.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - mazání kategorie je MĚKKÉ (is_deleted), ne
// smazání řádku: staré denní záznamy na tu kategorii pořád odkazují
// (day_work_records.category_id) - tvrdé smazání by buď spadlo na FK,
// nebo by starým záznamům "utrhlo" název/sazbu. Smazaná kategorie zmizí
// z nabídky při přidávání nové položky ke dni, ale historické záznamy
// ji dál zobrazí (viz getDayRecords - JOIN ji najde i smazanou).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - "quantity" je jedno obecné číslo (ne zvlášť
// hodiny, dny a km): význam určuje `day_work_records.unit` (oprava 2 -
// dřív rate_type kategorie). Zamezuje to věčně poloprázdným sloupcům.
//
// Tabulka `day_initialized` je od opravy 2 NEPOUŽÍVANÁ (výchozí položky
// se už nevkládají samy, jen se nabídnou - viz lib/workCalc.ts ->
// dayDefaultsProposal). Zůstává jen kvůli kompatibilitě se starší DB.

import * as SQLite from 'expo-sqlite';
import { paletteColorAt } from '@/theme';
import { localDayBounds } from './dayTimeline';
import type {
  AppSettings,
  CategoryKind,
  DayRecordSource,
  DayWorkRecordWithCategory,
  DebugEventType,
  DebugLogEntry,
  MonthDaySummary,
  Place,
  RateType,
  RateUnit,
  RoutePoint,
  Trip,
  VisitSource,
  VisitWithPlace,
  WorkCategory,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import type { EngineEvent, EngineVisitSource, LocationEventKind } from './visitEngine';

const DB_NAME = 'dochazka.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

const DEFAULT_CATEGORIES: { name: string; rateType: RateType; kind: CategoryKind }[] = [
  { name: 'Tatra', rateType: 'hourly', kind: 'machine' },
  { name: 'Bagr', rateType: 'hourly', kind: 'machine' },
  { name: 'Ruční práce', rateType: 'hourly', kind: 'labor' },
];

// Volá se až PO migracích (sloupce default_unit apod. už existují).
async function seedDefaultCategories(db: SQLite.SQLiteDatabase): Promise<void> {
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    await db.runAsync(
      "INSERT INTO work_categories (name, rate_type, rate_kc, sort_order, color, kind, default_unit) VALUES (?, ?, ?, ?, ?, ?, 'hour')",
      [c.name, c.rateType, 0, i, paletteColorAt(i), c.kind]
    );
  }
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  // Byla už databáze z dřívější verze? (Rozhoduje, jestli má smysl před
  // migracemi dělat zálohu - čerstvá instalace nemá co zálohovat.)
  const existing = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_categories'"
  );
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS work_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate_type TEXT NOT NULL CHECK (rate_type IN ('hourly', 'daily')),
      rate_kc REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS day_notes (
      date TEXT PRIMARY KEY NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS day_work_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES work_categories (id),
      quantity REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_day_work_records_date ON day_work_records (date);

    CREATE TABLE IF NOT EXISTS day_initialized (
      date TEXT PRIMARY KEY NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_m REAL NOT NULL DEFAULT 150,
      order_label TEXT NOT NULL DEFAULT '',
      is_home INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER REFERENCES places (id),
      unknown_latitude REAL,
      unknown_longitude REAL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      source TEXT NOT NULL CHECK (source IN ('clvisit', 'geofence', 'continuous', 'manual')),
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_visits_start_at ON visits (start_at);

    CREATE TABLE IF NOT EXISTS location_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_location_points_timestamp ON location_points (timestamp);

    CREATE TABLE IF NOT EXISTS debug_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      battery_level REAL,
      latitude REAL,
      longitude REAL
    );
    CREATE INDEX IF NOT EXISTS idx_debug_log_timestamp ON debug_log (timestamp);
  `);

  await migrateAddCategoryColor(db);
  await migrateAddCategoryKind(db);
  await runVersionedMigrations(db, existing !== null);

  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM work_categories'
  );
  if (row && row.count === 0) {
    await seedDefaultCategories(db);
  }
}

// Přidáno dodatečně (vizuální barvy kategorií/strojů, viz theme.ts) -
// `CREATE TABLE IF NOT EXISTS` výš nic nezmění na už existující tabulce
// z dřívější instalace (etapa 1), proto ruční ALTER TABLE jen když
// sloupec ještě chybí. Existujícím řádkům se hned při migraci přiřadí
// barvy z palety podle pořadí, ať nejsou všechny stejné.
async function migrateAddCategoryColor(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(work_categories)');
  if (columns.some((c) => c.name === 'color')) return;

  await db.execAsync(
    `ALTER TABLE work_categories ADD COLUMN color TEXT NOT NULL DEFAULT '${paletteColorAt(0)}'`
  );
  const existing = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM work_categories ORDER BY sort_order, id'
  );
  for (let i = 0; i < existing.length; i++) {
    await db.runAsync('UPDATE work_categories SET color = ? WHERE id = ?', [
      paletteColorAt(i),
      existing[i].id,
    ]);
  }
}

// ČÁST 3 (zadání "typ stroj/práce") - stejný vzor jako migrace barvy
// výš. Existující řádky (z dřívější instalace, bez tohohle pole)
// dostanou výchozí 'machine' - čistě informační pole, nic nerozbije.
async function migrateAddCategoryKind(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(work_categories)');
  if (columns.some((c) => c.name === 'kind')) return;

  await db.execAsync(
    "ALTER TABLE work_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'machine'"
  );
}

// --- číslované migrace (oprava 2 a dál) ---
//
// NETRIVIÁLNÍ ROZHODNUTÍ - od opravy 2 se migrace číslují přes
// `PRAGMA user_version` (dřívější migrace výš zůstávají, jsou idempotentní
// přes PRAGMA table_info). Každá proběhne právě jednou. Před první
// čekající migrací na už existující databázi se udělá ZÁLOHA celé
// databáze vedle původního souboru (VACUUM INTO) - zadání "data v
// telefonu se nesmí ztratit". Migrace samy nic fyzicky nemažou (jen
// is_deleted / přesun do *_removed tabulek).

const SCHEMA_VERSION = 5;
// Záloha se dělá před první čekající migrací; jméno podle verze, ze které
// se migruje (existující záloha se nikdy nepřepisuje).
function backupFileName(fromVersion: number): string {
  if (fromVersion < 2) return 'dochazka-zaloha-pred-opravami-2.db';
  if (fromVersion === 4) return 'dochazka-zaloha-pred-opravami-etapy-3.db';
  // v2 -> "před etapou 3", v3 -> "před etapou 4" (verze DB = číslo etapy)
  return `dochazka-zaloha-pred-etapou-${fromVersion + 1}.db`;
}

// Etapa 4: před migrací navíc šifrovaná záloha do složky v Souborech
// (lib/backup.ts se zaregistruje z app/_layout.tsx - datová vrstva o
// zálohování nic neví, jen dá vědět).
let preMigrationHook: ((db: SQLite.SQLiteDatabase, fromVersion: number) => Promise<void>) | null = null;

export function setPreMigrationHook(hook: (db: SQLite.SQLiteDatabase, fromVersion: number) => Promise<void>): void {
  preMigrationHook = hook;
}

async function runVersionedMigrations(db: SQLite.SQLiteDatabase, hadExistingDb: boolean): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  if (hadExistingDb) {
    await backupDatabase(db, version);
    await preMigrationHook?.(db, version).catch(() => {});
  }

  if (version < 1) {
    await migrateV1LocationEvents(db);
    await db.execAsync('PRAGMA user_version = 1');
  }
  if (version < 2) {
    await migrateV2RatesAndRecords(db);
    await db.execAsync('PRAGMA user_version = 2');
  }
  if (version < 3) {
    await migrateV3Trips(db);
    await db.execAsync('PRAGMA user_version = 3');
  }
  if (version < 4) {
    await migrateV4Reminders(db);
    await db.execAsync('PRAGMA user_version = 4');
  }
  if (version < 5) {
    await migrateV5RoadDistance(db);
    await db.execAsync('PRAGMA user_version = 5');
  }
}

async function backupDatabase(db: SQLite.SQLiteDatabase, fromVersion: number): Promise<void> {
  const dir = db.databasePath.substring(0, db.databasePath.lastIndexOf('/'));
  const name = backupFileName(fromVersion);
  const target = `${dir}/${name}`.replace(/'/g, "''");
  try {
    await db.execAsync(`VACUUM INTO '${target}'`);
    await setInternalValueWith(db, `backup.${name}`, `ok ${new Date().toISOString()}`);
  } catch (err) {
    // Typicky "soubor už existuje" (záloha z dřívějšího pokusu) - ta
    // původní je cennější, nepřepisovat. Migrace jsou nedestruktivní,
    // takže pokračovat i bez nové zálohy je bezpečné.
    await setInternalValueWith(db, `backup.${name}`, `chyba: ${String(err)}`);
  }
}

async function addColumnIfMissing(db: SQLite.SQLiteDatabase, table: string, column: string, definition: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Oprava 2, skupina A - pobyty se odvozují z událostí (viz lib/visitEngine.ts).
async function migrateV1LocationEvents(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'visits', 'start_uncertain', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'visits', 'deleted_by', 'TEXT');
  await addColumnIfMissing(db, 'places', 'is_private', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'debug_log', 'delivered_at', 'TEXT');
  await addColumnIfMissing(db, 'debug_log', 'delivered_battery', 'REAL');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS location_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      event_at TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      accuracy_m REAL,
      place_id INTEGER,
      received_at TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'live'
    );
    CREATE INDEX IF NOT EXISTS idx_location_events_event_at ON location_events (event_at);

    CREATE TABLE IF NOT EXISTS geocode_cache (
      key TEXT PRIMARY KEY NOT NULL,
      locality TEXT NOT NULL,
      looked_up_at TEXT NOT NULL
    );
  `);

  // Domov = soukromé místo (A4).
  await db.runAsync('UPDATE places SET is_private = 1 WHERE is_home = 1');

  // Časy pobytů na jednotný formát UTC ISO (toISOString). Ruční úpravy
  // v Detailu dne se dřív ukládaly v MÍSTNÍM čase bez zóny
  // ("2026-10-04T14:43:00"), CLVisit v UTC ("...Z") - textové porovnání
  // v dotazech na den pak ujíždělo o 2 h.
  const visitTimes = await db.getAllAsync<{ id: number; start_at: string; end_at: string | null }>(
    'SELECT id, start_at, end_at FROM visits'
  );
  for (const v of visitTimes) {
    const start = normalizeIso(v.start_at);
    const end = v.end_at === null ? null : normalizeIso(v.end_at);
    if (start !== v.start_at || end !== v.end_at) {
      await db.runAsync('UPDATE visits SET start_at = ?, end_at = ? WHERE id = ?', [start, end, v.id]);
    }
  }

  // Přehrání CLVisit událostí z ladicího deníku (zadání: rekonstrukce
  // pobytů 2.-4. 10.). Duplicity zmizí díky otisku (UNIQUE fingerprint).
  const logged = await db.getAllAsync<{ timestamp: string; event_type: string; latitude: number | null; longitude: number | null }>(
    `SELECT timestamp, event_type, latitude, longitude FROM debug_log
     WHERE event_type IN ('arrival', 'departure') AND detail LIKE 'CLVisit%'
     ORDER BY timestamp`
  );
  let firstReplayedAt: string | null = null;
  for (const entry of logged) {
    const eventAt = normalizeIso(entry.timestamp);
    if (firstReplayedAt === null || eventAt < firstReplayedAt) firstReplayedAt = eventAt;
    await insertLocationEventWith(db, {
      kind: entry.event_type === 'arrival' ? 'visit_arrival' : 'visit_departure',
      eventAt,
      latitude: entry.latitude,
      longitude: entry.longitude,
      accuracyM: null,
      placeId: null,
      receivedAt: eventAt,
      origin: 'debug_log_replay',
    });
  }

  // Automatické pobyty z doby PŘED začátkem deníku (nebo všechny, když
  // je deník prázdný) se převedou na umělé události příjezd/odjezd, ať
  // je přepočet zachová (a zároveň sloučí duplicity a ořízne překryvy).
  // Ruční pobyty se nemění vůbec.
  const legacy = await db.getAllAsync<{ place_id: number | null; unknown_latitude: number | null; unknown_longitude: number | null; start_at: string; end_at: string | null }>(
    `SELECT place_id, unknown_latitude, unknown_longitude, start_at, end_at FROM visits
     WHERE is_deleted = 0 AND source != 'manual' ${firstReplayedAt ? 'AND start_at < ?' : ''}
     ORDER BY start_at`,
    firstReplayedAt ? [firstReplayedAt] : []
  );
  for (const v of legacy) {
    const base = { latitude: v.unknown_latitude, longitude: v.unknown_longitude, accuracyM: null, placeId: v.place_id, origin: 'legacy_visit' as const };
    await insertLocationEventWith(db, { ...base, kind: 'visit_arrival', eventAt: v.start_at, receivedAt: v.start_at });
    if (v.end_at !== null) {
      await insertLocationEventWith(db, { ...base, kind: 'visit_departure', eventAt: v.end_at, receivedAt: v.end_at });
    }
  }

  // Samotné nahrazení starých pobytů přepočtem udělá lib/visits.ts ->
  // finishLegacyVisitMigrationIfNeeded() (potřebuje logiku pobytů a ta
  // do datové vrstvy nepatří).
  await setInternalValueWith(db, KEY_VISITS_REBUILD_PENDING, '1');
}

// Oprava 2, skupiny B a C - sazby h/den/km, příplatky, snímek sazby u
// položky, příznak původu položky + úklid automaticky vložených
// výchozích položek.
async function migrateV2RatesAndRecords(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'work_categories', 'rate_hour_kc', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'work_categories', 'rate_day_kc', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'work_categories', 'rate_km_kc', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'work_categories', 'default_unit', "TEXT NOT NULL DEFAULT 'hour'");
  await addColumnIfMissing(db, 'work_categories', 'weekend_pct', 'REAL');
  await addColumnIfMissing(db, 'work_categories', 'holiday_pct', 'REAL');
  await db.execAsync(`
    UPDATE work_categories SET
      rate_hour_kc = CASE WHEN rate_type = 'hourly' THEN rate_kc ELSE 0 END,
      rate_day_kc = CASE WHEN rate_type = 'daily' THEN rate_kc ELSE 0 END,
      default_unit = CASE WHEN rate_type = 'daily' THEN 'day' ELSE 'hour' END;
  `);

  await addColumnIfMissing(db, 'day_work_records', 'unit', "TEXT NOT NULL DEFAULT 'hour'");
  await addColumnIfMissing(db, 'day_work_records', 'rate_kc', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'day_work_records', 'surcharge_pct', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'day_work_records', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  // Stávající položky: jednotka a sazba podle kategorie (dnešní ceník =
  // jediný, co existoval), bez příplatku (dřív neexistoval).
  await db.execAsync(`
    UPDATE day_work_records SET
      unit = COALESCE((SELECT CASE WHEN c.rate_type = 'daily' THEN 'day' ELSE 'hour' END
                       FROM work_categories c WHERE c.id = day_work_records.category_id), 'hour'),
      rate_kc = COALESCE((SELECT c.rate_kc FROM work_categories c WHERE c.id = day_work_records.category_id), 0);

    CREATE TABLE IF NOT EXISTS day_work_records_removed (
      id INTEGER PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      rate_kc REAL NOT NULL,
      surcharge_pct REAL NOT NULL,
      source TEXT NOT NULL,
      removed_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
  `);

  // B2 úklid (zadání: "odeber všechny, které odpovídají výchozí položce,
  // od 2. 10. dál, i v minulých dnech"): položky výchozího stroje s
  // výchozím množstvím od 2. 10. 2026 (kdy se výchozí položky začaly
  // vkládat samy) + přesné duplicity (stejný den, stroj, množství).
  // Nic se nemaže natrvalo - přesun do day_work_records_removed.
  const stored = new Map(
    (await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings')).map((r) => [r.key, r.value])
  );
  const readSetting = <T,>(key: string, fallback: T): T => {
    try {
      const raw = stored.get(key);
      return raw === undefined ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  };
  const defaultIds = readSetting<number[]>('default_category_ids', []);
  const dayLength = readSetting<number>('default_day_length_hours', 8);
  const subtractBreak = readSetting<boolean>('auto_subtract_break', false);
  const breakMinutes = readSetting<number>('break_minutes', 30);
  const defaultHours = subtractBreak ? Math.max(0, Math.round((dayLength - breakMinutes / 60) * 100) / 100) : dayLength;

  const removedAt = new Date().toISOString();
  const moveRecord = async (id: number, reason: string) => {
    await db.runAsync(
      `INSERT OR IGNORE INTO day_work_records_removed
         (id, date, category_id, quantity, unit, rate_kc, surcharge_pct, source, removed_at, reason)
       SELECT id, date, category_id, quantity, unit, rate_kc, surcharge_pct, source, ?, ?
       FROM day_work_records WHERE id = ?`,
      [removedAt, reason, id]
    );
    await db.runAsync('DELETE FROM day_work_records WHERE id = ?', [id]);
  };

  if (defaultIds.length > 0) {
    const candidates = await db.getAllAsync<{ id: number; category_id: number; quantity: number; unit: RateUnit }>(
      `SELECT id, category_id, quantity, unit FROM day_work_records
       WHERE date >= '2026-10-02' AND category_id IN (${defaultIds.map(() => '?').join(', ')})`,
      defaultIds
    );
    for (const r of candidates) {
      const expected = r.unit === 'day' ? 1 : defaultHours;
      if (Math.abs(r.quantity - expected) < 0.001) await moveRecord(r.id, 'auto_default');
    }
  }

  const duplicates = await db.getAllAsync<{ id: number }>(
    `SELECT r.id FROM day_work_records r
     WHERE EXISTS (SELECT 1 FROM day_work_records o
                   WHERE o.date = r.date AND o.category_id = r.category_id
                     AND o.quantity = r.quantity AND o.id < r.id)`
  );
  for (const d of duplicates) await moveRecord(d.id, 'duplicate');
}

// Etapa 3 - přejezdy a body tras. Jen nové tabulky/sloupce; minulé
// přejezdy (mezery mezi už uloženými pobyty) doplní jako ODHAD
// lib/visits.ts -> finishLegacyVisitMigrationIfNeeded (příznak níž).
async function migrateV3Trips(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      from_place_id INTEGER,
      from_latitude REAL,
      from_longitude REAL,
      to_place_id INTEGER,
      to_latitude REAL,
      to_longitude REAL,
      distance_m REAL NOT NULL DEFAULT 0,
      is_estimate INTEGER NOT NULL DEFAULT 0,
      point_count INTEGER NOT NULL DEFAULT 0,
      km_override REAL,
      is_private INTEGER NOT NULL DEFAULT 0,
      vehicle_category_id INTEGER,
      work_record_id INTEGER,
      gps_first_point_at TEXT,
      gps_note TEXT,
      logged_at TEXT,
      user_edited INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trips_start_at ON trips (start_at);

    CREATE TABLE IF NOT EXISTS route_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER,
      timestamp TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_m REAL,
      speed_mps REAL
    );
    CREATE INDEX IF NOT EXISTS idx_route_points_timestamp ON route_points (timestamp);
    CREATE INDEX IF NOT EXISTS idx_route_points_trip ON route_points (trip_id);
  `);
  await addColumnIfMissing(db, 'day_work_records', 'trip_id', 'INTEGER');
  await setInternalValueWith(db, KEY_TRIPS_BACKFILL_PENDING, '1');
}

// Etapa 4 - připomenutí zápisu a učení stroje pro místo. Jen nové
// sloupce/tabulky, existující data beze změny.
async function migrateV4Reminders(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'day_work_records', 'place_id', 'INTEGER');
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_day_work_records_place ON day_work_records (place_id);

    CREATE TABLE IF NOT EXISTS place_suggestions (
      place_id INTEGER PRIMARY KEY NOT NULL,
      category_id INTEGER NOT NULL,
      unit TEXT NOT NULL DEFAULT 'hour',
      locked INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminder_state (
      key TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL,
      fire_at TEXT,
      payload TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
}

// Oprava po terénním testu etapy 3 - km po silnici. Jen nové sloupce;
// stávající přejezdy se dopočítají po silnici (road_status NULL = čeká),
// původní GPS hodnota (distance_m) zůstává.
async function migrateV5RoadDistance(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'trips', 'road_distance_m', 'REAL');
  await addColumnIfMissing(db, 'trips', 'road_status', 'TEXT');
  await addColumnIfMissing(db, 'trips', 'road_note', 'TEXT');
}

export function normalizeIso(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

// --- kategorie prací / stroje ---

interface CategoryRow {
  id: number;
  name: string;
  rate_type: RateType;
  rate_kc: number;
  rate_hour_kc: number;
  rate_day_kc: number;
  rate_km_kc: number;
  default_unit: RateUnit;
  weekend_pct: number | null;
  holiday_pct: number | null;
  sort_order: number;
  is_deleted: number;
  color: string;
  kind: CategoryKind;
}

function mapCategory(row: CategoryRow): WorkCategory {
  return {
    id: row.id,
    name: row.name,
    rates: { hour: row.rate_hour_kc, day: row.rate_day_kc, km: row.rate_km_kc },
    defaultUnit: row.default_unit,
    weekendPct: row.weekend_pct,
    holidayPct: row.holiday_pct,
    sortOrder: row.sort_order,
    isDeleted: row.is_deleted === 1,
    color: row.color,
    kind: row.kind,
  };
}

export async function listCategories(includeDeleted = false): Promise<WorkCategory[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    includeDeleted
      ? 'SELECT * FROM work_categories ORDER BY sort_order, id'
      : 'SELECT * FROM work_categories WHERE is_deleted = 0 ORDER BY sort_order, id'
  );
  return rows.map(mapCategory);
}

export interface CategoryFields {
  name: string;
  rates: Record<RateUnit, number>;
  defaultUnit: RateUnit;
  weekendPct: number | null;
  holidayPct: number | null;
  color: string;
  kind: CategoryKind;
}

// Původní sloupce rate_type/rate_kc (CHECK jen hourly/daily) se dál
// plní podle výchozí jednotky - ať zůstanou smysluplné, nic na nich ale
// už nestojí.
function legacyRateColumns(fields: CategoryFields): [RateType, number] {
  return [fields.defaultUnit === 'day' ? 'daily' : 'hourly', fields.rates[fields.defaultUnit]];
}

export async function createCategory(fields: CategoryFields): Promise<number> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sort_order) as maxOrder FROM work_categories'
  );
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  const [rateType, rateKc] = legacyRateColumns(fields);
  const result = await db.runAsync(
    `INSERT INTO work_categories
       (name, rate_type, rate_kc, rate_hour_kc, rate_day_kc, rate_km_kc, default_unit, weekend_pct, holiday_pct, sort_order, color, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fields.name, rateType, rateKc, fields.rates.hour, fields.rates.day, fields.rates.km, fields.defaultUnit,
      fields.weekendPct, fields.holidayPct, sortOrder, fields.color, fields.kind]
  );
  return result.lastInsertRowId;
}

export async function updateCategory(id: number, fields: CategoryFields): Promise<void> {
  const db = await getDb();
  const [rateType, rateKc] = legacyRateColumns(fields);
  await db.runAsync(
    `UPDATE work_categories SET name = ?, rate_type = ?, rate_kc = ?, rate_hour_kc = ?, rate_day_kc = ?, rate_km_kc = ?,
       default_unit = ?, weekend_pct = ?, holiday_pct = ?, color = ?, kind = ?
     WHERE id = ?`,
    [fields.name, rateType, rateKc, fields.rates.hour, fields.rates.day, fields.rates.km, fields.defaultUnit,
      fields.weekendPct, fields.holidayPct, fields.color, fields.kind, id]
  );
}

// Měkké smazání - viz NETRIVIÁLNÍ ROZHODNUTÍ v hlavičce souboru.
export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE work_categories SET is_deleted = 1 WHERE id = ?', [id]);
}

// --- denní záznamy práce ---

interface DayWorkRecordRow {
  id: number;
  date: string;
  category_id: number;
  quantity: number;
  unit: RateUnit;
  rate_kc: number;
  surcharge_pct: number;
  source: DayRecordSource;
  place_id: number | null;
  category_name: string;
  is_deleted: number;
  color: string;
}

function mapDayWorkRecord(row: DayWorkRecordRow): DayWorkRecordWithCategory {
  return {
    id: row.id,
    date: row.date,
    categoryId: row.category_id,
    placeId: row.place_id,
    quantity: row.quantity,
    unit: row.unit,
    rateKc: row.rate_kc,
    surchargePct: row.surcharge_pct,
    source: row.source,
    categoryName: row.category_name,
    categoryDeleted: row.is_deleted === 1,
    color: row.color,
  };
}

export async function getDayRecords(date: string): Promise<DayWorkRecordWithCategory[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DayWorkRecordRow>(
    `SELECT r.id, r.date, r.category_id, r.quantity, r.unit, r.rate_kc, r.surcharge_pct, r.source, r.place_id,
            c.name as category_name, c.is_deleted, c.color
     FROM day_work_records r
     JOIN work_categories c ON c.id = r.category_id
     WHERE r.date = ?
     ORDER BY r.id`,
    [date]
  );
  return rows.map(mapDayWorkRecord);
}

// Sazbu a příplatek spočítá volající (lib/workCalc.ts -> priceForRecord)
// - datová vrstva je jen uloží.
export async function addDayRecord(record: {
  date: string;
  categoryId: number;
  quantity: number;
  unit: RateUnit;
  rateKc: number;
  surchargePct: number;
  source: DayRecordSource;
  tripId?: number | null;
  placeId?: number | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO day_work_records (date, category_id, quantity, unit, rate_kc, surcharge_pct, source, trip_id, place_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.date, record.categoryId, record.quantity, record.unit, record.rateKc, record.surchargePct, record.source, record.tripId ?? null, record.placeId ?? null]
  );
  return result.lastInsertRowId;
}

export async function updateDayRecord(id: number, fields: { quantity: number; unit: RateUnit; rateKc: number }): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE day_work_records SET quantity = ?, unit = ?, rate_kc = ? WHERE id = ?', [
    fields.quantity,
    fields.unit,
    fields.rateKc,
    id,
  ]);
}

export async function deleteDayRecord(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM day_work_records WHERE id = ?', [id]);
}

// --- poznámka ke dni ---

export async function getDayNote(date: string): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ note: string }>(
    'SELECT note FROM day_notes WHERE date = ?',
    [date]
  );
  return row?.note ?? '';
}

export async function setDayNote(date: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO day_notes (date, note) VALUES (?, ?)
     ON CONFLICT (date) DO UPDATE SET note = excluded.note`,
    [date, note]
  );
}

// --- měsíční přehled (kalendář) ---

// Součet za den podle JEDNOTKY položky (zadání "u každého dne součet
// hodin") - dny a km nejdou na hodiny převést bez dalšího předpokladu,
// proto se počítají zvlášť a kalendář je zobrazí jako doplňkový údaj.
export async function getMonthSummary(
  year: number,
  month: number // 1-12
): Promise<Record<string, MonthDaySummary>> {
  const db = await getDb();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const rows = await db.getAllAsync<{ date: string; hours: number; days: number; km: number }>(
    `SELECT date,
            SUM(CASE WHEN unit = 'hour' THEN quantity ELSE 0 END) as hours,
            SUM(CASE WHEN unit = 'day' THEN quantity ELSE 0 END) as days,
            SUM(CASE WHEN unit = 'km' THEN quantity ELSE 0 END) as km
     FROM day_work_records
     WHERE date BETWEEN ? AND ?
     GROUP BY date`,
    [from, to]
  );

  const result: Record<string, MonthDaySummary> = {};
  for (const row of rows) {
    result[row.date] = { hours: row.hours, days: row.days, km: row.km };
  }
  return result;
}

// --- nastavení (klíč-hodnota, viz zadání "tabulka settings") ---

// Mapování AppSettings pole -> DB klíč (snake_case, stabilní napříč
// verzemi appky - i kdyby se TS název pole někdy přejmenoval).
const SETTINGS_KEYS: { [K in keyof AppSettings]: string } = {
  defaultDayLengthHours: 'default_day_length_hours',
  roundingMinutes: 'rounding_minutes',
  roundingMode: 'rounding_mode',
  numpadStepHours: 'numpad_step_hours',
  autoSubtractBreak: 'auto_subtract_break',
  breakMinutes: 'break_minutes',
  defaultCategoryIds: 'default_category_ids',
  defaultsOnlyWorkdays: 'defaults_only_workdays',
  weekendSurchargePct: 'weekend_surcharge_pct',
  holidaySurchargePct: 'holiday_surcharge_pct',
  dayNoteRequired: 'day_note_required',
  timeFormat24h: 'time_format_24h',
  weekStartsMonday: 'week_starts_monday',
  fontScale: 'font_scale',
  debugLogEnabled: 'debug_log_enabled',
  locationTrackingEnabled: 'location_tracking_enabled',
  locationMode: 'location_mode',
  continuousIntervalMinutes: 'continuous_interval_minutes',
  trackingDays: 'tracking_days',
  trackingStartMinutes: 'tracking_start_minutes',
  trackingEndMinutes: 'tracking_end_minutes',
  minStayMinutes: 'min_stay_minutes',
  reminderOnDeparture: 'reminder_on_departure',
  reminderMinStayMinutes: 'reminder_min_stay_minutes',
  reminderUnknownMinStayMinutes: 'reminder_unknown_min_stay_minutes',
  reminderDelayMinutes: 'reminder_delay_minutes',
  reminderOnArriveHome: 'reminder_on_arrive_home',
  reminderEvening: 'reminder_evening',
  reminderEveningMinutes: 'reminder_evening_minutes',
  remindersOnlyWorkdays: 'reminders_only_workdays',
  profileName: 'profile_name',
  profileIco: 'profile_ico',
  profileDic: 'profile_dic',
  profileAddress: 'profile_address',
  profilePhone: 'profile_phone',
  profileEmail: 'profile_email',
  routeTrackingEnabled: 'route_tracking_enabled',
  routeQuality: 'route_quality',
  minTripMeters: 'min_trip_meters',
  recentCustomColors: 'recent_custom_colors',
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const result = { ...DEFAULT_SETTINGS };
  for (const field of Object.keys(SETTINGS_KEYS) as (keyof AppSettings)[]) {
    const raw = stored.get(SETTINGS_KEYS[field]);
    if (raw === undefined) continue;
    try {
      (result as Record<keyof AppSettings, unknown>)[field] = JSON.parse(raw);
    } catch {
      // poškozená/neplatná hodnota v DB - necháme výchozí
    }
  }
  return result;
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<void> {
  const db = await getDb();
  for (const [field, value] of Object.entries(partial) as [keyof AppSettings, unknown][]) {
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [SETTINGS_KEYS[field], JSON.stringify(value)]
    );
  }
}

const MAX_RECENT_COLORS = 6;

// ČÁST 2 (barvy) - zavolá se při uložení kategorie s vlastní (ne
// paletovou) barvou. Nejnovější první, bez duplicit, max 6 - víc by se
// do jednoho řádku v ColorPicker.tsx nevešlo přehledně.
export async function addRecentCustomColor(hex: string): Promise<void> {
  const settings = await getSettings();
  const next = [hex, ...settings.recentCustomColors.filter((c) => c !== hex)].slice(
    0,
    MAX_RECENT_COLORS
  );
  await updateSettings({ recentCustomColors: next });
}

// --- reset (Nastavení -> Aplikace -> "Smazat všechna data") ---

export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM day_work_records;
    DELETE FROM day_notes;
    DELETE FROM day_initialized;
    DELETE FROM work_categories;
    DELETE FROM settings;
    DELETE FROM places;
    DELETE FROM visits;
    DELETE FROM location_points;
    DELETE FROM debug_log;
    DELETE FROM location_events;
    DELETE FROM geocode_cache;
    DELETE FROM day_work_records_removed;
    DELETE FROM trips;
    DELETE FROM route_points;
    DELETE FROM place_suggestions;
    DELETE FROM reminder_state;
  `);
  await seedDefaultCategories(db);
}

// --- uložená místa (etapa 2, ČÁST B) ---

interface PlaceRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  order_label: string;
  is_home: number;
  is_private: number;
  is_deleted: number;
}

function mapPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radius_m,
    orderLabel: row.order_label,
    isHome: row.is_home === 1,
    isPrivate: row.is_private === 1 || row.is_home === 1,
    isDeleted: row.is_deleted === 1,
  };
}

export async function listPlaces(includeDeleted = false): Promise<Place[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PlaceRow>(
    includeDeleted
      ? 'SELECT * FROM places ORDER BY name'
      : 'SELECT * FROM places WHERE is_deleted = 0 ORDER BY name'
  );
  return rows.map(mapPlace);
}

export interface PlaceFields {
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  orderLabel: string;
  isHome: boolean;
  isPrivate: boolean;
}

// Domov je vždy soukromé místo (A4) - hlídá se tady, ne jen v UI.
export async function createPlace(fields: PlaceFields): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO places (name, latitude, longitude, radius_m, order_label, is_home, is_private) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fields.name, fields.latitude, fields.longitude, fields.radiusM, fields.orderLabel, fields.isHome ? 1 : 0, fields.isHome || fields.isPrivate ? 1 : 0]
  );
  return result.lastInsertRowId;
}

export async function updatePlace(id: number, fields: PlaceFields): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE places SET name = ?, latitude = ?, longitude = ?, radius_m = ?, order_label = ?, is_home = ?, is_private = ? WHERE id = ?',
    [fields.name, fields.latitude, fields.longitude, fields.radiusM, fields.orderLabel, fields.isHome ? 1 : 0, fields.isHome || fields.isPrivate ? 1 : 0, id]
  );
}

// Měkké smazání - staré pobyty na tohle místo (visits.place_id) by
// jinak ztratily jméno, stejný důvod jako u work_categories.
export async function deletePlace(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE places SET is_deleted = 1 WHERE id = ?', [id]);
}

// --- pobyty (etapa 2, ČÁST B; oprava 2 - odvozené z událostí) ---
//
// Automatické pobyty (source clvisit/geofence/continuous) jsou ODVOZENÁ
// data - lib/visits.ts je přepočítává z location_events a tady se jen
// vymění (replaceDerivedVisits). Trvalé jsou jen ruční zásahy: ručně
// upravený pobyt (source 'manual') a ručně smazaný (deleted_by 'user').

interface VisitRow {
  id: number;
  place_id: number | null;
  unknown_latitude: number | null;
  unknown_longitude: number | null;
  start_at: string;
  end_at: string | null;
  source: VisitSource;
  start_uncertain: number;
  is_deleted: number;
  deleted_by: 'user' | 'migration' | null;
  place_name: string | null;
  place_radius_m: number | null;
  place_is_home: number | null;
  place_is_private: number | null;
  place_latitude: number | null;
  place_longitude: number | null;
}

function mapVisit(row: VisitRow): VisitWithPlace {
  return {
    id: row.id,
    placeId: row.place_id,
    unknownLatitude: row.unknown_latitude,
    unknownLongitude: row.unknown_longitude,
    startAt: row.start_at,
    endAt: row.end_at,
    source: row.source,
    startUncertain: row.start_uncertain === 1,
    isDeleted: row.is_deleted === 1,
    deletedBy: row.deleted_by,
    placeName: row.place_name,
    placeRadiusM: row.place_radius_m,
    placeIsHome: row.place_is_home === 1,
    placeIsPrivate: row.place_is_private === 1 || row.place_is_home === 1,
    placeLatitude: row.place_latitude,
    placeLongitude: row.place_longitude,
  };
}

const VISIT_SELECT = `SELECT v.*, p.name as place_name, p.radius_m as place_radius_m,
         p.is_home as place_is_home, p.is_private as place_is_private,
         p.latitude as place_latitude, p.longitude as place_longitude
  FROM visits v
  LEFT JOIN places p ON p.id = v.place_id`;

// Pobyty, co se (aspoň částečně) PŘEKRÝVAJÍ s daným LOKÁLNÍM dnem.
// Ořez na rozsah dne a "probíhá jen do teď" řeší lib/dayTimeline.ts.
export async function getVisitsForDay(date: string): Promise<VisitWithPlace[]> {
  const db = await getDb();
  const { startMs, endMs } = localDayBounds(date);
  const rows = await db.getAllAsync<VisitRow>(
    `${VISIT_SELECT}
     WHERE v.is_deleted = 0
       AND v.start_at < ?
       AND (v.end_at IS NULL OR v.end_at >= ?)
     ORDER BY v.start_at`,
    [new Date(endMs).toISOString(), new Date(startMs).toISOString()]
  );
  return rows.map(mapVisit);
}

// Ruční úprava = pobyt se stává ručním (přepočet ho pak nepřepíše).
export async function updateVisitTimes(id: number, startAt: string, endAt: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE visits SET start_at = ?, end_at = ?, start_uncertain = 0, source = 'manual' WHERE id = ?", [
    startAt,
    endAt,
    id,
  ]);
}

// Ruční smazání - zůstává jako "potlačení", ať ho přepočet nevrátí.
export async function deleteVisit(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE visits SET is_deleted = 1, deleted_by = 'user' WHERE id = ?", [id]);
}

// Začátek automatického pobytu, který přepočet od `fromIso` musí vzít
// celý: běží přes `fromIso`, nebo skončil těsně před ním (do 15 min -
// mohl by se sloučit s pobytem na stejném místě).
export async function findDerivedVisitStartNear(fromIso: string, mergeGapMs: number): Promise<string | null> {
  const db = await getDb();
  const gapIso = new Date(Date.parse(fromIso) - mergeGapMs).toISOString();
  const row = await db.getFirstAsync<{ start_at: string }>(
    `SELECT start_at FROM visits
     WHERE is_deleted = 0 AND source != 'manual' AND start_at < ? AND (end_at IS NULL OR end_at >= ?)
     ORDER BY start_at LIMIT 1`,
    [fromIso, gapIso]
  );
  return row?.start_at ?? null;
}

// Ruční a ručně smazané pobyty, co zasahují do přepočítávaného období.
export async function listUserTouchedVisits(fromIso: string | null): Promise<VisitWithPlace[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VisitRow>(
    `${VISIT_SELECT}
     WHERE ((v.is_deleted = 0 AND v.source = 'manual') OR (v.is_deleted = 1 AND v.deleted_by = 'user'))
       ${fromIso ? 'AND (v.end_at IS NULL OR v.end_at >= ?)' : ''}
     ORDER BY v.start_at`,
    fromIso ? [fromIso] : []
  );
  return rows.map(mapVisit);
}

export interface DerivedVisit {
  placeId: number | null;
  unknownLatitude: number | null;
  unknownLongitude: number | null;
  startAt: string;
  endAt: string | null;
  startUncertain: boolean;
  source: EngineVisitSource;
}

// Výměna automatických pobytů od `fromIso` (null = všech) za nově
// spočítané, v jedné transakci. `manualEnds` = otevřené ruční pobyty,
// které uzavřel začátek dalšího pobytu (A2 "jen jeden pobyt najednou").
export async function replaceDerivedVisits(
  fromIso: string | null,
  visits: DerivedVisit[],
  manualEnds: { id: number; endAt: string }[]
): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `DELETE FROM visits WHERE is_deleted = 0 AND source != 'manual' ${fromIso ? 'AND start_at >= ?' : ''}`,
      fromIso ? [fromIso] : []
    );
    for (const v of visits) {
      await txn.runAsync(
        `INSERT INTO visits (place_id, unknown_latitude, unknown_longitude, start_at, end_at, source, start_uncertain)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [v.placeId, v.unknownLatitude, v.unknownLongitude, v.startAt, v.endAt, v.source, v.startUncertain ? 1 : 0]
      );
    }
    for (const m of manualEnds) {
      await txn.runAsync('UPDATE visits SET end_at = ? WHERE id = ?', [m.endAt, m.id]);
    }
  });
}

// Migrace opravy 2: staré automatické pobyty nahradí přepočet z událostí.
export async function softDeleteLegacyAutoVisits(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE visits SET is_deleted = 1, deleted_by = 'migration' WHERE is_deleted = 0 AND source != 'manual'"
  );
}

// --- události polohy (oprava 2, A1) ---
//
// Každá událost (CLVisit příjezd/odjezd, geofence, significant change,
// průběžný bod) se uloží JEDNOU - otisk (typ + čas události [+ místo /
// souřadnice]) je UNIQUE, takže opakované doručení téže události iOS
// nic nezmění. Z téhle tabulky se počítají pobyty (lib/visits.ts).

export type LocationEventOrigin = 'live' | 'debug_log_replay' | 'legacy_visit';

export interface NewLocationEvent {
  kind: LocationEventKind;
  eventAt: string; // ISO - čas UDÁLOSTI
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  placeId: number | null;
  receivedAt: string; // ISO - kdy ji appka dostala
  origin: LocationEventOrigin;
}

const LOCATION_EVENTS_MAX_AGE_DAYS = 60;

export function locationEventFingerprint(e: Pick<NewLocationEvent, 'kind' | 'eventAt' | 'latitude' | 'longitude' | 'placeId'>): string {
  const ms = Date.parse(e.eventAt);
  const second = Math.floor(ms / 1000);
  switch (e.kind) {
    case 'visit_arrival':
    case 'visit_departure':
      // Stejný CLVisit doručený znovu má stejný čas; souřadnice se mezi
      // aktualizacemi téže návštěvy mírně liší, proto v otisku nejsou.
      return `${e.kind}|${second}`;
    case 'geofence_enter':
    case 'geofence_exit':
      return `${e.kind}|${second}|${e.placeId}`;
    default:
      return `${e.kind}|${ms}|${e.latitude?.toFixed(5)}|${e.longitude?.toFixed(5)}`;
  }
}

async function insertLocationEventWith(db: SQLite.SQLiteDatabase, e: NewLocationEvent): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO location_events
       (fingerprint, kind, event_at, latitude, longitude, accuracy_m, place_id, received_at, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      locationEventFingerprint(e),
      e.kind,
      normalizeIso(e.eventAt),
      e.latitude,
      e.longitude,
      e.accuracyM,
      e.placeId,
      normalizeIso(e.receivedAt),
      e.origin,
    ]
  );
  return result.changes > 0;
}

// Vrací pro každou událost, jestli byla NOVÁ (false = duplicita).
export async function insertLocationEvents(events: NewLocationEvent[]): Promise<boolean[]> {
  const db = await getDb();
  const inserted: boolean[] = [];
  for (const e of events) inserted.push(await insertLocationEventWith(db, e));
  if (inserted.some(Boolean)) {
    const cutoff = new Date(Date.now() - LOCATION_EVENTS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.runAsync('DELETE FROM location_events WHERE event_at < ?', [cutoff]);
  }
  return inserted;
}

export async function listLocationEvents(fromIso: string | null): Promise<EngineEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ kind: LocationEventKind; event_at: string; latitude: number | null; longitude: number | null; place_id: number | null }>(
    `SELECT kind, event_at, latitude, longitude, place_id FROM location_events
     ${fromIso ? 'WHERE event_at >= ?' : ''}
     ORDER BY event_at`,
    fromIso ? [fromIso] : []
  );
  return rows.map((r) => ({
    kind: r.kind,
    atMs: Date.parse(r.event_at),
    latitude: r.latitude,
    longitude: r.longitude,
    placeId: r.place_id,
  }));
}

// --- přejezdy a body tras (etapa 3) ---

interface TripRow {
  id: number;
  start_at: string;
  end_at: string;
  from_place_id: number | null;
  from_latitude: number | null;
  from_longitude: number | null;
  to_place_id: number | null;
  to_latitude: number | null;
  to_longitude: number | null;
  distance_m: number;
  is_estimate: number;
  point_count: number;
  road_distance_m: number | null;
  road_status: Trip['roadStatus'];
  road_note: string | null;
  km_override: number | null;
  is_private: number;
  vehicle_category_id: number | null;
  work_record_id: number | null;
  gps_first_point_at: string | null;
  gps_note: string | null;
  logged_at: string | null;
  user_edited: number;
  is_deleted: number;
  deleted_by: string | null;
}

export interface TripWithState extends Trip {
  loggedAt: string | null;
  userEdited: boolean;
  deletedBy: string | null;
}

function mapTrip(row: TripRow): TripWithState {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    fromPlaceId: row.from_place_id,
    fromLatitude: row.from_latitude,
    fromLongitude: row.from_longitude,
    toPlaceId: row.to_place_id,
    toLatitude: row.to_latitude,
    toLongitude: row.to_longitude,
    distanceM: row.distance_m,
    isEstimate: row.is_estimate === 1,
    pointCount: row.point_count,
    roadDistanceM: row.road_distance_m,
    roadStatus: row.road_status,
    roadNote: row.road_note,
    kmOverride: row.km_override,
    isPrivate: row.is_private === 1,
    vehicleCategoryId: row.vehicle_category_id,
    workRecordId: row.work_record_id,
    gpsFirstPointAt: row.gps_first_point_at,
    gpsNote: row.gps_note,
    isDeleted: row.is_deleted === 1,
    loggedAt: row.logged_at,
    userEdited: row.user_edited === 1,
    deletedBy: row.deleted_by,
  };
}

// Pobyty pro sladění přejezdů (od `fromIso`, null = všechny).
export async function listVisitsForTrips(fromIso: string | null): Promise<VisitWithPlace[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VisitRow>(
    `${VISIT_SELECT}
     WHERE v.is_deleted = 0 ${fromIso ? 'AND (v.end_at IS NULL OR v.end_at >= ?)' : ''}
     ORDER BY v.start_at`,
    fromIso ? [fromIso] : []
  );
  return rows.map(mapVisit);
}

export async function getLatestVisit(): Promise<VisitWithPlace | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VisitRow>(`${VISIT_SELECT} WHERE v.is_deleted = 0 ORDER BY v.start_at DESC LIMIT 1`);
  return row ? mapVisit(row) : null;
}

// Všechny přejezdy (i smazané - kvůli tomu, aby se ručně smazaný znovu
// neobjevil) končící po `fromIso`.
export async function listTripsForReconcile(fromIso: string | null): Promise<TripWithState[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    `SELECT * FROM trips ${fromIso ? 'WHERE end_at >= ?' : ''} ORDER BY start_at`,
    fromIso ? [fromIso] : []
  );
  return rows.map(mapTrip);
}

export interface TripComputedFields {
  startAt: string;
  endAt: string;
  fromPlaceId: number | null;
  fromLatitude: number | null;
  fromLongitude: number | null;
  toPlaceId: number | null;
  toLatitude: number | null;
  toLongitude: number | null;
  distanceM: number;
  isEstimate: boolean;
  pointCount: number;
  gpsFirstPointAt: string | null;
}

function computedParams(t: TripComputedFields): (string | number | null)[] {
  return [
    t.startAt, t.endAt, t.fromPlaceId, t.fromLatitude, t.fromLongitude, t.toPlaceId, t.toLatitude, t.toLongitude,
    t.distanceM, t.isEstimate ? 1 : 0, t.pointCount, t.gpsFirstPointAt,
  ];
}

// Výsledek sladění přejezdů (lib/trips.ts) v jedné transakci. Body trasy
// se k přejezdu přiřadí podle času (okno přejezdu ± 2 min).
export async function applyTripPlan(plan: {
  inserts: TripComputedFields[];
  updates: { id: number; fields: TripComputedFields; revive: boolean }[];
  removals: number[];
}): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const assigned: { id: number; t: TripComputedFields }[] = [];
    for (const u of plan.updates) {
      await txn.runAsync(
        // Změnila se trasa (jiné body / konce) -> dopočet po silnici znovu.
        `UPDATE trips SET
           road_status = CASE WHEN abs(distance_m - ?) > 1 OR point_count != ? OR start_at != ? OR end_at != ? THEN NULL ELSE road_status END,
           road_distance_m = CASE WHEN abs(distance_m - ?) > 1 OR point_count != ? OR start_at != ? OR end_at != ? THEN NULL ELSE road_distance_m END,
           start_at = ?, end_at = ?, from_place_id = ?, from_latitude = ?, from_longitude = ?,
           to_place_id = ?, to_latitude = ?, to_longitude = ?, distance_m = ?, is_estimate = ?, point_count = ?,
           gps_first_point_at = ? ${u.revive ? ', is_deleted = 0, deleted_by = NULL' : ''}
         WHERE id = ?`,
        [
          u.fields.distanceM, u.fields.pointCount, u.fields.startAt, u.fields.endAt,
          u.fields.distanceM, u.fields.pointCount, u.fields.startAt, u.fields.endAt,
          ...computedParams(u.fields), u.id,
        ]
      );
      assigned.push({ id: u.id, t: u.fields });
    }
    for (const t of plan.inserts) {
      const r = await txn.runAsync(
        `INSERT INTO trips (start_at, end_at, from_place_id, from_latitude, from_longitude, to_place_id, to_latitude,
           to_longitude, distance_m, is_estimate, point_count, gps_first_point_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        computedParams(t)
      );
      assigned.push({ id: r.lastInsertRowId, t });
    }
    for (const id of plan.removals) {
      await txn.runAsync("UPDATE trips SET is_deleted = 1, deleted_by = 'rebuild' WHERE id = ? AND is_deleted = 0", [id]);
      await txn.runAsync('UPDATE route_points SET trip_id = NULL WHERE trip_id = ?', [id]);
    }
    for (const { id, t } of assigned) {
      const from = new Date(Date.parse(t.startAt) - 2 * 60000).toISOString();
      const to = new Date(Date.parse(t.endAt) + 2 * 60000).toISOString();
      await txn.runAsync(
        'UPDATE route_points SET trip_id = ? WHERE timestamp >= ? AND timestamp <= ? AND (trip_id IS NULL OR trip_id != -1)',
        [id, from, to]
      );
    }
  });
}

// Přejezdy k zapsání do ladicího deníku (dokončené, ještě nezapsané).
export async function listUnloggedTrips(beforeIso: string): Promise<TripWithState[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    'SELECT * FROM trips WHERE is_deleted = 0 AND logged_at IS NULL AND end_at <= ? ORDER BY start_at',
    [beforeIso]
  );
  return rows.map(mapTrip);
}

export async function markTripLogged(id: number, gpsNote: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE trips SET logged_at = ?, gps_note = ? WHERE id = ?', [new Date().toISOString(), gpsNote, id]);
}

// Přejezdy zasahující do LOKÁLNÍHO dne (i smazané ne).
export async function getTripsForDay(date: string): Promise<TripWithState[]> {
  const db = await getDb();
  const { startMs, endMs } = localDayBounds(date);
  const rows = await db.getAllAsync<TripRow>(
    `SELECT t.* FROM trips t
     WHERE t.is_deleted = 0 AND t.start_at < ? AND t.end_at > ?
     ORDER BY t.start_at`,
    [new Date(endMs).toISOString(), new Date(startMs).toISOString()]
  );
  // Vazba na položku práce platí jen, dokud položka existuje.
  const trips = rows.map(mapTrip);
  const recordIds = trips.flatMap((t) => (t.workRecordId !== null ? [t.workRecordId] : []));
  if (recordIds.length > 0) {
    const existing = new Set(
      (await db.getAllAsync<{ id: number }>(
        `SELECT id FROM day_work_records WHERE id IN (${recordIds.map(() => '?').join(', ')})`,
        recordIds
      )).map((r) => r.id)
    );
    for (const t of trips) if (t.workRecordId !== null && !existing.has(t.workRecordId)) t.workRecordId = null;
  }
  return trips;
}

// Pracovní km podle LOKÁLNÍHO dne začátku přejezdu (kalendář).
export async function getMonthTripKm(year: number, month: number): Promise<Record<string, number>> {
  const db = await getDb();
  const from = new Date(year, month - 1, 1).toISOString();
  const to = new Date(year, month, 1).toISOString();
  const rows = await db.getAllAsync<{ start_at: string; km: number }>(
    `SELECT start_at, COALESCE(km_override, COALESCE(road_distance_m, distance_m) / 1000.0) as km FROM trips
     WHERE is_deleted = 0 AND is_private = 0 AND start_at >= ? AND start_at < ?`,
    [from, to]
  );
  const result: Record<string, number> = {};
  for (const r of rows) {
    const d = new Date(r.start_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    result[key] = (result[key] ?? 0) + r.km;
  }
  return result;
}

export async function updateTripUserFields(
  id: number,
  fields: { kmOverride: number | null; isPrivate: boolean; vehicleCategoryId: number | null }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE trips SET km_override = ?, is_private = ?, vehicle_category_id = ?, user_edited = 1 WHERE id = ?',
    [fields.kmOverride, fields.isPrivate ? 1 : 0, fields.vehicleCategoryId, id]
  );
}

// "Zahodit trasu" - body se od přejezdu odpojí a už se k němu nepřiřadí
// (označí se trip_id = -1), přejezd se přepočítá jako odhad.
export async function discardTripRoute(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE route_points SET trip_id = -1 WHERE trip_id = ?', [id]);
  await db.runAsync('UPDATE trips SET user_edited = 1, road_status = NULL, road_distance_m = NULL WHERE id = ?', [id]);
}

// Přejezdy čekající na dopočet po silnici (nové / změněné / bez sítě).
export async function listTripsNeedingRoad(limit: number): Promise<TripWithState[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    `SELECT * FROM trips WHERE is_deleted = 0 AND (road_status IS NULL OR road_status = 'pending') AND end_at <= ?
     ORDER BY end_at DESC LIMIT ?`,
    [new Date().toISOString(), limit]
  );
  return rows.map(mapTrip);
}

export async function setTripRoad(id: number, status: 'pending' | 'done' | 'none', distanceM: number | null, note: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE trips SET road_status = ?, road_distance_m = ?, road_note = ? WHERE id = ?', [status, distanceM, note, id]);
}

// Body přejezdu pro dopočet (bez zahozených).
export async function listRoutePointsForTrip(tripId: number): Promise<RoutePoint[]> {
  return (await listRoutePointsForTrips([tripId])).get(tripId) ?? [];
}

export async function deleteTrip(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE trips SET is_deleted = 1, deleted_by = 'user' WHERE id = ?", [id]);
}

export async function setTripsWorkRecord(tripIds: number[], recordId: number): Promise<void> {
  const db = await getDb();
  for (const id of tripIds) await db.runAsync('UPDATE trips SET work_record_id = ? WHERE id = ?', [recordId, id]);
}

export async function insertRoutePoint(p: RoutePoint): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO route_points (timestamp, latitude, longitude, accuracy_m, speed_mps) VALUES (?, ?, ?, ?, ?)',
    [normalizeIso(p.timestamp), p.latitude, p.longitude, p.accuracyM, p.speedMps]
  );
}

// Body v časovém rozsahu - bez bodů zahozených u trasy (trip_id = -1).
export async function listRoutePoints(fromIso: string, toIso: string): Promise<RoutePoint[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ timestamp: string; latitude: number; longitude: number; accuracy_m: number | null; speed_mps: number | null }>(
    `SELECT timestamp, latitude, longitude, accuracy_m, speed_mps FROM route_points
     WHERE timestamp >= ? AND timestamp <= ? AND (trip_id IS NULL OR trip_id != -1)
     ORDER BY timestamp`,
    [fromIso, toIso]
  );
  return rows.map((r) => ({ timestamp: r.timestamp, latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracy_m, speedMps: r.speed_mps }));
}

export async function listRoutePointsForTrips(tripIds: number[]): Promise<Map<number, RoutePoint[]>> {
  const result = new Map<number, RoutePoint[]>();
  if (tripIds.length === 0) return result;
  const db = await getDb();
  const rows = await db.getAllAsync<{ trip_id: number; timestamp: string; latitude: number; longitude: number; accuracy_m: number | null; speed_mps: number | null }>(
    `SELECT trip_id, timestamp, latitude, longitude, accuracy_m, speed_mps FROM route_points
     WHERE trip_id IN (${tripIds.map(() => '?').join(', ')}) ORDER BY timestamp`,
    tripIds
  );
  for (const r of rows) {
    const list = result.get(r.trip_id) ?? [];
    list.push({ timestamp: r.timestamp, latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracy_m, speedMps: r.speed_mps });
    result.set(r.trip_id, list);
  }
  return result;
}

// --- zápis pobytů, učení a připomenutí (etapa 4.3) ---

// Místa, ke kterým už v daný den existuje zápis (pobyt = zapsaný).
export async function recordedPlacesForDate(date: string): Promise<Set<number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ place_id: number }>(
    'SELECT DISTINCT place_id FROM day_work_records WHERE date = ? AND place_id IS NOT NULL',
    [date]
  );
  return new Set(rows.map((r) => r.place_id));
}

export interface PlaceSuggestion {
  categoryId: number;
  unit: RateUnit;
  locked: boolean;
}

// Návrh stroje pro místo: zamčený ručně, jinak nejčastější stroj z
// posledních 30 zápisů u toho místa (appka se učí ze zápisů), jinak null.
export async function getPlaceSuggestion(placeId: number): Promise<PlaceSuggestion | null> {
  const db = await getDb();
  const locked = await db.getFirstAsync<{ category_id: number; unit: RateUnit }>(
    `SELECT s.category_id, s.unit FROM place_suggestions s
     JOIN work_categories c ON c.id = s.category_id AND c.is_deleted = 0
     WHERE s.place_id = ? AND s.locked = 1`,
    [placeId]
  );
  if (locked) return { categoryId: locked.category_id, unit: locked.unit, locked: true };
  const learned = await db.getFirstAsync<{ category_id: number; unit: RateUnit }>(
    `SELECT r.category_id, r.unit FROM (
       SELECT category_id, unit FROM day_work_records WHERE place_id = ? ORDER BY id DESC LIMIT 30
     ) r JOIN work_categories c ON c.id = r.category_id AND c.is_deleted = 0
     GROUP BY r.category_id, r.unit ORDER BY COUNT(*) DESC LIMIT 1`,
    [placeId]
  );
  return learned ? { categoryId: learned.category_id, unit: learned.unit, locked: false } : null;
}

export async function setPlaceSuggestionLock(placeId: number, categoryId: number, unit: RateUnit, locked: boolean): Promise<void> {
  const db = await getDb();
  if (!locked) {
    await db.runAsync('DELETE FROM place_suggestions WHERE place_id = ?', [placeId]);
    return;
  }
  await db.runAsync(
    `INSERT INTO place_suggestions (place_id, category_id, unit, locked, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (place_id) DO UPDATE SET category_id = excluded.category_id, unit = excluded.unit, locked = 1,
       updated_at = excluded.updated_at`,
    [placeId, categoryId, unit, new Date().toISOString()]
  );
}

export interface ReminderState {
  key: string;
  state: 'scheduled' | 'sent' | 'evening' | 'dismissed' | 'written';
  fireAt: string | null;
  payload: string;
}

export async function listReminderStates(keyPrefix: string): Promise<ReminderState[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; state: ReminderState['state']; fire_at: string | null; payload: string }>(
    'SELECT key, state, fire_at, payload FROM reminder_state WHERE key LIKE ?',
    [`${keyPrefix}%`]
  );
  return rows.map((r) => ({ key: r.key, state: r.state, fireAt: r.fire_at, payload: r.payload }));
}

export async function setReminderState(key: string, state: ReminderState['state'], fireAt: string | null, payload = ''): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO reminder_state (key, state, fire_at, payload, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET state = excluded.state, fire_at = excluded.fire_at, payload = excluded.payload,
       updated_at = excluded.updated_at`,
    [key, state, fireAt, payload, new Date().toISOString()]
  );
}

export async function deleteReminderState(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM reminder_state WHERE key = ?', [key]);
}

// Poslední zachycená událost polohy (Stav záznamu, 4.2).
export async function getLastLocationEventAt(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ event_at: string }>('SELECT event_at FROM location_events ORDER BY event_at DESC LIMIT 1');
  return row?.event_at ?? null;
}

export async function countLocationEventsBetween(fromIso: string, toIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM location_events WHERE event_at >= ? AND event_at <= ?',
    [fromIso, toIso]
  );
  return row?.c ?? 0;
}

// --- záloha a obnova (etapa 4.1) ---

// Konzistentní snímek celé DB do souboru (VACUUM INTO).
export async function snapshotDatabaseTo(path: string, db?: SQLite.SQLiteDatabase): Promise<void> {
  const target = db ?? (await getDb());
  await target.execAsync(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
}

export async function getDatabasePath(): Promise<string> {
  return (await getDb()).databasePath;
}

// Před nahrazením souboru databáze při obnově (pak se appka znovu načte).
export async function closeDatabaseForRestore(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.closeAsync();
  dbPromise = null;
}

// Je databáze prakticky prázdná (čerstvá instalace)? - nabídka obnovy.
export async function isDatabaseEmpty(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ records: number; places: number; visits: number }>(
    `SELECT (SELECT COUNT(*) FROM day_work_records) as records, (SELECT COUNT(*) FROM places) as places,
            (SELECT COUNT(*) FROM visits) as visits`
  );
  return !row || (row.records === 0 && row.places === 0 && row.visits === 0);
}

// --- cache názvů obcí (oprava 2, F1/F2) ---

export async function getGeocodeCache(keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; locality: string }>(
    `SELECT key, locality FROM geocode_cache WHERE key IN (${keys.map(() => '?').join(', ')})`,
    keys
  );
  return new Map(rows.map((r) => [r.key, r.locality]));
}

export async function putGeocodeCache(key: string, locality: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO geocode_cache (key, locality, looked_up_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET locality = excluded.locality, looked_up_at = excluded.looked_up_at`,
    [key, locality, new Date().toISOString()]
  );
}

// --- interní hodnoty (stav appky, ne uživatelské nastavení) ---
//
// Ve stejné tabulce `settings`, s prefixem "internal." - getSettings()
// je ignoruje (čte jen klíče z SETTINGS_KEYS).

export const KEY_VISITS_REBUILD_PENDING = 'visits_rebuild_pending';
export const KEY_TRIPS_BACKFILL_PENDING = 'trips_backfill_pending';

async function setInternalValueWith(db: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [`internal.${key}`, value]
  );
}

export async function setInternalValue(key: string, value: string): Promise<void> {
  await setInternalValueWith(await getDb(), key, value);
}

export async function getInternalValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`internal.${key}`]);
  return row?.value ?? null;
}

// --- ladicí deník (etapa 2, ČÁST B bod 9) ---

interface DebugLogRow {
  id: number;
  timestamp: string;
  event_type: DebugEventType;
  detail: string;
  battery_level: number | null;
  latitude: number | null;
  longitude: number | null;
  delivered_at: string | null;
  delivered_battery: number | null;
}

function mapDebugLog(row: DebugLogRow): DebugLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    detail: row.detail,
    batteryLevel: row.battery_level,
    latitude: row.latitude,
    longitude: row.longitude,
    deliveredAt: row.delivered_at,
    deliveredBattery: row.delivered_battery,
  };
}

const DEBUG_LOG_MAX_AGE_DAYS = 14;

export async function addDebugLogEntry(entry: {
  timestamp: string;
  eventType: DebugEventType;
  detail: string;
  batteryLevel: number | null;
  latitude: number | null;
  longitude: number | null;
  deliveredAt?: string | null;
  deliveredBattery?: number | null;
}): Promise<void> {
  // Jedno centrální místo pro zapnuto/vypnuto (Nastavení -> Aplikace ->
  // Ladicí deník) - volající se o to nemusí starat.
  const settings = await getSettings();
  if (!settings.debugLogEnabled) return;

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO debug_log (timestamp, event_type, detail, battery_level, latitude, longitude, delivered_at, delivered_battery)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeIso(entry.timestamp),
      entry.eventType,
      entry.detail,
      entry.batteryLevel,
      entry.latitude,
      entry.longitude,
      entry.deliveredAt ?? null,
      entry.deliveredBattery ?? null,
    ]
  );
  // Prořezání starých záznamů při každém zápisu - ladicí deník běží
  // dny/týdny v terénu, bez tohohle by neomezeně rostl.
  const cutoff = new Date(Date.now() - DEBUG_LOG_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync('DELETE FROM debug_log WHERE timestamp < ?', [cutoff]);
}

export async function listDebugLog(limit = 500): Promise<DebugLogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DebugLogRow>(
    'SELECT * FROM debug_log ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
  return rows.map(mapDebugLog);
}

export async function clearDebugLog(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM debug_log', []);
}

// --- body polohy (etapa 2, ČÁST B bod 3 - průběžný režim) ---

const LOCATION_POINTS_MAX_AGE_DAYS = 14;

export async function insertLocationPoint(timestamp: string, latitude: number, longitude: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO location_points (timestamp, latitude, longitude) VALUES (?, ?, ?)', [
    timestamp,
    latitude,
    longitude,
  ]);
  const cutoff = new Date(Date.now() - LOCATION_POINTS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync('DELETE FROM location_points WHERE timestamp < ?', [cutoff]);
}
