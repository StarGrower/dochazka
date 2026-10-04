// Přepočet pobytů z událostí polohy (oprava 2, A1/A2) - spojuje čistou
// logiku (lib/visitEngine.ts) s databází (lib/db.ts).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - všechno, co mění události/pobyty, běží přes
// `runExclusive` (jedna fronta): iOS umí vzbudit appku a doručit několik
// událostí naráz (CLVisit, geofence task, significant change) a souběžné
// přepočty by si přepisovaly výsledky.

import {
  findDerivedVisitStartNear,
  getInternalValue,
  getSettings,
  KEY_TRIPS_BACKFILL_PENDING,
  KEY_VISITS_REBUILD_PENDING,
  listLocationEvents,
  listPlaces,
  listUserTouchedVisits,
  replaceDerivedVisits,
  setInternalValue,
  softDeleteLegacyAutoVisits,
  type DerivedVisit,
} from './db';
import { isSameLocation } from './dayTimeline';
import { KEY_TRIPS_FEATURE_SINCE, reconcileTrips } from './trips';
import { computeVisits, MERGE_GAP_MS } from './visitEngine';

let queue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

// Kolik zpětně se přepočítá po změně místa / nastavení (starší pobyty
// zůstanou, jak jsou - historie se zpětně nepřepisuje).
const RECENT_REBUILD_MS = 3 * 24 * 60 * 60 * 1000;

// Přepočet automatických pobytů od `fromMs` (null = úplně všech).
// Volat jen uvnitř runExclusive.
export async function rebuildVisits(fromMs: number | null): Promise<void> {
  let fromIso = fromMs === null ? null : new Date(fromMs).toISOString();
  if (fromIso) {
    const straddling = await findDerivedVisitStartNear(fromIso, MERGE_GAP_MS);
    if (straddling && straddling < fromIso) fromIso = straddling;
  }

  const [events, places, settings, touched] = await Promise.all([
    listLocationEvents(fromIso),
    listPlaces(),
    getSettings(),
    listUserTouchedVisits(fromIso),
  ]);

  const computed: DerivedVisit[] = computeVisits(
    events,
    places.map((p) => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, radiusM: p.radiusM })),
    { minStayMinutes: settings.minStayMinutes }
  ).map((v) => ({
    placeId: v.placeId,
    unknownLatitude: v.latitude,
    unknownLongitude: v.longitude,
    startAt: new Date(v.startMs).toISOString(),
    endAt: v.endMs === null ? null : new Date(v.endMs).toISOString(),
    startUncertain: v.startUncertain,
    source: v.source,
  }));

  const manual = touched.filter((v) => !v.isDeleted);
  const userDeleted = touched.filter((v) => v.isDeleted);

  // 1) Ručně smazaný pobyt se přepočtem nevrací (stejné místo, začátek do 15 min).
  let result = computed.filter(
    (c) =>
      !userDeleted.some(
        (d) => isSameLocation(d, c) && Math.abs(Date.parse(d.startAt) - Date.parse(c.startAt)) <= MERGE_GAP_MS
      )
  );

  // 2) Otevřený ruční pobyt uzavře začátek dalšího automatického pobytu.
  const manualEnds: { id: number; endAt: string }[] = [];
  for (const m of manual) {
    if (m.endAt !== null) continue;
    const next = result.find((c) => c.startAt > m.startAt && !isSameLocation(m, c));
    if (next) {
      manualEnds.push({ id: m.id, endAt: next.startAt });
      m.endAt = next.startAt;
    }
  }

  // 3) Ruční pobyty mají přednost - automatické se kolem nich oříznou.
  for (const m of manual) {
    const mStart = m.startAt;
    const mEnd = m.endAt; // null = ruční pobyt stále probíhá
    result = result.flatMap((c) => {
      const cEnd = c.endAt;
      const overlaps = c.startAt < (mEnd ?? '9999') && (cEnd === null || cEnd > mStart);
      if (!overlaps) return [c];
      if (c.startAt >= mStart) {
        // začíná uvnitř ručního - zbyde jen část po něm
        if (mEnd === null || (cEnd !== null && cEnd <= mEnd)) return [];
        return [{ ...c, startAt: mEnd, startUncertain: false }];
      }
      // začíná před ručním - uřízne se jeho začátkem
      return [{ ...c, endAt: mStart }];
    });
  }

  await replaceDerivedVisits(fromIso, result, manualEnds);
  // Etapa 3: přejezdy = mezery mezi pobyty - po každé změně pobytů sladit.
  await reconcileTrips(fromIso === null ? null : Date.parse(fromIso));
}

// Volá se po změně uložených míst nebo nastavení pobytů.
export function rebuildRecentVisits(fromMs?: number): Promise<void> {
  const from = Math.min(fromMs ?? Infinity, Date.now() - RECENT_REBUILD_MS);
  return runExclusive(() => rebuildVisits(from));
}

// Dokončení migrace opravy 2 (viz lib/db.ts -> migrateV1LocationEvents):
// staré automatické pobyty se označí smazané a nahradí je přepočet ze
// všech událostí. Idempotentní - když appka spadne uprostřed, při
// dalším startu se to jen zopakuje.
// Etapa 3 (migrace v3): minulé přejezdy (mezery mezi uloženými pobyty)
// se doplní jako odhad.
export function finishLegacyVisitMigrationIfNeeded(): Promise<void> {
  return runExclusive(async () => {
    const tripsPending = (await getInternalValue(KEY_TRIPS_BACKFILL_PENDING)) === '1';
    // Nejdřív "od kdy appka trasy umí" - starší přejezdy se v deníku
    // označí jako "z doby před etapou 3" (vzniknou už při přepočtu níž).
    if (tripsPending && !(await getInternalValue(KEY_TRIPS_FEATURE_SINCE))) {
      await setInternalValue(KEY_TRIPS_FEATURE_SINCE, new Date().toISOString());
    }
    if ((await getInternalValue(KEY_VISITS_REBUILD_PENDING)) === '1') {
      await softDeleteLegacyAutoVisits();
      await rebuildVisits(null);
      await setInternalValue(KEY_VISITS_REBUILD_PENDING, '0');
    }
    if (tripsPending) {
      await reconcileTrips(null);
      await setInternalValue(KEY_TRIPS_BACKFILL_PENDING, '0');
    }
  });
}

// Přepočet přejezdů po ruční změně (zahozená trasa apod.).
export function refreshTrips(fromMs: number): Promise<void> {
  return runExclusive(() => reconcileTrips(fromMs));
}
