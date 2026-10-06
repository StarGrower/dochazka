// Zakázky (etapa 5) - odběratelé, zakázky s místy, výdaje, podklady k
// faktuře a automatické přiřazení zápisů práce a přejezdů.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - přiřazení je uložené u záznamu (order_id), ne
// počítané: jde ho ručně změnit a vyfakturované záznamy se už nehýbou.
// Automatika přiřazuje jen nepřiřazené (order_id NULL; -1 = ručně "bez
// zakázky"): zápis s místem -> zakázka, které místo patří a do jejíhož
// období den spadá; zápis bez místa -> když v ten den byl pobyt na
// místě právě jedné zakázky; přejezd -> podle místa příjezdu (nebo odjezdu).
//
// Podklad k faktuře označí všechno nevyfakturované (invoice_batch_id) -
// nic se nedá vyúčtovat dvakrát. Servis se do nákladů nepočítá.

import { getDb, getVisitsForDay, listCategories, listPlaces } from './db';
import { toIsoDate } from './format';
import { computeOrderStats, type OrderStats } from './orderStats';
import { tripKm } from './tripPlan';
import { ME_ID, type Client, type ExpenseCategory, type InvoiceBatch, type Order, type OrderExpense, type OrderPriceMode, type OrderStatus, type Person } from './types';

// --- odběratelé ---

export async function listClients(): Promise<Client[]> {
  const db = await getDb();
  return db.getAllAsync<Client>('SELECT id, name, ico, dic, address, note FROM clients WHERE is_deleted = 0 ORDER BY name');
}

export async function saveClient(c: Omit<Client, 'id'> & { id?: number | null }): Promise<number> {
  const db = await getDb();
  if (c.id) {
    await db.runAsync('UPDATE clients SET name = ?, ico = ?, dic = ?, address = ?, note = ?, updated_at = ? WHERE id = ?', [
      c.name, c.ico, c.dic, c.address, c.note, new Date().toISOString(), c.id,
    ]);
    return c.id;
  }
  const r = await db.runAsync('INSERT INTO clients (name, ico, dic, address, note) VALUES (?, ?, ?, ?, ?)', [c.name, c.ico, c.dic, c.address, c.note]);
  return r.lastInsertRowId;
}

// --- zakázky ---

interface OrderRow {
  id: number;
  name: string;
  client_id: number | null;
  client_name: string | null;
  status: OrderStatus;
  price_mode: OrderPriceMode;
  fixed_price_kc: number | null;
  budget_kc: number | null;
  date_from: string | null;
  date_to: string | null;
  note: string;
  place_ids: string | null;
}

const ORDER_SELECT = `SELECT o.id, o.name, o.client_id, c.name as client_name, o.status, o.price_mode, o.fixed_price_kc, o.budget_kc,
    o.date_from, o.date_to, o.note, (SELECT group_concat(place_id) FROM order_places WHERE order_id = o.id) as place_ids
  FROM orders o LEFT JOIN clients c ON c.id = o.client_id`;

function mapOrder(r: OrderRow): Order {
  return {
    id: r.id,
    name: r.name,
    clientId: r.client_id,
    clientName: r.client_name,
    status: r.status,
    priceMode: r.price_mode,
    fixedPriceKc: r.fixed_price_kc,
    budgetKc: r.budget_kc,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    note: r.note,
    placeIds: r.place_ids ? r.place_ids.split(',').map(Number) : [],
  };
}

export async function listOrders(): Promise<Order[]> {
  const db = await getDb();
  return (await db.getAllAsync<OrderRow>(`${ORDER_SELECT} WHERE o.is_deleted = 0 ORDER BY o.created_at DESC`)).map(mapOrder);
}

export async function getOrder(id: number): Promise<Order | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
  return row ? mapOrder(row) : null;
}

export type OrderFields = Omit<Order, 'id' | 'clientName'>;

export async function saveOrder(id: number | null, f: OrderFields): Promise<number> {
  const db = await getDb();
  const params = [f.name, f.clientId, f.status, f.priceMode, f.fixedPriceKc, f.budgetKc, f.dateFrom, f.dateTo, f.note];
  let orderId = id;
  if (orderId) {
    await db.runAsync(
      `UPDATE orders SET name = ?, client_id = ?, status = ?, price_mode = ?, fixed_price_kc = ?, budget_kc = ?, date_from = ?, date_to = ?,
         note = ?, updated_at = ? WHERE id = ?`,
      [...params, new Date().toISOString(), orderId]
    );
  } else {
    const r = await db.runAsync(
      'INSERT INTO orders (name, client_id, status, price_mode, fixed_price_kc, budget_kc, date_from, date_to, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params
    );
    orderId = r.lastInsertRowId;
  }
  await db.runAsync('DELETE FROM order_places WHERE order_id = ?', [orderId]);
  for (const placeId of f.placeIds) await db.runAsync('INSERT OR IGNORE INTO order_places (order_id, place_id) VALUES (?, ?)', [orderId, placeId]);
  // Změna míst/období -> nevyfakturované automatické přiřazení znovu.
  await db.runAsync('UPDATE day_work_records SET order_id = NULL WHERE order_id = ? AND invoice_batch_id IS NULL', [orderId]);
  await db.runAsync('UPDATE trips SET order_id = NULL WHERE order_id = ? AND invoice_batch_id IS NULL', [orderId]);
  await assignOrdersAuto();
  return orderId;
}

export async function deleteOrder(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE orders SET is_deleted = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  await db.runAsync('UPDATE day_work_records SET order_id = NULL WHERE order_id = ? AND invoice_batch_id IS NULL', [id]);
  await db.runAsync('UPDATE trips SET order_id = NULL WHERE order_id = ? AND invoice_batch_id IS NULL', [id]);
}

// Ruční přeřazení (orderId -1 = "bez zakázky", null = vrátit automatice).
export async function setRecordOrder(recordId: number, orderId: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE day_work_records SET order_id = ? WHERE id = ? AND invoice_batch_id IS NULL', [orderId, recordId]);
}

export async function setTripOrder(tripId: number, orderId: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE trips SET order_id = ? WHERE id = ? AND invoice_batch_id IS NULL', [orderId, tripId]);
}

// --- automatické přiřazení ---

// Zakázka, které místo patří a do jejíhož období den spadá (nejnovější).
function orderFor(orders: Order[], placeId: number | null, date: string): number | null {
  if (placeId === null) return null;
  const match = orders.find(
    (o) => o.placeIds.includes(placeId) && (!o.dateFrom || o.dateFrom <= date) && (!o.dateTo || o.dateTo >= date)
  );
  return match?.id ?? null;
}

// Přiřadí nepřiřazené zápisy a přejezdy (rozsah dnů, null = vše).
export async function assignOrdersAuto(fromDate: string | null = null, toDate: string | null = null): Promise<void> {
  const db = await getDb();
  const orders = (await listOrders()).filter((o) => o.placeIds.length > 0);
  if (orders.length === 0) return;

  // Bez zadaného rozsahu jen období, které zakázky pokrývají (bez data = vše).
  if (!fromDate || !toDate) {
    const froms = orders.map((o) => o.dateFrom);
    const tos = orders.map((o) => o.dateTo);
    fromDate = froms.includes(null) ? '0000-01-01' : (froms as string[]).sort()[0];
    toDate = tos.includes(null) ? '9999-12-31' : (tos as string[]).sort().reverse()[0];
  }
  const range = 'AND date >= ? AND date <= ?';
  const rangeParams = [fromDate, toDate];
  const records = await db.getAllAsync<{ id: number; date: string; place_id: number | null; worker_id: number }>(
    `SELECT id, date, place_id, worker_id FROM day_work_records WHERE order_id IS NULL AND invoice_batch_id IS NULL ${range}`,
    rangeParams
  );
  const dayCandidates = new Map<string, number | null>(); // den -> jediná zakázka podle pobytů
  for (const r of records) {
    let orderId = orderFor(orders, r.place_id, r.date);
    // Zápis bez místa podle MÝCH pobytů jen u mojí práce (kolega mohl být jinde).
    if (orderId === null && r.place_id === null && r.worker_id === ME_ID) {
      if (!dayCandidates.has(r.date)) {
        const visits = await getVisitsForDay(r.date);
        const ids = new Set(visits.map((v) => orderFor(orders, v.placeId, r.date)).filter((x): x is number => x !== null));
        dayCandidates.set(r.date, ids.size === 1 ? [...ids][0] : null);
      }
      orderId = dayCandidates.get(r.date) ?? null;
    }
    if (orderId !== null) await db.runAsync('UPDATE day_work_records SET order_id = ? WHERE id = ?', [orderId, r.id]);
  }

  const trips = await db.getAllAsync<{ id: number; start_at: string; to_place_id: number | null; from_place_id: number | null }>(
    "SELECT id, start_at, to_place_id, from_place_id FROM trips WHERE order_id IS NULL AND invoice_batch_id IS NULL AND is_deleted = 0 AND is_private = 0"
  );
  for (const t of trips) {
    const date = toIsoDate(new Date(t.start_at));
    if (date < fromDate || date > toDate) continue;
    const orderId = orderFor(orders, t.to_place_id, date) ?? orderFor(orders, t.from_place_id, date);
    if (orderId !== null) await db.runAsync('UPDATE trips SET order_id = ? WHERE id = ?', [orderId, t.id]);
  }
}

// --- výdaje ---

export async function listExpenses(orderId: number): Promise<OrderExpense[]> {
  const db = await getDb();
  return db.getAllAsync<OrderExpense>(
    `SELECT id, order_id as orderId, date, amount_kc as amountKc, description, category, invoice_batch_id as invoiceBatchId
     FROM order_expenses WHERE order_id = ? AND is_deleted = 0 ORDER BY date DESC`,
    [orderId]
  );
}

export async function addExpense(orderId: number, e: { date: string; amountKc: number; description: string; category: ExpenseCategory }): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO order_expenses (order_id, date, amount_kc, description, category) VALUES (?, ?, ?, ?, ?)', [
    orderId, e.date, e.amountKc, e.description, e.category,
  ]);
}

export async function deleteExpense(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE order_expenses SET is_deleted = 1 WHERE id = ?', [id]);
}

// --- podklady k faktuře ---

export async function listInvoiceBatches(orderId: number | null = null): Promise<InvoiceBatch[]> {
  const db = await getDb();
  return db.getAllAsync<InvoiceBatch>(
    `SELECT id, order_id as orderId, created_at as createdAt, total_kc as totalKc, note, status, paid_at as paidAt
     FROM invoice_batches WHERE is_deleted = 0 ${orderId !== null ? 'AND order_id = ?' : ''} ORDER BY created_at DESC`,
    orderId !== null ? [orderId] : []
  );
}

// Vše nevyfakturované u zakázky -> jeden podklad (žádné dvojí účtování).
// Filtr podle pracovníka (doplněk etapy 5): jen jeho položky a jízdy, kde
// řídil; výdaje patří zakázce, ne pracovníkovi -> jen podklad bez filtru.
export async function createInvoiceBatch(order: Order, totalKc: number, note: string, workerId: number | null = null): Promise<number> {
  const db = await getDb();
  let batchId = 0;
  const w = workerId !== null ? ' AND worker_id = ?' : '';
  const wt = workerId !== null ? ' AND driver_id = ?' : '';
  const wp = workerId !== null ? [workerId] : [];
  await db.withExclusiveTransactionAsync(async (txn) => {
    const r = await txn.runAsync('INSERT INTO invoice_batches (order_id, total_kc, note) VALUES (?, ?, ?)', [order.id, totalKc, note]);
    batchId = r.lastInsertRowId;
    await txn.runAsync(`UPDATE day_work_records SET invoice_batch_id = ? WHERE order_id = ? AND invoice_batch_id IS NULL${w}`, [batchId, order.id, ...wp]);
    await txn.runAsync(`UPDATE trips SET invoice_batch_id = ? WHERE order_id = ? AND invoice_batch_id IS NULL AND is_deleted = 0${wt}`, [batchId, order.id, ...wp]);
    if (workerId === null) {
      await txn.runAsync('UPDATE order_expenses SET invoice_batch_id = ? WHERE order_id = ? AND invoice_batch_id IS NULL AND is_deleted = 0', [batchId, order.id]);
    }
    if (order.status === 'done') await txn.runAsync("UPDATE orders SET status = 'invoiced' WHERE id = ?", [order.id]);
  });
  return batchId;
}

export async function setInvoiceBatchPaid(batch: InvoiceBatch, paid: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE invoice_batches SET status = ?, paid_at = ? WHERE id = ?', [paid ? 'paid' : 'invoiced', paid ? new Date().toISOString() : null, batch.id]);
  const open = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM invoice_batches WHERE order_id = ? AND status = 'invoiced' AND is_deleted = 0", [batch.orderId]);
  if (paid && open?.c === 0) await db.runAsync("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'invoiced'", [batch.orderId]);
}

// Zrušení podkladu - položky jsou zase "nevyfakturované".
export async function deleteInvoiceBatch(batch: InvoiceBatch): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE invoice_batches SET is_deleted = 1 WHERE id = ?', [batch.id]);
    for (const table of ['day_work_records', 'trips', 'order_expenses']) {
      await txn.runAsync(`UPDATE ${table} SET invoice_batch_id = NULL WHERE invoice_batch_id = ?`, [batch.id]);
    }
  });
}

// --- přehled zakázky ---

export interface OrderDetail {
  order: Order;
  stats: OrderStats;
  expenses: OrderExpense[];
  batches: InvoiceBatch[];
  firstDate: string | null;
  lastDate: string | null;
}

// Pracovníci = řidiči (tabulka people, id 1 = já).
export async function listPeople(includeDeleted = false): Promise<Person[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; name: string; is_me: number; rate_hour_kc: number | null; rate_day_kc: number | null; billable: number | null }>(
    `SELECT id, name, is_me, rate_hour_kc, rate_day_kc, billable FROM people ${includeDeleted ? '' : 'WHERE is_deleted = 0'} ORDER BY is_me DESC, name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isMe: r.is_me === 1, rateHourKc: r.rate_hour_kc, rateDayKc: r.rate_day_kc, billable: r.billable !== 0 }));
}

export async function savePerson(p: Omit<Person, 'id' | 'isMe'> & { id?: number | null }): Promise<number> {
  const db = await getDb();
  if (p.id) {
    await db.runAsync('UPDATE people SET name = ?, rate_hour_kc = ?, rate_day_kc = ?, billable = ? WHERE id = ?', [p.name, p.rateHourKc, p.rateDayKc, p.billable ? 1 : 0, p.id]);
    return p.id;
  }
  const r = await db.runAsync('INSERT INTO people (name, is_me, rate_hour_kc, rate_day_kc, billable) VALUES (?, 0, ?, ?, ?)', [p.name, p.rateHourKc, p.rateDayKc, p.billable ? 1 : 0]);
  return r.lastInsertRowId;
}

// Měkké smazání - staré zápisy si jméno pracovníka nechají.
export async function deletePerson(id: number): Promise<void> {
  if (id === ME_ID) return;
  const db = await getDb();
  await db.runAsync('UPDATE people SET is_deleted = 1 WHERE id = ?', [id]);
}

// Výchozí vozidlo pro km bez vozidla: stroj s výchozí jednotkou Kč/km.
async function kmRates(): Promise<{ byId: Map<number, number>; defaultRate: number }> {
  const categories = await listCategories(true);
  const byId = new Map(categories.map((c) => [c.id, c.rates.km]));
  const def = categories.find((c) => !c.isDeleted && c.defaultUnit === 'km') ?? categories.find((c) => !c.isDeleted && c.rates.km > 0);
  return { byId, defaultRate: def?.rates.km ?? 0 };
}

// Palivo zakázky (etapa 6 doplní rozpočítání podle Mth) - zde nula.
export let orderFuelCost: (orderId: number) => Promise<{ kc: number; liters: number }> = async () => ({ kc: 0, liters: 0 });
export function setOrderFuelCostProvider(fn: typeof orderFuelCost): void {
  orderFuelCost = fn;
}

// workerId: přehled jen pro jednoho pracovníka (podklad, export); bez
// výdajů, ty patří celé zakázce.
export async function getOrderDetail(orderId: number, workerId: number | null = null): Promise<OrderDetail | null> {
  const order = await getOrder(orderId);
  if (!order) return null;
  const db = await getDb();
  const records = await db.getAllAsync<{
    category_id: number; category_name: string; color: string; unit: 'hour' | 'day' | 'km'; quantity: number; rate_kc: number;
    surcharge_pct: number; date: string; worker_id: number; invoice_batch_id: number | null;
  }>(
    `SELECT r.category_id, c.name as category_name, c.color, r.unit, r.quantity, r.rate_kc, r.surcharge_pct, r.date, r.worker_id, r.invoice_batch_id
     FROM day_work_records r JOIN work_categories c ON c.id = r.category_id WHERE r.order_id = ? ${workerId !== null ? 'AND r.worker_id = ?' : ''} ORDER BY r.date`,
    workerId !== null ? [orderId, workerId] : [orderId]
  );
  // Přejezdy bez km v Práci a strojích (jinak by se počítaly dvakrát).
  const trips = await db.getAllAsync<{
    start_at: string; distance_m: number; road_distance_m: number | null; km_override: number | null; vehicle_category_id: number | null;
    invoice_batch_id: number | null;
  }>(
    `SELECT t.start_at, t.distance_m, t.road_distance_m, t.km_override, t.vehicle_category_id, t.invoice_batch_id FROM trips t
     WHERE t.order_id = ? AND t.is_deleted = 0 AND t.is_private = 0 ${workerId !== null ? 'AND t.driver_id = ?' : ''}
       AND (t.work_record_id IS NULL OR NOT EXISTS (SELECT 1 FROM day_work_records r WHERE r.id = t.work_record_id))`,
    workerId !== null ? [orderId, workerId] : [orderId]
  );
  const rates = await kmRates();
  const [allExpenses, batches, people, fuel] = await Promise.all([listExpenses(orderId), listInvoiceBatches(orderId), listPeople(true), orderFuelCost(orderId)]);
  const expenses = workerId === null ? allExpenses : [];
  const stats = computeOrderStats({
    priceMode: order.priceMode,
    fixedPriceKc: order.fixedPriceKc,
    budgetKc: order.budgetKc,
    records: records.map((r) => ({
      categoryId: r.category_id, categoryName: r.category_name, color: r.color, unit: r.unit, quantity: r.quantity, rateKc: r.rate_kc,
      surchargePct: r.surcharge_pct, date: r.date, workerId: r.worker_id, invoiceBatchId: r.invoice_batch_id,
    })),
    trips: trips.map((t) => ({
      km: tripKm({ kmOverride: t.km_override, distanceM: t.distance_m, roadDistanceM: t.road_distance_m }),
      rateKc: (t.vehicle_category_id !== null ? rates.byId.get(t.vehicle_category_id) : undefined) ?? rates.defaultRate,
      date: toIsoDate(new Date(t.start_at)),
      invoiceBatchId: t.invoice_batch_id,
    })),
    expenses: expenses.map((e) => ({ amountKc: e.amountKc, category: e.category, date: e.date })),
    fuelCostKc: fuel.kc,
    fuelLiters: fuel.liters,
    invoicedKc: batches.reduce((s, b) => s + b.totalKc, 0),
    people: new Map(people.map((p) => [p.id, p.name])),
  });
  const dates = [...records.map((r) => r.date), ...trips.map((t) => toIsoDate(new Date(t.start_at)))].sort();
  return { order, stats, expenses, batches, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
}

// Přehled pro seznam (nevyfakturováno, čeká na platbu, rozpočet).
export interface OrderSummary {
  order: Order;
  unbilledKc: number;
  awaitingPaymentKc: number;
  ratesTotalKc: number;
  budgetPct: number | null;
  placeCount: number;
}

export async function listOrderSummaries(): Promise<OrderSummary[]> {
  await assignOrdersAuto();
  const orders = await listOrders();
  const out: OrderSummary[] = [];
  for (const o of orders) {
    const detail = await getOrderDetail(o.id);
    if (!detail) continue;
    out.push({
      order: o,
      unbilledKc: detail.stats.unbilledKc,
      awaitingPaymentKc: detail.batches.filter((b) => b.status === 'invoiced').reduce((s, b) => s + b.totalKc, 0),
      ratesTotalKc: detail.stats.ratesTotalKc,
      budgetPct: detail.stats.budgetPct,
      placeCount: o.placeIds.length,
    });
  }
  return out;
}

export async function workPlaces() {
  return (await listPlaces()).filter((p) => !p.isPrivate && !p.isHome);
}

