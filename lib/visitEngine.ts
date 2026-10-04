// Odvození pobytů z událostí polohy - ČISTÁ funkce bez DB/React Native,
// ať se dá stejná logika pustit v telefonu (lib/visits.ts) i v testech
// na počítači (scripts/test-visit-engine.ts).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - pobyty se PŘEPOČÍTÁVAJÍ z událostí, ne
// skládají přírůstkově (oprava 2, A1/A2). Dřív každá událost rovnou
// otevírala/zavírala řádek ve `visits`, takže pozdě doručená nebo
// duplicitní událost (iOS po probuzení doručí starší CLVisit znovu)
// vyrobila souběžné nebo neuzavřené pobyty. Teď se každá událost uloží
// jen jednou (otisk, viz lib/db.ts -> location_events) a pobyty za
// dotčené období se z událostí seřazených podle ČASU UDÁLOSTI spočítají
// znovu - pořadí doručení tím přestává hrát roli.
//
// Pravidla (zadání A1/A2):
// - hlavní zdroj = CLVisit (příjezd/odjezd); geofence jen doplněk
//   (rychlejší příjezd, záloha odjezdu), significant location change jen
//   jako důkaz, že jsem místo opustil
// - v jednu chvíli nejvýš jeden otevřený pobyt; začátek nového uzavře
//   předchozí
// - CLVisit odjezd vždy uzavře otevřený pobyt na tom místě
// - stejné místo v rozmezí 15 min = jeden pobyt
// - krátké pobyty (< minStayMinutes) se zahodí

import { distanceMeters } from './geo';

export type LocationEventKind =
  | 'visit_arrival'
  | 'visit_departure'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'significant'
  | 'point';

export interface EngineEvent {
  kind: LocationEventKind;
  atMs: number; // čas UDÁLOSTI (ne doručení)
  latitude: number | null;
  longitude: number | null;
  placeId: number | null; // geofence oblast (nebo převedený starý pobyt)
}

export interface EnginePlace {
  id: number;
  latitude: number;
  longitude: number;
  radiusM: number;
}

export type EngineVisitSource = 'clvisit' | 'geofence' | 'continuous';

export interface EngineVisit {
  placeId: number | null; // null = neznámé místo (pak platí latitude/longitude)
  latitude: number | null;
  longitude: number | null;
  startMs: number;
  endMs: number | null; // null = probíhá
  // Odjezd bez známého příjezdu (sledování začalo, když už jsem na místě
  // byl) - začátek neznámý, startMs = endMs, nezahazuje se jako krátký.
  startUncertain: boolean;
  source: EngineVisitSource;
}

export interface EngineOptions {
  minStayMinutes: number;
}

// Stejné místo v kratším sledu = jeden pobyt (zadání A2 "~15 min").
export const MERGE_GAP_MS = 15 * 60 * 1000;
// Souřadnice CLVisit jsou "těžiště" pobytu s přesností desítky až stovky
// metrů - u velkého místa (rybník, stavba) padá klidně kus za poloměr.
// Proto u CLVisit tolerance navíc k poloměru místa.
export const CLVISIT_MATCH_TOLERANCE_M = 200;
// Dvě "neznámá místa" blíž než tohle = totéž místo.
const UNKNOWN_SAME_PLACE_M = 300;
// Significant location change je hrubý (stovky m) - za důkaz odjezdu se
// bere až bod tak daleko, že to nemůže být nepřesnost.
const SIGNIFICANT_LEFT_PLACE_M = 1000;
// Průběžný bod (nízká přesnost) - za odjezd se bere až tohle za poloměrem.
const POINT_LEFT_PLACE_M = 100;
// Geofence "vstup" těsně po CLVisit odjezdu ze stejného místa je jen
// opožděné hlášení stavu, ne nový příjezd.
const STALE_GEOFENCE_ENTER_MS = 5 * 60 * 1000;

interface Loc {
  placeId: number | null;
  latitude: number | null;
  longitude: number | null;
}

interface OpenVisit {
  loc: Loc;
  startMs: number;
  source: EngineVisitSource;
}

// Duplicity se stejným typem a časem (iOS doručí stejný CLVisit znovu,
// občas s mírně jinými souřadnicemi) - dvě RŮZNÉ události stejného typu
// ve stejné sekundě reálně nevzniknou.
function dedupeKey(e: EngineEvent): string {
  const second = Math.floor(e.atMs / 1000);
  if (e.kind === 'geofence_enter' || e.kind === 'geofence_exit') return `${e.kind}|${second}|${e.placeId}`;
  return `${e.kind}|${second}`;
}

export function computeVisits(
  events: EngineEvent[],
  places: EnginePlace[],
  options: EngineOptions
): EngineVisit[] {
  const placeById = new Map(places.map((p) => [p.id, p]));

  const seen = new Set<string>();
  const sorted = [...events]
    .sort((a, b) => a.atMs - b.atMs)
    .filter((e) => {
      const key = dedupeKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  function matchPlace(lat: number, lon: number, toleranceM: number): number | null {
    let best: { id: number; over: number } | null = null;
    for (const p of places) {
      const over = distanceMeters(lat, lon, p.latitude, p.longitude) - p.radiusM;
      if (over <= toleranceM && (!best || over < best.over)) best = { id: p.id, over };
    }
    return best ? best.id : null;
  }

  function resolve(e: EngineEvent): Loc {
    if (e.placeId !== null) return { placeId: e.placeId, latitude: null, longitude: null };
    if (e.latitude === null || e.longitude === null) return { placeId: null, latitude: null, longitude: null };
    const tolerance = e.kind === 'visit_arrival' || e.kind === 'visit_departure' ? CLVISIT_MATCH_TOLERANCE_M : 0;
    const placeId = matchPlace(e.latitude, e.longitude, tolerance);
    return placeId !== null
      ? { placeId, latitude: null, longitude: null }
      : { placeId: null, latitude: e.latitude, longitude: e.longitude };
  }

  function sameLoc(a: Loc, b: Loc): boolean {
    if (a.placeId !== null || b.placeId !== null) return a.placeId === b.placeId;
    if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return false;
    return distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= UNKNOWN_SAME_PLACE_M;
  }

  // Vzdálenost bodu za hranicí místa (záporná = uvnitř); null = nedá se říct.
  function distanceOutside(loc: Loc, lat: number, lon: number): number | null {
    if (loc.placeId !== null) {
      const place = placeById.get(loc.placeId);
      if (!place) return null;
      return distanceMeters(lat, lon, place.latitude, place.longitude) - place.radiusM;
    }
    if (loc.latitude === null || loc.longitude === null) return null;
    return distanceMeters(lat, lon, loc.latitude, loc.longitude) - UNKNOWN_SAME_PLACE_M;
  }

  const result: EngineVisit[] = [];
  // Objekt místo `let`, ať TS správně vidí změny z vnitřních funkcí.
  const st: { open: OpenVisit | null } = { open: null };
  let lastDeparture: { loc: Loc; atMs: number } | null = null;

  const closeOpen = (endMs: number) => {
    if (!st.open) return;
    result.push({
      placeId: st.open.loc.placeId,
      latitude: st.open.loc.latitude,
      longitude: st.open.loc.longitude,
      startMs: st.open.startMs,
      endMs: Math.max(endMs, st.open.startMs),
      startUncertain: false,
      source: st.open.source,
    });
    st.open = null;
  };

  const startVisit = (loc: Loc, atMs: number, source: EngineVisitSource) => {
    if (st.open && sameLoc(st.open.loc, loc)) return; // pobyt už běží
    closeOpen(atMs); // začátek nového pobytu uzavře předchozí
    st.open = { loc, startMs: atMs, source };
  };

  for (const e of sorted) {
    switch (e.kind) {
      case 'visit_arrival': {
        startVisit(resolve(e), e.atMs, 'clvisit');
        break;
      }
      case 'geofence_enter': {
        const loc = resolve(e);
        if (lastDeparture && sameLoc(lastDeparture.loc, loc) && e.atMs - lastDeparture.atMs < STALE_GEOFENCE_ENTER_MS) {
          break;
        }
        startVisit(loc, e.atMs, 'geofence');
        break;
      }
      case 'visit_departure': {
        const loc = resolve(e);
        lastDeparture = { loc, atMs: e.atMs };
        if (st.open && sameLoc(st.open.loc, loc)) {
          closeOpen(e.atMs);
          break;
        }
        const prev = result[result.length - 1];
        if (!st.open && prev && sameLoc(prevLoc(prev), loc) && prev.endMs !== null && e.atMs >= prev.startMs && e.atMs - prev.endMs <= MERGE_GAP_MS) {
          // Pobyt už uzavřel geofence výstup - CLVisit odjezd je přesnější.
          prev.endMs = e.atMs;
          break;
        }
        // Odjezd z místa, kde jsem podle záznamu nebyl (příjezd se
        // nezachytil - typicky před zapnutím sledování): pobyt s
        // neznámým začátkem. Případný jiný otevřený pobyt tím skončil.
        closeOpen(e.atMs);
        result.push({
          placeId: loc.placeId,
          latitude: loc.latitude,
          longitude: loc.longitude,
          startMs: e.atMs,
          endMs: e.atMs,
          startUncertain: true,
          source: 'clvisit',
        });
        break;
      }
      case 'geofence_exit': {
        if (st.open && e.placeId !== null && st.open.loc.placeId === e.placeId) closeOpen(e.atMs);
        break;
      }
      case 'significant': {
        if (st.open && e.latitude !== null && e.longitude !== null) {
          const outside = distanceOutside(st.open.loc, e.latitude, e.longitude);
          if (outside !== null && outside > SIGNIFICANT_LEFT_PLACE_M) closeOpen(e.atMs);
        }
        break;
      }
      case 'point': {
        if (e.latitude === null || e.longitude === null) break;
        const placeId = matchPlace(e.latitude, e.longitude, 0);
        if (placeId !== null) {
          startVisit({ placeId, latitude: null, longitude: null }, e.atMs, 'continuous');
        } else if (st.open) {
          const outside = distanceOutside(st.open.loc, e.latitude, e.longitude);
          if (outside === null || outside > POINT_LEFT_PLACE_M) closeOpen(e.atMs);
        }
        break;
      }
    }
  }

  if (st.open) {
    const o = st.open;
    result.push({
      placeId: o.loc.placeId,
      latitude: o.loc.latitude,
      longitude: o.loc.longitude,
      startMs: o.startMs,
      endMs: null,
      startUncertain: false,
      source: o.source,
    });
  }

  const minStayMs = options.minStayMinutes * 60 * 1000;
  const merged = mergeSamePlace(result, sameLocOfVisits);
  const withoutShort = merged.filter(
    (v) => v.startUncertain || v.endMs === null || v.endMs - v.startMs >= minStayMs
  );
  return mergeSamePlace(withoutShort, sameLocOfVisits);

  function sameLocOfVisits(a: EngineVisit, b: EngineVisit): boolean {
    return sameLoc(prevLoc(a), prevLoc(b));
  }
}

function prevLoc(v: EngineVisit): Loc {
  return { placeId: v.placeId, latitude: v.latitude, longitude: v.longitude };
}

// Navazující pobyty na stejném místě s mezerou do 15 min (nebo překryvem)
// spojí do jednoho - "hlášení o stejném místě v krátkém sledu".
function mergeSamePlace(
  visits: EngineVisit[],
  same: (a: EngineVisit, b: EngineVisit) => boolean
): EngineVisit[] {
  const out: EngineVisit[] = [];
  for (const v of visits) {
    const last = out[out.length - 1];
    if (last && last.endMs !== null && same(last, v) && v.startMs - last.endMs <= MERGE_GAP_MS) {
      last.endMs = v.endMs === null ? null : Math.max(last.endMs, v.endMs);
      continue;
    }
    out.push({ ...v });
  }
  return out;
}
