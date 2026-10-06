// Sledování jízdy GPS během přejezdu (etapa 3, bod 1).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - start a konec se odvozují ze STAVU POBYTŮ po
// každém přepočtu (evaluateTripSession), ne z jednotlivých událostí:
// poslední pobyt právě skončil (CLVisit odjezd, výstup z geofence nebo
// významná změna daleko od místa - cokoliv přijde dřív) = odjezd -> GPS
// zapnout; začal nový pobyt = příjezd -> GPS vypnout. Navíc se GPS vypne
// po ~5 min stání (poloha do 100 m, rychlost ~0 - CLVisit příjezd chodí
// pozdě, v testu GPS běžela 21 min po příjezdu) a po 4 h jako pojistka.
//
// OPRAVA po terénním testu (km −15 až −18 %, jen 16 bodů na 25 km):
// GPS dostává VŠECHNY aktualizace (distanceInterval 0, bez pozastavení) -
// jinak by při stání nechodily žádné body a stání by nešlo poznat -, ale
// ukládá se jen bod po 25 m (přesná) / 50 m (úsporná), nejpozději každou
// minutu. Mezery a konce dopočítá po silnici lib/trips.ts.
// Body se ukládají do route_points; k přejezdu je přiřadí lib/trips.ts.
// Jen v úsporném režimu - v průběžném GPS běží stejně (body z něj se
// ukládají jako body trasy, viz lib/locationTracking.ts).

import * as Location from 'expo-location';

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { getBatteryLevelSafe } from './battery';
import {
  addDebugLogEntry,
  getInternalValue,
  getLatestVisit,
  getSettings,
  insertRoutePoint,
  listRoutePoints,
  setInternalValue,
} from './db';
import { distanceMeters } from './geo';
import { formatNumberCs } from './format';
import { filterRoutePoints, MAX_POINT_ACCURACY_M, MAX_SPEED_MPS, routeDistanceM } from './tripPlan';
import { formatDelay, KEY_TRIP_LAST_FAILURE } from './trips';
import type { AppSettings } from './types';
import { runExclusive } from './visits';

export const TRIP_TASK_NAME = 'dochazka-trip-task';

const KEY_TRIP_SESSION = 'trip_session';
// Odjezd, pro který už sledování proběhlo (a skončilo třeba stáním) - ať
// se GPS kvůli stejnému odjezdu nezapne znovu, dokud nepřijde příjezd.
const KEY_TRIP_HANDLED_DEPARTURE = 'trip_handled_departure';
// Odjezd starší než tohle už sledování nespustí (stará událost doručená pozdě).
const MAX_DEPARTURE_AGE_MS = 30 * 60 * 1000;
const STATIONARY_MS = 5 * 60 * 1000;
const STATIONARY_RADIUS_M = 100;
const MOVING_SPEED_MPS = 2; // ~7 km/h - pod tím se počítá jako stání
const STORE_MAX_INTERVAL_MS = 60 * 1000;
const KEY_TRIP_MOTION = 'trip_motion'; // JSON MotionState - přežije restart procesu
// Sledování zastavené stáním (zácpa, obchod, pumpa) bez nového pobytu:
// při další události pohybu se obnoví (jinak by zbytek cesty byl bez bodů).
const KEY_TRIP_PAUSED = 'trip_paused'; // JSON PausedTrip
export const KEY_TRIP_BT_LOG = 'trip_bt_log'; // JSON [{at, name}] - Bluetooth audio při startu/konci jízdy (etapa 7)

// Etapa 7: název připojeného Bluetooth/CarPlay výstupu (auto) -> návrh
// vozidla v knize jízd. Jen návrh, nic se samo nepřiřadí.
async function noteBluetooth(at: string): Promise<string> {
  let name = '';
  try {
    name = DochazkaNative.bluetoothAudioRoute();
  } catch {
    name = '';
  }
  if (!name) return '';
  let log: { at: string; name: string }[] = [];
  try {
    log = JSON.parse((await getInternalValue(KEY_TRIP_BT_LOG)) || '[]');
  } catch {
    log = [];
  }
  log.push({ at, name });
  await setInternalValue(KEY_TRIP_BT_LOG, JSON.stringify(log.slice(-200)));
  return name;
}
const MAX_PAUSE_MS = 3 * 60 * 60 * 1000;

interface PausedTrip {
  departedAt: string;
  at: string;
  latitude: number;
  longitude: number;
}

// Etapa 6: po zastavení stáním kontrola, jestli to nebyla čerpací stanice.
let stationaryStopHandler: ((latitude: number, longitude: number, atMs: number) => Promise<void>) | null = null;
export function setStationaryStopHandler(handler: typeof stationaryStopHandler): void {
  stationaryStopHandler = handler;
}

interface MotionState {
  anchor: { latitude: number; longitude: number; t: number }; // poslední místo, kde se jelo
  lastStored: { latitude: number; longitude: number; t: number } | null;
}
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;

interface TripSession {
  startedAt: string; // kdy se GPS zapnula
  departedAt: string; // čas odjezdu (konec posledního pobytu)
  reason: string;
  error: string | null; // start GPS selhal
}

async function getSession(): Promise<TripSession | null> {
  try {
    const raw = await getInternalValue(KEY_TRIP_SESSION);
    return raw ? (JSON.parse(raw) as TripSession) : null;
  } catch {
    return null;
  }
}

async function setSession(session: TripSession | null): Promise<void> {
  await setInternalValue(KEY_TRIP_SESSION, session ? JSON.stringify(session) : '');
}

function isRouteTrackingActive(settings: AppSettings): boolean {
  return settings.locationTrackingEnabled && settings.routeTrackingEnabled && settings.locationMode === 'economical';
}

// Přesná: navigační přesnost, ukládá bod po 25 m. Úsporná: GPS ~10 m,
// bod po 50 m. GPS běží jen během jízdy.
function trackingOptions(settings: AppSettings): Location.LocationTaskOptions {
  const precise = settings.routeQuality === 'precise';
  return {
    accuracy: precise ? Location.LocationAccuracy.BestForNavigation : Location.LocationAccuracy.High,
    distanceInterval: 0,
    activityType: Location.LocationActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: false,
  };
}

function storeSpacingM(settings: AppSettings): number {
  return settings.routeQuality === 'precise' ? 25 : 50;
}

// GPS volá úlohu zhruba každou sekundu - stav pohybu je v paměti, do DB
// se zapíše jen s uloženým bodem (kvůli restartu procesu uprostřed jízdy).
let motionMemo: { sessionStartedAt: string; motion: MotionState } | null = null;

async function getMotion(sessionStartedAt: string): Promise<MotionState | null> {
  if (motionMemo?.sessionStartedAt === sessionStartedAt) return motionMemo.motion;
  try {
    const raw = await getInternalValue(KEY_TRIP_MOTION);
    return raw ? (JSON.parse(raw) as MotionState) : null;
  } catch {
    return null;
  }
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function startSession(departedAt: string, reason: string, settings: AppSettings): Promise<void> {
  const startedAt = new Date().toISOString();
  let error: string | null = null;
  try {
    await Location.startLocationUpdatesAsync(TRIP_TASK_NAME, trackingOptions(settings));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    await setInternalValue(KEY_TRIP_LAST_FAILURE, JSON.stringify({ at: startedAt, reason: error }));
  }
  await setSession({ startedAt, departedAt, reason, error });
  const bt = await noteBluetooth(startedAt);
  await addDebugLogEntry({
    timestamp: startedAt,
    eventType: 'trip_start',
    detail: error
      ? `start GPS SELHAL (${reason}, odjezd ${hhmm(departedAt)}): ${error} - přejezd bude odhad`
      : `start sledování jízdy (${reason}) · odjezd ${hhmm(departedAt)} · ${settings.routeQuality === 'precise' ? 'přesná' : 'úsporná'} kvalita${bt ? ` · Bluetooth ${bt}` : ''}`,
    batteryLevel: await getBatteryLevelSafe(),
    latitude: null,
    longitude: null,
  });
}

async function stopSession(session: TripSession, reason: string, pausedAt?: { latitude: number; longitude: number; t: number }): Promise<void> {
  await Location.stopLocationUpdatesAsync(TRIP_TASK_NAME).catch(() => {});
  await noteBluetooth(new Date().toISOString());
  await setSession(null);
  await setInternalValue(
    KEY_TRIP_PAUSED,
    pausedAt ? JSON.stringify({ departedAt: session.departedAt, at: new Date(pausedAt.t).toISOString(), latitude: pausedAt.latitude, longitude: pausedAt.longitude }) : ''
  );
  await setInternalValue(KEY_TRIP_MOTION, '');
  motionMemo = null;
  await setInternalValue(KEY_TRIP_HANDLED_DEPARTURE, session.departedAt);
  const nowIso = new Date().toISOString();
  const points = filterRoutePoints(await listRoutePoints(session.departedAt, nowIso));
  const km = routeDistanceM(points, null, null) / 1000;
  const delay = points.length > 0 ? formatDelay(Date.parse(points[0].timestamp) - Date.parse(session.departedAt)) : null;
  // Jen body za dobu sledování, mezi body vzdušnou čarou - konečné km
  // přejezdu (s dopočtem začátku, konce a mezer po silnici) viz PŘEJEZD.
  let detail = `konec sledování jízdy (${reason}) · ${points.length} bodů za dobu sledování · GPS úsek ${formatNumberCs(Math.round(km * 10) / 10)} km (bez dopočtu začátku/konce - konečné km viz PŘEJEZD)`;
  if (delay) detail += ` · zpoždění startu GPS ${delay}`;
  if (points.length === 0) {
    detail += session.error
      ? ` · žádné body - start GPS selhal: ${session.error}`
      : ' · žádné body - iOS GPS nespustil nebo nedodal polohu';
    if (!session.error) {
      await setInternalValue(KEY_TRIP_LAST_FAILURE, JSON.stringify({ at: nowIso, reason: 'GPS spuštěná, ale nedodala žádné body' }));
    }
  }
  await addDebugLogEntry({
    timestamp: nowIso,
    eventType: 'trip_end',
    detail,
    batteryLevel: await getBatteryLevelSafe(),
    latitude: null,
    longitude: null,
  });
}

// Volat UVNITŘ runExclusive (po přepočtu pobytů, při startu appky, po
// změně nastavení). `trigger` = co vyvolalo vyhodnocení (do deníku).
// `movement` - událost svědčí o pohybu (významná změna, výstup z
// geofence, CLVisit odjezd) -> může obnovit sledování pozastavené stáním.
export async function evaluateTripSession(trigger: string, movement = false): Promise<void> {
  const settings = await getSettings();
  const session = await getSession();
  const latest = await getLatestVisit();

  if (!session) {
    let paused: PausedTrip | null = null;
    try {
      paused = JSON.parse((await getInternalValue(KEY_TRIP_PAUSED)) || 'null') as PausedTrip | null;
    } catch {
      paused = null;
    }
    if (paused) {
      const sameTrip = latest && latest.endAt !== null && latest.startAt <= paused.departedAt;
      if (!sameTrip || Date.now() - Date.parse(paused.at) > MAX_PAUSE_MS || !isRouteTrackingActive(settings)) {
        await setInternalValue(KEY_TRIP_PAUSED, ''); // přijel jsem / dávno / vypnuto
      } else if (movement) {
        await setInternalValue(KEY_TRIP_PAUSED, '');
        await startSession(paused.departedAt, `pokračování jízdy po stání - ${trigger}`, settings);
        return;
      }
    }
  }

  if (session) {
    if (!isRouteTrackingActive(settings)) {
      await stopSession(session, 'záznam tras vypnut');
    } else if (latest && latest.endAt === null && latest.startAt > session.departedAt) {
      await stopSession(session, `příjezd - ${trigger}`);
    } else if (Date.now() - Date.parse(session.startedAt) > MAX_SESSION_MS) {
      await stopSession(session, 'pojistka 4 h');
    }
    return;
  }

  if (!isRouteTrackingActive(settings) || !latest || latest.endAt === null) return;
  if (Date.now() - Date.parse(latest.endAt) > MAX_DEPARTURE_AGE_MS) return;
  // Odjezd z TOHOTO pobytu už vyřízený (čas odjezdu se může pozdějším
  // CLVisit zpřesnit, proto se porovnává se začátkem pobytu).
  const handled = await getInternalValue(KEY_TRIP_HANDLED_DEPARTURE);
  if (handled && handled >= latest.startAt) return;
  await startSession(latest.endAt, trigger, settings);
}

// Vypnutí zvenku (Nastavení) - bez ohledu na stav pobytů.
export function stopTripTrackingIfRunning(reason: string): Promise<void> {
  return runExclusive(async () => {
    const session = await getSession();
    if (session) await stopSession(session, reason);
    else await Location.stopLocationUpdatesAsync(TRIP_TASK_NAME).catch(() => {});
  });
}

// Volá se z lib/backgroundTasks.ts pro body z TRIP_TASK_NAME.
export function processTripLocations(locations: Location.LocationObject[]): Promise<void> {
  return runExclusive(async () => {
    const session = await getSession();
    if (!session) {
      // Zbloudilé sledování (appka spadla uprostřed jízdy apod.) - vypnout.
      await Location.stopLocationUpdatesAsync(TRIP_TASK_NAME).catch(() => {});
      return;
    }
    const settings = await getSettings();
    const spacing = storeSpacingM(settings);
    let motion = await getMotion(session.startedAt);
    let stored = false;

    for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      const accuracy = loc.coords.accuracy ?? null;
      if (accuracy !== null && accuracy > MAX_POINT_ACCURACY_M) continue;
      const here = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, t: loc.timestamp };
      const speed = loc.coords.speed !== null && loc.coords.speed >= 0 ? loc.coords.speed : null;

      if (!motion) motion = { anchor: here, lastStored: null };
      // Pohyb: rychlost nad ~7 km/h nebo posun > 100 m od posledního místa jízdy.
      const fromAnchor = distanceMeters(motion.anchor.latitude, motion.anchor.longitude, here.latitude, here.longitude);
      if ((speed !== null && speed >= MOVING_SPEED_MPS) || fromAnchor > STATIONARY_RADIUS_M) motion.anchor = here;

      // Uložit bod: po `spacing` metrech, nejpozději každou minutu; skoky pryč.
      const last = motion.lastStored;
      if (last) {
        const dt = (here.t - last.t) / 1000;
        if (dt <= 0) continue;
        const d = distanceMeters(last.latitude, last.longitude, here.latitude, here.longitude);
        if (d / dt > MAX_SPEED_MPS) continue;
        if (d < spacing && here.t - last.t < STORE_MAX_INTERVAL_MS) continue;
      }
      await insertRoutePoint({ timestamp: new Date(here.t).toISOString(), latitude: here.latitude, longitude: here.longitude, accuracyM: accuracy, speedMps: speed });
      motion.lastStored = here;
      stored = true;
    }

    if (!motion) return;
    motionMemo = { sessionStartedAt: session.startedAt, motion };
    // Stání ~5 min = cíl (CLVisit příjezd může přijít až za desítky minut).
    if (Date.now() - motion.anchor.t >= STATIONARY_MS) {
      const anchor = motion.anchor;
      await stopSession(session, 'stání 5 min', anchor);
      await stationaryStopHandler?.(anchor.latitude, anchor.longitude, anchor.t).catch(() => {});
      return;
    }
    if (stored) await setInternalValue(KEY_TRIP_MOTION, JSON.stringify(motion));
  });
}
