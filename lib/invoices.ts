// Faktury (migrace v9) - koncepty, vystavení, platba, zrušení.
//
// - Faktura ze zakázky: položky se předvyplní z NEVYFAKTUROVANÉ práce
//   zakázky (pak jsou samostatné - úprava položek nemění docházku), výpis
//   prací ukazuje vždy skutečné zápisy.
// - Vystavení faktury ze zakázky = podklad k faktuře (invoice_batches) na
//   částku faktury: zápisy a přejezdy ve výpisu se označí jako
//   vyfakturované, takže zmizí z "Nevyfakturováno" (u pevné ceny se
//   odečte částka faktury) a nic se nevyúčtuje dvakrát.
// - Faktura nese snímek dodavatele, odběratele, položek a výpisu prací -
//   PDF jde kdykoli vygenerovat znovu stejné (viz lib/invoiceReport.ts).

import { ibanFromSetting } from './bankAccount';
import { getDb, getSettings } from './db';
import { toIsoDate } from './format';
import { addDaysIso, buildWorkLog, invoiceTotal, itemsFromWork, nextInvoiceNumber, periodLabel, round2, summarizeWorkLog, type WorkSource } from './invoiceCalc';
import { effectiveOrders, getOrder, getOrderDetail, kmRates, listClients, listPeople } from './orders';
import { tripKm } from './tripPlan';
import type { AppSettings, Client, Invoice, InvoiceItem, InvoiceParty, InvoicePayment, InvoiceStatus, InvoiceSupplier, Order, WorkLogRow } from './types';

interface InvoiceRow {
  id: number;
  number: string;
  order_id: number | null;
  order_name: string | null;
  client_id: number | null;
  client_json: string;
  supplier_json: string;
  status: InvoiceStatus;
  issue_date: string;
  due_days: number;
  due_date: string;
  payment: InvoicePayment;
  with_work_log: number;
  work_log_json: string | null;
  total_kc: number;
  invoice_batch_id: number | null;
  issued_at: string | null;
  paid_at: string | null;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function supplierFromSettings(s: AppSettings): InvoiceSupplier {
  return {
    name: s.profileName,
    address: s.profileAddress,
    ico: s.profileIco,
    dic: s.profileDic,
    phone: s.profilePhone,
    email: s.profileEmail,
    registryText: s.registryText,
    vatPayer: s.vatPayer,
    bankAccount: ibanFromSetting(s.bankAccount) ? s.bankAccount : '',
    iban: ibanFromSetting(s.bankAccount),
  };
}

const EMPTY_SUPPLIER: InvoiceSupplier = { name: '', address: '', ico: '', dic: '', phone: '', email: '', registryText: '', vatPayer: false, bankAccount: '', iban: null };

export const clientParty = (c: Client): InvoiceParty => ({ name: c.name, address: c.address, ico: c.ico, dic: c.dic });

async function itemsOf(invoiceId: number): Promise<InvoiceItem[]> {
  const db = await getDb();
  return db.getAllAsync<InvoiceItem>(
    `SELECT name, description, quantity, unit, unit_price_kc as unitPriceKc FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id`,
    [invoiceId]
  );
}

const SELECT = `SELECT id, number, order_id, order_name, client_id, client_json, supplier_json, status, issue_date, due_days, due_date, payment,
  with_work_log, work_log_json, total_kc, invoice_batch_id, issued_at, paid_at FROM invoices`;

function mapRow(r: InvoiceRow, items: InvoiceItem[]): Invoice {
  const client = parseJson<InvoiceParty | null>(r.client_json, null);
  return {
    id: r.id,
    number: r.number,
    orderId: r.order_id,
    orderName: r.order_name,
    clientId: r.client_id,
    client: client && client.name !== undefined ? client : null,
    supplier: { ...EMPTY_SUPPLIER, ...parseJson<Partial<InvoiceSupplier>>(r.supplier_json, {}) },
    status: r.status,
    issueDate: r.issue_date,
    dueDays: r.due_days,
    dueDate: r.due_date,
    payment: r.payment,
    withWorkLog: r.with_work_log === 1,
    workLog: parseJson<WorkLogRow[] | null>(r.work_log_json, null),
    items,
    totalKc: r.total_kc,
    invoiceBatchId: r.invoice_batch_id,
    issuedAt: r.issued_at,
    paidAt: r.paid_at,
  };
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<InvoiceRow>(`${SELECT} WHERE id = ? AND is_deleted = 0`, [id]);
  return row ? mapRow(row, await itemsOf(id)) : null;
}

// Seznam bez položek (stačí částka a stav).
export async function listInvoices(): Promise<Invoice[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<InvoiceRow>(`${SELECT} WHERE is_deleted = 0 ORDER BY issue_date DESC, number DESC`);
  return rows.map((r) => mapRow(r, []));
}

export async function findDraftForOrder(orderId: number): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM invoices WHERE order_id = ? AND status = 'draft' AND is_deleted = 0 ORDER BY id DESC", [orderId]);
  return row?.id ?? null;
}

// --- číslo faktury ---

export async function suggestInvoiceNumber(issueDate: string): Promise<string> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ number: string }>('SELECT number FROM invoices WHERE is_deleted = 0');
  return nextInvoiceNumber(rows.map((r) => r.number), Number(issueDate.slice(0, 4)));
}

export async function invoiceNumberTaken(number: string, exceptId: number | null): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM invoices WHERE number = ? AND is_deleted = 0 AND id IS NOT ?', [number, exceptId]);
  return (row?.c ?? 0) > 0;
}

// --- práce zakázky k fakturaci ---

export interface OrderWork {
  order: Order;
  sources: WorkSource[];
  recordIds: number[];
  tripIds: number[];
  workLog: WorkLogRow[];
  prefill: InvoiceItem[];
}

// Nevyfakturovaná práce zakázky: zápisy (sazba a příplatek uložené u
// zápisu) a přejezdy, jejichž km nejsou už v zápisech (jako přehled zakázky).
export async function orderWorkForInvoice(orderId: number): Promise<OrderWork | null> {
  const order = await getOrder(orderId);
  if (!order) return null;
  const db = await getDb();
  const eff = await effectiveOrders();
  const people = new Map((await listPeople(true)).map((p) => [p.id, p.name]));
  const records = (
    await db.getAllAsync<{ id: number; date: string; name: string; quantity: number; unit: 'hour' | 'day' | 'km'; rate_kc: number; surcharge_pct: number; worker_id: number }>(
      `SELECT r.id, r.date, c.name, r.quantity, r.unit, r.rate_kc, r.surcharge_pct, r.worker_id
       FROM day_work_records r JOIN work_categories c ON c.id = r.category_id WHERE r.invoice_batch_id IS NULL ORDER BY r.date, r.id`
    )
  ).filter((r) => eff.records.get(r.id) === orderId);
  const trips = (
    await db.getAllAsync<{ id: number; start_at: string; distance_m: number; road_distance_m: number | null; km_override: number | null; vehicle_category_id: number | null; driver_id: number }>(
      `SELECT t.id, t.start_at, t.distance_m, t.road_distance_m, t.km_override, t.vehicle_category_id, t.driver_id FROM trips t
       WHERE t.is_deleted = 0 AND t.invoice_batch_id IS NULL
         AND (t.work_record_id IS NULL OR NOT EXISTS (SELECT 1 FROM day_work_records r WHERE r.id = t.work_record_id))`
    )
  ).filter((t) => eff.trips.get(t.id) === orderId);
  const rates = await kmRates();
  const sources: WorkSource[] = [
    ...records.map((r) => ({
      date: r.date,
      work: r.name,
      worker: people.get(r.worker_id) ?? 'Neznámý',
      quantity: r.quantity,
      unit: r.unit,
      amountKc: r.quantity * r.rate_kc * (1 + r.surcharge_pct / 100),
    })),
    ...trips.map((t) => {
      const km = tripKm({ kmOverride: t.km_override, distanceM: t.distance_m, roadDistanceM: t.road_distance_m });
      const rate = (t.vehicle_category_id !== null ? rates.byId.get(t.vehicle_category_id) : undefined) ?? rates.defaultRate;
      return { date: toIsoDate(new Date(t.start_at)), work: 'Doprava', worker: people.get(t.driver_id) ?? 'Neznámý', quantity: km, unit: 'km' as const, amountKc: km * rate };
    }),
  ];
  const workLog = buildWorkLog(sources);
  const summary = summarizeWorkLog(workLog);
  const description = [`Zakázka ${order.name}`, periodLabel(summary.from, summary.to)].filter(Boolean).join(' · ');
  let fixed: { name: string; amountKc: number } | null = null;
  if (order.priceMode === 'fixed' && order.fixedPriceKc !== null) {
    const detail = await getOrderDetail(orderId, null, eff);
    fixed = { name: order.name, amountKc: detail?.stats.unbilledKc ?? 0 };
  }
  return { order, sources, recordIds: records.map((r) => r.id), tripIds: trips.map((t) => t.id), workLog, prefill: itemsFromWork(sources, description, fixed) };
}

// --- nový koncept ---

export async function newInvoice(orderId: number | null): Promise<Invoice> {
  const settings = await getSettings();
  const issueDate = toIsoDate(new Date());
  const dueDays = settings.defaultDueDays;
  const work = orderId !== null ? await orderWorkForInvoice(orderId) : null;
  let client: Client | null = null;
  if (work?.order.clientId) client = (await listClients()).find((c) => c.id === work.order.clientId) ?? null;
  const items = work?.prefill ?? [];
  return {
    id: null,
    number: await suggestInvoiceNumber(issueDate),
    orderId: work ? work.order.id : null,
    orderName: work ? work.order.name : null,
    clientId: client?.id ?? null,
    client: client ? clientParty(client) : null,
    supplier: supplierFromSettings(settings),
    status: 'draft',
    issueDate,
    dueDays,
    dueDate: addDaysIso(issueDate, dueDays),
    payment: 'transfer',
    withWorkLog: work !== null,
    workLog: work ? work.workLog : null,
    items,
    totalKc: invoiceTotal(items),
    invoiceBatchId: null,
    issuedAt: null,
    paidAt: null,
  };
}

// Koncept ze zakázky: dodavatel a výpis prací vždy aktuální (zápisy se
// mezitím mohly změnit); položky zůstávají, jak je uživatel upravil.
export async function refreshDraft(inv: Invoice): Promise<Invoice> {
  if (inv.status !== 'draft') return inv;
  const supplier = supplierFromSettings(await getSettings());
  if (inv.orderId === null) return { ...inv, supplier };
  const work = await orderWorkForInvoice(inv.orderId);
  return { ...inv, supplier, workLog: work ? work.workLog : inv.workLog, orderName: work?.order.name ?? inv.orderName };
}

// --- uložení ---

export async function saveInvoice(inv: Invoice): Promise<number> {
  const db = await getDb();
  const items = inv.items.filter((i) => i.name.trim() || i.quantity !== 0 || i.unitPriceKc !== 0);
  const total = invoiceTotal(items);
  const params = [
    inv.number, inv.orderId, inv.orderName, inv.clientId, JSON.stringify(inv.client), JSON.stringify(inv.supplier), inv.status, inv.issueDate,
    inv.dueDays, addDaysIso(inv.issueDate, inv.dueDays), inv.payment, inv.withWorkLog ? 1 : 0, inv.workLog ? JSON.stringify(inv.workLog) : null, total,
  ];
  let id = inv.id;
  await db.withExclusiveTransactionAsync(async (txn) => {
    if (id) {
      await txn.runAsync(
        `UPDATE invoices SET number = ?, order_id = ?, order_name = ?, client_id = ?, client_json = ?, supplier_json = ?, status = ?, issue_date = ?,
           due_days = ?, due_date = ?, payment = ?, with_work_log = ?, work_log_json = ?, total_kc = ?, updated_at = ? WHERE id = ?`,
        [...params, new Date().toISOString(), id]
      );
      await txn.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    } else {
      const r = await txn.runAsync(
        `INSERT INTO invoices (number, order_id, order_name, client_id, client_json, supplier_json, status, issue_date, due_days, due_date, payment,
           with_work_log, work_log_json, total_kc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
      id = r.lastInsertRowId;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await txn.runAsync('INSERT INTO invoice_items (invoice_id, sort_order, name, description, quantity, unit, unit_price_kc) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id, i, it.name.trim(), it.description.trim(), round2(it.quantity), it.unit, round2(it.unitPriceKc),
      ]);
    }
  });
  return id as number;
}

// Vystavení: uloží snímek a u faktury ze zakázky vytvoří podklad k faktuře
// na částku faktury - označí právě ty zápisy a přejezdy, které jsou ve
// výpisu prací (výpis se v tu chvíli zafixuje).
export async function issueInvoice(inv: Invoice): Promise<Invoice> {
  if (inv.status !== 'draft') return inv;
  const supplier = supplierFromSettings(await getSettings());
  const work = inv.orderId !== null ? await orderWorkForInvoice(inv.orderId) : null;
  const ready: Invoice = { ...inv, supplier, workLog: work ? work.workLog : inv.workLog };
  const id = await saveInvoice(ready);
  const total = invoiceTotal(ready.items);
  const now = new Date().toISOString();
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    let batchId: number | null = null;
    if (work) {
      const r = await txn.runAsync('INSERT INTO invoice_batches (order_id, total_kc, note) VALUES (?, ?, ?)', [work.order.id, total, `Faktura č. ${ready.number}`]);
      batchId = r.lastInsertRowId;
      for (const rid of work.recordIds) await txn.runAsync('UPDATE day_work_records SET invoice_batch_id = ?, order_id = ? WHERE id = ? AND invoice_batch_id IS NULL', [batchId, work.order.id, rid]);
      for (const tid of work.tripIds) await txn.runAsync('UPDATE trips SET invoice_batch_id = ?, order_id = ? WHERE id = ? AND invoice_batch_id IS NULL', [batchId, work.order.id, tid]);
      await txn.runAsync('UPDATE order_expenses SET invoice_batch_id = ? WHERE order_id = ? AND invoice_batch_id IS NULL AND is_deleted = 0', [batchId, work.order.id]);
      if (work.order.status === 'done') await txn.runAsync("UPDATE orders SET status = 'invoiced' WHERE id = ?", [work.order.id]);
    }
    await txn.runAsync("UPDATE invoices SET status = 'issued', issued_at = ?, invoice_batch_id = ? WHERE id = ?", [now, batchId, id]);
  });
  return (await getInvoice(id)) as Invoice;
}

export async function setInvoicePaid(inv: Invoice, paid: boolean): Promise<void> {
  if (inv.id === null || inv.status === 'draft') return;
  const db = await getDb();
  const at = paid ? new Date().toISOString() : null;
  await db.runAsync('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?', [paid ? 'paid' : 'issued', at, inv.id]);
  if (inv.invoiceBatchId !== null) {
    await db.runAsync('UPDATE invoice_batches SET status = ?, paid_at = ? WHERE id = ?', [paid ? 'paid' : 'invoiced', at, inv.invoiceBatchId]);
    const open = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM invoice_batches WHERE order_id = ? AND status = 'invoiced' AND is_deleted = 0", [inv.orderId]);
    if (paid && open?.c === 0) await db.runAsync("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'invoiced'", [inv.orderId]);
  }
}

// Smazání konceptu / zrušení vystavené faktury - u faktury ze zakázky se
// zruší i podklad, práce je zase nevyfakturovaná.
export async function deleteInvoice(inv: Invoice): Promise<void> {
  if (inv.id === null) return;
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE invoices SET is_deleted = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), inv.id]);
    if (inv.invoiceBatchId !== null) {
      await txn.runAsync('UPDATE invoice_batches SET is_deleted = 1 WHERE id = ?', [inv.invoiceBatchId]);
      for (const table of ['day_work_records', 'trips', 'order_expenses']) {
        await txn.runAsync(`UPDATE ${table} SET invoice_batch_id = NULL WHERE invoice_batch_id = ?`, [inv.invoiceBatchId]);
      }
    }
  });
}
