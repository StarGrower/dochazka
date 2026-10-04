// Státní a ostatní svátky ČR (zákon č. 245/2000 Sb.) - oprava 2, D1.
// Kalendář je odlišuje od víkendu, Detail dne ukáže název, příplatky
// (C2) a "výchozí položky jen v pracovní dny" (B2) z nich vycházejí.
// Pohyblivé svátky (Velký pátek, Velikonoční pondělí) se počítají pro
// každý rok z data Velikonoc - žádná pevná tabulka, co by jednou došla.

const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': 'Den obnovy samostatného českého státu',
  '05-01': 'Svátek práce',
  '05-08': 'Den vítězství',
  '07-05': 'Den slovanských věrozvěstů Cyrila a Metoděje',
  '07-06': 'Den upálení mistra Jana Husa',
  '09-28': 'Den české státnosti',
  '10-28': 'Den vzniku samostatného československého státu',
  '11-17': 'Den boje za svobodu a demokracii',
  '12-24': 'Štědrý den',
  '12-25': '1. svátek vánoční',
  '12-26': '2. svátek vánoční',
};

// Velikonoční neděle (gregoriánský kalendář, anonymní algoritmus
// Meeus/Jones/Butcher) - vrací [měsíc 1-12, den].
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const movableCache = new Map<number, Record<string, string>>();

function movableHolidays(year: number): Record<string, string> {
  const cached = movableCache.get(year);
  if (cached) return cached;
  const [month, day] = easterSunday(year);
  const key = (offset: number) => {
    const d = new Date(year, month - 1, day + offset);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const result: Record<string, string> = { [key(1)]: 'Velikonoční pondělí' };
  // Velký pátek je státním svátkem od roku 2016.
  if (year >= 2016) result[key(-2)] = 'Velký pátek';
  movableCache.set(year, result);
  return result;
}

// Název svátku pro den "YYYY-MM-DD", nebo null.
export function holidayName(dateIso: string): string | null {
  const year = Number(dateIso.slice(0, 4));
  const monthDay = dateIso.slice(5, 10);
  return FIXED_HOLIDAYS[monthDay] ?? movableHolidays(year)[monthDay] ?? null;
}

export function isWeekend(dateIso: string): boolean {
  const [y, m, d] = dateIso.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

export function isWorkday(dateIso: string): boolean {
  return !isWeekend(dateIso) && holidayName(dateIso) === null;
}
