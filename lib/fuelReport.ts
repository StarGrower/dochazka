// Přehled tankování (etapa 6.5) - PDF a Excel za rok: každé tankování
// (stroj, palivo, litry, Kč, Kč/l, plná, počitadlo, platba, zdroj,
// proplaceno) a souhrn po strojích.

import { formatKc, formatNumberCs } from './format';
import { FUEL_LABEL, fuelCostOf, PAYMENT_LABEL, type FuelEntry, type MachineCard } from './machines';
import { esc, xlsxFromSheets } from './report';

const dateCs = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};
const dec = (n: number, digits = 2) => String(Math.round(n * 10 ** digits) / 10 ** digits).replace('.', ',');

const HEAD = ['Datum', 'Stroj', 'Palivo', 'Litry', 'Kč', 'Kč/l', 'Plná', 'Počitadlo', 'Platba', 'Zdroj', 'Proplaceno'];

function prepare(entries: FuelEntry[], machines: MachineCard[]) {
  const name = (id: number | null) => (id === null ? 'Kanystr / jiné' : (machines.find((m) => m.id === id)?.name ?? '?'));
  const sorted = [...entries].sort((a, b) => a.fueledAt.localeCompare(b.fueledAt));
  const byMachine = new Map<string, { liters: number; kc: number; count: number }>();
  for (const e of sorted) {
    const k = name(e.categoryId);
    const cur = byMachine.get(k) ?? { liters: 0, kc: 0, count: 0 };
    byMachine.set(k, { liters: cur.liters + e.liters, kc: cur.kc + fuelCostOf(e), count: cur.count + 1 });
  }
  return { sorted, name, byMachine };
}

export function fuelReportHtml(year: number, entries: FuelEntry[], machines: MachineCard[]): string {
  const { sorted, name, byMachine } = prepare(entries, machines);
  const rows = sorted
    .map((e) => {
      const kc = fuelCostOf(e);
      return `<tr><td>${dateCs(e.fueledAt)}</td><td>${esc(name(e.categoryId))}</td><td>${FUEL_LABEL[e.fuelType]}</td><td class="r">${formatNumberCs(e.liters)}</td><td class="r">${formatKc(kc)}</td><td class="r">${e.liters > 0 ? formatNumberCs(Math.round((kc / e.liters) * 100) / 100) : ''}</td><td>${e.fullTank ? 'ano' : ''}</td><td class="r">${e.counterValue !== null ? formatNumberCs(e.counterValue) : ''}</td><td>${e.source === 'stock' ? 'zásoba' : PAYMENT_LABEL[e.payment]}</td><td>${e.reimbursedAt ? dateCs(e.reimbursedAt) : ''}</td></tr>`;
    })
    .join('');
  const sum = [...byMachine]
    .map(([n, s]) => `<tr><td>${esc(n)}</td><td class="r">${s.count}×</td><td class="r">${formatNumberCs(Math.round(s.liters))} l</td><td class="r">${formatKc(s.kc)}</td></tr>`)
    .join('');
  const totalKc = sorted.reduce((s, e) => s + fuelCostOf(e), 0);
  const totalL = sorted.reduce((s, e) => s + e.liters, 0);
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  @page{size:A4 landscape;margin:14mm}
  body{font-family:-apple-system,Helvetica,sans-serif;color:#131311;font-size:10px}
  h1{font-size:18px;margin:0 0 6px} h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b685f;margin:14px 0 4px}
  table{width:100%;border-collapse:collapse} th{text-align:left;font-size:9px;color:#6b685f;border-bottom:2px solid #F2B705;padding:4px 3px}
  td{padding:4px 3px;border-bottom:1px solid #eee} .r{text-align:right;white-space:nowrap}
  .tot td{font-weight:700;border-top:2px solid #F2B705} .sum{width:50%}
  </style></head><body>
  <h1>Přehled tankování ${year}</h1>
  <h2>Souhrn po strojích</h2>
  <table class="sum">${sum}<tr class="tot"><td>Celkem</td><td></td><td class="r">${formatNumberCs(Math.round(totalL))} l</td><td class="r">${formatKc(totalKc)}</td></tr></table>
  <h2>Tankování</h2>
  <table><tr>${['Datum', 'Stroj', 'Palivo', 'Litry', 'Kč', 'Kč/l', 'Plná', 'Počitadlo', 'Platba', 'Proplaceno'].map((h) => `<th>${h}</th>`).join('')}</tr>${rows}</table>
  </body></html>`;
}

export function fuelReportXlsx(entries: FuelEntry[], machines: MachineCard[]): Uint8Array {
  const { sorted, name, byMachine } = prepare(entries, machines);
  const rows = sorted.map((e) => {
    const kc = fuelCostOf(e);
    return [
      dateCs(e.fueledAt),
      name(e.categoryId),
      FUEL_LABEL[e.fuelType],
      dec(e.liters),
      dec(kc),
      e.liters > 0 ? dec(kc / e.liters) : '',
      e.fullTank ? 'ano' : '',
      e.counterValue !== null ? dec(e.counterValue, 1) : '',
      PAYMENT_LABEL[e.payment],
      e.source === 'stock' ? 'zásoba' : 'pumpa',
      e.reimbursedAt ? dateCs(e.reimbursedAt) : '',
    ];
  });
  const summary = [['Stroj', 'Počet', 'Litry', 'Kč'], ...[...byMachine].map(([n, s]) => [n, String(s.count), dec(s.liters), dec(s.kc)])];
  return xlsxFromSheets([
    { name: 'Tankování', rows: [HEAD, ...rows] },
    { name: 'Souhrn', rows: summary },
  ]);
}
