// Sdílené typy datové vrstvy (viz lib/db.ts). Držené odděleně od DB
// kódu, ať je jde importovat i do UI komponent bez tažení SQLite kódu.

export type RateType = 'hourly' | 'daily';

// ČÁST 3 (zadání "typ stroj/práce") - čistě informační rozlišení, na
// nic jiného (geometrii/cenu) nemá vliv - jen jiná ikona v Nastavení.
export type CategoryKind = 'machine' | 'labor';

export interface WorkCategory {
  id: number;
  name: string;
  rateType: RateType;
  rateKc: number;
  sortOrder: number;
  isDeleted: boolean;
  color: string; // hex - buď z theme.ts -> categoryPalette, nebo vlastní (viz components/ColorPicker.tsx)
  kind: CategoryKind;
}

export interface DayWorkRecord {
  id: number;
  date: string; // YYYY-MM-DD
  categoryId: number;
  quantity: number; // hodiny (rateType 'hourly') nebo dny/půldny (rateType 'daily')
}

export interface DayWorkRecordWithCategory extends DayWorkRecord {
  categoryName: string;
  rateType: RateType;
  rateKc: number;
  categoryDeleted: boolean;
  color: string;
}

export interface MonthDaySummary {
  hours: number;
  days: number;
}

// Aplikační nastavení (klíč-hodnota v SQLite, viz lib/db.ts ->
// getSettings/updateSettings). Jeden plochý objekt - sekce v UI
// (Nastavení -> Zápisy/Aplikace/...) jsou jen vizuální seskupení,
// datově je to jedna sada hodnot.
export type RoundingMinutes = 0 | 15 | 30 | 60;
export type NumpadStepHours = 0.25 | 0.5 | 1;
export type FontScale = 'normal' | 'large';

export interface AppSettings {
  // --- Zápisy ---
  defaultDayLengthHours: number;
  roundingMinutes: RoundingMinutes;
  numpadStepHours: NumpadStepHours;
  autoSubtractBreak: boolean;
  breakMinutes: number;
  defaultCategoryIds: number[];
  dayNoteRequired: boolean;
  // --- Aplikace ---
  timeFormat24h: boolean;
  weekStartsMonday: boolean;
  hapticsEnabled: boolean;
  fontScale: FontScale;
  // --- interní (ne vlastní obrazovka v Nastavení) ---
  // Poslední vlastní (hex) barvy kategorií - viz components/ColorPicker.tsx,
  // "Naposledy použité".
  recentCustomColors: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultDayLengthHours: 8,
  roundingMinutes: 0,
  numpadStepHours: 0.5,
  autoSubtractBreak: false,
  breakMinutes: 30,
  defaultCategoryIds: [],
  dayNoteRequired: false,
  timeFormat24h: true,
  weekStartsMonday: true,
  hapticsEnabled: true,
  fontScale: 'normal',
  recentCustomColors: [],
};
