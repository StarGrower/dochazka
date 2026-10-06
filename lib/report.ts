// Výkaz pro šéfa (etapa 4.4) - data za období a jejich převod na PDF
// (HTML pro expo-print), CSV a XLSX. Šéf appku mít nemusí.
//
// Soukromí: soukromá místa ani soukromé jízdy se NIKDY nevypíšou; body
// tras v okolí soukromých míst (domov) se z mapy ořežou, ať z ní nejde
// poznat, kde bydlím.

import { strToU8, zipSync } from 'fflate';

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { getDayNote, getDayRecords, getTripsForDay, getVisitsForDay, listPlaces, listRoutePointsForTrips } from './db';
import { buildDayTimeline, type TimelineStay } from './dayTimeline';
import { formatDayLabel, formatKc, formatNumberCs, formatQuantity, toIsoDate } from './format';
import { distanceMeters } from './geo';
import { holidayName, isWeekend } from './holidays';
import { formatDurationHM } from './stayProposal';
import { tripKm } from './tripPlan';
import { listPeople } from './orders';
import { ME_ID, type AppSettings, type DayWorkRecordWithCategory, type Place, type VisitWithPlace } from './types';
import { recordAmountKc } from './workCalc';

export interface ReportOptions {
  from: string; // YYYY-MM-DD
  to: string;
  placeIds: number[] | null; // null = všechna pracovní místa
  withPrices: boolean;
  withMap: boolean;
  detailed: boolean; // pobyty s časy a přejezdy; jinak souhrn po dnech
  signatureSvgPath: string | null; // podpis prstem (SVG path ve viewBoxu 0 0 300 100)
  // Doplněk etapy 5: jen jeden pracovník (null / chybí = všichni). Pobyty
  // jsou jen moje, jízdy podle řidiče.
  workerId?: number | null;
}

export interface ReportStay {
  placeName: string;
  from: string; // H:MM
  to: string;
  durationMs: number;
}

export interface ReportTrip {
  fromName: string;
  toName: string;
  from: string;
  to: string;
  km: number;
  estimate: boolean;
  route: [number, number][]; // ořezaná o okolí soukromých míst
}

export interface ReportDay {
  date: string;
  label: string; // "Po 5. října 2026"
  holiday: string | null;
  weekend: boolean;
  records: DayWorkRecordWithCategory[];
  stays: ReportStay[];
  trips: ReportTrip[];
  note: string;
  km: number;
  amountKc: number;
}

export interface ReportData {
  options: ReportOptions;
  days: ReportDay[];
  totals: { hour: number; day: number; recordKm: number; tripKm: number; amountKc: number };
  // Rozpis po strojích/pracích: název -> { jednotka -> množství, Kč }
  byCategory: { name: string; quantities: string; amountKc: number }[];
  workerNames: Map<number, string>;
  byWorker: { name: string; hours: number; days: number }[]; // jen když je víc pracovníků
  placeNames: Map<number, string>;
}

const hm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function datesBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split('-').map(Number);
  const out: string[] = [];
  for (let date = new Date(y, m - 1, d); toIsoDate(date) <= to; date.setDate(date.getDate() + 1)) out.push(toIsoDate(date));
  return out;
}

// Body trasy blíž než poloměr + 300 m od soukromého místa se vynechají.
function trimPrivate(points: [number, number][], privatePlaces: Place[]): [number, number][] {
  return points.filter(([lat, lon]) => privatePlaces.every((p) => distanceMeters(lat, lon, p.latitude, p.longitude) > p.radiusM + 300));
}

export async function collectReport(options: ReportOptions): Promise<ReportData> {
  const places = await listPlaces(true);
  const placeById = new Map(places.map((p) => [p.id, p]));
  const privatePlaces = places.filter((p) => p.isPrivate || p.isHome);
  const inFilter = (placeId: number | null) => options.placeIds === null || (placeId !== null && options.placeIds.includes(placeId));
  const workerId = options.workerId ?? null;
  const people = await listPeople(true);
  const workerNames = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (placeId: number | null) => {
    if (placeId === null) return 'neznámé místo';
    const p = placeById.get(placeId);
    return !p || p.isPrivate || p.isHome ? 'soukromé místo' : p.name;
  };

  const days: ReportDay[] = [];
  for (const date of datesBetween(options.from, options.to)) {
    const [allRecords, visits, trips, note] = await Promise.all([getDayRecords(date), getVisitsForDay(date), getTripsForDay(date), getDayNote(date)]);
    const timeline = buildDayTimeline(visits, date, Date.now());
    const workStays =
      workerId !== null && workerId !== ME_ID
        ? []
        : timeline.filter((i): i is TimelineStay<VisitWithPlace> => i.kind === 'stay' && !i.visit.placeIsPrivate && inFilter(i.visit.placeId));
    // S filtrem míst: zápisy u vybraných míst + zápisy bez místa ve dnech s pobytem na vybraném místě.
    const records = allRecords
      .filter((r) => workerId === null || r.workerId === workerId)
      .filter((r) => options.placeIds === null || (r.placeId !== null ? inFilter(r.placeId) : workStays.length > 0));
    const dayTrips = trips.filter(
      (t) => !t.isPrivate && (workerId === null || t.driverId === workerId) && (options.placeIds === null || inFilter(t.toPlaceId) || inFilter(t.fromPlaceId))
    );
    if (records.length === 0 && workStays.length === 0 && dayTrips.length === 0) continue;

    const points = await listRoutePointsForTrips(dayTrips.map((t) => t.id));
    days.push({
      date,
      label: formatDayLabel(date),
      holiday: holidayName(date),
      weekend: isWeekend(date),
      records,
      stays: workStays.map((s) => ({
        placeName: s.visit.placeName ?? 'Neznámé místo',
        from: s.startsBeforeDay ? '0:00' : hm(s.segStartMs),
        to: s.ongoing ? 'probíhá' : s.endsAfterDay ? '24:00' : hm(s.segEndMs),
        durationMs: s.segEndMs - s.segStartMs,
      })),
      trips: dayTrips.map((t) => ({
        fromName: nameOf(t.fromPlaceId),
        toName: nameOf(t.toPlaceId),
        from: hm(Date.parse(t.startAt)),
        to: hm(Date.parse(t.endAt)),
        km: tripKm(t),
        estimate: t.isEstimate && t.kmOverride === null,
        route: trimPrivate((points.get(t.id) ?? []).map((p) => [p.latitude, p.longitude] as [number, number]), privatePlaces),
      })),
      note,
      km: dayTrips.reduce((sum, t) => sum + tripKm(t), 0),
      amountKc: records.reduce((sum, r) => sum + recordAmountKc(r), 0),
    });
  }

  const totals = { hour: 0, day: 0, recordKm: 0, tripKm: 0, amountKc: 0 };
  const byName = new Map<string, { hour: number; day: number; km: number; amountKc: number }>();
  const byWorkerMap = new Map<number, { hours: number; days: number }>();
  for (const d of days) {
    totals.tripKm += d.km;
    totals.amountKc += d.amountKc;
    for (const r of d.records) {
      if (r.unit === 'hour') totals.hour += r.quantity;
      else if (r.unit === 'day') totals.day += r.quantity;
      else totals.recordKm += r.quantity;
      const entry = byName.get(r.categoryName) ?? { hour: 0, day: 0, km: 0, amountKc: 0 };
      entry[r.unit === 'hour' ? 'hour' : r.unit === 'day' ? 'day' : 'km'] += r.quantity;
      entry.amountKc += recordAmountKc(r);
      byName.set(r.categoryName, entry);
      const w = byWorkerMap.get(r.workerId) ?? { hours: 0, days: 0 };
      if (r.unit === 'hour') w.hours += r.quantity;
      if (r.unit === 'day') w.days += r.quantity;
      byWorkerMap.set(r.workerId, w);
    }
  }
  const byWorker =
    byWorkerMap.size > 1 ? [...byWorkerMap.entries()].map(([id, w]) => ({ name: workerNames.get(id) ?? 'Neznámý', ...w })).sort((a, b) => b.hours - a.hours) : [];
  const placeNames = new Map(places.filter((p) => !p.isPrivate && !p.isHome).map((p) => [p.id, p.name]));
  const byCategory = [...byName.entries()].map(([name, e]) => ({
    name,
    quantities: [
      e.hour > 0 ? formatQuantity(e.hour, 'hour') : null,
      e.day > 0 ? formatQuantity(e.day, 'day') : null,
      e.km > 0 ? formatQuantity(e.km, 'km') : null,
    ]
      .filter(Boolean)
      .join(' + '),
    amountKc: e.amountKc,
  }));

  return { options, days, totals, byCategory, workerNames, byWorker, placeNames };
}

// --- PDF (HTML pro expo-print) ---

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const LOGO_SVG = `<svg viewBox="0 0 400 100" width="200" height="50" xmlns="http://www.w3.org/2000/svg">
<g transform="rotate(-12 30 50)"><rect x="12" y="20" width="10" height="60" rx="5" fill="#F2B705"/><path d="M23 22a28 28 0 0 1 0 56z" fill="#F2B705"/><path d="M29 46h13v8H29z" fill="#131311" opacity=".25"/></g>
<circle cx="72" cy="52" r="25" fill="#131311" stroke="#131311" stroke-width="12"/><circle cx="72" cy="52" r="25" fill="none" stroke="#F2B705" stroke-width="10"/>
<path d="M72 52V39" stroke="#F3F1EA" stroke-width="6" stroke-linecap="round"/><path d="M72 52h10" stroke="#F3F1EA" stroke-width="6" stroke-linecap="round"/>
<text x="106" y="81" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="86" letter-spacing="1" fill="#F3F1EA">CHÁZKA</text></svg>`;

// Trasa bez mapového podkladu (offline) - jednoduchá projekce do SVG.
function routeSvg(routes: [number, number][][]): string {
  const all = routes.flat();
  if (all.length < 2) return '';
  const lats = all.map((p) => p[0]);
  const lons = all.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const w = Math.max((maxLon - minLon) * k, 1e-4);
  const h = Math.max(maxLat - minLat, 1e-4);
  const scale = Math.min(560 / w, 220 / h);
  const pt = ([lat, lon]: [number, number]) => `${(20 + (lon - minLon) * k * scale).toFixed(1)},${(240 - 20 - (lat - minLat) * scale).toFixed(1)}`;
  const lines = routes
    .filter((r) => r.length >= 2)
    .map((r) => `<polyline points="${r.map(pt).join(' ')}" fill="none" stroke="#131311" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${r.map(pt).join(' ')}" fill="none" stroke="#F2B705" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join('');
  return `<svg viewBox="0 0 600 240" width="100%" style="background:#F1EFE8;border-radius:6px">${lines}</svg>`;
}

async function mapHtml(day: ReportDay): Promise<string> {
  const routes = day.trips.map((t) => t.route).filter((r) => r.length >= 2);
  if (routes.length === 0) return '';
  try {
    const base64 = await DochazkaNative.mapSnapshot(routes, [], [], 600, 240);
    if (base64) return `<img src="data:image/png;base64,${base64}" style="width:100%;border-radius:6px"/>`;
  } catch {
    // bez internetu / chyba -> trasa bez podkladu
  }
  return routeSvg(routes);
}

export async function reportHtml(data: ReportData, settings: AppSettings): Promise<string> {
  const { options, days, totals } = data;
  const fmtDate = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;
  const kc = (n: number) => (options.withPrices ? formatKc(n) : '');
  const profile = [settings.profileName, settings.profileIco ? `IČO ${settings.profileIco}` : '', settings.profileDic ? `DIČ ${settings.profileDic}` : '', settings.profileAddress, settings.profilePhone, settings.profileEmail]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const parts: string[] = [];
  parts.push(`<div class="head">${LOGO_SVG}<div class="who">${profile}</div></div>`);
  const workerTitle = options.workerId != null ? ` · ${data.workerNames.get(options.workerId) ?? ''}` : '';
  parts.push(`<h1>Výkaz práce ${fmtDate(options.from)} – ${fmtDate(options.to)}${esc(workerTitle)}</h1>`);

  // Souhrn
  const sumParts = [
    totals.hour > 0 ? formatQuantity(totals.hour, 'hour') : null,
    totals.day > 0 ? formatQuantity(totals.day, 'day') : null,
    totals.tripKm > 0 ? `${formatNumberCs(Math.round(totals.tripKm * 10) / 10)} km najeto` : null,
    `${days.length} dní`,
  ].filter(Boolean);
  parts.push(`<div class="sum"><div>${sumParts.join(' · ')}</div>${options.withPrices ? `<div class="total">${formatKc(totals.amountKc)}</div>` : ''}</div>`);
  if (data.byCategory.length > 0) {
    parts.push('<table class="cat">');
    for (const c of data.byCategory) parts.push(`<tr><td>${esc(c.name)}</td><td>${esc(c.quantities)}</td><td class="r">${kc(c.amountKc)}</td></tr>`);
    parts.push('</table>');
  }
  if (data.byWorker.length > 0) {
    parts.push('<table class="cat">');
    for (const w of data.byWorker) {
      const q = [w.hours > 0 ? formatQuantity(w.hours, 'hour') : null, w.days > 0 ? formatQuantity(w.days, 'day') : null].filter(Boolean).join(' + ');
      parts.push(`<tr><td>${esc(w.name)}</td><td>${esc(q)}</td><td></td></tr>`);
    }
    parts.push('</table>');
  }

  // Dny
  parts.push(`<table class="days"><tr><th>Den</th><th>Práce a stroje</th><th class="r">Km</th>${options.withPrices ? '<th class="r">Kč</th>' : ''}</tr>`);
  for (const d of days) {
    const items = d.records
      .map((r) => {
        const extra = [
          r.workerId !== ME_ID ? data.workerNames.get(r.workerId) : null,
          r.placeId !== null ? data.placeNames.get(r.placeId) : null,
          r.timeFrom && r.timeTo ? `${r.timeFrom}–${r.timeTo}` : null,
        ].filter(Boolean);
        return `${esc(r.categoryName)} ${formatQuantity(r.quantity, r.unit)}${r.surchargePct > 0 ? ` (+${formatNumberCs(r.surchargePct)} %)` : ''}${
          extra.length ? ` <span class="mut">· ${esc(extra.join(' · '))}</span>` : ''
        }`;
      })
      .join('<br/>');
    const dayName = `${esc(d.label)}${d.holiday ? `<br/><span class="mut">${esc(d.holiday)}</span>` : ''}`;
    parts.push(
      `<tr class="${d.weekend || d.holiday ? 'we' : ''}"><td>${dayName}</td><td>${items || '<span class="mut">-</span>'}</td><td class="r">${d.km > 0 ? formatNumberCs(Math.round(d.km * 10) / 10) : ''}</td>${options.withPrices ? `<td class="r">${formatKc(d.amountKc)}</td>` : ''}</tr>`
    );
    if (options.detailed && (d.stays.length > 0 || d.trips.length > 0 || d.note)) {
      const lines = [
        ...d.stays.map((s) => `▪ ${esc(s.placeName)} ${s.from}–${s.to} (${formatDurationHM(s.durationMs)})`),
        ...d.trips.map((t) => `↦ ${esc(t.fromName)} → ${esc(t.toName)} ${t.from}–${t.to} · ${t.estimate ? '≈ ' : ''}${formatNumberCs(Math.round(t.km * 10) / 10)} km`),
        ...(d.note ? [`Poznámka: ${esc(d.note)}`] : []),
      ];
      parts.push(`<tr class="det"><td></td><td colspan="${options.withPrices ? 3 : 2}">${lines.join('<br/>')}</td></tr>`);
    }
    if (options.withMap) {
      const map = await mapHtml(d);
      if (map) parts.push(`<tr class="det"><td></td><td colspan="${options.withPrices ? 3 : 2}">${map}</td></tr>`);
    }
  }
  parts.push('</table>');

  if (options.signatureSvgPath) {
    parts.push(
      `<div class="sig"><svg viewBox="0 0 300 100" width="240" height="80"><path d="${options.signatureSvgPath}" fill="none" stroke="#131311" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><div>Podpis · ${fmtDate(toIsoDate(new Date()))}</div></div>`
    );
  }
  parts.push(`<div class="foot">Vytvořeno v appce Docházka ${fmtDate(toIsoDate(new Date()))}</div>`);

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body{font-family:-apple-system,Helvetica,sans-serif;color:#131311;margin:28px;font-size:11px}
  .head{background:#131311;border-radius:8px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .who{color:#F3F1EA;font-size:10px;text-align:right;max-width:55%}
  h1{font-size:18px;margin:18px 0 8px}
  .sum{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #F2B705;padding:6px 0 8px;font-size:13px}
  .total{font-size:20px;font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b685f;border-bottom:1px solid #ccc;padding:4px}
  td{padding:5px 4px;vertical-align:top;border-bottom:1px solid #eee}
  .r{text-align:right;white-space:nowrap}
  .we td{background:#FAF8F1}
  .det td{border-bottom:1px solid #eee;color:#4a4740;font-size:10px;padding-top:0}
  .mut{color:#8b877c;font-size:10px}
  .cat td{border-bottom:none;padding:2px 4px}
  .sig{margin-top:28px;font-size:10px;color:#4a4740}
  .foot{margin-top:24px;font-size:9px;color:#8b877c}
  </style></head><body>${parts.join('\n')}</body></html>`;
}

// --- CSV a XLSX ---

function rowsForExport(data: ReportData): string[][] {
  const head = ['Datum', 'Den', 'Stroj / práce', 'Pracovník', 'Místo', 'Od', 'Do', 'Množství', 'Jednotka', 'Příplatek %', ...(data.options.withPrices ? ['Sazba Kč', 'Částka Kč'] : []), 'Km přejezdů'];
  const unitName = { hour: 'h', day: 'den', km: 'km' } as const;
  const rows: string[][] = [head];
  for (const d of data.days) {
    const base = [d.date, d.label.split(' ')[0]];
    if (d.records.length === 0) rows.push([...base, '', '', '', '', '', '', '', '', ...(data.options.withPrices ? ['', ''] : []), formatNumberCs(Math.round(d.km * 10) / 10)]);
    d.records.forEach((r, i) => {
      rows.push([
        ...base,
        r.categoryName,
        data.workerNames.get(r.workerId) ?? '',
        r.placeId !== null ? (data.placeNames.get(r.placeId) ?? '') : '',
        r.timeFrom ?? '',
        r.timeTo ?? '',
        formatNumberCs(r.quantity),
        unitName[r.unit],
        formatNumberCs(r.surchargePct),
        ...(data.options.withPrices ? [formatNumberCs(r.rateKc), formatNumberCs(Math.round(recordAmountKc(r) * 100) / 100)] : []),
        i === 0 ? formatNumberCs(Math.round(d.km * 10) / 10) : '',
      ]);
    });
  }
  return rows;
}

function tripRows(data: ReportData): string[][] {
  const rows = [['Datum', 'Odjezd', 'Příjezd', 'Odkud', 'Kam', 'Km', 'Odhad']];
  for (const d of data.days) for (const t of d.trips) rows.push([d.date, t.from, t.to, t.fromName, t.toName, formatNumberCs(Math.round(t.km * 10) / 10), t.estimate ? 'ano' : 'ne']);
  return rows;
}

// CSV pro český Excel: středník, UTF-8 s BOM.
export function reportCsv(data: ReportData): string {
  const quote = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rowsForExport(data).map((r) => r.map(quote).join(';')).join('\r\n');
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sheetXml(rows: string[][]): string {
  const colName = (i: number) => String.fromCharCode(65 + i); // výkaz má méně než 26 sloupců
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          const numeric = r > 0 && /^-?\d+(,\d+)?$/.test(value);
          return numeric
            ? `<c r="${ref}"><v>${value.replace(',', '.')}</v></c>`
            : `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t>${xmlEsc(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

// Minimální skutečné XLSX (OOXML v ZIPu) - listy Dny a Přejezdy.
export function reportXlsx(data: ReportData): Uint8Array {
  return xlsxFromSheets([
    { name: 'Dny', rows: rowsForExport(data) },
    { name: 'Přejezdy', rows: tripRows(data) },
  ]);
}

// Obecný zápis XLSX (sdílí výkaz pro šéfa a export zakázky).
export function xlsxFromSheets(sheets: { name: string; rows: string[][] }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });
  return zipSync(files);
}
