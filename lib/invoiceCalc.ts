// Fakturace - ČISTÉ výpočty (testované v scripts/test-invoice.ts): číslo
// faktury, splatnost, součty položek, výpis prací po dnech a souhrny,
// předvyplnění položek z práce zakázky, kontrola hodin.
//
// Částky na haléře (2 desetinná místa): celkem položky = množství × cena
// za jednotku zaokrouhlené na haléře, faktura = součet položek. Stejné
// číslo jde do PDF i do QR Platby.

import { formatQuantity } from './format';
import type { InvoiceCarry, InvoiceItem, InvoiceRemainder, RateUnit, WorkLogRow } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const itemTotal = (i: Pick<InvoiceItem, 'quantity' | 'unitPriceKc'>) => round2(i.quantity * i.unitPriceKc);

export const invoiceTotal = (items: Pick<InvoiceItem, 'quantity' | 'unitPriceKc'>[]) => round2(items.reduce((s, i) => s + itemTotal(i), 0));

// Číslo faktury = variabilní symbol: jen číslice, nejvýš 10.
export const isValidInvoiceNumber = (s: string) => /^\d{1,10}$/.test(s);

// Další volné číslo RRRRnnn (2026001, 2026002, …) - po nejvyšším čísle
// letošní řady; čísla jiného tvaru se přeskočí (jen se hlídají duplicity).
export function nextInvoiceNumber(existing: string[], year: number): string {
  const prefix = String(year);
  let max = 0;
  for (const n of existing) {
    if (n.length >= 7 && n.length <= 10 && n.startsWith(prefix) && /^\d+$/.test(n)) max = Math.max(max, Number(n.slice(4)));
  }
  const next = `${prefix}${String(max + 1).padStart(3, '0')}`;
  return next.length <= 10 ? next : prefix;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// "1. 2. 2026" -> "2026-02-01"; null = neplatné datum.
export function parseCzDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const czDate = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

const WEEKDAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

// "út 21. 10. 2026"
export function czDateWithWeekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${czDate(iso)}`;
}

// Množství z textu s desetinnou čárkou ("6,5", "1 250,5"); null = neplatné.
export function parseDecimal(text: string): number | null {
  const s = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  return Number(s);
}

export function formatDecimal(n: number): string {
  return String(round2(n)).replace('.', ',');
}

// --- výpis prací ---

export interface WorkSource {
  date: string;
  work: string; // druh práce / stroj
  worker: string;
  quantity: number;
  unit: RateUnit;
  amountKc: number; // včetně příplatku
}

// Řádek za den × druh práce × pracovník × jednotka, seřazeno podle data.
export function buildWorkLog(sources: WorkSource[]): WorkLogRow[] {
  const map = new Map<string, WorkLogRow>();
  for (const s of sources) {
    const key = [s.date, s.work, s.worker, s.unit].join('\u0001');
    const row = map.get(key) ?? { date: s.date, work: s.work, worker: s.worker, quantity: 0, unit: s.unit, amountKc: 0 };
    row.quantity += s.quantity;
    row.amountKc += s.amountKc;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, quantity: round2(r.quantity), amountKc: round2(r.amountKc) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.work.localeCompare(b.work, 'cs') || a.worker.localeCompare(b.worker, 'cs') || a.unit.localeCompare(b.unit));
}

// Sazba řádku (částka / množství) - u příplatků průměrná.
export const workLogRate = (r: WorkLogRow) => (r.quantity > 0 ? r.amountKc / r.quantity : 0);

export interface QuantityTotals {
  hour: number;
  day: number;
  km: number;
}

// "20,5 h", "8 h + 1 den + 45 km"
export function quantityTotalsLabel(t: QuantityTotals): string {
  const parts = [t.hour > 0 ? formatQuantity(t.hour, 'hour') : null, t.day > 0 ? formatQuantity(t.day, 'day') : null, t.km > 0 ? formatQuantity(t.km, 'km') : null].filter(Boolean);
  return parts.length ? parts.join(' + ') : '0 h';
}

export interface WorkLogGroup {
  name: string;
  totals: QuantityTotals;
  amountKc: number;
}

export interface WorkLogSummary {
  days: number;
  totals: QuantityTotals;
  amountKc: number;
  byWork: WorkLogGroup[];
  byWorker: WorkLogGroup[];
  from: string | null;
  to: string | null;
}

function groupBy(rows: WorkLogRow[], key: (r: WorkLogRow) => string): WorkLogGroup[] {
  const map = new Map<string, WorkLogGroup>();
  for (const r of rows) {
    const name = key(r);
    const g = map.get(name) ?? { name, totals: { hour: 0, day: 0, km: 0 }, amountKc: 0 };
    g.totals[r.unit] += r.quantity;
    g.amountKc += r.amountKc;
    map.set(name, g);
  }
  return [...map.values()].sort((a, b) => b.amountKc - a.amountKc || a.name.localeCompare(b.name, 'cs'));
}

export function summarizeWorkLog(rows: WorkLogRow[]): WorkLogSummary {
  const totals: QuantityTotals = { hour: 0, day: 0, km: 0 };
  for (const r of rows) totals[r.unit] += r.quantity;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  return {
    days: dates.length,
    totals,
    amountKc: round2(rows.reduce((s, r) => s + r.amountKc, 0)),
    byWork: groupBy(rows, (r) => r.work),
    byWorker: groupBy(rows, (r) => r.worker),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

export function periodLabel(from: string | null, to: string | null): string {
  if (!from || !to) return '';
  if (from === to) return czDate(from);
  // "21. 10. – 26. 10. 2026" (rok jen jednou, když je stejný)
  const short = from.slice(0, 4) === to.slice(0, 4) ? `${Number(from.slice(8, 10))}. ${Number(from.slice(5, 7))}.` : czDate(from);
  return `${short} – ${czDate(to)}`;
}

// "1 den", "4 dny", "5 dní"
export function daysLabel(n: number): string {
  if (n === 1) return '1 den';
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dní`;
}

// --- položky ze zakázky ---

const UNIT_TO_INVOICE: Record<RateUnit, string> = { hour: 'h', day: 'den', km: 'km' };

// Položky podle práce: druh práce × jednotka × sazba (sazba vč. příplatku,
// ať součet sedí na haléř s výpisem prací). Pevná cena = jedna položka.
export function itemsFromWork(rows: WorkSource[], description: string, fixed: { name: string; amountKc: number } | null): InvoiceItem[] {
  if (fixed) return [{ name: fixed.name, description, quantity: 1, unit: 'paušál', unitPriceKc: round2(fixed.amountKc) }];
  const map = new Map<string, InvoiceItem & { amountKc: number }>();
  for (const r of rows) {
    if (r.quantity <= 0) continue;
    const rate = round2(r.amountKc / r.quantity);
    const key = [r.work, r.unit, rate].join('\u0001');
    const item = map.get(key) ?? { name: r.work, description, quantity: 0, unit: UNIT_TO_INVOICE[r.unit], unitPriceKc: rate, amountKc: 0 };
    item.quantity += r.quantity;
    item.amountKc += r.amountKc;
    map.set(key, item);
  }
  return [...map.values()]
    .sort((a, b) => b.amountKc - a.amountKc)
    .map((i) => ({ name: i.name, description: i.description, quantity: round2(i.quantity), unit: i.unit, unitPriceKc: i.unitPriceKc }));
}

// Žluté upozornění: hodiny v položkách (jednotka h) ≠ odpracované hodiny
// (výpis prací + převzaté zbytky dřívějších faktur). Bez hodinových položek
// (pevná cena, paušál) se nehlídá.
export function hoursMismatch(items: InvoiceItem[], workLog: WorkLogRow[] | null, carries: InvoiceCarry[] = []): { itemHours: number; workHours: number } | null {
  if (!workLog || !items.some((i) => i.unit === 'h')) return null;
  const itemHours = round2(items.filter((i) => i.unit === 'h').reduce((s, i) => s + i.quantity, 0));
  const workHours = round2(workLog.filter((r) => r.unit === 'hour').reduce((s, r) => s + r.quantity, 0) + carries.reduce((s, c) => s + c.hours, 0));
  return Math.abs(itemHours - workHours) > 0.001 ? { itemHours, workHours } : null;
}

// --- zbytek hodin při nižší fakturaci ---

export const carryKc = (c: Pick<InvoiceCarry, 'hours' | 'rateKc'>) => round2(c.hours * c.rateKc);

// Fakturuje se méně hodin, než je odpracováno -> zbytek (hodiny, průměrná
// hodinová sazba, druh práce). null = nic nezbývá.
export function remainderFor(items: InvoiceItem[], workLog: WorkLogRow[] | null, carries: InvoiceCarry[] = []): Omit<InvoiceRemainder, 'mode'> | null {
  const m = hoursMismatch(items, workLog, carries);
  if (!m || m.itemHours >= m.workHours) return null;
  const hourRows = (workLog ?? []).filter((r) => r.unit === 'hour');
  const amount = hourRows.reduce((s, r) => s + r.amountKc, 0) + carries.reduce((s, c) => s + carryKc(c), 0);
  const works = new Set([...hourRows.map((r) => r.work), ...carries.map((c) => c.work)]);
  return { hours: round2(m.workHours - m.itemHours), rateKc: round2(amount / m.workHours), work: works.size === 1 ? [...works][0] : 'Práce' };
}

// Položka faktury za zbytek převzatý z dřívější faktury.
export function carryItem(c: InvoiceCarry): InvoiceItem {
  return { name: c.work, description: `Nevyfakturováno z faktury č. ${c.number}`, quantity: c.hours, unit: 'h', unitPriceKc: c.rateKc };
}
