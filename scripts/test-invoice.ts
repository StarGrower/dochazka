// Testy fakturace: číslo účtu (mod 11), IBAN (ISO 13616), QR Platba
// (SPAYD 1.0). Spuštění: npm run test:invoice
//
// Číslo účtu 19-2000145399/0800 je ukázkové ze specifikace QR Platby.

import assert from 'node:assert/strict';

import { czIban, formatCzAccount, formatIban, ibanFromSetting, ibanValid, mod11Ok, parseCzAccount } from '../lib/bankAccount';
import { buildSpayd, qrSvg, spaydMessage } from '../lib/spayd';

const parse = (s: string) => {
  const r = parseCzAccount(s);
  if ('error' in r) throw new Error(`${s}: ${r.error}`);
  return r.account;
};
const parseError = (s: string) => {
  const r = parseCzAccount(s);
  assert.ok('error' in r, `${s} měl být neplatný`);
  return r.error;
};

const tests: Array<[string, () => void]> = [
  ['mod 11: váhy 6,3,7,9,10,5,8,4,2,1 (číslo doplněné zleva na 10 míst)', () => {
    assert.ok(mod11Ok('2000145399'));
    assert.ok(mod11Ok('19'));
    assert.ok(mod11Ok('123'));
    assert.ok(!mod11Ok('2000145398'));
    assert.ok(!mod11Ok('18'));
  }],
  ['účet s předčíslím -> IBAN ze specifikace', () => {
    const a = parse('19-2000145399/0800');
    assert.deepEqual(a, { prefix: '19', number: '2000145399', bankCode: '0800' });
    assert.equal(czIban(a), 'CZ6508000000192000145399');
    assert.equal(formatIban(czIban(a)), 'CZ65 0800 0000 1920 0014 5399');
  }],
  ['účet bez předčíslí, krátké číslo, mezery a úvodní nuly', () => {
    assert.equal(czIban(parse('2000145399/0800')), 'CZ7908000000002000145399');
    assert.equal(czIban(parse('123/0100')), 'CZ7801000000000000000123');
    assert.equal(formatCzAccount(parse(' 000019 - 2000145399 / 0800 ')), '19-2000145399/0800');
  }],
  ['neplatné účty', () => {
    assert.match(parseError('19-2000145398/0800'), /Číslo účtu neprošlo/);
    assert.match(parseError('18-2000145399/0800'), /Předčíslí neprošlo/);
    assert.match(parseError('2000145399'), /kód banky/);
    assert.match(parseError('2000145399/080'), /4 číslice/);
    assert.match(parseError('2000145399/08000'), /4 číslice/);
    parseError('1234567-2000145399/0800'); // předčíslí víc než 6 číslic
    parseError('12345678901/0800'); // číslo víc než 10 číslic
    parseError('abc/0800');
  }],
  ['IBAN: kontrola mod 97', () => {
    assert.ok(ibanValid('CZ6508000000192000145399'));
    assert.ok(ibanValid('CZ65 0800 0000 1920 0014 5399'));
    assert.ok(!ibanValid('CZ6608000000192000145399'));
    for (const s of ['2000145399/0800', '123/0100', '19-2000145399/0800']) assert.ok(ibanValid(czIban(parse(s))), s);
  }],
  ['IBAN z nastavení: prázdné / neplatné -> null', () => {
    assert.equal(ibanFromSetting(''), null);
    assert.equal(ibanFromSetting('19-2000145398/0800'), null);
    assert.equal(ibanFromSetting('19-2000145399/0800'), 'CZ6508000000192000145399');
  }],
  ['SPAYD 1.0: přesný tvar', () => {
    const s = buildSpayd({ iban: 'CZ6508000000192000145399', amountKc: 7175, vs: '2026001', dueDate: '2026-11-11', message: 'Faktura 2026001' });
    assert.equal(s, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:7175.00*CC:CZK*X-VS:2026001*DT:20261111*MSG:Faktura 2026001');
  }],
  ['SPAYD: částka na 2 místa s tečkou, zpráva bez diakritiky a hvězdiček, max 60 znaků', () => {
    const s = buildSpayd({ iban: 'CZ65 0800 0000 1920 0014 5399', amountKc: 1234.5, vs: '12*3', dueDate: '2026-01-02', message: 'Příliš žluťoučký kůň * úpěl ďábelské ódy a ještě něco navíc dlouhého' });
    assert.match(s, /\*AM:1234\.50\*/);
    assert.match(s, /\*X-VS:123\*/);
    const msg = s.split('*MSG:')[1];
    assert.equal(msg, spaydMessage('Příliš žluťoučký kůň * úpěl ďábelské ódy a ještě něco navíc dlouhého'));
    assert.ok(msg.length <= 60);
    assert.ok(!/[^\x20-\x7e]/.test(msg), msg);
    assert.ok(msg.startsWith('Prilis zlutoucky kun'));
    assert.equal(buildSpayd({ iban: 'CZ6508000000192000145399', amountKc: 0.005, vs: '1', dueDate: '2026-01-02', message: '' }).split('*')[3], 'AM:0.01');
  }],
  ['QR kód: offline SVG, korekce M', () => {
    const svg = qrSvg('SPD*1.0*ACC:CZ6508000000192000145399*AM:7175.00*CC:CZK', '3cm');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
    assert.match(svg, /width="3cm"/);
    assert.ok(svg.includes('M0 0h1v1h-1z'), 'levý horní roh vyhledávacího vzoru');
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`OK    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} OK`);
process.exit(failed ? 1 : 0);
