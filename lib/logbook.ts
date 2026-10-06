// Kniha jízd (etapa 7) - data: jízdy z přejezdů s názvy míst, návrhy
// (účel / soukromá / vozidlo z historie a Bluetooth - jen návrhy),
// řidiči, tachometr = pravda (korekce do tolerance, řádky "Jiný řidič /
// nezaznamenáno", upozornění), uzavření měsíce.

import { getDb, getGeocodeCache, getInternalValue, listAllTrips, listCategories, listPlaces, type TripWithState } from './db';
import { geocodeKey, nearLocalityLabel } from './geocode';
import { reconcileOdometer, runningOdometer, suggestTrip, type HistoryTrip, type OdoAnchor, type TripSuggestion } from './logbookCalc';
import { listMachines, listReadings } from './machines';
import { listOrders, listPeople } from './orders';
import { tripKm } from './tripPlan';
import { KEY_TRIP_BT_LOG } from './tripTracking';
import type { Person, Trip } from './types';

export interface LogbookTrip extends TripWithState {
  vehicleId: number | null; // efektivní (null u jízdy = výchozí vozidlo)
  fromLabel: string;
  toLabel: string;
  fromKey: string;
  toKey: string;
  km: number; // podle tachometru, jinak ručně / silnice / GPS
  baseKm: number; // bez korekce tachometrem
  closed: boolean; // měsíc vozidla je uzavřený
  suggestion: (TripSuggestion & { vehicleSource: 'learned' | 'bluetooth' | null }) | null;
  missingLocality: { latitude: number; longitude: number }[];
}

export interface LogbookGap {
  id: number;
  vehicleId: number;
  fromAt: string;
  toAt: string;
  km: number;
  driverId: number | null;
  note: string;
}

const monthOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Výchozí vozidlo (stejně jako Detail dne): stroj s výchozí jednotkou
// Kč/km, jinak první se sazbou za km.
export async function defaultVehicleId(): Promise<number | null> {
  const categories = await listCategories();
  return categories.find((c) => c.defaultUnit === 'km')?.id ?? categories.find((c) => c.rates.km > 0)?.id ?? null;
}

async function closedMonths(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category_id: number; month: string }>('SELECT category_id, month FROM logbook_months');
  return new Set(rows.map((r) => `${r.category_id}|${r.month}`));
}

export async function listClosedMonths(): Promise<{ vehicleId: number; month: string; closedAt: string }[]> {
  const db = await getDb();
  return db.getAllAsync('SELECT category_id as vehicleId, month, closed_at as closedAt FROM logbook_months ORDER BY month DESC');
}

async function btLog(): Promise<{ atMs: number; name: string }[]> {
  try {
    const raw = JSON.parse((await getInternalValue(KEY_TRIP_BT_LOG)) || '[]') as { at: string; name: string }[];
    return raw.map((r) => ({ atMs: Date.parse(r.at), name: r.name.toLowerCase() }));
  } catch {
    return [];
  }
}

export async function listLogbookTrips(): Promise<LogbookTrip[]> {
  const trips = await listAllTrips();
  if (trips.length === 0) return [];
  const places = new Map((await listPlaces(true)).map((p) => [p.id, p]));
  const orders = new Map((await listOrders()).map((o) => [o.id, o]));
  const vehicles = await listMachines();
  const defVehicle = await defaultVehicleId();
  const closed = await closedMonths();
  const bt = await btLog();
  const btVehicles = vehicles.filter((v) => v.bluetoothName.trim()).map((v) => ({ id: v.id, name: v.bluetoothName.trim().toLowerCase() }));

  const coordKeys: string[] = [];
  for (const t of trips) {
    if (t.fromPlaceId === null && t.fromLatitude !== null && t.fromLongitude !== null) coordKeys.push(geocodeKey(t.fromLatitude, t.fromLongitude));
    if (t.toPlaceId === null && t.toLatitude !== null && t.toLongitude !== null) coordKeys.push(geocodeKey(t.toLatitude, t.toLongitude));
  }
  const localities = await getGeocodeCache([...new Set(coordKeys)]);

  const endpoint = (placeId: number | null, lat: number | null, lon: number | null) => {
    const place = placeId !== null ? places.get(placeId) : undefined;
    if (place) return { label: place.name, key: `p${place.id}`, missing: null };
    if (lat === null || lon === null) return { label: 'Neznámé místo', key: 'x', missing: null };
    const key = geocodeKey(lat, lon);
    const locality = localities.get(key);
    return { label: locality ? nearLocalityLabel(locality) : 'Neznámé místo', key: `c${key}`, missing: locality ? null : { latitude: lat, longitude: lon } };
  };

  const base = trips.map((t) => {
    const from = endpoint(t.fromPlaceId, t.fromLatitude, t.fromLongitude);
    const to = endpoint(t.toPlaceId, t.toLatitude, t.toLongitude);
    const vehicleId = t.vehicleCategoryId ?? defVehicle;
    const baseKm = tripKm(t);
    return {
      ...t,
      vehicleId,
      fromLabel: from.label,
      toLabel: to.label,
      fromKey: from.key,
      toKey: to.key,
      baseKm,
      km: t.kmOverride === null && t.odoKm !== null ? t.odoKm : baseKm,
      closed: vehicleId !== null && closed.has(`${vehicleId}|${monthOf(t.startAt)}`),
      suggestion: null,
      missingLocality: [from.missing, to.missing].filter((m): m is { latitude: number; longitude: number } => m !== null),
    } as LogbookTrip;
  });

  // Potvrzené = uživatel zadal účel nebo jízdu upravil.
  const history: HistoryTrip[] = base
    .filter((t) => t.purpose.trim() !== '' || t.userEdited)
    .map((t) => ({ fromKey: t.fromKey, toKey: t.toKey, purpose: t.purpose, isPrivate: t.isPrivate, vehicleId: t.vehicleCategoryId, confirmed: true }));

  for (const t of base) {
    if (t.purpose.trim() !== '' && t.vehicleSource !== null) continue;
    const learned = suggestTrip(history, t.fromKey, t.toKey);
    const startMs = Date.parse(t.startAt);
    const endMs = Date.parse(t.endAt);
    const btHit = bt.find((b) => b.atMs >= startMs - 15 * 60000 && b.atMs <= endMs + 5 * 60000 && btVehicles.some((v) => b.name.includes(v.name)));
    const btVehicle = btHit ? (btVehicles.find((v) => btHit.name.includes(v.name))?.id ?? null) : null;
    // Bez historie: účel podle zakázky, jinak podle cíle.
    const order = t.orderId !== null && t.orderId > 0 ? orders.get(t.orderId) : undefined;
    const toPlace = t.toPlaceId !== null ? places.get(t.toPlaceId) : undefined;
    const fallbackPurpose = order ? order.name : toPlace && !toPlace.isPrivate ? toPlace.name : toPlace?.isHome ? 'Cesta domů' : null;
    const purpose = t.purpose.trim() ? null : (learned?.purpose ?? fallbackPurpose);
    const vehicle = t.vehicleSource !== null ? null : (btVehicle ?? learned?.vehicleId ?? null);
    const isPrivate = t.userEdited ? null : (learned?.isPrivate ?? null);
    if (purpose === null && (vehicle === null || vehicle === t.vehicleId) && (isPrivate === null || isPrivate === t.isPrivate)) continue;
    t.suggestion = {
      purpose,
      isPrivate: isPrivate === t.isPrivate ? null : isPrivate,
      vehicleId: vehicle === t.vehicleId ? null : vehicle,
      basedOn: learned?.basedOn ?? 0,
      vehicleSource: vehicle === null ? null : btVehicle !== null ? 'bluetooth' : 'learned',
    };
  }
  return base;
}

// Uložení jízdy z knihy jízd (potvrzení návrhu / ruční úprava). Úprava
// v uzavřeném měsíci se vyznačí.
export async function saveLogbookTrip(
  trip: LogbookTrip,
  f: { purpose: string; isPrivate: boolean; vehicleId: number | null; vehicleSource: Trip['vehicleSource']; driverId: number }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE trips SET purpose = ?, is_private = ?, vehicle_category_id = ?, vehicle_source = ?, driver_id = ?, user_edited = 1,
       edited_after_close = CASE WHEN ? THEN 1 ELSE edited_after_close END WHERE id = ?`,
    [f.purpose, f.isPrivate ? 1 : 0, f.vehicleId, f.vehicleSource, f.driverId, trip.closed ? 1 : 0, trip.id]
  );
}

export async function addPerson(name: string): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('INSERT INTO people (name, is_me) VALUES (?, 0)', [name]);
  return r.lastInsertRowId;
}

export async function listDrivers(): Promise<Person[]> {
  return listPeople();
}

// --- tachometr = pravda ---

export async function listGaps(): Promise<LogbookGap[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT id, category_id as vehicleId, from_at as fromAt, to_at as toAt, km, driver_id as driverId, note
     FROM logbook_gaps WHERE is_deleted = 0 ORDER BY from_at`
  );
}

export async function assignGap(id: number, driverId: number | null, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE logbook_gaps SET driver_id = ?, note = ? WHERE id = ?', [driverId, note, id]);
}

export interface OdoWarning {
  vehicleName: string;
  fromAt: string;
  toAt: string;
  text: string;
}

// Přepočet pro všechna vozidla s tachometrem (km): mezi každou dvojicí
// kotev porovná rozdíl tachometru s km jízd. Uzavřené měsíce se nemění.
// Nepřiřazené řádky "nezaznamenáno" se vytvoří znovu, přiřazené zůstanou.
export async function reconcileAllOdometers(trips: LogbookTrip[]): Promise<OdoWarning[]> {
  const db = await getDb();
  const warnings: OdoWarning[] = [];
  const vehicles = (await listMachines()).filter((v) => v.counterUnit === 'km');
  const existingGaps = await listGaps();
  for (const v of vehicles) {
    const readings = await listReadings(v.id);
    const anchors: OdoAnchor[] = readings.map((r) => ({ atMs: Date.parse(r.readAt), km: r.value })).sort((a, b) => a.atMs - b.atMs);
    if (v.counterStartValue !== null && v.counterStartDate) anchors.unshift({ atMs: Date.parse(`${v.counterStartDate}T00:00:00`), km: v.counterStartValue });
    const own = trips.filter((t) => t.vehicleId === v.id && !t.closed);
    const odo = new Map<number, number | null>(own.map((t) => [t.id, null]));
    await db.runAsync('UPDATE logbook_gaps SET is_deleted = 1 WHERE category_id = ? AND driver_id IS NULL AND note = ? AND is_deleted = 0', [v.id, '']);
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const res = reconcileOdometer(
        a,
        b,
        trips.filter((t) => t.vehicleId === v.id).map((t) => ({ id: t.id, startMs: Date.parse(t.startAt), endMs: Date.parse(t.endAt), km: t.baseKm }))
      );
      if (!res) continue;
      const fromAt = new Date(a.atMs).toISOString();
      const toAt = new Date(b.atMs).toISOString();
      if (res.kind === 'within') {
        if (Math.abs(res.factor - 1) > 0.001) for (const c of res.corrected) if (odo.has(c.id)) odo.set(c.id, c.km);
      } else if (res.kind === 'more') {
        const assigned = existingGaps.some((g) => g.vehicleId === v.id && (g.driverId !== null || g.note !== '') && g.fromAt >= fromAt && g.toAt <= toAt);
        if (!assigned) {
          await db.runAsync('INSERT INTO logbook_gaps (category_id, from_at, to_at, km) VALUES (?, ?, ?, ?)', [
            v.id,
            new Date(res.window.fromMs).toISOString(),
            new Date(res.window.toMs).toISOString(),
            res.extraKm,
          ]);
        }
      } else {
        warnings.push({
          vehicleName: v.name,
          fromAt,
          toAt,
          text: `Tachometr ukazuje o ${res.missingKm} km méně než jízdy (${Math.round(res.odoKm)} km × ${Math.round(res.gpsKm)} km). Zkontroluj stav tachometru nebo km jízd - nic se nezměnilo.`,
        });
      }
    }
    const current = new Map(own.map((t) => [t.id, t.odoKm]));
    for (const [id, km] of odo) if (current.get(id) !== km) await db.runAsync('UPDATE trips SET odo_km = ? WHERE id = ?', [km, id]);
  }
  return warnings;
}

// --- uzavření měsíce ---

export async function closeMonth(vehicleId: number, month: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO logbook_months (category_id, month, closed_at) VALUES (?, ?, ?)', [vehicleId, month, new Date().toISOString()]);
}

export async function reopenMonth(vehicleId: number, month: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM logbook_months WHERE category_id = ? AND month = ?', [vehicleId, month]);
}

// Průběžný stav tachometru po každé jízdě (vozidla s počitadlem km).
export async function odometerByTrip(trips: LogbookTrip[], gaps: LogbookGap[]): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();
  for (const v of (await listMachines()).filter((m) => m.counterUnit === 'km')) {
    const anchors: OdoAnchor[] = (await listReadings(v.id)).map((r) => ({ atMs: Date.parse(r.readAt), km: r.value }));
    if (v.counterStartValue !== null && v.counterStartDate) anchors.push({ atMs: Date.parse(`${v.counterStartDate}T00:00:00`), km: v.counterStartValue });
    const own = trips.filter((t) => t.vehicleId === v.id);
    const entries = [
      ...own.map((t) => ({ startMs: Date.parse(t.startAt), endMs: Date.parse(t.endAt), km: t.km })),
      ...gaps.filter((g) => g.vehicleId === v.id).map((g) => ({ startMs: Date.parse(g.fromAt), endMs: Date.parse(g.toAt), km: g.km })),
    ];
    const odo = runningOdometer(anchors, entries);
    own.forEach((t, i) => result.set(t.id, odo[i]));
  }
  return result;
}

export { monthOf };
