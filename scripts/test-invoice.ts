// Testy fakturace: číslo účtu (mod 11), IBAN (ISO 13616), QR Platba
// (SPAYD 1.0). Spuštění: npm run test:invoice
//
// Číslo účtu 19-2000145399/0800 je ukázkové ze specifikace QR Platby.

import assert from 'node:assert/strict';

import { czIban, formatCzAccount, formatIban, ibanFromSetting, ibanValid, mod11Ok, parseCzAccount } from '../lib/bankAccount';
import {
  addDaysIso,
  buildWorkLog,
  carryItem,
  carryKc,
  czDateWithWeekday,
  hoursMismatch,
  invoiceTotal,
  isValidInvoiceNumber,
  itemsFromWork,
  nextInvoiceNumber,
  parseCzDate,
  parseDecimal,
  periodLabel,
  remainderFor,
  summarizeWorkLog,
  type WorkSource,
} from '../lib/invoiceCalc';
import { addressLines, invoiceHtml, invoicePageCount, kc2, kcInvoice, paginate } from '../lib/invoiceReport';
import { buildSpayd, qrSvg, spaydMessage } from '../lib/spayd';
import type { Invoice } from '../lib/types';

// Faktura jako v předloze: zakázka Veselá, ruční práce 20,5 h × 350 Kč.
const WORK: WorkSource[] = [
  { date: '2026-10-21', work: 'Ruční práce', worker: 'Já', quantity: 5, unit: 'hour', amountKc: 1750 },
  { date: '2026-10-22', work: 'Ruční práce', worker: 'Já', quantity: 1, unit: 'hour', amountKc: 350 },
  { date: '2026-10-23', work: 'Ruční práce', worker: 'Já', quantity: 8, unit: 'hour', amountKc: 2800 },
  { date: '2026-10-26', work: 'Ruční práce', worker: 'Já', quantity: 4, unit: 'hour', amountKc: 1400 },
  { date: '2026-10-26', work: 'Ruční práce', worker: 'Já', quantity: 2.5, unit: 'hour', amountKc: 875 },
];

function sampleInvoice(over: Partial<Invoice> = {}): Invoice {
  const workLog = buildWorkLog(WORK);
  const items = itemsFromWork(WORK, 'Zakázka Veselá · 21. 10. – 26. 10. 2026', null);
  return {
    id: 1,
    number: '2026001',
    numberManual: true,
    orderId: 7,
    orderName: 'Veselá',
    clientId: 3,
    client: { name: 'Aleš Kalenský', address: 'Olšany 33, 378 53 Strmilov', ico: '07538669', dic: '' },
    supplier: {
      name: 'Filip Kalenský', address: 'Heřmaneč 21\n378 53 Strmilov', ico: '09041362', dic: '', phone: '', email: '',
      registryText: 'Fyzická osoba zapsaná v živnostenském rejstříku.', vatPayer: false, bankAccount: '19-2000145399/0800', iban: 'CZ6508000000192000145399',
    },
    status: 'issued',
    issueDate: '2026-10-28',
    dueDays: 14,
    dueDate: '2026-11-11',
    payment: 'transfer',
    withWorkLog: true,
    workLog,
    items,
    totalKc: invoiceTotal(items),
    invoiceBatchId: null,
    issuedAt: '2026-10-28T10:00:00.000Z',
    paidAt: null,
    cancelledAt: null,
    remainder: null,
    carries: [],
    ...over,
  };
}

const parse = (s: string) => {
  const r = parseCzAccount(s);
  if ('error' in r) throw new Error(`${s}: ${r.error}`);
  return r.account;
};
const parseError = (s: string) => {
  const r = parseCzAccount(s);
  assert.ok('error' in r, `${s} měl být neplatný`);
  return r.error;
};

const tests: Array<[string, () => void]> = [
  ['mod 11: váhy 6,3,7,9,10,5,8,4,2,1 (číslo doplněné zleva na 10 míst)', () => {
    assert.ok(mod11Ok('2000145399'));
    assert.ok(mod11Ok('19'));
    assert.ok(mod11Ok('123'));
    assert.ok(!mod11Ok('2000145398'));
    assert.ok(!mod11Ok('18'));
  }],
  ['účet s předčíslím -> IBAN ze specifikace', () => {
    const a = parse('19-2000145399/0800');
    assert.deepEqual(a, { prefix: '19', number: '2000145399', bankCode: '0800' });
    assert.equal(czIban(a), 'CZ6508000000192000145399');
    assert.equal(formatIban(czIban(a)), 'CZ65 0800 0000 1920 0014 5399');
  }],
  ['účet bez předčíslí, krátké číslo, mezery a úvodní nuly', () => {
    assert.equal(czIban(parse('2000145399/0800')), 'CZ7908000000002000145399');
    assert.equal(czIban(parse('123/0100')), 'CZ7801000000000000000123');
    assert.equal(formatCzAccount(parse(' 000019 - 2000145399 / 0800 ')), '19-2000145399/0800');
  }],
  ['neplatné účty', () => {
    assert.match(parseError('19-2000145398/0800'), /Číslo účtu neprošlo/);
    assert.match(parseError('18-2000145399/0800'), /Předčíslí neprošlo/);
    assert.match(parseError('2000145399'), /kód banky/);
    assert.match(parseError('2000145399/080'), /4 číslice/);
    assert.match(parseError('2000145399/08000'), /4 číslice/);
    parseError('1234567-2000145399/0800'); // předčíslí víc než 6 číslic
    parseError('12345678901/0800'); // číslo víc než 10 číslic
    parseError('abc/0800');
  }],
  ['IBAN: kontrola mod 97', () => {
    assert.ok(ibanValid('CZ6508000000192000145399'));
    assert.ok(ibanValid('CZ65 0800 0000 1920 0014 5399'));
    assert.ok(!ibanValid('CZ6608000000192000145399'));
    for (const s of ['2000145399/0800', '123/0100', '19-2000145399/0800']) assert.ok(ibanValid(czIban(parse(s))), s);
  }],
  ['IBAN z nastavení: prázdné / neplatné -> null', () => {
    assert.equal(ibanFromSetting(''), null);
    assert.equal(ibanFromSetting('19-2000145398/0800'), null);
    assert.equal(ibanFromSetting('19-2000145399/0800'), 'CZ6508000000192000145399');
  }],
  ['SPAYD 1.0: přesný tvar', () => {
    const s = buildSpayd({ iban: 'CZ6508000000192000145399', amountKc: 7175, vs: '2026001', dueDate: '2026-11-11', message: 'Faktura 2026001' });
    assert.equal(s, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:7175.00*CC:CZK*X-VS:2026001*DT:20261111*MSG:Faktura 2026001');
  }],
  ['SPAYD: částka na 2 místa s tečkou, zpráva bez diakritiky a hvězdiček, max 60 znaků', () => {
    const s = buildSpayd({ iban: 'CZ65 0800 0000 1920 0014 5399', amountKc: 1234.5, vs: '12*3', dueDate: '2026-01-02', message: 'Příliš žluťoučký kůň * úpěl ďábelské ódy a ještě něco navíc dlouhého' });
    assert.match(s, /\*AM:1234\.50\*/);
    assert.match(s, /\*X-VS:123\*/);
    const msg = s.split('*MSG:')[1];
    assert.equal(msg, spaydMessage('Příliš žluťoučký kůň * úpěl ďábelské ódy a ještě něco navíc dlouhého'));
    assert.ok(msg.length <= 60);
    assert.ok(!/[^\x20-\x7e]/.test(msg), msg);
    assert.ok(msg.startsWith('Prilis zlutoucky kun'));
    assert.equal(buildSpayd({ iban: 'CZ6508000000192000145399', amountKc: 0.005, vs: '1', dueDate: '2026-01-02', message: '' }).split('*')[3], 'AM:0.01');
  }],
  ['QR kód: offline SVG, korekce M', () => {
    const svg = qrSvg('SPD*1.0*ACC:CZ6508000000192000145399*AM:7175.00*CC:CZK', '3cm');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
    assert.match(svg, /width="3cm"/);
    assert.ok(svg.includes('M0 0h1v1h-1z'), 'levý horní roh vyhledávacího vzoru');
  }],
  ['číslo faktury: RRRRnnn, další volné, jen číslice max 10', () => {
    assert.equal(nextInvoiceNumber([], 2026), '2026001');
    assert.equal(nextInvoiceNumber(['2026001', '2026007', '2025099', '15'], 2026), '2026008');
    assert.equal(nextInvoiceNumber(['2025099'], 2026), '2026001');
    assert.equal(nextInvoiceNumber(['2026999'], 2026), '20261000');
    assert.ok(isValidInvoiceNumber('2026001'));
    assert.ok(isValidInvoiceNumber('1234567890'));
    assert.ok(!isValidInvoiceNumber('12345678901'));
    assert.ok(!isValidInvoiceNumber('2026-01'));
    assert.ok(!isValidInvoiceNumber(''));
  }],
  ['splatnost a datum', () => {
    assert.equal(addDaysIso('2026-10-28', 14), '2026-11-11');
    assert.equal(addDaysIso('2026-12-25', 7), '2027-01-01');
    assert.equal(addDaysIso('2026-03-20', 14), '2026-04-03'); // přes změnu času
    assert.equal(parseCzDate('28. 10. 2026'), '2026-10-28');
    assert.equal(parseCzDate('1.2.2026'), '2026-02-01');
    assert.equal(parseCzDate('31. 2. 2026'), null);
    assert.equal(czDateWithWeekday('2026-10-21'), 'st 21. 10. 2026');
    assert.equal(periodLabel('2026-10-21', '2026-10-26'), '21. 10. – 26. 10. 2026');
    assert.equal(periodLabel('2026-10-21', '2026-10-21'), '21. 10. 2026');
  }],
  ['desetinná čárka a součty na haléře', () => {
    assert.equal(parseDecimal('6,5'), 6.5);
    assert.equal(parseDecimal('1 250,5'), 1250.5);
    assert.equal(parseDecimal('abc'), null);
    assert.equal(parseDecimal(''), null);
    assert.equal(invoiceTotal([{ quantity: 1.5, unitPriceKc: 333.33 }, { quantity: 3, unitPriceKc: 0.1 }]), 500.3);
    assert.equal(kcInvoice(7175), '7\u00A0175\u00A0Kč');
    assert.equal(kcInvoice(500.3), '500,30\u00A0Kč');
    assert.equal(kc2(7175), '7\u00A0175,00\u00A0Kč');
  }],
  ['výpis prací: řádek za den × druh práce × pracovník, souhrny', () => {
    const extra: WorkSource[] = [
      ...WORK,
      { date: '2026-10-22', work: 'Bagr', worker: 'Petr', quantity: 3, unit: 'hour', amountKc: 2700 },
      { date: '2026-10-22', work: 'Doprava', worker: 'Já', quantity: 40, unit: 'km', amountKc: 480 },
    ];
    const log = buildWorkLog(extra);
    assert.deepEqual(log.map((r) => `${r.date} ${r.work} ${r.worker} ${r.quantity}`), [
      '2026-10-21 Ruční práce Já 5',
      '2026-10-22 Bagr Petr 3',
      '2026-10-22 Doprava Já 40',
      '2026-10-22 Ruční práce Já 1',
      '2026-10-23 Ruční práce Já 8',
      '2026-10-26 Ruční práce Já 6.5',
    ]);
    const s = summarizeWorkLog(log);
    assert.equal(s.days, 4);
    assert.equal(s.totals.hour, 23.5);
    assert.equal(s.totals.km, 40);
    assert.equal(s.amountKc, 10355);
    assert.deepEqual(s.byWork.map((g) => g.name), ['Ruční práce', 'Bagr', 'Doprava']);
    assert.deepEqual(s.byWorker.map((g) => [g.name, g.totals.hour]), [['Já', 20.5], ['Petr', 3]]);
  }],
  ['položky ze zakázky: druh práce × jednotka × sazba, pevná cena jako paušál', () => {
    const items = itemsFromWork(WORK, 'Zakázka Veselá', null);
    assert.deepEqual(items, [{ name: 'Ruční práce', description: 'Zakázka Veselá', quantity: 20.5, unit: 'h', unitPriceKc: 350 }]);
    assert.equal(invoiceTotal(items), 7175);
    const weekend = itemsFromWork([...WORK, { date: '2026-10-24', work: 'Ruční práce', worker: 'Já', quantity: 2, unit: 'hour', amountKc: 875 }], '', null);
    assert.equal(weekend.length, 2);
    assert.equal(invoiceTotal(weekend), 8050);
    assert.deepEqual(itemsFromWork(WORK, 'x', { name: 'Veselá', amountKc: 50000 }), [{ name: 'Veselá', description: 'x', quantity: 1, unit: 'paušál', unitPriceKc: 50000 }]);
  }],
  ['žluté upozornění: hodiny v položkách ≠ odpracované', () => {
    const inv = sampleInvoice();
    assert.equal(hoursMismatch(inv.items, inv.workLog), null);
    assert.deepEqual(hoursMismatch([{ ...inv.items[0], quantity: 18 }], inv.workLog), { itemHours: 18, workHours: 20.5 });
    assert.equal(hoursMismatch(inv.items, null), null);
  }],
  ['adresa na řádky', () => {
    assert.deepEqual(addressLines('Heřmaneč 21, 378 53 Strmilov'), ['Heřmaneč 21', '378 53 Strmilov']);
    assert.deepEqual(addressLines('Heřmaneč 21\n378 53 Strmilov'), ['Heřmaneč 21', '378 53 Strmilov']);
    assert.deepEqual(addressLines('Olšany 33'), ['Olšany 33']);
  }],
  ['PDF: faktura + výpis prací, QR Platba, logo, neplátce DPH', () => {
    const inv = sampleInvoice();
    const html = invoiceHtml(inv, { mode: 'print' });
    assert.equal(invoicePageCount(inv), 2);
    assert.match(html, /Strana 1 z 2/);
    assert.match(html, /Strana 2 z 2/);
    assert.match(html, /fill="#D3CFC4"[^>]*>CHÁZKA/);
    assert.match(html, /Nejsem plátce DPH\./);
    assert.match(html, /Příloha: výpis prací po dnech \(strana 2\)\./);
    assert.match(html, /CZ65 0800 0000 1920 0014 5399/);
    assert.match(html, /aria-label="QR Platba"/);
    assert.match(html, />QR Platba</);
    assert.match(html, /7\u00A0175,00\u00A0Kč/);
    assert.match(html, /út 27\. 10\. 2026|po 26\. 10\. 2026/);
    assert.match(html, /Celkem<\/td><td>4 dny/);
    assert.match(html, /20,5 h/);
    assert.doesNotMatch(html, /Doplň číslo účtu/);
  }],
  ['PDF: plátce DPH, hotově, bez přílohy, bez účtu', () => {
    const vat = invoiceHtml(sampleInvoice({ supplier: { ...sampleInvoice().supplier, vatPayer: true } }), { mode: 'print' });
    assert.doesNotMatch(vat, /Nejsem plátce DPH/);
    const cash = invoiceHtml(sampleInvoice({ payment: 'cash', withWorkLog: false }), { mode: 'print' });
    assert.doesNotMatch(cash, /QR Platba|IBAN|Číslo účtu/);
    assert.match(cash, /Strana 1 z 1/);
    assert.doesNotMatch(cash, /Příloha:/);
    const noAcc = sampleInvoice({ supplier: { ...sampleInvoice().supplier, bankAccount: '', iban: null } });
    assert.doesNotMatch(invoiceHtml(noAcc, { mode: 'print' }), /QR Platba|Doplň číslo účtu/);
    assert.match(invoiceHtml(noAcc, { mode: 'preview' }), /Doplň číslo účtu v Nastavení/);
  }],
  ['PDF: dlouhý výpis pokračuje na další strany se záhlavím, Strana X z Y', () => {
    const many: WorkSource[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      many.push({ date, work: 'Bagr', worker: 'Já', quantity: 8, unit: 'hour', amountKc: 7200 });
      many.push({ date, work: 'Ruční práce', worker: 'Petr', quantity: 8, unit: 'hour', amountKc: 2800 });
    }
    const inv = sampleInvoice({ workLog: buildWorkLog(many) });
    const html = invoiceHtml(inv, { mode: 'print' });
    const pages = invoicePageCount(inv);
    assert.ok(pages >= 4, `stran ${pages}`);
    assert.equal((html.match(/<th>Datum<\/th>/g) ?? []).length, pages - 1, 'záhlaví tabulky na každé straně výpisu');
    assert.match(html, /Výpis prací \(pokračování\)/);
    assert.match(html, new RegExp(`Strana ${pages} z ${pages}`));
    assert.match(html, new RegExp(`strany 2–${pages}`));
    // každý řádek výpisu právě jednou
    assert.equal((html.match(/<td class="nw">/g) ?? []).length, 60);
  }],
  ['faktura bez zakázky: vlastní položky, součet = částka i v QR, bez výpisu prací', () => {
    const items = [
      { name: 'Přeprava bagru', description: '', quantity: 1, unit: 'paušál', unitPriceKc: 2500 },
      { name: 'Práce bagrem', description: 'výkop přípojky', quantity: parseDecimal('6,5') as number, unit: 'h', unitPriceKc: 1100 },
      { name: 'Štěrk', description: '', quantity: 2.25, unit: 'm³', unitPriceKc: 480.4 },
    ];
    const total = invoiceTotal(items);
    assert.equal(total, 10730.9);
    const inv = sampleInvoice({ orderId: null, orderName: null, workLog: null, withWorkLog: true, items, totalKc: total });
    const html = invoiceHtml(inv, { mode: 'print' });
    assert.equal(invoicePageCount(inv), 1);
    assert.doesNotMatch(html, /Výpis prací|Příloha:/);
    assert.match(html, /6,5\u00A0h/);
    assert.match(html, /2,25\u00A0m³/);
    assert.match(html, /10\u00A0730,90\u00A0Kč/);
    const spayd = buildSpayd({ iban: 'CZ6508000000192000145399', amountKc: total, vs: inv.number, dueDate: inv.dueDate, message: `Faktura ${inv.number}` });
    assert.match(spayd, /\*AM:10730\.90\*/);
    assert.equal(hoursMismatch(items, null), null);
  }],
  ['vodoznak: koncept KONCEPT, zrušená ZRUŠENO, vystavená bez nápisu, na každé straně', () => {
    assert.doesNotMatch(invoiceHtml(sampleInvoice(), { mode: 'print' }), /class="wm"/);
    const draft = invoiceHtml(sampleInvoice({ status: 'draft' }), { mode: 'print' });
    assert.equal((draft.match(/<span>KONCEPT<\/span>/g) ?? []).length, 2);
    const cancelled = invoiceHtml(sampleInvoice({ status: 'cancelled', cancelledAt: '2026-10-30T10:00:00.000Z' }), { mode: 'preview' });
    assert.equal((cancelled.match(/<span>ZRUŠENO<\/span>/g) ?? []).length, 2);
    assert.doesNotMatch(invoiceHtml(sampleInvoice({ status: 'paid' }), { mode: 'print' }), /class="wm"/);
  }],
  ['zbytek hodin: jen když se fakturuje méně, průměrná sazba, převzetí do další faktury', () => {
    const inv = sampleInvoice();
    assert.equal(remainderFor(inv.items, inv.workLog), null);
    assert.equal(remainderFor([{ ...inv.items[0], quantity: 22 }], inv.workLog), null);
    assert.deepEqual(remainderFor([{ ...inv.items[0], quantity: 18 }], inv.workLog), { hours: 2.5, rateKc: 350, work: 'Ruční práce' });
    const mixed = buildWorkLog([...WORK, { date: '2026-10-27', work: 'Bagr', worker: 'Já', quantity: 4, unit: 'hour', amountKc: 3600 }]);
    assert.deepEqual(remainderFor([{ ...inv.items[0], quantity: 20.5 }], mixed), { hours: 4, rateKc: 439.8, work: 'Práce' });
    // paušál (pevná cena) se nehlídá
    assert.equal(remainderFor([{ name: 'Veselá', description: '', quantity: 1, unit: 'paušál', unitPriceKc: 50000 }], inv.workLog), null);
    const carry = { invoiceId: 1, number: '2026001', hours: 2.5, rateKc: 350, work: 'Ruční práce' };
    assert.equal(carryKc(carry), 875);
    assert.deepEqual(carryItem(carry), { name: 'Ruční práce', description: 'Nevyfakturováno z faktury č. 2026001', quantity: 2.5, unit: 'h', unitPriceKc: 350 });
    // s převzatým zbytkem se hodiny počítají včetně něj
    assert.equal(hoursMismatch([...inv.items, carryItem(carry)], inv.workLog, [carry]), null);
    assert.deepEqual(hoursMismatch(inv.items, inv.workLog, [carry]), { itemHours: 20.5, workHours: 23 });
  }],
  ['stránkování: součty na poslední straně, jinak strana navíc', () => {
    assert.deepEqual(paginate([1, 1, 1], () => 10, 25, 25, 0).map((p) => p.length), [2, 1]);
    assert.deepEqual(paginate([1, 1], () => 10, 25, 25, 10).map((p) => p.length), [2, 0]);
    assert.deepEqual(paginate([], () => 10, 25, 25, 10).map((p) => p.length), [0]);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`OK    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} OK`);
process.exit(failed ? 1 : 0);
