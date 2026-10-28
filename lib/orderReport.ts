// Export zakázky (etapa 5): pro odběratele (bez nákladů, s logem a mými
// údaji) a interní (s náklady, výsledkem, lidmi a dny); PDF (HTML pro
// expo-print) a Excel (XLSX). Servis se do nákladů nepočítá.

import { formatHodiny, formatKc, formatNumberCs, toIsoDate } from './format';
import { orderPeriod, type OrderDetail } from './orders';
import { esc, LOGO_SVG, xlsxFromSheets } from './report';
import type { AppSettings, Client, ExpenseCategory } from './types';

export type OrderReportKind = 'client' | 'internal';

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  material: 'Materiál',
  transport: 'Doprava',
  subcontract: 'Subdodávka',
  other: 'Jiné',
};

const czDate = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}` : '');

function period(d: OrderDetail): string {
  const { from, to } = orderPeriod(d);
  return from === to ? czDate(from) : `${czDate(from)} – ${to ? czDate(to) : 'dosud'}`;
}

export function orderReportHtml(d: OrderDetail, kind: OrderReportKind, settings: AppSettings, client: Client | null, workerName: string | null = null): string {
  const s = d.stats;
  const me = [settings.profileName, settings.profileIco ? `IČO ${settings.profileIco}` : '', settings.profileDic ? `DIČ ${settings.profileDic}` : '', settings.profileAddress]
    .filter(Boolean)
    .map(esc)
    .join('<br/>');
  const them = client
    ? [client.name, client.ico ? `IČO ${client.ico}` : '', client.dic ? `DIČ ${client.dic}` : '', client.address].filter(Boolean).map(esc).join('<br/>')
    : '';
  const rows = s.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.quantityLabel)}</td><td class="r">${formatKc(l.amountKc)}</td></tr>`);
  if (s.km > 0) rows.push(`<tr><td>Kilometry</td><td>${formatNumberCs(Math.round(s.km))} km</td><td class="r">${formatKc(s.kmAmountKc)}</td></tr>`);
  const fixed = d.order.priceMode === 'fixed' && d.order.fixedPriceKc !== null;

  const parts: string[] = [
    `<div class="head">${LOGO_SVG}<div class="who">${me}</div></div>`,
    `<h1>${esc(d.order.name)}${workerName ? ` · ${esc(workerName)}` : ''}</h1>`,
    `<div class="meta">${them ? `<div><b>Odběratel</b><br/>${them}</div>` : ''}<div><b>Období</b><br/>${period(d)}</div></div>`,
    `<h2>${kind === 'client' ? 'Provedené práce' : 'K fakturaci'}</h2>`,
    `<table>${rows.join('')}<tr class="tot"><td>Celkem${fixed ? ' (pevná cena)' : ''}</td><td></td><td class="r">${formatKc(s.billableKc)}</td></tr></table>`,
  ];
  if (fixed && kind === 'internal') parts.push(`<p class="mut">Podle ceníku by to bylo ${formatKc(s.ratesTotalKc)}.</p>`);
  if (kind === 'client' && s.unbilledKc > 0.5 && s.unbilledKc < s.billableKc - 0.5) {
    parts.push(`<p class="mut">Z toho dosud nevyfakturováno ${formatKc(s.unbilledKc)}.</p>`);
  }

  if (kind === 'internal') {
    parts.push('<h2>Náklady a výsledek</h2><table>');
    if (s.fuelCostKc > 0) parts.push(`<tr><td>Palivo</td><td>${formatNumberCs(Math.round(s.fuelLiters))} l</td><td class="r">${formatKc(-s.fuelCostKc)}</td></tr>`);
    for (const e of s.expensesByCategory) parts.push(`<tr><td>Výdaje - ${EXPENSE_LABEL[e.category]}</td><td></td><td class="r">${formatKc(-e.amountKc)}</td></tr>`);
    parts.push(
      `<tr class="tot"><td>Výsledek</td><td>${s.kcPerHour !== null ? `${formatKc(s.kcPerHour)}/h` : ''}</td><td class="r">${formatKc(s.resultKc)}</td></tr></table>`
    );
    if (s.people.length > 0) {
      parts.push(`<h2>Lidé</h2><table>${s.people.map((p) => `<tr><td>${esc(p.name)}</td><td></td><td class="r">${formatHodiny(p.hours)}</td></tr>`).join('')}</table>`);
    }
    if (s.budgetPct !== null && d.order.budgetKc !== null) {
      parts.push(`<p>Rozpočet ${formatKc(d.order.budgetKc)} · čerpáno ${Math.round(s.budgetPct)} %</p>`);
    }
    if (d.expenses.length > 0) {
      parts.push(`<h2>Výdaje</h2><table>${d.expenses.map((e) => `<tr><td>${czDate(e.date)}</td><td>${esc(EXPENSE_LABEL[e.category])} · ${esc(e.description)}</td><td class="r">${formatKc(e.amountKc)}</td></tr>`).join('')}</table>`);
    }
    if (s.days.length > 0) {
      // Celkem = K fakturaci podle ceníku (u pevné ceny se liší, proto poznámka).
      const dayRows = s.days.map((x) => {
        const breakdown = x.items.length > 1 ? `<div class="sub">${x.items.map((i) => `${esc(i.name)} ${esc(i.quantityLabel)}`).join(' · ')}</div>` : '';
        return `<tr><td>${czDate(x.date)}${breakdown}</td><td class="r">${x.hours > 0 ? formatHodiny(x.hours) : ''}</td><td class="r">${formatKc(x.amountKc)}</td></tr>`;
      });
      const daysTotal = s.days.reduce((sum, x) => sum + x.amountKc, 0);
      parts.push(
        `<h2>Po dnech</h2><table><tr class="th"><td>Datum</td><td class="r">Hodiny</td><td class="r">Částka</td></tr>${dayRows.join('')}` +
          `<tr class="tot"><td>Celkem${fixed ? ' podle ceníku' : ''}</td><td class="r">${formatHodiny(s.hours)}</td><td class="r">${formatKc(daysTotal)}</td></tr></table>`
      );
    }
  }
  parts.push(`<div class="foot">Vytvořeno v appce Docházka ${czDate(toIsoDate(new Date()))}</div>`);

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body{font-family:-apple-system,Helvetica,sans-serif;color:#131311;margin:28px;font-size:12px}
  .head{background:#131311;border-radius:8px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .who{color:#F3F1EA;font-size:10px;text-align:right}
  h1{font-size:20px;margin:18px 0 6px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b685f;margin:18px 0 4px}
  .meta{display:flex;gap:40px;font-size:11px;margin-bottom:6px}
  table{width:100%;border-collapse:collapse} td{padding:5px 4px;border-bottom:1px solid #eee}
  .r{text-align:right;white-space:nowrap} .tot td{font-weight:700;border-top:2px solid #F2B705}
  .th td{font-size:10px;color:#6b685f;text-transform:uppercase;letter-spacing:.04em} .sub{font-size:9px;color:#8b877c;margin-top:2px}
  .mut{color:#8b877c;font-size:10px} .foot{margin-top:24px;font-size:9px;color:#8b877c}
  </style></head><body>${parts.join('\n')}</body></html>`;
}

export function orderReportXlsx(d: OrderDetail, kind: OrderReportKind): Uint8Array {
  const s = d.stats;
  // Čísla zůstávají v buňkách číselná (jdou sčítat), "Kč" / "h" a mezery
  // po tisících doplní formát sloupce.
  const n = (x: number) => formatNumberCs(Math.round(x * 100) / 100);
  const h = (x: number) => formatNumberCs(Math.round(x * 10) / 10);
  const fixed = d.order.priceMode === 'fixed' && d.order.fixedPriceKc !== null;
  const work = [['Položka', 'Množství', 'Částka'], ['Období', period(d), ''], ...s.lines.map((l) => [l.name, l.quantityLabel, n(l.amountKc)])];
  if (s.km > 0) work.push(['Kilometry', `${n(s.km)} km`, n(s.kmAmountKc)]);
  work.push([fixed ? 'Celkem (pevná cena)' : 'Celkem', '', n(s.billableKc)]);
  const sheets: Parameters<typeof xlsxFromSheets>[0] = [{ name: 'K fakturaci', rows: work, formats: { 2: 'kc' } }];
  if (kind === 'internal') {
    sheets.push({
      name: 'Náklady',
      rows: [
        ['Druh', 'Popis', 'Částka'],
        ['Palivo', `${formatNumberCs(Math.round(s.fuelLiters))} l`, n(-s.fuelCostKc)],
        ...d.expenses.map((e) => [EXPENSE_LABEL[e.category], `${e.date} ${e.description}`, n(-e.amountKc)]),
        ['Výsledek', s.kcPerHour !== null ? `${formatKc(s.kcPerHour)}/h` : '', n(s.resultKc)],
      ],
      formats: { 2: 'kc' },
    });
    sheets.push({
      name: 'Po dnech',
      rows: [
        ['Datum', 'Hodiny', 'Částka', 'Rozpis'],
        ...s.days.map((x) => [x.date, h(x.hours), n(x.amountKc), x.items.length > 1 ? x.items.map((i) => `${i.name} ${i.quantityLabel}`).join(' · ') : '']),
        [fixed ? 'Celkem podle ceníku' : 'Celkem', h(s.hours), n(s.days.reduce((sum, x) => sum + x.amountKc, 0)), ''],
      ],
      formats: { 1: 'h', 2: 'kc' },
    });
    sheets.push({ name: 'Lidé', rows: [['Jméno', 'Hodiny'], ...s.people.map((p) => [p.name, h(p.hours)])], formats: { 1: 'h' } });
  }
  return xlsxFromSheets(sheets);
}
