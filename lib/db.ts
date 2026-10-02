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
// hodiny a zvlášť dny): význam (hodiny, nebo dny/půldny) určuje
// work_categories.rate_type u navázané kategorie. Zamezuje to dvěma
// věčně jednomu z nich NULL sloupcům.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - `day_initialized`: "výchozí položky nového
// dne" (viz lib/workCalc.ts -> applyDayDefaults) se mají předvyplnit
// jen PRVNÍ návštěvu prázdného dne, ne pokaždé, když je den prázdný -
// jinak by se uživateli vracely položky, co si úmyslně smazal (den, kdy
// nepracoval). Tahle tabulka je jediný způsob, jak rozlišit "den ještě
// nikdy neotevřený" od "den otevřený a vědomě vyprázdněný".

import * as SQLite from 'expo-sqlite';
import { paletteColorAt } from '@/theme';
import type {
  AppSettings,
  CategoryKind,
  DayWorkRecordWithCategory,
  MonthDaySummary,
  RateType,
  WorkCategory,
} from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'dochazka.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

const DEFAULT_CATEGORIES: Array<{ name: string; rateType: RateType; kind: CategoryKind }> = [
  { name: 'Tatra', rateType: 'hourly', kind: 'machine' },
  { name: 'Bagr', rateType: 'hourly', kind: 'machine' },
  { name: 'Ruční práce', rateType: 'hourly', kind: 'labor' },
];

async function seedDefaultCategories(db: SQLite.SQLiteDatabase): Promise<void> {
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    await db.runAsync(
      'INSERT INTO work_categories (name, rate_type, rate_kc, sort_order, color, kind) VALUES (?, ?, ?, ?, ?, ?)',
      [c.name, c.rateType, 0, i, paletteColorAt(i), c.kind]
    );
  }
}

export async function initDb(): Promise<void> {
  const db = await getDb();
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
  `);

  await migrateAddCategoryColor(db);
  await migrateAddCategoryKind(db);

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

// --- kategorie prací / stroje ---

interface CategoryRow {
  id: number;
  name: string;
  rate_type: RateType;
  rate_kc: number;
  sort_order: number;
  is_deleted: number;
  color: string;
  kind: CategoryKind;
}

function mapCategory(row: CategoryRow): WorkCategory {
  return {
    id: row.id,
    name: row.name,
    rateType: row.rate_type,
    rateKc: row.rate_kc,
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

export async function createCategory(
  name: string,
  rateType: RateType,
  rateKc: number,
  color: string,
  kind: CategoryKind
): Promise<number> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sort_order) as maxOrder FROM work_categories'
  );
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  const result = await db.runAsync(
    'INSERT INTO work_categories (name, rate_type, rate_kc, sort_order, color, kind) VALUES (?, ?, ?, ?, ?, ?)',
    [name, rateType, rateKc, sortOrder, color, kind]
  );
  return result.lastInsertRowId;
}

export async function updateCategory(
  id: number,
  fields: { name: string; rateType: RateType; rateKc: number; color: string; kind: CategoryKind }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE work_categories SET name = ?, rate_type = ?, rate_kc = ?, color = ?, kind = ? WHERE id = ?',
    [fields.name, fields.rateType, fields.rateKc, fields.color, fields.kind, id]
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
  category_name: string;
  rate_type: RateType;
  rate_kc: number;
  is_deleted: number;
  color: string;
}

function mapDayWorkRecord(row: DayWorkRecordRow): DayWorkRecordWithCategory {
  return {
    id: row.id,
    date: row.date,
    categoryId: row.category_id,
    quantity: row.quantity,
    categoryName: row.category_name,
    rateType: row.rate_type,
    rateKc: row.rate_kc,
    categoryDeleted: row.is_deleted === 1,
    color: row.color,
  };
}

export async function getDayRecords(date: string): Promise<DayWorkRecordWithCategory[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DayWorkRecordRow>(
    `SELECT r.id, r.date, r.category_id, r.quantity,
            c.name as category_name, c.rate_type, c.rate_kc, c.is_deleted, c.color
     FROM day_work_records r
     JOIN work_categories c ON c.id = r.category_id
     WHERE r.date = ?
     ORDER BY r.id`,
    [date]
  );
  return rows.map(mapDayWorkRecord);
}

export async function addDayRecord(
  date: string,
  categoryId: number,
  quantity: number
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO day_work_records (date, category_id, quantity) VALUES (?, ?, ?)',
    [date, categoryId, quantity]
  );
  // Ruční přidání položky taky počítá jako "den je inicializovaný" -
  // viz NETRIVIÁLNÍ ROZHODNUTÍ v hlavičce souboru (ať se po smazání
  // všeho nepředvyplní znovu výchozí položky).
  await markDayInitialized(date);
  return result.lastInsertRowId;
}

export async function updateDayRecordQuantity(id: number, quantity: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE day_work_records SET quantity = ? WHERE id = ?', [quantity, id]);
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

// --- "den byl inicializován" (výchozí položky nového dne) ---

export async function isDayInitialized(date: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT 1 FROM day_initialized WHERE date = ?', [date]);
  return row !== null;
}

export async function markDayInitialized(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO day_initialized (date) VALUES (?)', [date]);
}

// --- měsíční přehled (kalendář) ---

// Součet za den je jen z HODINOVÝCH položek (viz zadání "u každého dne
// součet hodin") - denní/půldenní položky nejdou na hodiny převést bez
// dalšího předpokladu, proto se počítají zvlášť (`days`) a kalendář je
// zobrazí jako doplňkový údaj vedle hodin, ne sečtené dohromady.
export async function getMonthSummary(
  year: number,
  month: number // 1-12
): Promise<Record<string, MonthDaySummary>> {
  const db = await getDb();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const rows = await db.getAllAsync<{ date: string; hours: number; days: number }>(
    `SELECT r.date as date,
            SUM(CASE WHEN c.rate_type = 'hourly' THEN r.quantity ELSE 0 END) as hours,
            SUM(CASE WHEN c.rate_type = 'daily' THEN r.quantity ELSE 0 END) as days
     FROM day_work_records r
     JOIN work_categories c ON c.id = r.category_id
     WHERE r.date BETWEEN ? AND ?
     GROUP BY r.date`,
    [from, to]
  );

  const result: Record<string, MonthDaySummary> = {};
  for (const row of rows) {
    result[row.date] = { hours: row.hours, days: row.days };
  }
  return result;
}

// --- nastavení (klíč-hodnota, viz zadání "tabulka settings") ---

// Mapování AppSettings pole -> DB klíč (snake_case, stabilní napříč
// verzemi appky - i kdyby se TS název pole někdy přejmenoval).
const SETTINGS_KEYS: { [K in keyof AppSettings]: string } = {
  defaultDayLengthHours: 'default_day_length_hours',
  roundingMinutes: 'rounding_minutes',
  numpadStepHours: 'numpad_step_hours',
  autoSubtractBreak: 'auto_subtract_break',
  breakMinutes: 'break_minutes',
  defaultCategoryIds: 'default_category_ids',
  dayNoteRequired: 'day_note_required',
  timeFormat24h: 'time_format_24h',
  weekStartsMonday: 'week_starts_monday',
  hapticsEnabled: 'haptics_enabled',
  fontScale: 'font_scale',
  recentCustomColors: 'recent_custom_colors',
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const result = { ...DEFAULT_SETTINGS };
  for (const field of Object.keys(SETTINGS_KEYS) as Array<keyof AppSettings>) {
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
  for (const [field, value] of Object.entries(partial) as Array<[keyof AppSettings, unknown]>) {
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
  `);
  await seedDefaultCategories(db);
}
