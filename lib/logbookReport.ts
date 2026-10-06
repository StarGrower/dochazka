// Export knihy jízd (etapa 7): PDF (HTML pro expo-print) a Excel.
// Volby: období, vozidlo, s / bez soukromých jízd (bez nich jen souhrn
// soukromých km), jen moje / všichni řidiči. Úpravy po uzavření měsíce
// a korekce podle tachometru se vyznačí.

import { formatKc, formatNumberCs } from './format';
import type { LogbookGap, LogbookTrip } from './logbook';
import { logbookSummary } from './logbookCalc';
import { esc, LOGO_SVG, xlsxFromSheets } from './report';
import type { AppSettings, Person } from './types';

export interface LogbookExportInput {
  title: string; // "Kniha jízd · Osobák · říjen 2026"
  periodLabel: string;
  vehicleLabel: string;
  trips: LogbookTrip[]; // už vyfiltrované (období, vozidlo, řidič)
  gaps: LogbookGap[];
  odometer: Map<number, number | null>; // id jízdy -> stav tachometru po jízdě
  includePrivate: boolean;
  people: Person[];
  vehicleNames: Map<number, string>;
  settings: AppSettings;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateCs = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const km1 = (n: number) => formatNumberCs(Math.round(n * 10) / 10);

function rowsOf(input: LogbookExportInput, forXlsx = false) {
  const num = (n: number) => (forXlsx ? String(Math.round(n * 10) / 10).replace('.', ',') : km1(n));
  const driver = (id: number | null) => input.people.find((p) => p.id === id)?.name ?? '';
  type Row = { at: string; cells: string[]; marks: string[] };
  const out: Row[] = [];
  for (const t of input.trips) {
    if (t.isPrivate && !input.includePrivate) continue;
    const marks: string[] = [];
    if (t.odoKm !== null && t.kmOverride === null) marks.push(`upraveno podle tachometru (GPS ${km1(t.baseKm)} km)`);
    if (t.editedAfterClose) marks.push('upraveno po uzavření měsíce');
    const odo = input.odometer.get(t.id);
    out.push({
      at: t.startAt,
      cells: [
        dateCs(t.startAt),
        hm(t.startAt),
        hm(t.endAt),
        t.fromLabel,
        t.toLabel,
        t.purpose,
        t.isPrivate ? 'soukromá' : 'služební',
        driver(t.driverId),
        input.vehicleNames.get(t.vehicleId ?? -1) ?? '',
        num(t.km),
        odo !== null && odo !== undefined ? (forXlsx ? String(odo) : formatNumberCs(odo)) : '',
      ],
      marks,
    });
  }
  for (const g of input.gaps) {
    out.push({
      at: g.fromAt,
      cells: [dateCs(g.fromAt), hm(g.fromAt), `${dateCs(g.toAt)} ${hm(g.toAt)}`, '', '', g.note || 'Jiný řidič / nezaznamenáno', '', driver(g.driverId), input.vehicleNames.get(g.vehicleId) ?? '', num(g.km), ''],
      marks: ['rozdíl podle tachometru'],
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const HEAD = ['Datum', 'Odjezd', 'Příjezd', 'Odkud', 'Kam', 'Účel', 'Druh', 'Řidič', 'Vozidlo', 'Km', 'Tachometr'];

function summaryOf(input: LogbookExportInput) {
  return logbookSummary(
    input.trips.map((t) => ({ km: t.km, isPrivate: t.isPrivate })),
    input.settings.logbookAllowanceKcPerKm
  );
}

export function logbookHtml(input: LogbookExportInput): string {
  const s = summaryOf(input);
  const rows = rowsOf(input);
  const me = [input.settings.profileName, input.settings.profileAddress].filter(Boolean).map(esc).join('<br/>');
  const body = rows
    .map(
      (r) =>
        `<tr>${r.cells.map((c, i) => `<td${i >= 9 ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>${
          r.marks.length ? `<tr class="mk"><td></td><td colspan="10">${esc(r.marks.join(' · '))}</td></tr>` : ''
        }`
    )
    .join('');
  const sum = [
    `<tr><td>Služební jízdy</td><td class="r">${s.businessCount}</td><td class="r">${km1(s.businessKm)} km</td></tr>`,
    `<tr><td>Soukromé jízdy${input.includePrivate ? '' : ' (bez rozpisu)'}</td><td class="r">${s.privateCount}</td><td class="r">${km1(s.privateKm)} km</td></tr>`,
    s.businessPct !== null ? `<tr><td>Podíl služebních km</td><td></td><td class="r">${Math.round(s.businessPct)} %</td></tr>` : '',
    s.allowanceKc !== null
      ? `<tr class="tot"><td>Náhrada (${formatNumberCs(input.settings.logbookAllowanceKcPerKm)} Kč/km)</td><td></td><td class="r">${formatKc(s.allowanceKc)}</td></tr>`
      : '',
  ].join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  @page{size:A4 landscape;margin:14mm}
  body{font-family:-apple-system,Helvetica,sans-serif;color:#131311;font-size:10px}
  .head{background:#131311;border-radius:8px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .who{color:#F3F1EA;font-size:10px;text-align:right}
  h1{font-size:18px;margin:14px 0 4px} h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b685f;margin:14px 0 4px}
  .meta{font-size:10px;color:#6b685f}
  table{width:100%;border-collapse:collapse} th{text-align:left;font-size:9px;color:#6b685f;border-bottom:2px solid #F2B705;padding:4px 3px}
  td{padding:4px 3px;border-bottom:1px solid #eee;vertical-align:top} .r{text-align:right;white-space:nowrap}
  .mk td{color:#8b877c;font-size:8.5px;border-bottom:1px solid #eee;padding-top:0}
  .tot td{font-weight:700;border-top:2px solid #F2B705} .sum{width:50%}
  .foot{margin-top:18px;font-size:8px;color:#8b877c}
  </style></head><body>
  <div class="head">${LOGO_SVG}<div class="who">${me}</div></div>
  <h1>${esc(input.title)}</h1>
  <div class="meta">${esc(input.periodLabel)} · ${esc(input.vehicleLabel)}</div>
  <h2>Souhrn</h2><table class="sum">${sum}</table>
  <h2>Jízdy</h2>
  <table><tr>${HEAD.map((h, i) => `<th${i >= 9 ? ' class="r"' : ''}>${h}</th>`).join('')}</tr>${body}</table>
  <div class="foot">Km = po silnici z GPS, případně opravené podle tachometru nebo ručně. Vytvořeno v appce Docházka ${dateCs(new Date().toISOString())}</div>
  </body></html>`;
}

export function logbookXlsx(input: LogbookExportInput): Uint8Array {
  const s = summaryOf(input);
  const rows = rowsOf(input, true).map((r) => [...r.cells, r.marks.join(' · ')]);
  const summary: string[][] = [
    [input.title],
    [input.periodLabel, input.vehicleLabel],
    [],
    ['Služební jízdy', String(s.businessCount), String(Math.round(s.businessKm * 10) / 10).replace('.', ',')],
    ['Soukromé jízdy', String(s.privateCount), String(Math.round(s.privateKm * 10) / 10).replace('.', ',')],
    ['Podíl služebních km %', '', s.businessPct !== null ? String(Math.round(s.businessPct)) : ''],
    ['Náhrada Kč', '', s.allowanceKc !== null ? String(Math.round(s.allowanceKc * 100) / 100).replace('.', ',') : ''],
  ];
  return xlsxFromSheets([
    { name: 'Jízdy', rows: [[...HEAD, 'Poznámka'], ...rows] },
    { name: 'Souhrn', rows: summary },
  ]);
}
