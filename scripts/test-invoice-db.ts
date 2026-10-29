// Testy faktur nad skutečnou SQLite (node:sqlite přes scripts/test-shims):
// koncept vs. vystavení, číslo z řady, zbytek hodin (nechat / odepsat),
// zrušená faktura (zůstává, číslo se znovu nepoužije, PDF s ZRUŠENO).
// Spuštění: npm run test:invoice-db
//
// Žádná skutečná data - čistá prázdná databáze v node_modules/.cache.

import assert from 'node:assert/strict';
import * as fs from 'fs';

const dir = process.env.TEST_DB_DIR as string;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../lib/db') as typeof import('../lib/db');
const orders = require('../lib/orders') as typeof import('../lib/orders');
const invoices = require('../lib/invoices') as typeof import('../lib/invoices');
const { invoiceHtml } = require('../lib/invoiceReport') as typeof import('../lib/invoiceReport');
/* eslint-enable @typescript-eslint/no-require-imports */

import type { Invoice } from '../lib/types';

const Y = new Date().getFullYear();
const html = (inv: Invoice) => invoiceHtml(inv, { mode: 'print' });

async function main() {
  await db.initDb();
  await db.updateSettings({ profileName: 'Dodavatel', bankAccount: '19-2000145399/0800' });
  const sql = await db.getDb();
  const categoryId = (await db.listCategories())[0].id;
  const clientId = await orders.saveClient({ name: 'Odběratel s.r.o.', ico: '12345678', dic: '', address: 'Ulice 1, 123 45 Obec', note: '' });
  const orderId = await orders.saveOrder(null, {
    name: 'Veselá', clientId, status: 'running', priceMode: 'rates', fixedPriceKc: null, budgetKc: null, dateFrom: null, dateTo: null, note: '', placeIds: [],
  });
  const addWork = async (date: string, hours: number) => {
    const r = await sql.runAsync(
      "INSERT INTO day_work_records (date, category_id, quantity, unit, rate_kc, surcharge_pct, source, worker_id) VALUES (?, ?, ?, 'hour', 350, 0, 'manual', 1)",
      [date, categoryId, hours]
    );
    await orders.setRecordOrder(r.lastInsertRowId, orderId);
  };
  const unbilled = async () => Math.round((await orders.getOrderDetail(orderId))!.stats.unbilledKc * 100) / 100;
  const withHours = (inv: Invoice, hours: number): Invoice => ({ ...inv, items: inv.items.map((i, idx) => (idx === 0 ? { ...i, quantity: hours } : i)) });

  for (const [d, h] of [['2026-10-21', 5], ['2026-10-22', 1], ['2026-10-23', 8], ['2026-10-26', 6.5]] as const) await addWork(d, h);

  const tests: Array<[string, () => Promise<void>]> = [
    ['poznámky ke dnům: zakázka i snímek faktury, na PDF jen s přepínačem', async () => {
      await db.setDayNote('2026-10-22', 'Pršelo, jen hodina');
      const rec = await sql.getFirstAsync<{ id: number }>("SELECT id FROM day_work_records WHERE date = '2026-10-23'");
      await sql.runAsync('UPDATE day_work_records SET note = ? WHERE id = ?', ['Jen pro Veselou: výkop u plotu', rec!.id]);
      const days = (await orders.getOrderDetail(orderId))!.stats.days;
      assert.equal(days.find((d) => d.date === '2026-10-22')!.note, 'Pršelo, jen hodina');
      assert.equal(days.find((d) => d.date === '2026-10-23')!.note, 'Jen pro Veselou: výkop u plotu');
      assert.equal(days.find((d) => d.date === '2026-10-21')!.note, '');
      const draft = await invoices.newInvoice(orderId);
      assert.deepEqual(draft.workNotes, [
        { date: '2026-10-22', note: 'Pršelo, jen hodina' },
        { date: '2026-10-23', note: 'Jen pro Veselou: výkop u plotu' },
      ]);
      assert.doesNotMatch(html(draft), /Pršelo|výkop/);
      const withNotes = invoiceHtml(draft, { mode: 'print', withNotes: true });
      assert.match(withNotes, /class="dnote"><td colspan="6">Pršelo, jen hodina/);
      assert.match(withNotes, /výkop u plotu/);
    }],
    ['koncept: uložení ani sdílení nic nemění, číslo nerezervuje, PDF s nápisem KONCEPT', async () => {
      const draft = await invoices.newInvoice(orderId);
      assert.equal(draft.numberManual, false);
      assert.equal(draft.number, `${Y}001`);
      assert.equal(draft.totalKc, 7175);
      const id = await invoices.saveInvoice(draft);
      const saved = (await invoices.getInvoice(id))!;
      assert.equal(saved.status, 'draft');
      assert.equal(await unbilled(), 7175);
      assert.equal((await orders.listInvoiceBatches(orderId)).length, 0);
      assert.equal(await invoices.invoiceNumberTaken(draft.number), false);
      assert.match(html(saved), /<div class="wm"[^>]*><span>KONCEPT<\/span>/);
      assert.equal(await invoices.suggestInvoiceNumber(draft.issueDate), `${Y}001`);
    }],
    ['vystavení s nižšími hodinami bez volby zbytku neprojde', async () => {
      const draft = (await invoices.getInvoice((await invoices.findDraftForOrder(orderId))!))!;
      const { remainder } = await invoices.prepareIssue(withHours(draft, 18));
      assert.deepEqual(remainder, { hours: 2.5, rateKc: 350, work: draft.items[0].name });
      await assert.rejects(invoices.issueInvoice(withHours(draft, 18)), /zbytkem hodin/);
      assert.equal((await invoices.getInvoice(draft.id!))!.status, 'draft');
    }],
    ['vystavení 18 z 20,5 h, zbytek nechat: číslo z řady, zbytek 2,5 h zůstane v Nevyfakturováno', async () => {
      const draft = (await invoices.getInvoice((await invoices.findDraftForOrder(orderId))!))!;
      const issued = await invoices.issueInvoice(withHours(draft, 18), 'carry');
      assert.equal(issued.status, 'issued');
      assert.equal(issued.number, `${Y}001`);
      assert.equal(issued.totalKc, 6300);
      assert.deepEqual(issued.remainder, { mode: 'carry', hours: 2.5, rateKc: 350, work: draft.items[0].name });
      assert.equal(await unbilled(), 875);
      assert.doesNotMatch(html(issued), /class="wm"/);
      await assert.rejects(invoices.saveInvoice(issued), /nemění/);
    }],
    ['příští faktura ze zakázky předvyplní zbytek a převezme ho', async () => {
      await addWork('2026-10-27', 4);
      const next = await invoices.newInvoice(orderId);
      assert.equal(next.number, `${Y}002`);
      assert.equal(next.carries.length, 1);
      assert.ok(next.items.some((i) => i.unit === 'h' && i.quantity === 2.5 && /z faktury č\. \d+001/.test(i.description)));
      assert.equal(next.totalKc, 1400 + 875);
      const { remainder } = await invoices.prepareIssue(next);
      assert.equal(remainder, null);
      const issued = await invoices.issueInvoice(next);
      assert.equal(issued.number, `${Y}002`);
      assert.match(html(issued), /Navíc fakturováno 2,5 h dříve nevyfakturované práce/);
      assert.equal(await unbilled(), 0);
      assert.equal((await invoices.newInvoice(orderId)).carries.length, 0);
    }],
    ['zbytek odepsat (sleva): Nevyfakturováno 0, volba uložená u faktury', async () => {
      await addWork('2026-10-28', 4);
      const draft = await invoices.newInvoice(orderId);
      const issued = await invoices.issueInvoice(withHours(draft, 3), 'writeoff');
      assert.equal(issued.number, `${Y}003`);
      assert.equal(issued.remainder?.mode, 'writeoff');
      assert.equal(issued.remainder?.hours, 1);
      assert.equal(await unbilled(), 0);
    }],
    ['zrušená faktura: zůstává v seznamu, PDF se ZRUŠENO, práce i převzatý zbytek zase k fakturaci', async () => {
      const second = (await invoices.listInvoices()).find((i) => i.number === `${Y}002`)!;
      await invoices.cancelInvoice((await invoices.getInvoice(second.id!))!);
      const cancelled = (await invoices.getInvoice(second.id!))!;
      assert.equal(cancelled.status, 'cancelled');
      assert.ok(cancelled.cancelledAt);
      assert.ok((await invoices.listInvoices()).some((i) => i.id === second.id && i.status === 'cancelled'));
      assert.match(html(cancelled), /<span>ZRUŠENO<\/span>/);
      assert.equal(await unbilled(), 1400 + 875);
      assert.equal((await invoices.newInvoice(orderId)).carries.length, 1);
      await invoices.setInvoicePaid(cancelled, true);
      assert.equal((await invoices.getInvoice(second.id!))!.status, 'cancelled');
    }],
    ['číslo zrušené faktury se nikdy znovu nepoužije', async () => {
      assert.equal(await invoices.suggestInvoiceNumber(`${Y}-12-01`), `${Y}004`);
      assert.equal(await invoices.invoiceNumberTaken(`${Y}002`), true);
      // ani ručně zadané
      const free = await invoices.newInvoice(null);
      const manual: Invoice = { ...free, number: `${Y}002`, numberManual: true, client: { name: 'X', address: '', ico: '', dic: '' }, items: [{ name: 'Práce', description: '', quantity: 1, unit: 'paušál', unitPriceKc: 100 }] };
      await assert.rejects(invoices.issueInvoice(manual), /už byla vystavená/);
      // zrušení poslední vystavené faktury číslo neuvolní
      const third = (await invoices.listInvoices()).find((i) => i.number === `${Y}003`)!;
      await invoices.cancelInvoice((await invoices.getInvoice(third.id!))!);
      assert.equal(await invoices.suggestInvoiceNumber(`${Y}-12-01`), `${Y}004`);
      const issued = await invoices.issueInvoice({ ...manual, number: free.number, numberManual: false });
      assert.equal(issued.number, `${Y}004`);
    }],
    ['zrušení podkladu v detailu zakázky zruší i fakturu', async () => {
      const first = (await invoices.listInvoices()).find((i) => i.number === `${Y}001`)!;
      const batch = (await orders.listInvoiceBatches(orderId)).find((b) => b.id === first.invoiceBatchId)!;
      await orders.deleteInvoiceBatch(batch);
      assert.equal((await invoices.getInvoice(first.id!))!.status, 'cancelled');
      assert.equal(await invoices.suggestInvoiceNumber(`${Y}-12-01`), `${Y}005`);
    }],
    ['poznámky: snímek se uloží s konceptem', async () => {
      const draft = await invoices.newInvoice(orderId);
      const id = await invoices.saveInvoice(draft);
      assert.deepEqual((await invoices.getInvoice(id))!.workNotes, draft.workNotes);
      assert.ok((draft.workNotes ?? []).length > 0);
    }],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`OK    ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
