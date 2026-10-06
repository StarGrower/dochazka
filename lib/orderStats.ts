// Přehled zakázky (etapa 5) - ČISTÉ výpočty (testované): k fakturaci po
// strojích/pracích a km, náklady (palivo, výdaje), výsledek a Kč/h, lidé,
// dny, rozpočet. Nic se neukládá - počítá se vždy ze zápisů.
//
// - položky práce: sazba a příplatek uložené v okamžiku zápisu
// - přejezdy na místa zakázky: km × sazba Kč/km vozidla (jen přejezdy,
//   jejichž km ještě nejsou v Práci a strojích - jinak by se počítaly 2×)
// - pevná cena: k fakturaci = pevná cena (rozpis jen pro informaci)
// - servis se do nákladů NEPOČÍTÁ (zadání)

import type { ExpenseCategory, OrderPriceMode, RateUnit } from './types';
import { formatQuantity } from './format';

export interface StatsRecord {
  categoryId: number;
  categoryName: string;
  color: string;
  unit: RateUnit;
  quantity: number;
  rateKc: number;
  surchargePct: number;
  date: string;
  workerId: number; // kdo pracoval (people.id)
  invoiceBatchId: number | null;
}

export interface StatsTrip {
  km: number;
  rateKc: number; // Kč/km vozidla
  date: string;
  invoiceBatchId: number | null;
}

export interface StatsExpense {
  amountKc: number;
  category: ExpenseCategory;
  date: string;
}

export interface OrderStatsInput {
  priceMode: OrderPriceMode;
  fixedPriceKc: number | null;
  budgetKc: number | null;
  records: StatsRecord[];
  trips: StatsTrip[];
  expenses: StatsExpense[];
  fuelCostKc: number;
  fuelLiters: number;
  invoicedKc: number; // součet vystavených podkladů
  people: Map<number, string>;
}

export interface OrderStats {
  lines: { categoryId: number; name: string; color: string; quantityLabel: string; amountKc: number }[];
  km: number;
  kmAmountKc: number;
  ratesTotalKc: number; // podle ceníku (práce + km)
  billableKc: number; // k fakturaci celkem (pevná cena / podle ceníku)
  unbilledKc: number; // ještě nevyfakturováno
  hours: number;
  expensesKc: number;
  expensesByCategory: { category: ExpenseCategory; amountKc: number }[];
  fuelCostKc: number;
  fuelLiters: number;
  resultKc: number;
  kcPerHour: number | null;
  people: { name: string; hours: number }[];
  days: { date: string; amountKc: number }[];
  budgetPct: number | null; // ratesTotal / rozpočet
}

const amount = (r: Pick<StatsRecord, 'quantity' | 'rateKc' | 'surchargePct'>) => r.quantity * r.rateKc * (1 + r.surchargePct / 100);

export function computeOrderStats(input: OrderStatsInput): OrderStats {
  const byCategory = new Map<number, { name: string; color: string; hour: number; day: number; km: number; amountKc: number }>();
  const byDay = new Map<string, number>();
  const byPerson = new Map<number, number>();
  let hours = 0;
  let unbilledRates = 0;

  for (const r of input.records) {
    const a = amount(r);
    const entry = byCategory.get(r.categoryId) ?? { name: r.categoryName, color: r.color, hour: 0, day: 0, km: 0, amountKc: 0 };
    entry[r.unit] += r.quantity;
    entry.amountKc += a;
    byCategory.set(r.categoryId, entry);
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + a);
    if (r.unit === 'hour') {
      hours += r.quantity;
      byPerson.set(r.workerId, (byPerson.get(r.workerId) ?? 0) + r.quantity);
    }
    if (r.invoiceBatchId === null) unbilledRates += a;
  }

  let km = 0;
  let kmAmountKc = 0;
  for (const t of input.trips) {
    const a = t.km * t.rateKc;
    km += t.km;
    kmAmountKc += a;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + a);
    if (t.invoiceBatchId === null) unbilledRates += a;
  }

  const lines = [...byCategory.entries()]
    .map(([categoryId, e]) => ({
      categoryId,
      name: e.name,
      color: e.color,
      quantityLabel: [e.hour > 0 ? formatQuantity(e.hour, 'hour') : null, e.day > 0 ? formatQuantity(e.day, 'day') : null, e.km > 0 ? formatQuantity(e.km, 'km') : null]
        .filter(Boolean)
        .join(' + '),
      amountKc: e.amountKc,
    }))
    .sort((a, b) => b.amountKc - a.amountKc);

  const ratesTotalKc = lines.reduce((s, l) => s + l.amountKc, 0) + kmAmountKc;
  const fixed = input.priceMode === 'fixed' && input.fixedPriceKc !== null;
  const billableKc = fixed ? (input.fixedPriceKc as number) : ratesTotalKc;
  const unbilledKc = fixed ? Math.max(0, billableKc - input.invoicedKc) : unbilledRates;

  const expenseMap = new Map<ExpenseCategory, number>();
  for (const e of input.expenses) expenseMap.set(e.category, (expenseMap.get(e.category) ?? 0) + e.amountKc);
  const expensesKc = input.expenses.reduce((s, e) => s + e.amountKc, 0);
  const resultKc = billableKc - expensesKc - input.fuelCostKc;

  const budget = input.budgetKc;
  return {
    lines,
    km,
    kmAmountKc,
    ratesTotalKc,
    billableKc,
    unbilledKc,
    hours,
    expensesKc,
    expensesByCategory: [...expenseMap.entries()].map(([category, amountKc]) => ({ category, amountKc })),
    fuelCostKc: input.fuelCostKc,
    fuelLiters: input.fuelLiters,
    resultKc,
    kcPerHour: hours > 0 ? resultKc / hours : null,
    people: [...byPerson.entries()].map(([id, h]) => ({ name: input.people.get(id) ?? 'Neznámý', hours: h })).sort((a, b) => b.hours - a.hours),
    days: [...byDay.entries()].map(([date, amountKc]) => ({ date, amountKc })).sort((a, b) => b.date.localeCompare(a.date)),
    budgetPct: budget && budget > 0 ? (ratesTotalKc / budget) * 100 : null,
  };
}

// Blížení k rozpočtu (zadání: "upozornění při blížení").
export const BUDGET_WARN_PCT = 90;
