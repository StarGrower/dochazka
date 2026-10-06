// Stroje (etapa 6) - ČISTÉ výpočty (testované): odhad počitadla z
// kotevních bodů a naučeného poměru, stav servisu, spotřeba plná-plná,
// průměrná cena vlastní zásoby a čtení čísel z rozpoznaného textu (OCR).

export interface Anchor {
  atMs: number;
  value: number; // stav počitadla (Mth / km)
}

// Odpracované hodiny (Mth) / ujeté km (vozidlo) podle zápisů a přejezdů.
export interface UsageSample {
  atMs: number;
  amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// NETRIVIÁLNÍ ROZHODNUTÍ - poměr "zapsané hodiny -> Mth" (u vozidel
// "km z přejezdů -> tachometr") se učí z dvojic kotevních bodů: medián
// z posledních 5 úseků, omezený na 0,3-3 (chybná kotva nerozhodí odhad).
// Bez dvou kotev = 1 (Mth = zapsané hodiny).
export function learnRatio(anchors: Anchor[], samples: UsageSample[]): number {
  const sorted = [...anchors].sort((a, b) => a.atMs - b.atMs);
  const ratios: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const used = samples.filter((s) => s.atMs > a.atMs && s.atMs <= b.atMs).reduce((sum, s) => sum + s.amount, 0);
    if (used > 0 && b.value > a.value) ratios.push((b.value - a.value) / used);
  }
  if (ratios.length === 0) return 1;
  return Math.min(3, Math.max(0.3, median(ratios.slice(-5))));
}

export interface CounterEstimate {
  value: number;
  ratio: number;
  lastAnchor: Anchor;
  sinceAnchor: number; // zapsaná práce / km od poslední kotvy
}

export function estimateCounter(anchors: Anchor[], samples: UsageSample[], nowMs: number): CounterEstimate | null {
  const sorted = [...anchors].filter((a) => a.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const ratio = learnRatio(sorted, samples);
  const sinceAnchor = samples.filter((s) => s.atMs > last.atMs && s.atMs <= nowMs).reduce((sum, s) => sum + s.amount, 0);
  return { value: last.value + sinceAnchor * ratio, ratio, lastAnchor: last, sinceAnchor };
}

// Průměrné využití na pracovní den (dny se záznamem) za posledních `days` dní.
export function usagePerWorkday(samples: UsageSample[], nowMs: number, ratio: number, days = 60): number {
  const recent = samples.filter((s) => s.atMs > nowMs - days * DAY_MS && s.atMs <= nowMs && s.amount > 0);
  const dayKeys = new Set(recent.map((s) => Math.floor(s.atMs / DAY_MS)));
  if (dayKeys.size === 0) return 0;
  return (recent.reduce((sum, s) => sum + s.amount, 0) * ratio) / dayKeys.size;
}

// --- servis ---

export interface ServiceItemInput {
  intervalValue: number | null; // Mth / km
  intervalDays: number | null;
  warnFirst: number | null; // výchozí 50 (Mth) / úměrně u km
  warnSecond: number | null; // výchozí 20
  warnDaysFirst: number; // 30
  warnDaysSecond: number; // 7
  lastDoneValue: number | null;
  lastDoneDate: string | null; // YYYY-MM-DD
}

export interface ServiceStatus {
  level: 'ok' | 'soon' | 'overdue' | 'unknown';
  remainingValue: number | null;
  remainingDays: number | null; // podle data intervalu
  estimatedWorkdays: number | null; // podle průměrného využití
  threshold: 'first' | 'second' | 'due' | null; // pro upozornění
}

// Co nastane dřív - interval v Mth/km, nebo čas.
export function serviceStatus(item: ServiceItemInput, current: number | null, nowMs: number, usagePerDay: number): ServiceStatus {
  let remainingValue: number | null = null;
  let remainingDays: number | null = null;
  if (item.intervalValue && current !== null) {
    remainingValue = (item.lastDoneValue ?? 0) + item.intervalValue - current;
  }
  if (item.intervalDays && item.lastDoneDate) {
    const due = Date.parse(`${item.lastDoneDate}T12:00:00`) + item.intervalDays * DAY_MS;
    remainingDays = Math.floor((due - nowMs) / DAY_MS);
  }
  if (remainingValue === null && remainingDays === null) {
    return { level: 'unknown', remainingValue: null, remainingDays: null, estimatedWorkdays: null, threshold: null };
  }
  const estimatedWorkdays = remainingValue !== null && usagePerDay > 0 ? Math.max(0, Math.round(remainingValue / usagePerDay)) : null;
  const overdue = (remainingValue !== null && remainingValue <= 0) || (remainingDays !== null && remainingDays <= 0);
  const second =
    (remainingValue !== null && item.warnSecond !== null && remainingValue <= item.warnSecond) ||
    (remainingDays !== null && remainingDays <= item.warnDaysSecond);
  const first =
    (remainingValue !== null && item.warnFirst !== null && remainingValue <= item.warnFirst) ||
    (remainingDays !== null && remainingDays <= item.warnDaysFirst);
  return {
    level: overdue ? 'overdue' : first || second ? 'soon' : 'ok',
    remainingValue,
    remainingDays,
    estimatedWorkdays,
    threshold: overdue ? 'due' : second ? 'second' : first ? 'first' : null,
  };
}

// --- spotřeba metodou plná-plná ---

export interface FuelSample {
  atMs: number;
  liters: number;
  fullTank: boolean;
  counter: number | null;
}

export interface ConsumptionSegment {
  fromMs: number;
  toMs: number;
  liters: number;
  distance: number; // Mth / km
  perUnit: number; // l/Mth, nebo l/km (×100 = l/100 km)
  jump: boolean; // +20 % proti průměru předchozích
}

// Mezi dvěma plnými nádržemi: litry tankované po první plné až po
// druhou plnou včetně / rozdíl počitadla.
export function consumptionSegments(samples: FuelSample[]): ConsumptionSegment[] {
  const sorted = [...samples].sort((a, b) => a.atMs - b.atMs);
  const out: ConsumptionSegment[] = [];
  let start: FuelSample | null = null;
  let liters = 0;
  for (const s of sorted) {
    if (start) liters += s.liters;
    if (s.fullTank && s.counter !== null) {
      if (start && start.counter !== null && s.counter > start.counter) {
        const distance = s.counter - start.counter;
        const perUnit = liters / distance;
        const prev = out.map((x) => x.perUnit);
        const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
        out.push({ fromMs: start.atMs, toMs: s.atMs, liters, distance, perUnit, jump: avg !== null && perUnit > avg * 1.2 });
      }
      start = s;
      liters = 0;
    }
  }
  return out;
}

// --- vlastní zásoba nafty ---

export interface StockMove {
  atMs: number;
  kind: 'purchase' | 'issue';
  liters: number;
  priceTotalKc: number | null;
}

// Stav zásoby a průměrná cena (vážený průměr nákupů; výdej odebírá za průměr).
export function stockState(moves: StockMove[]): { liters: number; avgPricePerL: number } {
  let liters = 0;
  let value = 0;
  for (const m of [...moves].sort((a, b) => a.atMs - b.atMs)) {
    if (m.kind === 'purchase') {
      liters += m.liters;
      value += m.priceTotalKc ?? 0;
    } else {
      const avg = liters > 0 ? value / liters : 0;
      liters = Math.max(0, liters - m.liters);
      value = Math.max(0, value - avg * m.liters);
    }
  }
  return { liters, avgPricePerL: liters > 0 ? value / liters : 0 };
}

// --- OCR (Apple Vision vrací řádky textu) ---

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// Počitadlo: nejdelší číslo (3-7 číslic, volitelně desetinná část),
// mimo data a časy.
export function parseCounterText(lines: string[]): number | null {
  let best: { digits: number; value: number } | null = null;
  for (const line of lines) {
    if (/\d{1,2}[.:]\d{2}[.:]\d{2,4}/.test(line)) continue;
    for (const m of line.matchAll(/\d[\d\s]{1,8}(?:[.,]\d)?/g)) {
      const raw = m[0].trim();
      const digits = raw.replace(/\D/g, '').length;
      if (digits < 3 || digits > 8) continue;
      const value = num(raw);
      if (!best || digits > best.digits) best = { digits, value };
    }
  }
  return best?.value ?? null;
}

export interface ReceiptGuess {
  liters: number | null;
  totalKc: number | null;
  pricePerL: number | null;
  date: string | null; // YYYY-MM-DD
}

// Účtenka z čerpací stanice - odhad; vždy potvrzuje uživatel.
export function parseReceiptText(lines: string[]): ReceiptGuess {
  const text = lines.join('\n');
  const liters = /(\d+[.,]\d{1,3})\s*(?:l\b|L\b|ltr|litr)/.exec(text);
  const perL = /(\d+[.,]\d{1,2})\s*(?:Kč|CZK|,-)?\s*\/\s*l/i.exec(text);
  let total: number | null = null;
  for (const line of lines) {
    if (/celkem|k\s*úhrad|total|suma|zaplaceno/i.test(line)) {
      const m = /(\d[\d\s]*[.,]\d{2})/.exec(line);
      if (m) total = Math.max(total ?? 0, num(m[1]));
    }
  }
  if (total === null) {
    const amounts = [...text.matchAll(/(\d[\d\s]{0,6}[.,]\d{2})\s*(?:Kč|CZK)/g)].map((m) => num(m[1]));
    if (amounts.length) total = Math.max(...amounts);
  }
  const d = /(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})/.exec(text);
  return {
    liters: liters ? num(liters[1]) : null,
    totalKc: total,
    pricePerL: perL ? num(perL[1]) : null,
    date: d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null,
  };
}
