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

// --- ČÁST B (etapa 2) - uložená místa, pobyty, ladicí deník ---

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  orderLabel: string; // zakázka/odběratel - zatím jen text, viz PŘÍPRAVA NA FAKTURACI
  isHome: boolean; // vyloučeno z "NAVRHNOUT Z POBYTŮ" (zadání "bez domova")
  isDeleted: boolean;
}

// "clvisit"/"geofence" = úsporný režim (viz modules/visit-monitor),
// "continuous" = průběžný režim (odvozeno z bodů), "manual" = ručně
// upravené/vytvořené v Detailu dne.
export type VisitSource = 'clvisit' | 'geofence' | 'continuous' | 'manual';

export interface Visit {
  id: number;
  placeId: number | null; // null = neznámé místo
  unknownLatitude: number | null;
  unknownLongitude: number | null;
  startAt: string; // ISO datetime
  endAt: string | null; // null = pobyt ještě neskončil (probíhá)
  source: VisitSource;
  isDeleted: boolean;
}

export interface VisitWithPlace extends Visit {
  placeName: string | null;
  placeRadiusM: number | null;
  placeIsHome: boolean;
}

export type DebugEventType =
  | 'arrival'
  | 'departure'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'point'
  | 'app_wake'
  | 'significant_change'
  | 'permission'
  | 'error';

export interface DebugLogEntry {
  id: number;
  timestamp: string; // ISO
  eventType: DebugEventType;
  detail: string;
  batteryLevel: number | null; // 0-1
  latitude: number | null;
  longitude: number | null;
}

export type LocationTrackingMode = 'economical' | 'continuous';

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
  debugLogEnabled: boolean;
  // --- Poloha a trasy (etapa 2, ČÁST B) ---
  locationTrackingEnabled: boolean;
  locationMode: LocationTrackingMode;
  continuousIntervalMinutes: number; // 5-10
  // Dny v týdnu, kdy se zaznamenává - 0=neděle..6=sobota (JS Date.getDay()).
  trackingDays: number[];
  trackingStartMinutes: number; // minut od půlnoci, např. 6:00 = 360
  trackingEndMinutes: number; // např. 19:00 = 1140
  minStayMinutes: number; // krátké pobyty pod tohle se ignorují
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
  debugLogEnabled: true,
  locationTrackingEnabled: false,
  locationMode: 'economical',
  continuousIntervalMinutes: 7,
  trackingDays: [1, 2, 3, 4, 5], // Po-Pá
  trackingStartMinutes: 360, // 6:00
  trackingEndMinutes: 1140, // 19:00
  minStayMinutes: 10,
  recentCustomColors: [],
};
