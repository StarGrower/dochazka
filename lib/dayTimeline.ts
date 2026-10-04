// "PRŮBĚH DNE" - rozpad pobytů na jeden kalendářní den (oprava 2, A3).
// Čistá funkce (bez DB/React Native), sdílená Detailem dne a testy.
//
// - pobyt přes půlnoc se v každém dni ukáže jen v rozsahu toho dne
//   (So 17:09–24:00, Ne 0:00–…)
// - probíhající pobyt končí "teď" a v budoucích dnech se neukazuje
// - délka (i návrh hodin) se počítá jen za daný den
// - přejezd jen mezi dvěma RŮZNÝMI místy

import { distanceMeters } from './geo';

export interface TimelineVisitInput {
  placeId: number | null;
  unknownLatitude: number | null;
  unknownLongitude: number | null;
  startAt: string; // ISO (UTC)
  endAt: string | null;
  startUncertain: boolean;
}

export interface TimelineStay<V extends TimelineVisitInput> {
  kind: 'stay';
  visit: V;
  segStartMs: number;
  segEndMs: number;
  startsBeforeDay: boolean; // zobrazit "0:00"
  endsAfterDay: boolean; // zobrazit "24:00"
  ongoing: boolean; // probíhá a dnešní úsek končí "teď"
  uncertainEnd: boolean; // probíhá déle než 24 h - asi chybí odjezd
}

export interface TimelineTravel {
  kind: 'travel';
  fromMs: number;
  toMs: number;
}

export type TimelineItem<V extends TimelineVisitInput> = TimelineStay<V> | TimelineTravel;

export const UNCERTAIN_END_AFTER_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_SAME_PLACE_M = 300;

// Hranice LOKÁLNÍHO dne v ms - přes Date(y, m, d), ať sedí i den
// přechodu letního/zimního času (23/25 h).
export function localDayBounds(dateIso: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateIso.split('-').map(Number);
  return { startMs: new Date(y, m - 1, d).getTime(), endMs: new Date(y, m - 1, d + 1).getTime() };
}

export function isSameLocation(a: TimelineVisitInput, b: TimelineVisitInput): boolean {
  if (a.placeId !== null || b.placeId !== null) return a.placeId === b.placeId;
  if (a.unknownLatitude === null || a.unknownLongitude === null || b.unknownLatitude === null || b.unknownLongitude === null) {
    return false;
  }
  return distanceMeters(a.unknownLatitude, a.unknownLongitude, b.unknownLatitude, b.unknownLongitude) <= UNKNOWN_SAME_PLACE_M;
}

export function buildDayTimeline<V extends TimelineVisitInput>(
  visits: V[],
  dateIso: string,
  nowMs: number
): TimelineItem<V>[] {
  const { startMs: dayStart, endMs: dayEnd } = localDayBounds(dateIso);
  const stays: TimelineStay<V>[] = [];

  const sorted = [...visits].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  for (const visit of sorted) {
    const start = Date.parse(visit.startAt);
    if (start >= dayEnd || start > nowMs) continue;
    const ongoing = visit.endAt === null;
    const end = ongoing ? nowMs : Date.parse(visit.endAt as string);
    // Pobyt s neznámým začátkem má start == end - patří do dne, kde skončil.
    if (end < dayStart || (end === dayStart && start < dayStart)) continue;

    const segStartMs = Math.max(start, dayStart);
    const segEndMs = Math.min(end, dayEnd);
    stays.push({
      kind: 'stay',
      visit,
      segStartMs,
      segEndMs,
      startsBeforeDay: start < dayStart,
      endsAfterDay: end > dayEnd,
      ongoing: ongoing && nowMs < dayEnd,
      uncertainEnd: ongoing && nowMs - start > UNCERTAIN_END_AFTER_MS,
    });
  }

  const items: TimelineItem<V>[] = [];
  stays.forEach((stay, i) => {
    const prev = stays[i - 1];
    if (prev && !isSameLocation(prev.visit, stay.visit) && stay.segStartMs > prev.segEndMs) {
      items.push({ kind: 'travel', fromMs: prev.segEndMs, toMs: stay.segStartMs });
    }
    items.push(stay);
  });
  return items;
}
