// Sdílené typy datové vrstvy (viz lib/db.ts). Držené odděleně od DB
// kódu, ať je jde importovat i do UI komponent bez tažení SQLite kódu.

export type RateType = 'hourly' | 'daily';

// Oprava 2, C1 - jednotka sazby/položky. Stroj může mít vyplněné všechny
// tři sazby, jedna je výchozí; při zápisu do dne jde jednotku přepnout.
export type RateUnit = 'hour' | 'day' | 'km';

// Původ položky dne (B2): ruční zápis, potvrzený návrh výchozích
// položek, nebo potvrzený návrh z pobytů.
export type DayRecordSource = 'manual' | 'default' | 'suggestion' | 'trip' | 'reminder';

// ČÁST 3 (zadání "typ stroj/práce") - čistě informační rozlišení, na
// nic jiného (geometrii/cenu) nemá vliv - jen jiná ikona v Nastavení.
export type CategoryKind = 'machine' | 'labor';

export interface WorkCategory {
  id: number;
  name: string;
  rates: Record<RateUnit, number>; // Kč za hodinu / den / km
  defaultUnit: RateUnit;
  // Vlastní příplatek v % (C2): null = použij výchozí z Nastavení ->
  // Zápisy, 0 = bez příplatku.
  weekendPct: number | null;
  holidayPct: number | null;
  sortOrder: number;
  isDeleted: boolean;
  color: string; // hex - buď z theme.ts -> categoryPalette, nebo vlastní (viz components/ColorPicker.tsx)
  kind: CategoryKind;
}

export interface DayWorkRecord {
  id: number;
  date: string; // YYYY-MM-DD
  categoryId: number;
  placeId: number | null; // místo, ke kterému zápis patří (zápis pobytu, etapa 4)
  quantity: number; // v jednotce `unit`
  unit: RateUnit;
  // Sazba a příplatek uložené v okamžiku zápisu (C1/C2) - pozdější
  // změna ceníku nemění staré dny.
  rateKc: number;
  surchargePct: number;
  source: DayRecordSource;
}

export interface DayWorkRecordWithCategory extends DayWorkRecord {
  categoryName: string;
  categoryDeleted: boolean;
  color: string;
}

export interface MonthDaySummary {
  hours: number;
  days: number;
  km: number;
}

// --- ČÁST B (etapa 2) - uložená místa, pobyty, ladicí deník ---

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  orderLabel: string; // zakázka/odběratel - zatím jen text, viz PŘÍPRAVA NA FAKTURACI
  isHome: boolean; // domov - vždy zároveň soukromé místo
  // Oprava 2, A4: soukromé místo (domov a podobně) se nepočítá do
  // pracovní doby ani do "NAVRHNOUT Z POBYTŮ", v průběhu dne je tlumené.
  isPrivate: boolean;
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
  // Odjezd bez zachyceného příjezdu - začátek neznámý (startAt = endAt).
  startUncertain: boolean;
  isDeleted: boolean;
  // Kdo pobyt smazal: 'user' (ručně - při přepočtu se znovu neobjeví),
  // 'migration' (nahrazeno přepočtem z událostí, oprava 2), null.
  deletedBy: 'user' | 'migration' | null;
}

export interface VisitWithPlace extends Visit {
  placeName: string | null;
  placeRadiusM: number | null;
  placeIsHome: boolean;
  placeIsPrivate: boolean;
  placeLatitude: number | null;
  placeLongitude: number | null;
}

// --- etapa 3 - přejezdy ---

// Přejezd mezi dvěma pobyty. ODVOZENÝ z mezer mezi pobyty (lib/trips.ts
// -> reconcileTrips), ale je to trvalý řádek - nese ruční úpravy (km,
// soukromá jízda, vozidlo, smazání) a vazbu na položku práce.
export interface Trip {
  id: number;
  startAt: string; // ISO - odjezd
  endAt: string; // ISO - příjezd
  fromPlaceId: number | null;
  fromLatitude: number | null;
  fromLongitude: number | null;
  toPlaceId: number | null;
  toLatitude: number | null;
  toLongitude: number | null;
  distanceM: number; // vypočtené z bodů trasy, nebo odhad
  isEstimate: boolean; // vzdušná vzdálenost × 1,3 (žádné použitelné body)
  pointCount: number;
  kmOverride: number | null; // ručně opravené km
  isPrivate: boolean; // soukromá jízda - nepočítá se do pracovních km
  vehicleCategoryId: number | null;
  workRecordId: number | null; // položka práce, do které se km přidaly
  gpsFirstPointAt: string | null;
  gpsNote: string | null; // proč chybí body (deník)
  isDeleted: boolean;
}

export interface RoutePoint {
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMps: number | null;
}

export type RouteQuality = 'economical' | 'precise';

export type DebugEventType =
  | 'arrival'
  | 'departure'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'point'
  | 'app_wake'
  | 'significant_change'
  | 'permission'
  | 'error'
  | 'trip_start'
  | 'trip_end'
  | 'trip'
  | 'backup'
  | 'reminder';

export interface DebugLogEntry {
  id: number;
  timestamp: string; // ISO
  eventType: DebugEventType;
  detail: string;
  batteryLevel: number | null; // 0-1, v čase události (null u opožděně doručených)
  latitude: number | null;
  longitude: number | null;
  // Opožděně doručená událost (iOS doručí CLVisit třeba až po hodinách):
  // kdy a s jakou baterií appka událost skutečně dostala.
  deliveredAt: string | null;
  deliveredBattery: number | null;
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
  defaultDayLengthHours: number; // 0 = proměnná pracovní doba (nic se nepředvyplňuje)
  roundingMinutes: RoundingMinutes;
  numpadStepHours: NumpadStepHours;
  autoSubtractBreak: boolean;
  breakMinutes: number;
  defaultCategoryIds: number[];
  defaultsOnlyWorkdays: boolean; // výchozí položky nabízet jen v pracovní dny (B2)
  weekendSurchargePct: number; // výchozí příplatek za víkend (C2)
  holidaySurchargePct: number; // výchozí příplatek za svátek (C2)
  dayNoteRequired: boolean;
  // --- Aplikace ---
  timeFormat24h: boolean;
  weekStartsMonday: boolean;
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
  // --- Připomenutí zápisu (etapa 4.3) ---
  reminderOnDeparture: boolean; // po odjezdu z pracovního místa
  reminderMinStayMinutes: number; // jen po pobytu aspoň tak dlouhém
  reminderDelayMinutes: number; // odeslat až po tolika minutách (návrat = zrušit)
  reminderOnArriveHome: boolean; // po příjezdu domů souhrn nezapsaných pobytů
  reminderEvening: boolean; // večerní souhrn (jen když něco chybí)
  reminderEveningMinutes: number; // čas večerního souhrnu, minut od půlnoci
  remindersOnlyWorkdays: boolean;
  // --- Moje údaje (hlavička výkazu, etapa 4.4) ---
  profileName: string;
  profileIco: string;
  profileDic: string;
  profileAddress: string;
  profilePhone: string;
  profileEmail: string;
  // --- Trasy jízd (etapa 3) ---
  routeTrackingEnabled: boolean; // GPS během přejezdu (jen úsporný režim)
  routeQuality: RouteQuality;
  minTripMeters: number; // kratší přejezd se nepočítá
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
  defaultsOnlyWorkdays: true,
  weekendSurchargePct: 0,
  holidaySurchargePct: 0,
  dayNoteRequired: false,
  timeFormat24h: true,
  weekStartsMonday: true,
  fontScale: 'normal',
  debugLogEnabled: true,
  locationTrackingEnabled: false,
  locationMode: 'economical',
  continuousIntervalMinutes: 7,
  trackingDays: [1, 2, 3, 4, 5], // Po-Pá
  trackingStartMinutes: 360, // 6:00
  trackingEndMinutes: 1140, // 19:00
  minStayMinutes: 10,
  reminderOnDeparture: false,
  reminderMinStayMinutes: 30,
  reminderDelayMinutes: 10,
  reminderOnArriveHome: false,
  reminderEvening: false,
  reminderEveningMinutes: 1140, // 19:00
  remindersOnlyWorkdays: true,
  profileName: '',
  profileIco: '',
  profileDic: '',
  profileAddress: '',
  profilePhone: '',
  profileEmail: '',
  routeTrackingEnabled: true,
  routeQuality: 'economical',
  minTripMeters: 300,
  recentCustomColors: [],
};
