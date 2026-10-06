// Kniha jízd (etapa 7) - ČISTÉ výpočty (testované): návrhy účelu /
// soukromé / vozidla z historie, porovnání s tachometrem mezi kotvami
// a souhrny (služební/soukromé km, náhrada).

export interface HistoryTrip {
  fromKey: string; // místo odjezdu (id místa / zaokrouhlené souřadnice)
  toKey: string;
  purpose: string;
  isPrivate: boolean;
  vehicleId: number | null;
  confirmed: boolean; // uživatel jízdu potvrdil / upravil
}

export interface TripSuggestion {
  purpose: string | null;
  isPrivate: boolean | null;
  vehicleId: number | null;
  basedOn: number; // z kolika jízd
}

const mostCommon = <T>(xs: T[]): { value: T; count: number } | null => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
};

// NETRIVIÁLNÍ ROZHODNUTÍ - učí se jen z potvrzených jízd: nejdřív stejná
// trasa (odkud -> kam), když žádná není, stejný cíl. Soukromá/služební
// a vozidlo se navrhnou, jen když se shoduje aspoň 2/3 jízd (min. 2).
// Výsledek je VŽDY jen návrh - uloží se až po potvrzení.
export function suggestTrip(history: HistoryTrip[], fromKey: string, toKey: string): TripSuggestion | null {
  const confirmed = history.filter((h) => h.confirmed);
  let pool = confirmed.filter((h) => h.fromKey === fromKey && h.toKey === toKey);
  if (pool.length === 0) pool = confirmed.filter((h) => h.toKey === toKey);
  if (pool.length === 0) return null;
  const purpose = mostCommon(pool.map((h) => h.purpose.trim()).filter(Boolean));
  const priv = mostCommon(pool.map((h) => h.isPrivate));
  const vehicle = mostCommon(pool.map((h) => h.vehicleId).filter((v): v is number => v !== null));
  const strong = (c: { count: number } | null) => c !== null && c.count >= 2 && c.count / pool.length >= 2 / 3;
  return {
    purpose: purpose?.value ?? null,
    isPrivate: strong(priv) ? priv!.value : null,
    vehicleId: strong(vehicle) ? vehicle!.value : null,
    basedOn: pool.length,
  };
}

// --- tachometr = pravda ---

export interface OdoAnchor {
  atMs: number;
  km: number; // stav tachometru
}

export interface OdoTrip {
  id: number;
  startMs: number;
  endMs: number;
  km: number; // GPS / silnice / ručně
}

export type OdoResult =
  | { kind: 'within'; odoKm: number; gpsKm: number; factor: number; corrected: { id: number; km: number }[] }
  | { kind: 'more'; odoKm: number; gpsKm: number; extraKm: number; window: { fromMs: number; toMs: number } }
  | { kind: 'less'; odoKm: number; gpsKm: number; missingKm: number };

export const ODO_TOLERANCE_PCT = 0.03;
export const ODO_TOLERANCE_KM = 2;

export function odoTolerance(gpsKm: number): number {
  return gpsKm * ODO_TOLERANCE_PCT + ODO_TOLERANCE_KM;
}

// Porovnání jedné dvojice kotev: do tolerance (~3 % + 2 km) poměrně
// rozpočítat do jízd; tachometr víc = "Jiný řidič / nezaznamenáno" v
// nejdelším okně mezi kotvami, kdy jsem autem nejel; tachometr méně =
// jen upozornit.
export function reconcileOdometer(a: OdoAnchor, b: OdoAnchor, trips: OdoTrip[]): OdoResult | null {
  if (b.atMs <= a.atMs || b.km < a.km) return null;
  const inside = trips.filter((t) => t.startMs >= a.atMs && t.endMs <= b.atMs).sort((x, y) => x.startMs - y.startMs);
  const odoKm = b.km - a.km;
  const gpsKm = inside.reduce((s, t) => s + t.km, 0);
  const diff = odoKm - gpsKm;
  if (Math.abs(diff) <= odoTolerance(gpsKm)) {
    const factor = gpsKm > 0 ? odoKm / gpsKm : 1;
    return { kind: 'within', odoKm, gpsKm, factor, corrected: inside.map((t) => ({ id: t.id, km: Math.round(t.km * factor * 10) / 10 })) };
  }
  if (diff > 0) {
    let window = { fromMs: a.atMs, toMs: b.atMs };
    let best = -1;
    let cursor = a.atMs;
    for (const t of [...inside, { startMs: b.atMs, endMs: b.atMs } as OdoTrip]) {
      if (t.startMs - cursor > best) {
        best = t.startMs - cursor;
        window = { fromMs: cursor, toMs: t.startMs };
      }
      cursor = Math.max(cursor, t.endMs);
    }
    return { kind: 'more', odoKm, gpsKm, extraKm: Math.round(diff * 10) / 10, window };
  }
  return { kind: 'less', odoKm, gpsKm, missingKm: Math.round(-diff * 10) / 10 };
}

// --- souhrn ---

export interface SummaryRow {
  km: number;
  isPrivate: boolean;
}

export function logbookSummary(rows: SummaryRow[], allowanceKcPerKm: number) {
  const businessKm = rows.filter((r) => !r.isPrivate).reduce((s, r) => s + r.km, 0);
  const privateKm = rows.filter((r) => r.isPrivate).reduce((s, r) => s + r.km, 0);
  const total = businessKm + privateKm;
  return {
    businessKm,
    privateKm,
    businessCount: rows.filter((r) => !r.isPrivate).length,
    privateCount: rows.filter((r) => r.isPrivate).length,
    businessPct: total > 0 ? (businessKm / total) * 100 : null,
    allowanceKc: allowanceKcPerKm > 0 ? businessKm * allowanceKcPerKm : null,
  };
}

// Průběžný stav tachometru po každé jízdě: od poslední kotvy před jízdou
// + km jízd (a řádků "nezaznamenáno") od ní. Bez kotvy null.
export function runningOdometer(anchors: OdoAnchor[], entries: { startMs: number; endMs: number; km: number }[]): (number | null)[] {
  const sortedAnchors = [...anchors].sort((x, y) => x.atMs - y.atMs);
  const order = entries.map((e, i) => ({ e, i })).sort((x, y) => x.e.startMs - y.e.startMs);
  const out: (number | null)[] = entries.map(() => null);
  let current: number | null = null;
  let ai = 0;
  for (const { e, i } of order) {
    while (ai < sortedAnchors.length && sortedAnchors[ai].atMs <= e.startMs) current = sortedAnchors[ai++].km;
    if (current !== null) current += e.km;
    out[i] = current === null ? null : Math.round(current);
  }
  return out;
}
