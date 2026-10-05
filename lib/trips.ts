// Sladění přejezdů s pobyty (etapa 3) - lib/tripPlan.ts počítá, tady se
// čte a zapisuje DB a dokončené přejezdy se zapíšou do ladicího deníku.
// Volá se z lib/visits.ts po každém přepočtu pobytů (uvnitř runExclusive).

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import {
  addDebugLogEntry,
  applyTripPlan,
  getInternalValue,
  getSettings,
  listPlaces,
  listRoutePoints,
  listRoutePointsForTrip,
  listTripsForReconcile,
  listTripsNeedingRoad,
  listUnloggedTrips,
  listVisitsForTrips,
  markTripLogged,
  setTripRoad,
} from './db';
import { formatNumberCs } from './format';
import { acceptRoadDistance, computeGapTrips, matchTrips, planRoadSegments, tripKm, type Coord } from './tripPlan';
import type { AppSettings, Trip } from './types';

export const KEY_TRIP_LAST_FAILURE = 'trip_last_failure'; // JSON { at, reason } - poslední selhání startu GPS
export const KEY_TRIPS_FEATURE_SINCE = 'trips_feature_since'; // ISO - od kdy appka trasy umí (etapa 3)

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// `fromMs` - od kdy se změnily pobyty (null = všechno, migrace).
export async function reconcileTrips(fromMs: number | null): Promise<void> {
  const rangeStart = fromMs === null ? null : new Date(fromMs - ONE_DAY_MS).toISOString();
  const visits = await listVisitsForTrips(rangeStart);
  if (visits.length === 0) return;

  // Přejezdy se sladí jen od konce prvního pobytu v rozsahu - starší
  // přejezdy nemají v tomhle výběru mezeru, nesmí se smazat.
  const tripsFrom = visits[0].endAt ?? visits[0].startAt;
  const lastStart = visits[visits.length - 1].startAt;
  const settings = await getSettings();
  const [existing, points] = await Promise.all([
    listTripsForReconcile(tripsFrom),
    listRoutePoints(new Date(Date.parse(tripsFrom) - 5 * 60000).toISOString(), new Date(Date.parse(lastStart) + 5 * 60000).toISOString()),
  ]);

  const computed = computeGapTrips(visits, points, settings.minTripMeters);
  const plan = matchTrips(
    computed,
    existing.filter((t) => t.startAt >= tripsFrom)
  );
  if (plan.inserts.length || plan.updates.length || plan.removals.length) await applyTripPlan(plan);

  await refineRoadDistances();
  await logFinishedTrips(settings);
}

// --- dopočet po silnici (oprava po terénním testu etapy 3) ---

const km1 = (m: number) => formatNumberCs(Math.round(m / 100) / 10);

// Dokončené přejezdy bez dopočtu -> úseky bez bodů GPS po silnici
// (MKDirections). Bez sítě zůstane 'pending' a zkusí se při dalším
// probuzení appky. Volat v runExclusive.
export async function refineRoadDistances(limit = 5): Promise<void> {
  const trips = await listTripsNeedingRoad(limit);
  if (trips.length === 0) return;
  const places = new Map((await listPlaces(true)).map((p) => [p.id, p]));
  const coord = (placeId: number | null, lat: number | null, lon: number | null): Coord | null => {
    if (placeId !== null) {
      const p = places.get(placeId);
      return p ? { latitude: p.latitude, longitude: p.longitude } : null;
    }
    return lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null;
  };

  for (const trip of trips) {
    const plan = planRoadSegments(
      await listRoutePointsForTrip(trip.id),
      coord(trip.fromPlaceId, trip.fromLatitude, trip.fromLongitude),
      coord(trip.toPlaceId, trip.toLatitude, trip.toLongitude)
    );
    if (plan.segments.length === 0) {
      await setTripRoad(trip.id, 'none', null, `GPS body ${km1(plan.gpsM)} km (bez mezer k dopočtu)`);
      continue;
    }
    let total = plan.gpsM;
    const parts = { start: 0, end: 0, gaps: 0, gapCount: 0, whole: 0 };
    let offline = false;
    for (const seg of plan.segments) {
      let road: number;
      try {
        road = await DochazkaNative.roadDistance(seg.from.latitude, seg.from.longitude, seg.to.latitude, seg.to.longitude);
      } catch {
        offline = true;
        break;
      }
      const m = acceptRoadDistance(seg.straightM, road);
      total += m;
      if (seg.kind === 'gap') {
        parts.gaps += m;
        parts.gapCount += 1;
      } else {
        parts[seg.kind] += m;
      }
    }
    if (offline) {
      if (trip.roadStatus !== 'pending') await setTripRoad(trip.id, 'pending', null, 'dopočítává se (čeká na síť)');
      break; // bez sítě nemá smysl zkoušet další
    }
    const note = parts.whole
      ? `celý přejezd po silnici ${km1(parts.whole)} km (bez bodů GPS)`
      : [
          `GPS body ${km1(plan.gpsM)} km`,
          parts.start ? `začátek po silnici ${km1(parts.start)} km` : null,
          parts.gapCount ? `mezery po silnici ${km1(parts.gaps)} km (${parts.gapCount}×)` : null,
          parts.end ? `konec po silnici ${km1(parts.end)} km` : null,
        ]
          .filter(Boolean)
          .join(' + ');
    await setTripRoad(trip.id, 'done', total, note);
  }
}

// --- ladicí deník (zadání etapy 3, bod 6 + doplnění) ---

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function formatDelay(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}

// Proč přejezd nemá body trasy (zadání: "v deníku bude důvod").
async function missingPointsReason(trip: Trip, settings: AppSettings): Promise<string> {
  const since = await getInternalValue(KEY_TRIPS_FEATURE_SINCE);
  if (since && trip.endAt < since) return 'přejezd z doby před etapou 3 (bez záznamu trasy)';
  if (trip.pointCount === 1) return 'GPS dodala jen 1 bod';
  if (trip.pointCount > 1) return 'body trasy zahozené ručně';
  if (!settings.routeTrackingEnabled) return 'záznam tras jízd vypnutý';
  if (settings.locationMode !== 'economical') return 'průběžný režim - body jen v intervalu';
  try {
    const failure = JSON.parse((await getInternalValue(KEY_TRIP_LAST_FAILURE)) ?? 'null') as { at: string; reason: string } | null;
    if (failure && failure.at >= new Date(Date.parse(trip.startAt) - 30 * 60000).toISOString() && failure.at <= trip.endAt) {
      return `start GPS selhal: ${failure.reason}`;
    }
  } catch {
    // poškozený záznam - obecný důvod níž
  }
  return 'GPS nedodala žádné body (iOS sledování jízdy nespustil)';
}

async function logFinishedTrips(settings: AppSettings): Promise<void> {
  const trips = await listUnloggedTrips(new Date().toISOString());
  for (const trip of trips) {
    // Do deníku až s konečnými km (po dopočtu po silnici).
    if (trip.roadStatus === null || trip.roadStatus === 'pending') continue;
    const reason = trip.isEstimate ? await missingPointsReason(trip, settings) : null;
    const delay =
      trip.gpsFirstPointAt && !trip.isEstimate
        ? ` · zpoždění startu GPS ${formatDelay(Date.parse(trip.gpsFirstPointAt) - Date.parse(trip.startAt))}`
        : '';
    const km = `${trip.isEstimate ? '≈ ' : ''}${formatNumberCs(Math.round(tripKm(trip) * 10) / 10)} km`;
    await addDebugLogEntry({
      timestamp: trip.endAt,
      eventType: 'trip',
      detail:
        `přejezd ${hhmm(trip.startAt)}–${hhmm(trip.endAt)} · ${km} · ${trip.pointCount} bodů · ` +
        (reason ? `odhad ano (${reason})` : 'odhad ne') +
        delay +
        (trip.roadNote ? ` · rozpad: ${trip.roadNote} (vzdušnou čarou ${km1(trip.distanceM)} km)` : ''),
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    await markTripLogged(trip.id, reason);
  }
}
