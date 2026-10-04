// Návrh zápisu pobytu (etapa 4.3) - sdílí připomenutí (lib/reminders.ts)
// i okno "Zapsat pobyt" (components/StaySheet.tsx).
//
// Stroj: ručně zamčený pro místo -> naučený (nejčastější zápis u místa)
// -> první výchozí položka nového dne -> první stroj. Hodiny: délka
// pobytu − přestávka (Nastavení -> Zápisy), zaokrouhlené. Vždy jen
// NÁVRH - uloží se až potvrzením.

import { formatNumberCs } from './format';
import type { AppSettings, RateUnit, WorkCategory } from './types';
import { applyRounding } from './workCalc';

export interface StayProposal {
  category: WorkCategory;
  unit: RateUnit;
  quantity: number;
  explanation: string; // "8 h 15 min − 30 min přestávka, zaokrouhleno na 0,5 h"
  locked: boolean; // návrh je ručně zamčený pro místo
}

export function formatDurationHM(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function proposeStayRecord(
  durationMs: number,
  suggestion: { categoryId: number; unit: RateUnit; locked: boolean } | null,
  settings: AppSettings,
  categories: WorkCategory[]
): StayProposal | null {
  const active = categories.filter((c) => !c.isDeleted);
  const byId = new Map(active.map((c) => [c.id, c]));
  const category =
    (suggestion && byId.get(suggestion.categoryId)) ||
    settings.defaultCategoryIds.map((id) => byId.get(id)).find((c) => c !== undefined) ||
    active[0];
  if (!category) return null;

  const unit: RateUnit = suggestion && byId.has(suggestion.categoryId) ? suggestion.unit : 'hour';
  if (unit !== 'hour') {
    return { category, unit, quantity: unit === 'day' ? 1 : 0, explanation: `${formatDurationHM(durationMs)} na místě`, locked: !!suggestion?.locked };
  }

  const parts = [formatDurationHM(durationMs)];
  let hours = durationMs / 3600000;
  if (settings.autoSubtractBreak && settings.breakMinutes > 0) {
    hours = Math.max(0, hours - settings.breakMinutes / 60);
    parts.push(`− ${settings.breakMinutes} min přestávka`);
  }
  const rounded = applyRounding(hours, settings.roundingMinutes);
  let explanation = parts.join(' ');
  if (settings.roundingMinutes > 0) {
    explanation += `, zaokrouhleno na ${formatNumberCs(settings.roundingMinutes / 60)} h`;
  }
  return { category, unit, quantity: Math.round(rounded * 100) / 100, explanation, locked: !!suggestion?.locked };
}
