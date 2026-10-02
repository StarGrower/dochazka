// Formátovací pomůcky (čeština) - datum, čas, peníze. Žádná externí
// knihovna (date-fns/dayjs) - na tenhle rozsah stačí Intl a pár
// jednořádkových funkcí.

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
  const hoursPart = formatHours(hours);
  if (km === null || km <= 0) return hoursPart;
  return `${hoursPart} · ${Math.round(km)} km`;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded.toString().replace('.', ',')} h`;
}

export function formatDays(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return `${rounded.toString().replace('.', ',')} d`;
}

export function formatKc(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('cs-CZ')} Kč`;
}
