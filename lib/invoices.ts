// Faktury (migrace v9, v10) - koncepty, vystavení, platba, zrušení.
//
// - Koncept jde kdykoli upravit a sdílet (PDF s nápisem KONCEPT) - nic
//   nemění, číslo nerezervuje. Teprve VYSTAVENÍ fakturu zamkne, přidělí
//   číslo z řady (není-li zadané ručně) a u faktury ze zakázky odečte
//   práci z "Nevyfakturováno".
// - Faktura ze zakázky: položky se předvyplní z NEVYFAKTUROVANÉ práce
//   zakázky a ze zbytků dřívějších faktur (pak jsou samostatné - úprava
//   položek nemění docházku), výpis prací ukazuje vždy skutečné zápisy.
// - Vystavení faktury ze zakázky = podklad k faktuře (invoice_batches) na
//   částku faktury: zápisy a přejezdy ve výpisu se označí jako
//   vyfakturované. Fakturuje-li se méně hodin, než je odpracováno, zbytek
//   se buď nechá k fakturaci později (zůstane v Nevyfakturováno, příští
//   faktura ho předvyplní), nebo odepíše (sleva); volba se uloží k faktuře.
// - Zrušená faktura zůstává v seznamu (stav "Zrušená", PDF s nápisem
//   ZRUŠENO) a její číslo se nikdy znovu nepoužije.
// - Faktura nese snímek dodavatele, odběratele, položek a výpisu prací -
//   PDF jde kdykoli vygenerovat znovu stejné (viz lib/invoiceReport.ts).

import { ibanFromSetting } from './bankAccount';
import { getDayNotesBetween, getDb, getSettings } from './db';
import { toIsoDate } from './format';
import {
  addDaysIso,
  buildWorkLog,
  carryItem,
  invoiceTotal,
  isValidInvoiceNumber,
  itemsFromWork,
  nextInvoiceNumber,
  periodLabel,
  remainderFor,
  round2,
  summarizeWorkLog,
  type WorkSource,
} from './invoiceCalc';
import { deleteInvoiceBatch, effectiveOrders, getOrder, getOrderDetail, kmRates, listClients, listPeople, pendingCarries } from './orders';
import { dayNoteText } from './orderStats';
import { tripKm } from './tripPlan';
import type {
  AppSettings,
  Client,
  Invoice,
  InvoiceCarry,
  InvoiceItem,
  InvoiceParty,
  InvoicePayment,
  InvoiceRemainder,
  InvoiceStatus,
  InvoiceSupplier,
  Order,
  RemainderMode,
  WorkLogNote,
  WorkLogRow,
} from './types';

interface InvoiceRow {
  id: number;
  number: string;
  number_manual: number;
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
  work_notes_json: string | null;
  total_kc: number;
  invoice_batch_id: number | null;
  issued_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  remainder_mode: RemainderMode | null;
  remainder_hours: number | null;
  remainder_rate_kc: number | null;
  remainder_work: string | null;
  carry_json: string | null;
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

const SELECT = `SELECT id, number, number_manual, order_id, order_name, client_id, client_json, supplier_json, status, issue_date, due_days, due_date,
  payment, with_work_log, work_log_json, work_notes_json, total_kc, invoice_batch_id, issued_at, paid_at, cancelled_at, remainder_mode, remainder_hours,
  remainder_rate_kc, remainder_work, carry_json FROM invoices`;

function mapRow(r: InvoiceRow, items: InvoiceItem[]): Invoice {
  const client = parseJson<InvoiceParty | null>(r.client_json, null);
  const remainder: InvoiceRemainder | null =
    r.remainder_mode && r.remainder_hours !== null
      ? { mode: r.remainder_mode, hours: r.remainder_hours, rateKc: r.remainder_rate_kc ?? 0, work: r.remainder_work ?? 'Práce' }
      : null;
  return {
    id: r.id,
    number: r.number,
    numberManual: r.number_manual === 1,
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
    workNotes: parseJson<WorkLogNote[]>(r.work_notes_json, []),
    items,
    totalKc: r.total_kc,
    invoiceBatchId: r.invoice_batch_id,
    issuedAt: r.issued_at,
    paidAt: r.paid_at,
    cancelledAt: r.cancelled_at,
    remainder,
    carries: parseJson<InvoiceCarry[]>(r.carry_json, []),
  };
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<InvoiceRow>(`${SELECT} WHERE id = ? AND is_deleted = 0`, [id]);
  return row ? mapRow(row, await itemsOf(id)) : null;
}

// Seznam bez položek (stačí částka a stav); zrušené zůstávají.
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
//
// Řadu tvoří všechny kdy vystavené faktury - i zrušené (a i ty, které
// starší verze smazala), takže se číslo nikdy nepoužije znovu. Koncepty
// čísla nerezervují.

const SERIES = "SELECT number FROM invoices WHERE status != 'draft' OR issued_at IS NOT NULL";

export async function suggestInvoiceNumber(issueDate: string): Promise<string> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ number: string }>(SERIES);
  return nextInvoiceNumber(rows.map((r) => r.number), Number(issueDate.slice(0, 4)));
}

export async function invoiceNumberTaken(number: string, exceptId: number | null = null): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM (${SERIES.replace('SELECT number', 'SELECT number, id')}) WHERE number = ? AND id IS NOT ?`, [number, exceptId]);
  return (row?.c ?? 0) > 0;
}

// --- práce zakázky k fakturaci ---

export interface OrderWork {
  order: Order;
  sources: WorkSource[];
  recordIds: number[];
  tripIds: number[];
  workLog: WorkLogRow[];
  workNotes: WorkLogNote[];
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
    await db.getAllAsync<{ id: number; date: string; name: string; quantity: number; unit: 'hour' | 'day' | 'km'; rate_kc: number; surcharge_pct: number; worker_id: number; note: string }>(
      `SELECT r.id, r.date, c.name, r.quantity, r.unit, r.rate_kc, r.surcharge_pct, r.worker_id, r.note
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
  // Poznámky dnů výpisu (stejně jako interní výkaz zakázky).
  const dayNotes = summary.from && summary.to ? await getDayNotesBetween(summary.from, summary.to) : new Map<string, string>();
  const workNotes: WorkLogNote[] = [...new Set(workLog.map((r) => r.date))]
    .map((date) => ({
      date,
      note: dayNoteText(dayNotes.get(date), [...new Set(records.filter((r) => r.date === date).map((r) => r.note.trim()).filter(Boolean))]),
    }))
    .filter((n) => n.note);
  const description = [`Zakázka ${order.name}`, periodLabel(summary.from, summary.to)].filter(Boolean).join(' · ');
  let fixed: { name: string; amountKc: number } | null = null;
  if (order.priceMode === 'fixed' && order.fixedPriceKc !== null) {
    const detail = await getOrderDetail(orderId, null, eff);
    fixed = { name: order.name, amountKc: detail?.stats.unbilledKc ?? 0 };
  }
  return { order, sources, recordIds: records.map((r) => r.id), tripIds: trips.map((t) => t.id), workLog, workNotes, prefill: itemsFromWork(sources, description, fixed) };
}

// --- nový koncept ---

export async function newInvoice(orderId: number | null): Promise<Invoice> {
  const settings = await getSettings();
  const issueDate = toIsoDate(new Date());
  const dueDays = settings.defaultDueDays;
  const work = orderId !== null ? await orderWorkForInvoice(orderId) : null;
  const carries = work ? await pendingCarries(work.order.id) : [];
  let client: Client | null = null;
  if (work?.order.clientId) client = (await listClients()).find((c) => c.id === work.order.clientId) ?? null;
  const items = [...(work?.prefill ?? []), ...carries.map(carryItem)];
  return {
    id: null,
    number: await suggestInvoiceNumber(issueDate),
    numberManual: false,
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
    workNotes: work ? work.workNotes : [],
    items,
    totalKc: invoiceTotal(items),
    invoiceBatchId: null,
    issuedAt: null,
    paidAt: null,
    cancelledAt: null,
    remainder: null,
    carries,
  };
}

// Koncept: dodavatel, výpis prací, zbytky dřívějších faktur a navržené
// číslo vždy aktuální (zápisy i řada se mezitím mohly změnit); položky
// zůstávají, jak je uživatel upravil.
export async function refreshDraft(inv: Invoice): Promise<Invoice> {
  if (inv.status !== 'draft') return inv;
  const supplier = supplierFromSettings(await getSettings());
  const number = inv.numberManual ? inv.number : await suggestInvoiceNumber(inv.issueDate);
  if (inv.orderId === null) return { ...inv, supplier, number };
  const work = await orderWorkForInvoice(inv.orderId);
  return {
    ...inv,
    supplier,
    number,
    workLog: work ? work.workLog : inv.workLog,
    workNotes: work ? work.workNotes : inv.workNotes,
    orderName: work?.order.name ?? inv.orderName,
    carries: await pendingCarries(inv.orderId),
  };
}

// --- uložení konceptu ---

export async function saveInvoice(inv: Invoice): Promise<number> {
  if (inv.status !== 'draft') throw new Error('Vystavená faktura se už nemění.');
  if (!(inv.dueDays >= 0)) throw new Error('Splatnost nesmí být před datem vystavení.');
  const db = await getDb();
  const items = inv.items.filter((i) => i.name.trim() || i.quantity !== 0 || i.unitPriceKc !== 0);
  const total = invoiceTotal(items);
  const params = [
    inv.number, inv.numberManual ? 1 : 0, inv.orderId, inv.orderName, inv.clientId, JSON.stringify(inv.client), JSON.stringify(inv.supplier), inv.issueDate,
    inv.dueDays, addDaysIso(inv.issueDate, inv.dueDays), inv.payment, inv.withWorkLog ? 1 : 0, inv.workLog ? JSON.stringify(inv.workLog) : null, total,
    JSON.stringify(inv.carries), JSON.stringify(inv.workNotes ?? []),
  ];
  let id = inv.id;
  await db.withExclusiveTransactionAsync(async (txn) => {
    if (id) {
      await txn.runAsync(
        `UPDATE invoices SET number = ?, number_manual = ?, order_id = ?, order_name = ?, client_id = ?, client_json = ?, supplier_json = ?, issue_date = ?,
           due_days = ?, due_date = ?, payment = ?, with_work_log = ?, work_log_json = ?, total_kc = ?, carry_json = ?, work_notes_json = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
        [...params, new Date().toISOString(), id]
      );
      await txn.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', [id]);
    } else {
      const r = await txn.runAsync(
        `INSERT INTO invoices (number, number_manual, order_id, order_name, client_id, client_json, supplier_json, issue_date, due_days, due_date, payment,
           with_work_log, work_log_json, total_kc, carry_json, work_notes_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
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

// --- vystavení ---

// Před vystavením (pro potvrzení v UI): výsledné číslo, aktuální výpis
// prací a zbytky, a kolik hodin by zbylo (null = nic).
export async function prepareIssue(inv: Invoice): Promise<{ invoice: Invoice; remainder: Omit<InvoiceRemainder, 'mode'> | null }> {
  const fresh = await refreshDraft(inv);
  const number = fresh.numberManual ? fresh.number : await suggestInvoiceNumber(fresh.issueDate);
  const invoice = { ...fresh, number };
  return { invoice, remainder: invoice.orderId !== null ? remainderFor(invoice.items, invoice.workLog, invoice.carries) : null };
}

// Vystavení: zamkne snímek, přidělí číslo z řady (ruční číslo jen když je
// volné) a u faktury ze zakázky vytvoří podklad na částku faktury - označí
// právě ty zápisy a přejezdy, které jsou ve výpisu prací, a převezme
// zbytky dřívějších faktur. `remainderMode` = co se zbytkem hodin (jen
// když se fakturuje méně hodin, než je odpracováno).
export async function issueInvoice(inv: Invoice, remainderMode: RemainderMode | null = null): Promise<Invoice> {
  if (inv.status !== 'draft') return inv;
  const { invoice: ready, remainder } = await prepareIssue(inv);
  if (!isValidInvoiceNumber(ready.number)) throw new Error('Číslo faktury smí mít jen číslice, nejvýš 10.');
  if (await invoiceNumberTaken(ready.number, ready.id)) throw new Error(`Faktura č. ${ready.number} už byla vystavená (čísla se znovu nepoužívají).`);
  if (remainder && !remainderMode) throw new Error('Chybí volba, co se zbytkem hodin.');
  const work = ready.orderId !== null ? await orderWorkForInvoice(ready.orderId) : null;
  const id = await saveInvoice({ ...ready, workLog: work ? work.workLog : ready.workLog, workNotes: work ? work.workNotes : ready.workNotes });
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
      for (const c of ready.carries) await txn.runAsync('UPDATE invoices SET remainder_consumed_by = ? WHERE id = ? AND remainder_consumed_by IS NULL', [id, c.invoiceId]);
      if (work.order.status === 'done') await txn.runAsync("UPDATE orders SET status = 'invoiced' WHERE id = ?", [work.order.id]);
    }
    await txn.runAsync(
      `UPDATE invoices SET status = 'issued', number_manual = 1, issued_at = ?, invoice_batch_id = ?, remainder_mode = ?, remainder_hours = ?, remainder_rate_kc = ?,
         remainder_work = ? WHERE id = ?`,
      [now, batchId, remainder ? remainderMode : null, remainder?.hours ?? null, remainder?.rateKc ?? null, remainder?.work ?? null, id]
    );
  });
  return (await getInvoice(id)) as Invoice;
}

export async function setInvoicePaid(inv: Invoice, paid: boolean): Promise<void> {
  if (inv.id === null || (inv.status !== 'issued' && inv.status !== 'paid')) return;
  const db = await getDb();
  const at = paid ? new Date().toISOString() : null;
  await db.runAsync('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?', [paid ? 'paid' : 'issued', at, inv.id]);
  if (inv.invoiceBatchId !== null) {
    await db.runAsync('UPDATE invoice_batches SET status = ?, paid_at = ? WHERE id = ?', [paid ? 'paid' : 'invoiced', at, inv.invoiceBatchId]);
    const open = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM invoice_batches WHERE order_id = ? AND status = 'invoiced' AND is_deleted = 0", [inv.orderId]);
    if (paid && open?.c === 0) await db.runAsync("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'invoiced'", [inv.orderId]);
  }
}

// Smazání konceptu (koncept číslo nemá, nic se neztratí).
export async function deleteDraft(inv: Invoice): Promise<void> {
  if (inv.id === null || inv.status !== 'draft') return;
  const db = await getDb();
  await db.runAsync("UPDATE invoices SET is_deleted = 1, updated_at = ? WHERE id = ? AND status = 'draft'", [new Date().toISOString(), inv.id]);
}

// Zrušení vystavené faktury: zůstane v seznamu jako "Zrušená" (číslo se
// znovu nepoužije); u faktury ze zakázky se zruší podklad - práce je zase
// nevyfakturovaná a převzaté zbytky dřívějších faktur jsou zase k fakturaci.
export async function cancelInvoice(inv: Invoice): Promise<void> {
  if (inv.id === null || (inv.status !== 'issued' && inv.status !== 'paid')) return;
  if (inv.invoiceBatchId !== null) {
    const db = await getDb();
    const batch = await db.getFirstAsync<{ order_id: number }>('SELECT order_id FROM invoice_batches WHERE id = ?', [inv.invoiceBatchId]);
    if (batch) {
      // podklad zruší i fakturu (lib/orders.ts -> deleteInvoiceBatch)
      await deleteInvoiceBatch({ id: inv.invoiceBatchId, orderId: batch.order_id, createdAt: '', totalKc: 0, note: '', status: 'invoiced', paidAt: null });
      return;
    }
  }
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync('UPDATE invoices SET remainder_consumed_by = NULL WHERE remainder_consumed_by = ?', [inv.id]);
  await db.runAsync("UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", [now, now, inv.id]);
}
