// QR Platba (SPAYD 1.0, ČBA) - text platby a QR kód jako SVG pro PDF
// faktury. Generuje se OFFLINE knihovnou `qrcode` (je v projektu jako
// závislost react-native-qrcode-svg), korekce chyb M.
//
// SPD*1.0*ACC:{IBAN}*AM:{částka}*CC:CZK*X-VS:{VS}*DT:{RRRRMMDD}*MSG:{zpráva}
// - částka s tečkou a 2 desetinnými místy
// - hodnoty bez "*" (oddělovač polí), zpráva bez diakritiky, max 60 znaků

// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as {
  create: (text: string, opts: { errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' }) => { modules: { size: number; get: (row: number, col: number) => number | boolean } };
};

export interface SpaydInput {
  iban: string;
  amountKc: number;
  vs: string;
  dueDate: string; // YYYY-MM-DD
  message: string;
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const clean = (s: string) => s.replace(/\*/g, '').trim();

export function spaydMessage(text: string): string {
  return clean(stripDiacritics(text)).slice(0, 60);
}

export function buildSpayd(p: SpaydInput): string {
  const fields = [
    'SPD',
    '1.0',
    `ACC:${clean(p.iban.replace(/\s/g, '').toUpperCase())}`,
    `AM:${(Math.round(p.amountKc * 100) / 100).toFixed(2)}`,
    'CC:CZK',
  ];
  const vs = clean(p.vs);
  if (vs) fields.push(`X-VS:${vs}`);
  fields.push(`DT:${p.dueDate.replace(/-/g, '')}`);
  const msg = spaydMessage(p.message);
  if (msg) fields.push(`MSG:${msg}`);
  return fields.join('*');
}

// Čtvercové SVG (viewBox v modulech, bez okrajů - okraj dělá rámeček v
// PDF). Tmavé moduly jako jedna cesta, ostré hrany.
export function qrSvg(text: string, sizeCss: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sizeCss}" height="${sizeCss}" shape-rendering="crispEdges" role="img" aria-label="QR Platba"><path d="${d}" fill="#000"/></svg>`;
}
