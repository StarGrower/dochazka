// České číslo účtu (Nastavení -> Moje údaje) a převod na IBAN - ČISTÉ
// funkce (testované v scripts/test-invoice.ts).
//
// Tvar: [předčíslí-]číslo/kód banky. Předčíslí max 6 číslic, číslo 2-10
// číslic, kód banky přesně 4 číslice. Předčíslí i číslo musí projít
// kontrolou mod 11 (vyhláška ČNB 169/2011): číslo doplněné nulami zleva
// na 10 míst, váhy 6,3,7,9,10,5,8,4,2,1 - zprava tedy 1,2,4,8,5,10,...
// IBAN podle ISO 13616: CZ + 2 kontrolní číslice (mod 97) + kód banky
// (4) + předčíslí (6) + číslo (10).

export interface CzAccount {
  prefix: string; // bez úvodních nul, '' = bez předčíslí
  number: string; // bez úvodních nul
  bankCode: string; // 4 číslice
}

const WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

export function mod11Ok(digits: string): boolean {
  const padded = digits.padStart(10, '0');
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(padded[i]) * WEIGHTS[i];
  return sum % 11 === 0;
}

// Rozpoznaný účet, nebo česká chybová hláška pro formulář.
export function parseCzAccount(input: string): { account: CzAccount } | { error: string } {
  const s = input.replace(/\s/g, '');
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
  if (!m) {
    if (!s.includes('/')) return { error: 'Chybí kód banky - tvar [předčíslí-]číslo/kód banky.' };
    if (!/\/\d{4}$/.test(s)) return { error: 'Kód banky má 4 číslice.' };
    return { error: 'Tvar [předčíslí-]číslo/kód banky, předčíslí max 6 číslic, číslo max 10.' };
  }
  const [, prefix = '', number, bankCode] = m;
  if (prefix && !mod11Ok(prefix)) return { error: 'Předčíslí neprošlo kontrolou (mod 11) - zkontroluj překlep.' };
  if (!mod11Ok(number)) return { error: 'Číslo účtu neprošlo kontrolou (mod 11) - zkontroluj překlep.' };
  if (Number(number) === 0) return { error: 'Číslo účtu nesmí být nulové.' };
  return { account: { prefix: prefix.replace(/^0+/, ''), number: number.replace(/^0+/, ''), bankCode } };
}

export function formatCzAccount(a: CzAccount): string {
  return `${a.prefix ? `${a.prefix}-` : ''}${a.number}/${a.bankCode}`;
}

// Zbytek po dělení 97 pro dlouhé číslo zapsané jako text (po kouscích,
// ať se nepřekročí přesnost čísel v JS).
function mod97(digits: string): number {
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(`${rest}${digits.slice(i, i + 7)}`) % 97;
  return rest;
}

// Písmena na čísla podle ISO 13616 (A = 10 … Z = 35).
const lettersToDigits = (s: string) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

export function czIban(a: CzAccount): string {
  const bban = `${a.bankCode}${a.prefix.padStart(6, '0')}${a.number.padStart(10, '0')}`;
  const check = 98 - mod97(lettersToDigits(`${bban}CZ00`));
  return `CZ${String(check).padStart(2, '0')}${bban}`;
}

export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  return mod97(lettersToDigits(`${s.slice(4)}${s.slice(0, 4)}`)) === 1;
}

// "CZ65 0800 0000 1920 0014 5399" - po čtveřicích, jak se tiskne.
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

// Účet z Nastavení -> IBAN, nebo null (prázdné / neplatné číslo).
export function ibanFromSetting(account: string): string | null {
  if (!account.trim()) return null;
  const r = parseCzAccount(account);
  return 'account' in r ? czIban(r.account) : null;
}
