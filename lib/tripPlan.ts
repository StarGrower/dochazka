// Přejezdy z mezer mezi pobyty (etapa 3) - ČISTÉ funkce bez DB/React
// Native, sdílené telefonem (lib/trips.ts) a testy
// (scripts/test-visit-engine.ts).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - přejezd nemůže odkazovat na pobyty (ty se po
// každé události přepočítají a mění ID). Přejezd je proto vlastní řádek
// s časem od-do, který se po každém přepočtu pobytů SLADÍ s mezerami
// mezi nimi podle časového překryvu (matchTrips) - ruční úpravy, body
// trasy i vazba na položku práce tak přepočet přežijí.

import { isSameLocation, type TimelineVisitInput } from './dayTimeline';
import { distanceMeters } from './geo';
import type { RoutePoint } from './types';

// Nepřesné body a nereálné skoky (zadání: accuracy > 100 m, nereálná rychlost).
export const MAX_POINT_ACCURACY_M = 100;
export const MAX_SPEED_MPS = 55; // ~200 km/h
// Bez použitelných bodů: vzdušná vzdálenost × tohle = "odhad".
export const ESTIMATE_FACTOR = 1.3;
// Body kus před odjezdem / po příjezdu ještě patří k přejezdu (zpožděný
// CLVisit, okraj geofence).
export const POINT_WINDOW_MARGIN_MS = 2 * 60 * 1000;

export interface PlanVisit extends TimelineVisitInput {
  placeLatitude: number | null;
  placeLongitude: number | null;
}

export interface PlannedTrip {
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

export interface Coord {
  latitude: number;
  longitude: number;
}

export function coordOf(v: PlanVisit): Coord | null {
  if (v.placeId !== null) {
    return v.placeLatitude !== null && v.placeLongitude !== null
      ? { latitude: v.placeLatitude, longitude: v.placeLongitude }
      : null;
  }
  return v.unknownLatitude !== null && v.unknownLongitude !== null
    ? { latitude: v.unknownLatitude, longitude: v.unknownLongitude }
    : null;
}

const dist = (a: Coord, b: Coord) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

export function filterRoutePoints(points: RoutePoint[]): RoutePoint[] {
  const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const kept: RoutePoint[] = [];
  for (const p of sorted) {
    if (p.accuracyM !== null && p.accuracyM > MAX_POINT_ACCURACY_M) continue;
    const prev = kept[kept.length - 1];
    if (prev) {
      const dt = (Date.parse(p.timestamp) - Date.parse(prev.timestamp)) / 1000;
      if (dt <= 0) continue;
      if (dist(prev, p) / dt > MAX_SPEED_MPS) continue;
    }
    kept.push(p);
  }
  return kept;
}

// Délka trasy: místo odjezdu -> body -> místo příjezdu. Úsek od místa k
// prvnímu bodu se dopočítá vzdušnou čarou (GPS se rozběhne se
// zpožděním - bez toho by se první kilometry ztratily).
export function routeDistanceM(points: RoutePoint[], from: Coord | null, to: Coord | null): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (points.length > 0) {
    if (from) total += dist(from, points[0]);
    if (to) total += dist(points[points.length - 1], to);
  }
  return total;
}

// Mezery mezi dvěma pobyty na RŮZNÝCH místech -> přejezdy. Body trasy
// (už vyfiltrované) se vezmou z okna přejezdu; méně než 2 body = odhad.
// Kratší než `minTripMeters` se nepočítá.
export function computeGapTrips(visits: PlanVisit[], points: RoutePoint[], minTripMeters: number): PlannedTrip[] {
  const sorted = [...visits].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const usable = filterRoutePoints(points);
  const trips: PlannedTrip[] = [];

  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.endAt === null || b.startUncertain) continue;
    if (isSameLocation(a, b)) continue;
    const startMs = Date.parse(a.endAt);
    const endMs = Date.parse(b.startAt);
    if (endMs <= startMs) continue;

    const from = coordOf(a);
    const to = coordOf(b);
    const inWindow = usable.filter((p) => {
      const t = Date.parse(p.timestamp);
      return t >= startMs - POINT_WINDOW_MARGIN_MS && t <= endMs + POINT_WINDOW_MARGIN_MS;
    });

    const isEstimate = inWindow.length < 2;
    const distanceM = isEstimate
      ? from && to
        ? dist(from, to) * ESTIMATE_FACTOR
        : 0
      : routeDistanceM(inWindow, from, to);
    if (distanceM < minTripMeters) continue;

    trips.push({
      startAt: a.endAt,
      endAt: b.startAt,
      fromPlaceId: a.placeId,
      fromLatitude: a.placeId === null ? a.unknownLatitude : null,
      fromLongitude: a.placeId === null ? a.unknownLongitude : null,
      toPlaceId: b.placeId,
      toLatitude: b.placeId === null ? b.unknownLatitude : null,
      toLongitude: b.placeId === null ? b.unknownLongitude : null,
      distanceM,
      isEstimate,
      pointCount: inWindow.length,
      gpsFirstPointAt: inWindow[0]?.timestamp ?? null,
    });
  }
  return trips;
}

export interface ExistingTrip {
  id: number;
  startAt: string;
  endAt: string;
  isDeleted: boolean;
  deletedBy: string | null;
}

export interface TripPlan {
  inserts: PlannedTrip[];
  updates: { id: number; fields: PlannedTrip; revive: boolean }[];
  removals: number[];
}

// Spárování nově spočítaných přejezdů s uloženými podle největšího
// časového překryvu. Ručně smazaný přejezd zůstane smazaný; přejezd, ke
// kterému už mezera neexistuje (pobyty se sloučily), se měkce smaže.
export function matchTrips(computed: PlannedTrip[], existing: ExistingTrip[]): TripPlan {
  const used = new Set<number>();
  const plan: TripPlan = { inserts: [], updates: [], removals: [] };

  for (const c of computed) {
    const cs = Date.parse(c.startAt);
    const ce = Date.parse(c.endAt);
    let best: { trip: ExistingTrip; overlap: number } | null = null;
    for (const e of existing) {
      if (used.has(e.id)) continue;
      const overlap = Math.min(ce, Date.parse(e.endAt)) - Math.max(cs, Date.parse(e.startAt));
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { trip: e, overlap };
    }
    if (!best) {
      plan.inserts.push(c);
      continue;
    }
    used.add(best.trip.id);
    if (best.trip.isDeleted && best.trip.deletedBy === 'user') continue;
    plan.updates.push({ id: best.trip.id, fields: c, revive: best.trip.isDeleted });
  }

  for (const e of existing) {
    if (!used.has(e.id) && !e.isDeleted) plan.removals.push(e.id);
  }
  return plan;
}

// --- dopočet po silnici (oprava po terénním testu etapy 3) ---
//
// GPS body jsou úsečky "vzdušnou čarou" - kde je mezi body velká mezera
// (GPS nedodala body, nebo začátek/konec jízdy), vzdušná čára silnici
// zkrátí (v testu −15 až −18 %). Takové úseky se dopočítají po silnici
// (MKDirections): mezery > 300 m, začátek (místo odjezdu -> 1. bod) a
// konec (poslední bod -> místo příjezdu) od 100 m. Bez bodů celý přejezd.

export const ROAD_GAP_M = 300;
export const ROAD_ENDS_MIN_M = 100;

export interface RoadSegment {
  kind: 'start' | 'gap' | 'end' | 'whole';
  from: Coord;
  to: Coord;
  straightM: number;
}

export interface RoadPlan {
  gpsM: number; // součet úseků mezi body, které se nedopočítávají
  segments: RoadSegment[]; // úseky k dopočtu po silnici
}

export function planRoadSegments(points: RoutePoint[], from: Coord | null, to: Coord | null): RoadPlan {
  const usable = filterRoutePoints(points);
  if (usable.length < 2) {
    return from && to ? { gpsM: 0, segments: [{ kind: 'whole', from, to, straightM: dist(from, to) }] } : { gpsM: 0, segments: [] };
  }
  const segments: RoadSegment[] = [];
  let gpsM = 0;
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (from) {
    const d = dist(from, first);
    if (d >= ROAD_ENDS_MIN_M) segments.push({ kind: 'start', from, to: first, straightM: d });
    else gpsM += d;
  }
  for (let i = 1; i < usable.length; i++) {
    const d = dist(usable[i - 1], usable[i]);
    if (d > ROAD_GAP_M) segments.push({ kind: 'gap', from: usable[i - 1], to: usable[i], straightM: d });
    else gpsM += d;
  }
  if (to) {
    const d = dist(last, to);
    if (d >= ROAD_ENDS_MIN_M) segments.push({ kind: 'end', from: last, to, straightM: d });
    else gpsM += d;
  }
  return { gpsM, segments };
}

// Silnice nikdy kratší než vzdušná čára; nesmyslně dlouhá objížďka
// (víc než 2,5× vzdušná čára - např. špatně přichycený bod) se nebere.
export function acceptRoadDistance(straightM: number, roadM: number): number {
  if (roadM <= 0) return straightM;
  if (roadM > straightM * 2.5 + 500) return straightM;
  return Math.max(straightM, roadM);
}

// Km přejezdu: ruční oprava > dopočet po silnici > GPS (vzdušnou čarou mezi body).
export function tripKm(trip: { kmOverride: number | null; distanceM: number; roadDistanceM?: number | null }): number {
  return trip.kmOverride ?? (trip.roadDistanceM ?? trip.distanceM) / 1000;
}
