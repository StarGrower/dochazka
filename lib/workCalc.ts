// Obchodní logika navázaná na nastavení "Zápisy" (viz lib/types.ts ->
// AppSettings) - oddělené od lib/db.ts (persistence) a lib/format.ts
// (zobrazení), ať se tyhle pravidla dají najít na jednom místě a
// později doplnit (etapa 3: zaokrouhlení časů příjezdu/odjezdu bude
// používat stejný `applyRounding`).

import { holidayName, isWeekend, isWorkday } from './holidays';
import type { AppSettings, DayWorkRecord, RateUnit, WorkCategory } from './types';

// Výchozí množství pro NOVOU hodinovou položku (zadání "výchozí délka
// pracovního dne" + "automaticky odečítat přestávku"). 0 = proměnná
// pracovní doba (oprava 2, B1) - nic se nepředvyplňuje.
export function defaultHourlyQuantity(settings: AppSettings): number {
  if (settings.defaultDayLengthHours <= 0) return 0;
  if (!settings.autoSubtractBreak) return settings.defaultDayLengthHours;
  const hours = settings.defaultDayLengthHours - settings.breakMinutes / 60;
  return Math.max(0, Math.round(hours * 100) / 100);
}

// Výchozí množství nové položky podle jednotky - den = 1, km se vždy
// zadávají ručně (do etapy 3).
export function defaultQuantityFor(unit: RateUnit, settings: AppSettings): number {
  if (unit === 'hour') return defaultHourlyQuantity(settings);
  if (unit === 'day') return 1;
  return 0;
}

// Zaokrouhlení zadaného množství hodin na krok podle nastavení (0 =
// "bez") - zadání "zaokrouhlení času"; směr nejbližší / dolů / nahoru
// (Nastavení -> Zápisy). Platí jen pro HODINOVÉ položky - dny/km se
// nezaokrouhlují.
export function applyRounding(hours: number, settings: Pick<AppSettings, 'roundingMinutes' | 'roundingMode'>): number {
  if (settings.roundingMinutes === 0) return hours;
  const stepHours = settings.roundingMinutes / 60;
  // Drobná tolerance, ať 7,5000001 h nezaokrouhlí nahoru na 8 h.
  const steps = Math.round((hours / stepHours) * 1e6) / 1e6;
  const rounded = settings.roundingMode === 'down' ? Math.floor(steps) : settings.roundingMode === 'up' ? Math.ceil(steps) : Math.round(steps);
  return Math.round(rounded * stepHours * 100) / 100;
}

export const ROUNDING_MODE_LABEL: Record<AppSettings['roundingMode'], string> = { nearest: '', down: 'dolů ', up: 'nahoru ' };

// --- příplatky (oprava 2, C2) ---
//
// Vlastní % u stroje přepíše výchozí z Nastavení (null = výchozí, 0 =
// bez příplatku). Svátek o víkendu = procenta se SČÍTAJÍ. Platí i pro
// položky v km.

export function effectiveWeekendPct(category: WorkCategory, settings: AppSettings): number {
  return category.weekendPct ?? settings.weekendSurchargePct;
}

export function effectiveHolidayPct(category: WorkCategory, settings: AppSettings): number {
  return category.holidayPct ?? settings.holidaySurchargePct;
}

export function surchargePctFor(date: string, category: WorkCategory, settings: AppSettings): number {
  let pct = 0;
  if (isWeekend(date)) pct += effectiveWeekendPct(category, settings);
  if (holidayName(date) !== null) pct += effectiveHolidayPct(category, settings);
  return pct;
}

// Sazba + příplatek, které se uloží k položce v okamžiku zápisu (C1/C2).
export function priceForRecord(
  date: string,
  category: WorkCategory,
  unit: RateUnit,
  settings: AppSettings
): { rateKc: number; surchargePct: number } {
  return { rateKc: category.rates[unit], surchargePct: surchargePctFor(date, category, settings) };
}

export function recordAmountKc(record: Pick<DayWorkRecord, 'quantity' | 'rateKc' | 'surchargePct'>): number {
  return record.quantity * record.rateKc * (1 + record.surchargePct / 100);
}

// --- výchozí položky nového dne (oprava 2, B2) ---
//
// NETRIVIÁLNÍ ROZHODNUTÍ - výchozí položky se NIKDY neukládají samy
// otevřením dne (dřív se vkládaly do každého otevřeného dne, i do
// budoucích, a souběžným načtením dvakrát). Jsou jen NÁVRH, který se
// nabídne, když den aktivně začnu zapisovat (+ Přidat / ZAPSAT DNEŠEK)
// a uloží se až po potvrzení. Jen pro dny bez položek, nikdy pro
// budoucí dny, volitelně jen v pracovní dny (bez víkendů a svátků).

export interface DefaultItemProposal {
  category: WorkCategory;
  unit: RateUnit;
  quantity: number;
}

export function dayDefaultsProposal(
  date: string,
  todayIso: string,
  settings: AppSettings,
  categories: WorkCategory[],
  existingRecordCount: number
): DefaultItemProposal[] {
  if (existingRecordCount > 0) return [];
  if (date > todayIso) return [];
  if (settings.defaultsOnlyWorkdays && !isWorkday(date)) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const proposals: DefaultItemProposal[] = [];
  for (const id of settings.defaultCategoryIds) {
    const category = byId.get(id);
    if (!category) continue; // smazaná kategorie
    proposals.push({ category, unit: category.defaultUnit, quantity: defaultQuantityFor(category.defaultUnit, settings) });
  }
  return proposals;
}
