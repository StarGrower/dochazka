// Stroje, servis, tankování (etapa 6) - datová vrstva a napojení na
// zakázky (palivo), upozornění (servis, čerpací stanice) a kniha jízd.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - stroj = stávající položka `work_categories`
// (kind 'machine') rozšířená o kartu: zápisy práce, sazby a přejezdy na
// něj dál odkazují beze změny. Ceny servisu se nikde neukládají ani
// nepočítají (zadání).

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { createCategory, getDb, getInternalValue, listCategories, setInternalValue } from './db';
import { toIsoDate } from './format';
import {
  consumptionSegments,
  estimateCounter,
  serviceStatus,
  stockState,
  usagePerWorkday,
  type Anchor,
  type ConsumptionSegment,
  type CounterEstimate,
  type ServiceStatus,
  type UsageSample,
} from './machineCalc';
import { setOrderFuelCostProvider } from './orders';
import { tripKm } from './tripPlan';
import { setStationaryStopHandler } from './tripTracking';
import type { WorkCategory } from './types';

export type CounterUnit = 'mth' | 'km' | 'none';

export interface MachineCard extends WorkCategory {
  manufacturer: string;
  model: string;
  serialNumber: string;
  yearBuilt: number | null;
  plate: string;
  counterUnit: CounterUnit;
  counterStartValue: number | null;
  counterStartDate: string | null;
  templateId: number | null;
  bluetoothName: string;
}

export interface MachineTemplate {
  id: number;
  name: string;
  kind: string;
  counterUnit: CounterUnit;
  isBuiltin: boolean;
  plan: { name: string; value?: number; days?: number }[];
}

export interface CounterReading {
  id: number;
  readAt: string;
  value: number;
  source: 'manual' | 'photo' | 'fuel';
  photoId: number | null;
  note: string;
}

export interface ServiceItem {
  id: number;
  categoryId: number;
  name: string;
  intervalValue: number | null;
  intervalDays: number | null;
  warnFirst: number | null;
  warnSecond: number | null;
  warnDaysFirst: number;
  warnDaysSecond: number;
  lastDoneValue: number | null;
  lastDoneDate: string | null;
}

export interface ServiceRecord {
  id: number;
  serviceItemId: number | null;
  serviceItemName: string | null;
  doneAt: string;
  counterValue: number | null;
  workDone: string;
  material: string;
  doneBy: string;
  note: string;
}

export type DefectSeverity = 'ok' | 'careful' | 'stopped';

export interface Defect {
  id: number;
  categoryId: number;
  createdAt: string;
  description: string;
  photoId: number | null;
  severity: DefectSeverity;
  resolvedAt: string | null;
  resolutionNote: string;
}

export type FuelType = 'diesel' | 'petrol' | 'adblue';
export type FuelPayment = 'own_card' | 'company_card' | 'cash';

export interface FuelEntry {
  id: number;
  categoryId: number | null;
  fueledAt: string;
  liters: number;
  priceTotalKc: number | null;
  pricePerL: number | null;
  fuelType: FuelType;
  fullTank: boolean;
  counterValue: number | null;
  counterPhotoId: number | null;
  receiptPhotoId: number | null;
  latitude: number | null;
  longitude: number | null;
  payment: FuelPayment;
  reimbursedAt: string | null;
  source: 'pump' | 'stock';
  note: string;
}

export const DEFECT_LABEL: Record<DefectSeverity, string> = { ok: 'Jde pracovat', careful: 'Opatrně', stopped: 'Stroj stojí' };
export const FUEL_LABEL: Record<FuelType, string> = { diesel: 'Nafta', petrol: 'Benzín', adblue: 'AdBlue' };
export const PAYMENT_LABEL: Record<FuelPayment, string> = { own_card: 'Vlastní karta', company_card: 'Firemní karta', cash: 'Hotově' };
export const COUNTER_LABEL: Record<CounterUnit, string> = { mth: 'Mth', km: 'km', none: '' };

// --- karta stroje ---

interface CardRow {
  id: number;
  manufacturer: string;
  model: string;
  serial_number: string;
  year_built: number | null;
  plate: string;
  counter_unit: CounterUnit;
  counter_start_value: number | null;
  counter_start_date: string | null;
  template_id: number | null;
  bluetooth_name: string;
}

export async function listMachines(includeLabor = false): Promise<MachineCard[]> {
  const db = await getDb();
  const categories = (await listCategories()).filter((c) => includeLabor || c.kind === 'machine');
  const rows = await db.getAllAsync<CardRow>(
    'SELECT id, manufacturer, model, serial_number, year_built, plate, counter_unit, counter_start_value, counter_start_date, template_id, bluetooth_name FROM work_categories'
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return categories.map((c) => {
    const r = byId.get(c.id);
    return {
      ...c,
      manufacturer: r?.manufacturer ?? '',
      model: r?.model ?? '',
      serialNumber: r?.serial_number ?? '',
      yearBuilt: r?.year_built ?? null,
      plate: r?.plate ?? '',
      counterUnit: r?.counter_unit ?? 'none',
      counterStartValue: r?.counter_start_value ?? null,
      counterStartDate: r?.counter_start_date ?? null,
      templateId: r?.template_id ?? null,
      bluetoothName: r?.bluetooth_name ?? '',
    };
  });
}

export async function getMachine(id: number): Promise<MachineCard | null> {
  return (await listMachines(true)).find((m) => m.id === id) ?? null;
}

export type MachineCardFields = Pick<
  MachineCard,
  'manufacturer' | 'model' | 'serialNumber' | 'yearBuilt' | 'plate' | 'counterUnit' | 'counterStartValue' | 'counterStartDate' | 'templateId' | 'bluetoothName'
>;

export async function saveMachineCard(id: number, f: MachineCardFields & { name?: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE work_categories SET manufacturer = ?, model = ?, serial_number = ?, year_built = ?, plate = ?, counter_unit = ?,
       counter_start_value = ?, counter_start_date = ?, template_id = ?, bluetooth_name = ? ${f.name ? ', name = ?' : ''} WHERE id = ?`,
    [f.manufacturer, f.model, f.serialNumber, f.yearBuilt, f.plate, f.counterUnit, f.counterStartValue, f.counterStartDate, f.templateId, f.bluetoothName, ...(f.name ? [f.name] : []), id]
  );
}

// Nový stroj ze šablony: položka strojů (sazby 0, doplní se v Strojích a
// kategoriích) + karta + servisní plán šablony.
export async function createMachine(name: string, template: MachineTemplate | null, counterUnit: CounterUnit): Promise<number> {
  const unit = template?.counterUnit ?? counterUnit;
  const id = await createCategory({
    name,
    rates: { hour: 0, day: 0, km: 0 },
    defaultUnit: unit === 'km' ? 'km' : 'hour',
    weekendPct: null,
    holidayPct: null,
    color: '#8A6D4B',
    kind: 'machine',
  });
  await saveMachineCard(id, {
    manufacturer: '', model: '', serialNumber: '', yearBuilt: null, plate: '', counterUnit: unit, counterStartValue: null,
    counterStartDate: toIsoDate(new Date()), templateId: template?.id ?? null, bluetoothName: '',
  });
  if (template) await applyTemplatePlan(id, template, unit);
  return id;
}

// --- šablony ---

export async function listTemplates(): Promise<MachineTemplate[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; name: string; kind: string; counter_unit: CounterUnit; is_builtin: number; service_plan: string }>(
    'SELECT id, name, kind, counter_unit, is_builtin, service_plan FROM machine_templates WHERE is_deleted = 0 ORDER BY is_builtin DESC, name'
  );
  return rows.map((r) => {
    let plan: MachineTemplate['plan'] = [];
    try {
      plan = JSON.parse(r.service_plan);
    } catch {
      plan = [];
    }
    return { id: r.id, name: r.name, kind: r.kind, counterUnit: r.counter_unit, isBuiltin: r.is_builtin === 1, plan };
  });
}

// Upozornění předem: výchozí 50 a 20 Mth (zadání); u km úměrně (1000/400 km).
function defaultWarn(unit: CounterUnit): [number | null, number | null] {
  if (unit === 'mth') return [50, 20];
  if (unit === 'km') return [1000, 400];
  return [null, null];
}

export async function applyTemplatePlan(machineId: number, template: MachineTemplate, unit: CounterUnit): Promise<void> {
  const db = await getDb();
  const [w1, w2] = defaultWarn(unit);
  const today = toIsoDate(new Date());
  for (const p of template.plan) {
    await db.runAsync(
      `INSERT INTO service_items (category_id, name, interval_value, interval_days, warn_first, warn_second, last_done_value, last_done_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [machineId, p.name, p.value ?? null, p.days ?? null, p.value ? w1 : null, p.value ? w2 : null, null, p.days ? today : null]
    );
  }
}

// Vlastní šablona z aktuálního plánu stroje (válec, deska, žába...).
export async function saveTemplateFromMachine(machineId: number, name: string): Promise<void> {
  const db = await getDb();
  const machine = await getMachine(machineId);
  const items = await listServiceItems(machineId);
  const plan = items.map((i) => ({ name: i.name, ...(i.intervalValue ? { value: i.intervalValue } : {}), ...(i.intervalDays ? { days: i.intervalDays } : {}) }));
  await db.runAsync("INSERT INTO machine_templates (name, kind, counter_unit, is_builtin, service_plan) VALUES (?, 'custom', ?, 0, ?)", [
    name,
    machine?.counterUnit ?? 'mth',
    JSON.stringify(plan),
  ]);
}

// --- fotky (zmenšené JPEG v DB -> jsou v šifrované záloze) ---

export async function savePhoto(base64: string, width: number, height: number): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('INSERT INTO photos (data, width, height) VALUES (?, ?, ?)', [base64, width, height]);
  return r.lastInsertRowId;
}

export async function getPhotoBase64(id: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM photos WHERE id = ?', [id]);
  return row?.data ?? null;
}

// --- počitadlo (kotevní body + odhad) ---

export async function listReadings(machineId: number): Promise<CounterReading[]> {
  const db = await getDb();
  return db.getAllAsync<CounterReading>(
    `SELECT id, read_at as readAt, value, source, photo_id as photoId, note FROM counter_readings
     WHERE category_id = ? AND is_deleted = 0 ORDER BY read_at DESC`,
    [machineId]
  );
}

export async function addReading(machineId: number, r: { readAt: string; value: number; source: CounterReading['source']; photoId?: number | null; fuelEntryId?: number | null; note?: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO counter_readings (category_id, read_at, value, source, photo_id, fuel_entry_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    machineId, r.readAt, r.value, r.source, r.photoId ?? null, r.fuelEntryId ?? null, r.note ?? '',
  ]);
}

export async function deleteReading(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE counter_readings SET is_deleted = 1 WHERE id = ?', [id]);
}

async function anchorsFor(machine: MachineCard): Promise<Anchor[]> {
  const anchors: Anchor[] = (await listReadings(machine.id)).map((r) => ({ atMs: Date.parse(r.readAt), value: r.value }));
  if (machine.counterStartValue !== null) {
    anchors.push({ atMs: Date.parse(`${machine.counterStartDate ?? '2000-01-01'}T00:00:00`), value: machine.counterStartValue });
  }
  return anchors;
}

// Stroj: odpracované hodiny ze zápisů (den = poledne). Vozidlo: km z
// přejezdů s tímhle vozidlem (i soukromé - tachometr je počítá taky).
export async function usageSamples(machine: MachineCard): Promise<UsageSample[]> {
  const db = await getDb();
  if (machine.counterUnit === 'km') {
    const defaultVehicle = (await listCategories()).find((c) => c.defaultUnit === 'km')?.id ?? null;
    const rows = await db.getAllAsync<{ start_at: string; distance_m: number; road_distance_m: number | null; km_override: number | null }>(
      `SELECT start_at, distance_m, road_distance_m, km_override FROM trips
       WHERE is_deleted = 0 AND (vehicle_category_id = ? OR (vehicle_category_id IS NULL AND ? = ?))`,
      [machine.id, machine.id, defaultVehicle ?? -1]
    );
    return rows.map((t) => ({ atMs: Date.parse(t.start_at), amount: tripKm({ kmOverride: t.km_override, distanceM: t.distance_m, roadDistanceM: t.road_distance_m }) }));
  }
  const rows = await db.getAllAsync<{ date: string; hours: number }>(
    "SELECT date, SUM(quantity) as hours FROM day_work_records WHERE category_id = ? AND unit = 'hour' GROUP BY date",
    [machine.id]
  );
  return rows.map((r) => ({ atMs: Date.parse(`${r.date}T12:00:00`), amount: r.hours }));
}

export interface MachineCounterInfo {
  estimate: CounterEstimate | null;
  usagePerDay: number;
}

export async function machineCounter(machine: MachineCard): Promise<MachineCounterInfo> {
  if (machine.counterUnit === 'none') return { estimate: null, usagePerDay: 0 };
  const [anchors, samples] = await Promise.all([anchorsFor(machine), usageSamples(machine)]);
  const now = Date.now();
  const estimate = estimateCounter(anchors, samples, now);
  return { estimate, usagePerDay: usagePerWorkday(samples, now, estimate?.ratio ?? 1) };
}

// --- servisní plán ---

export async function listServiceItems(machineId: number): Promise<ServiceItem[]> {
  const db = await getDb();
  return db.getAllAsync<ServiceItem>(
    `SELECT id, category_id as categoryId, name, interval_value as intervalValue, interval_days as intervalDays, warn_first as warnFirst,
       warn_second as warnSecond, warn_days_first as warnDaysFirst, warn_days_second as warnDaysSecond, last_done_value as lastDoneValue,
       last_done_date as lastDoneDate
     FROM service_items WHERE category_id = ? AND is_deleted = 0 ORDER BY name`,
    [machineId]
  );
}

export async function saveServiceItem(item: Omit<ServiceItem, 'id'> & { id?: number | null }): Promise<void> {
  const db = await getDb();
  const params = [item.name, item.intervalValue, item.intervalDays, item.warnFirst, item.warnSecond, item.warnDaysFirst, item.warnDaysSecond, item.lastDoneValue, item.lastDoneDate];
  if (item.id) {
    await db.runAsync(
      `UPDATE service_items SET name = ?, interval_value = ?, interval_days = ?, warn_first = ?, warn_second = ?, warn_days_first = ?,
         warn_days_second = ?, last_done_value = ?, last_done_date = ? WHERE id = ?`,
      [...params, item.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO service_items (name, interval_value, interval_days, warn_first, warn_second, warn_days_first, warn_days_second, last_done_value,
         last_done_date, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...params, item.categoryId]
    );
  }
}

export async function deleteServiceItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE service_items SET is_deleted = 1 WHERE id = ?', [id]);
}

export function itemStatus(item: ServiceItem, info: MachineCounterInfo): ServiceStatus {
  return serviceStatus(item, info.estimate?.value ?? null, Date.now(), info.usagePerDay);
}

// Uložením servisního záznamu se interval položky vynuluje (zadání).
export async function addServiceRecord(machineId: number, r: Omit<ServiceRecord, 'id' | 'serviceItemName'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO service_records (category_id, service_item_id, done_at, counter_value, work_done, material, done_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [machineId, r.serviceItemId, r.doneAt, r.counterValue, r.workDone, r.material, r.doneBy, r.note]
  );
  if (r.serviceItemId) {
    await db.runAsync('UPDATE service_items SET last_done_value = ?, last_done_date = ? WHERE id = ?', [r.counterValue, r.doneAt.slice(0, 10), r.serviceItemId]);
  }
  if (r.counterValue !== null) await addReading(machineId, { readAt: new Date(`${r.doneAt.slice(0, 10)}T12:00:00`).toISOString(), value: r.counterValue, source: 'manual', note: 'servis' });
}

export async function listServiceRecords(machineId: number): Promise<ServiceRecord[]> {
  const db = await getDb();
  return db.getAllAsync<ServiceRecord>(
    `SELECT r.id, r.service_item_id as serviceItemId, i.name as serviceItemName, r.done_at as doneAt, r.counter_value as counterValue,
       r.work_done as workDone, r.material, r.done_by as doneBy, r.note
     FROM service_records r LEFT JOIN service_items i ON i.id = r.service_item_id
     WHERE r.category_id = ? AND r.is_deleted = 0 ORDER BY r.done_at DESC`,
    [machineId]
  );
}

// --- závady ---

export async function listDefects(machineId: number | null, includeResolved: boolean): Promise<Defect[]> {
  const db = await getDb();
  return db.getAllAsync<Defect>(
    `SELECT id, category_id as categoryId, created_at as createdAt, description, photo_id as photoId, severity, resolved_at as resolvedAt,
       resolution_note as resolutionNote
     FROM defects WHERE is_deleted = 0 ${machineId !== null ? 'AND category_id = ?' : ''} ${includeResolved ? '' : 'AND resolved_at IS NULL'}
     ORDER BY created_at DESC`,
    machineId !== null ? [machineId] : []
  );
}

export async function addDefect(machineId: number, d: { description: string; severity: DefectSeverity; photoId: number | null }): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO defects (category_id, description, severity, photo_id) VALUES (?, ?, ?, ?)', [machineId, d.description, d.severity, d.photoId]);
}

export async function resolveDefect(id: number, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE defects SET resolved_at = ?, resolution_note = ? WHERE id = ?', [new Date().toISOString(), note, id]);
}

// --- tankování ---

export async function listFuelEntries(machineId: number | null = null): Promise<FuelEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<FuelEntry, 'fullTank'> & { fullTank: number }>(
    `SELECT id, category_id as categoryId, fueled_at as fueledAt, liters, price_total_kc as priceTotalKc, price_per_l as pricePerL,
       fuel_type as fuelType, full_tank as fullTank, counter_value as counterValue, counter_photo_id as counterPhotoId,
       receipt_photo_id as receiptPhotoId, latitude, longitude, payment, reimbursed_at as reimbursedAt, source, note
     FROM fuel_entries WHERE is_deleted = 0 ${machineId !== null ? 'AND category_id = ?' : ''} ORDER BY fueled_at DESC`,
    machineId !== null ? [machineId] : []
  );
  return rows.map((r) => ({ ...r, fullTank: !!r.fullTank }));
}

export async function saveFuelEntry(e: Omit<FuelEntry, 'id' | 'reimbursedAt'>): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO fuel_entries (category_id, fueled_at, liters, price_total_kc, price_per_l, fuel_type, full_tank, counter_value, counter_photo_id,
       receipt_photo_id, latitude, longitude, payment, source, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.categoryId, e.fueledAt, e.liters, e.priceTotalKc, e.pricePerL, e.fuelType, e.fullTank ? 1 : 0, e.counterValue, e.counterPhotoId, e.receiptPhotoId,
      e.latitude, e.longitude, e.payment, e.source, e.note]
  );
  const id = r.lastInsertRowId;
  // Stav počitadla při tankování = kotevní bod (zadání).
  if (e.categoryId !== null && e.counterValue !== null) {
    await addReading(e.categoryId, { readAt: e.fueledAt, value: e.counterValue, source: e.counterPhotoId ? 'photo' : 'fuel', photoId: e.counterPhotoId, fuelEntryId: id });
  }
  // Výdej z vlastní zásoby.
  if (e.source === 'stock') {
    await db.runAsync("INSERT INTO fuel_stock_moves (moved_at, kind, liters, price_total_kc, fuel_entry_id) VALUES (?, 'issue', ?, ?, ?)", [
      e.fueledAt, e.liters, e.priceTotalKc, id,
    ]);
  }
  return id;
}

export async function deleteFuelEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE fuel_entries SET is_deleted = 1 WHERE id = ?', [id]);
  await db.runAsync('UPDATE counter_readings SET is_deleted = 1 WHERE fuel_entry_id = ?', [id]);
  await db.runAsync('UPDATE fuel_stock_moves SET is_deleted = 1 WHERE fuel_entry_id = ?', [id]);
}

// K proplacení: vlastní karta / hotově, ještě neproplaceno.
export async function listToReimburse(): Promise<FuelEntry[]> {
  return (await listFuelEntries()).filter((e) => e.payment !== 'company_card' && e.source === 'pump' && !e.reimbursedAt);
}

export async function markReimbursed(ids: number[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  for (const id of ids) await db.runAsync('UPDATE fuel_entries SET reimbursed_at = ? WHERE id = ?', [now, id]);
}

// --- vlastní zásoba nafty ---

export async function listStockMoves(): Promise<{ id: number; movedAt: string; kind: 'purchase' | 'issue'; liters: number; priceTotalKc: number | null; note: string }[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT id, moved_at as movedAt, kind, liters, price_total_kc as priceTotalKc, note FROM fuel_stock_moves WHERE is_deleted = 0 ORDER BY moved_at DESC`
  );
}

export async function addStockPurchase(p: { movedAt: string; liters: number; priceTotalKc: number; note: string }): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT INTO fuel_stock_moves (moved_at, kind, liters, price_total_kc, note) VALUES (?, 'purchase', ?, ?, ?)", [p.movedAt, p.liters, p.priceTotalKc, p.note]);
}

export async function fuelStock(): Promise<{ liters: number; avgPricePerL: number }> {
  const moves = await listStockMoves();
  return stockState(moves.map((m) => ({ atMs: Date.parse(m.movedAt), kind: m.kind, liters: m.liters, priceTotalKc: m.priceTotalKc })));
}

// --- spotřeba a náklady ---

export async function machineConsumption(machine: MachineCard): Promise<ConsumptionSegment[]> {
  const entries = (await listFuelEntries(machine.id)).filter((e) => e.fuelType !== 'adblue');
  return consumptionSegments(entries.map((e) => ({ atMs: Date.parse(e.fueledAt), liters: e.liters, fullTank: e.fullTank, counter: e.counterValue })));
}

export function fuelCostOf(e: FuelEntry): number {
  return e.priceTotalKc ?? (e.pricePerL !== null ? e.pricePerL * e.liters : 0);
}

// Palivo zakázky (etapa 5): u každého stroje průměrné náklady na palivo na
// odpracovanou hodinu (vozidlo: na km) × hodiny (km) na zakázce.
setOrderFuelCostProvider(async (orderId, eff) => {
  const db = await getDb();
  const machines = await listMachines();
  let kc = 0;
  let liters = 0;
  for (const m of machines) {
    const entries = await listFuelEntries(m.id);
    if (entries.length === 0) continue;
    const samples = await usageSamples(m);
    const totalUsage = samples.reduce((s, x) => s + x.amount, 0);
    if (totalUsage <= 0) continue;
    const costPer = entries.reduce((s, e) => s + fuelCostOf(e), 0) / totalUsage;
    const litersPer = entries.reduce((s, e) => s + e.liters, 0) / totalUsage;
    let onOrder = 0;
    if (m.counterUnit === 'km') {
      // zakázka přejezdu je dopočtená (migrace v8), ne uložená
      const trips = (
        await db.getAllAsync<{ id: number; distance_m: number; road_distance_m: number | null; km_override: number | null }>(
          'SELECT id, distance_m, road_distance_m, km_override FROM trips WHERE vehicle_category_id = ? AND is_deleted = 0',
          [m.id]
        )
      ).filter((t) => eff.trips.get(t.id) === orderId);
      onOrder = trips.reduce((s, t) => s + tripKm({ kmOverride: t.km_override, distanceM: t.distance_m, roadDistanceM: t.road_distance_m }), 0);
    } else {
      const rows = await db.getAllAsync<{ id: number; quantity: number }>("SELECT id, quantity FROM day_work_records WHERE category_id = ? AND unit = 'hour'", [m.id]);
      onOrder = rows.filter((r) => eff.records.get(r.id) === orderId).reduce((sum, r) => sum + r.quantity, 0);
    }
    kc += onOrder * costPer;
    liters += onOrder * litersPer;
  }
  return { kc, liters };
});

// --- upozornění: servis a čerpací stanice ---

// Servis: 1× pro každý práh (první / druhé upozornění / po termínu) a
// každé provedení (klíč obsahuje datum posledního servisu).
export async function evaluateServiceNotifications(): Promise<void> {
  for (const m of await listMachines()) {
    const info = await machineCounter(m);
    for (const item of await listServiceItems(m.id)) {
      const st = itemStatus(item, info);
      if (!st.threshold) continue;
      const key = `svc.${item.id}.${item.lastDoneDate ?? ''}.${item.lastDoneValue ?? ''}.${st.threshold}`;
      if ((await getInternalValue(key)) !== null) continue;
      const unit = COUNTER_LABEL[m.counterUnit];
      const what =
        st.threshold === 'due'
          ? 'je po termínu'
          : st.remainingValue !== null && unit
            ? `zbývá ${Math.round(st.remainingValue)} ${unit}${st.estimatedWorkdays !== null ? ` (≈ ${st.estimatedWorkdays} prac. dní)` : ''}`
            : `zbývá ${st.remainingDays} dní`;
      try {
        DochazkaNative.scheduleNotification(`svc|${item.id}|${st.threshold}`, `Servis ${m.name}: ${item.name}`, what, 0, [], JSON.stringify({ kind: 'machine', date: toIsoDate(new Date()), machineId: m.id }));
        await setInternalValue(key, new Date().toISOString());
      } catch {
        // nativní modul chybí
      }
    }
  }
}

// Stání 5 min při jízdě u čerpací stanice -> "Tankoval jsi? Zapsat".
setStationaryStopHandler(async (latitude, longitude, atMs) => {
  const name = await DochazkaNative.nearbyGasStation(latitude, longitude, 80).catch(() => '');
  if (!name) return;
  DochazkaNative.scheduleNotification(
    `fuel|${atMs}`,
    'Tankoval jsi?',
    `${name} - zapsat tankování`,
    0,
    [{ id: 'fuel', title: 'Zapsat tankování', foreground: true }],
    JSON.stringify({ kind: 'fuel', date: toIsoDate(new Date(atMs)), latitude, longitude, at: new Date(atMs).toISOString(), station: name })
  );
});

// Varování při prvním zápisu dne pro stroj s nevyřešenou závadou (zadání).
export async function defectWarningFor(date: string, categoryIds: number[]): Promise<string | null> {
  const db = await getDb();
  const lines: string[] = [];
  for (const id of [...new Set(categoryIds)]) {
    const already = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM day_work_records WHERE date = ? AND category_id = ?', [date, id]);
    if ((already?.n ?? 0) > 0) continue;
    const open = await listDefects(id, false);
    if (open.length === 0) continue;
    const machine = await getMachine(id);
    lines.push(`${machine?.name ?? 'Stroj'}: ${open.map((d) => `${d.description} (${DEFECT_LABEL[d.severity]})`).join(', ')}`);
  }
  return lines.length ? lines.join('\n') : null;
}
