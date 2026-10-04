// Čisté pomůcky zálohy (etapa 4.1) - formát obnovovacího klíče a
// rotace záloh. Bez nativního modulu, ať jdou testovat
// (scripts/test-visit-engine.ts).

import { toIsoDate } from './format';

export const BACKUP_DAILY_PREFIX = 'Dochazka-zaloha-';
export const BACKUP_EXTENSION = '.dochazka';

// --- obnovovací klíč (QR + text) ---

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base64ToBytes(b64: string): number[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of clean) {
    buffer = (buffer << 6) | chars.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function bytesToBase64(bytes: number[]): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[n & 63] : '=';
  }
  return out;
}

// 32 bajtů -> 52 znaků base32 ve skupinách po 4 ("ABCD-EFGH-...").
export function formatRecoveryKey(keyBase64: string): string {
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of base64ToBytes(keyBase64)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)?.join('-') ?? out;
}

// Opak formatRecoveryKey; null = neplatný klíč.
export function parseRecoveryKey(text: string): string | null {
  const clean = text.toUpperCase().replace(/^DOCHAZKA-KEY:/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const c of clean) {
    buffer = (buffer << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes.length >= 32 ? bytesToBase64(bytes.slice(0, 32)) : null;
}


// --- rotace: 7 denních, 4 týdenní, 12 měsíčních ---

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

// Čistá funkce (testovaná) - které denní zálohy smazat.
export function backupsToDelete(fileNames: string[]): string[] {
  const dated = fileNames
    .map((name) => {
      const m = new RegExp(`^${BACKUP_DAILY_PREFIX}(\\d{4})-(\\d{2})-(\\d{2})\\${BACKUP_EXTENSION}$`).exec(name);
      return m ? { name, date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) } : null;
    })
    .filter((x): x is { name: string; date: Date } => x !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const keep = new Set<string>();
  const pick = (keyOf: (d: Date) => string, count: number) => {
    const seen = new Set<string>();
    for (const item of dated) {
      const key = keyOf(item.date);
      if (seen.has(key)) continue;
      if (seen.size >= count) break;
      seen.add(key);
      keep.add(item.name);
    }
  };
  pick((d) => toIsoDate(d), 7);
  pick(isoWeekKey, 4);
  pick((d) => `${d.getFullYear()}-${d.getMonth()}`, 12);
  return dated.filter((item) => !keep.has(item.name)).map((item) => item.name);
}

