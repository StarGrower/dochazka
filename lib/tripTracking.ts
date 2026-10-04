// Sledování jízdy GPS během přejezdu (etapa 3, bod 1).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - start a konec se odvozují ze STAVU POBYTŮ po
// každém přepočtu (evaluateTripSession), ne z jednotlivých událostí:
// poslední pobyt právě skončil (CLVisit odjezd, výstup z geofence nebo
// významná změna daleko od místa - cokoliv přijde dřív) = odjezd -> GPS
// zapnout; začal nový pobyt = příjezd -> GPS vypnout. Navíc se GPS vypne
// po ~10 min stání (body do 100 m od sebe) a po 4 h jako pojistka.
// Body se ukládají do route_points; k přejezdu je přiřadí lib/trips.ts.
// Jen v úsporném režimu - v průběžném GPS běží stejně (body z něj se
// ukládají jako body trasy, viz lib/locationTracking.ts).

import * as Location from 'expo-location';

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
const STATIONARY_MS = 10 * 60 * 1000;
const STATIONARY_RADIUS_M = 100;
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

// Přesná: GPS ~10 m, bod po 50 m. Úsporná: ~100 m (spíš Wi-Fi/BTS než
// čisté GPS), bod po 100 m - výrazně menší spotřeba, trasa hrubší.
function trackingOptions(settings: AppSettings): Location.LocationTaskOptions {
  const precise = settings.routeQuality === 'precise';
  return {
    accuracy: precise ? Location.LocationAccuracy.High : Location.LocationAccuracy.Balanced,
    distanceInterval: precise ? 50 : 100,
    activityType: Location.LocationActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: false,
  };
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
  await addDebugLogEntry({
    timestamp: startedAt,
    eventType: 'trip_start',
    detail: error
      ? `start GPS SELHAL (${reason}, odjezd ${hhmm(departedAt)}): ${error} - přejezd bude odhad`
      : `start sledování jízdy (${reason}) · odjezd ${hhmm(departedAt)} · ${settings.routeQuality === 'precise' ? 'přesná' : 'úsporná'} kvalita`,
    batteryLevel: await getBatteryLevelSafe(),
    latitude: null,
    longitude: null,
  });
}

async function stopSession(session: TripSession, reason: string): Promise<void> {
  await Location.stopLocationUpdatesAsync(TRIP_TASK_NAME).catch(() => {});
  await setSession(null);
  await setInternalValue(KEY_TRIP_HANDLED_DEPARTURE, session.departedAt);
  const nowIso = new Date().toISOString();
  const points = filterRoutePoints(await listRoutePoints(session.departedAt, nowIso));
  const km = routeDistanceM(points, null, null) / 1000;
  const delay = points.length > 0 ? formatDelay(Date.parse(points[0].timestamp) - Date.parse(session.departedAt)) : null;
  let detail = `konec sledování jízdy (${reason}) · ${points.length} bodů · ${formatNumberCs(Math.round(km * 10) / 10)} km`;
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
export async function evaluateTripSession(trigger: string): Promise<void> {
  const settings = await getSettings();
  const session = await getSession();
  const latest = await getLatestVisit();

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

    const recent = await listRoutePoints(new Date(Date.now() - STATIONARY_MS - 2 * 60000).toISOString(), new Date().toISOString());
    let last = recent[recent.length - 1] ?? null;
    for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      const accuracy = loc.coords.accuracy ?? null;
      if (accuracy !== null && accuracy > MAX_POINT_ACCURACY_M) continue;
      const timestamp = new Date(loc.timestamp).toISOString();
      if (last) {
        const dt = (loc.timestamp - Date.parse(last.timestamp)) / 1000;
        if (dt <= 0) continue;
        const speed = distanceMeters(last.latitude, last.longitude, loc.coords.latitude, loc.coords.longitude) / dt;
        if (speed > MAX_SPEED_MPS) continue;
      }
      const point = {
        timestamp,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracyM: accuracy,
        speedMps: loc.coords.speed !== null && loc.coords.speed >= 0 ? loc.coords.speed : null,
      };
      await insertRoutePoint(point);
      recent.push(point);
      last = point;
    }

    // Stání ~10 min (body do 100 m od sebe) = cíl, GPS vypnout.
    if (!last) return;
    const newest = last;
    const windowStart = Date.parse(newest.timestamp) - STATIONARY_MS;
    const inWindow = recent.filter((p) => Date.parse(p.timestamp) >= windowStart - 60000);
    const coversWindow = inWindow.length > 1 && Date.parse(inWindow[0].timestamp) <= windowStart;
    const allNear = inWindow.every(
      (p) => distanceMeters(p.latitude, p.longitude, newest.latitude, newest.longitude) <= STATIONARY_RADIUS_M
    );
    if (coversWindow && allNear) await stopSession(session, 'stání 10 min');
  });
}
