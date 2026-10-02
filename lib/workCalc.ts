// Obchodní logika navázaná na nastavení "Zápisy" (viz lib/types.ts ->
// AppSettings) - oddělené od lib/db.ts (persistence) a lib/format.ts
// (zobrazení), ať se tyhle pravidla dají najít na jednom místě a
// později doplnit (etapa 3: zaokrouhlení časů příjezdu/odjezdu bude
// používat stejný `applyRounding`).

import { addDayRecord, getDayRecords, isDayInitialized, listCategories, markDayInitialized } from './db';
import type { AppSettings } from './types';

// Výchozí množství pro NOVOU hodinovou položku (zadání "výchozí délka
// pracovního dne" + "automaticky odečítat přestávku"). Denní sazba
// vždy dostane 1 den (přestávka na denní položky nedává smysl).
export function defaultHourlyQuantity(settings: AppSettings): number {
  if (!settings.autoSubtractBreak) return settings.defaultDayLengthHours;
  const hours = settings.defaultDayLengthHours - settings.breakMinutes / 60;
  return Math.max(0, Math.round(hours * 100) / 100);
}

// Zaokrouhlení zadaného množství hodin na nejbližší krok podle
// nastavení (0 = "bez") - zadání "zaokrouhlení času". Platí jen pro
// HODINOVÉ položky - dny/půldny se nezaokrouhlují (zaokrouhlení na
// minuty by u nich nedávalo smysl).
export function applyRounding(hours: number, roundingMinutes: AppSettings['roundingMinutes']): number {
  if (roundingMinutes === 0) return hours;
  const stepHours = roundingMinutes / 60;
  return Math.round(hours / stepHours) * stepHours;
}

// Předvyplnění "výchozích položek nového dne" (zadání) - jen při PRVNÍ
// návštěvě prázdného dne (viz day_initialized v lib/db.ts), nikdy znovu
// po úmyslném vymazání všech položek. Vrací true, pokud něco vložila -
// volající pak ví, že má znovu načíst getDayRecords().
export async function applyDayDefaultsIfNeeded(date: string, settings: AppSettings): Promise<boolean> {
  const existing = await getDayRecords(date);
  if (existing.length > 0) return false;
  if (await isDayInitialized(date)) return false;

  if (settings.defaultCategoryIds.length === 0) {
    await markDayInitialized(date);
    return false;
  }

  const categories = await listCategories();
  const byId = new Map(categories.map((c) => [c.id, c]));
  let inserted = false;
  for (const id of settings.defaultCategoryIds) {
    const category = byId.get(id);
    if (!category) continue; // smazaná/neexistující kategorie - přeskočit
    const quantity = category.rateType === 'hourly' ? defaultHourlyQuantity(settings) : 1;
    await addDayRecord(date, category.id, quantity); // addDayRecord označí den jako inicializovaný
    inserted = true;
  }
  if (!inserted) await markDayInitialized(date);
  return inserted;
}
