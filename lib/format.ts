// Formátovací pomůcky (čeština) - datum, čas, peníze. Žádná externí
// knihovna (date-fns/dayjs) - na tenhle rozsah stačí Intl a pár
// jednořádkových funkcí.

import type { RateUnit } from './types';

const MONTHS_CS = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
];

const WEEKDAYS_CS_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

// YYYY-MM-DD v LOKÁLNÍM čase (ne UTC) - toISOString() by u pozdní/
// časné hodiny mohl posunout na jiný kalendářní den, což by neseděl s
// tím, který den uživatel vidí na obrazovce.
export function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_CS[month - 1]} ${year}`;
}

// VERZÁLKAMI - viz vizuální směr "A · Stavba" (kalendář: název měsíce
// nahoře, Barlow Condensed Bold).
export function monthNameUpper(month: number): string {
  return MONTHS_CS[month - 1].toUpperCase();
}

export function weekdayShort(index: number): string {
  return WEEKDAYS_CS_SHORT[index];
}

export function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = WEEKDAYS_CS_SHORT[(date.getDay() + 6) % 7]; // getDay(): 0=neděle
  return `${weekday} ${day}. ${MONTHS_CS[month - 1].toLowerCase()} ${year}`;
}

// Záhlaví detailu dne - "ÚT 1. ZÁŘÍ" (bez roku, viz vizuální směr).
export function formatDayHeaderTitle(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = WEEKDAYS_CS_SHORT[(date.getDay() + 6) % 7].toUpperCase();
  return `${weekday} ${day}. ${monthNameUpper(month)}`;
}

// "9,5 h" nebo "9,5 h · 45 km" (km zatím vždy null, dokud etapa 3
// nepřidá záznam přejezdů - viz POZNAMKY.md).
export function formatDayHeaderSummary(hours: number, km: number | null): string {
  const hoursPart = formatHodiny(hours);
  if (km === null || km <= 0) return hoursPart;
  return `${hoursPart} · ${Math.round(km)} km`;
}

// Odpracované hodiny VŠUDE stejně (aplikace, PDF, Excel): desetinně s
// čárkou na jedno místo - "15,4 h", "8 h", "6,5 h". Ne "15 h 23 min".
// Zaokrouhluje se jen tady při zobrazení, výpočty jdou z přesné hodnoty.
export function formatHodiny(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${formatNumberCs(rounded === 0 ? 0 : rounded)} h`;
}

export function formatDays(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return `${rounded.toString().replace('.', ',')} d`;
}

// Peníze VŠUDE stejně: celé Kč, mezera po tisících i u čtyřmístných
// ("5 383 Kč" - cs-CZ toLocaleString čtyřmístná čísla neodděluje),
// záporné s "−", nula vždy "0 Kč" (nikdy "−0"). Náklady se předávají
// záporně: formatKc(-naklad). Mezera je nezlomitelná (nerozdělí řádek).
export function formatKc(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${amount < 0 && rounded !== 0 ? '−' : ''}${digits}\u00A0Kč`;
}

// --- jednotky položek (oprava 2, C1) ---

export function formatNumberCs(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

// "8 h", "1 den", "2 dny", "5 dní", "0,5 dne", "120 km"
export function formatQuantity(quantity: number, unit: RateUnit): string {
  const n = formatNumberCs(quantity);
  if (unit === 'hour') return formatHodiny(quantity);
  if (unit === 'km') return `${n} km`;
  if (!Number.isInteger(quantity)) return `${n} dne`;
  if (quantity === 1) return '1 den';
  if (quantity >= 2 && quantity <= 4) return `${n} dny`;
  return `${n} dní`;
}

export const UNIT_SHORT: Record<RateUnit, string> = { hour: 'h', day: 'den', km: 'km' };
export const UNIT_RATE_LABEL: Record<RateUnit, string> = { hour: 'Kč/h', day: 'Kč/den', km: 'Kč/km' };
