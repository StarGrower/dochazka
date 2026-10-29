// PDF faktury podle předlohy (E:\spoluprace\pro_claude_code\predloha-faktura.html):
// strana 1 = faktura (dodavatel, odběratel, data, položky, celkem, platební
// údaje a QR Platba), další strany = výpis prací po dnech (přepínač).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - stránky se skládají RUČNĚ (ne zalomením
// prohlížeče), aby šlo napsat "Strana X z Y" a opakovat záhlaví: každá
// strana je pevný blok 794 × 1122 px (A4 v rozměrech předlohy), řádky se
// rozdělí podle odhadu výšky (text v buňkách výpisu se nezalamuje). Celá
// strana se pak zmenší (CSS zoom) na šířku tisku - u expo-print 595 bodů
// = A4. Náhled má stejné stránky, jen je na displej zmenší WebView přes
// viewport (ostré písmo, jde přiblížit prsty).
//
// HTML je čistá funkce dat faktury (snímek v DB), takže PDF jde kdykoli
// vygenerovat znovu stejné. Koncept má přes každou stranu šikmý světle šedý
// nápis KONCEPT, zrušená faktura ZRUŠENO.
//
// Poznámky ke dnům (snímek workNotes) jdou ven jen s withNotes = true
// (přepínač před sdílením, výchozí vypnuto) - řádek pod posledním řádkem
// dne, menší šedá kurzíva.

import { formatIban } from './bankAccount';
import { czDate, czDateWithWeekday, daysLabel, formatDecimal, itemTotal, periodLabel, quantityTotalsLabel, summarizeWorkLog, workLogRate, type WorkLogGroup } from './invoiceCalc';
import { formatKc, formatQuantity } from './format';
import { buildSpayd, qrSvg } from './spayd';
import type { Invoice, InvoiceItem, InvoiceParty, WorkLogNote, WorkLogRow } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export interface InvoiceHtmlOptions {
  mode: 'print' | 'preview';
  fontsCss?: string; // @font-face s vloženými písmy Barlow (lib/invoiceFonts.ts)
  withNotes?: boolean; // poznámky ke dnům ve výpisu prací (výchozí vypnuto)
}

const PAGE_W = 794;
const PAGE_H = 1122;

// Odhady výšek (px předlohy) - s rezervou, ať se nic neuřízne.
const INNER = PAGE_H - 56 - 40; // bez horního a dolního okraje
const FOOT = 52;
const P1_HEAD = 400; // logo, pruh, dodavatel/odběratel, data
const CONT_HEAD = 104; // záhlaví další strany (nadpis + pruh)
const THEAD = 38;
const ITEMS_TAIL = 350; // celkem k úhradě, DPH, příloha, platební údaje + QR
const LOG_ROW = 41;
const NOTE_LINE = 17; // řádek poznámky (12 px kurzíva), ~105 znaků na řádek
const NOTE_PAD = 10;

type LogEntry = { kind: 'row'; row: WorkLogRow } | { kind: 'note'; note: WorkLogNote };

const noteHeight = (n: WorkLogNote) =>
  NOTE_PAD + NOTE_LINE * n.note.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 105)), 0);
const SAFETY = 16;

// Kč na faktuře: celé koruny bez haléřů ("7 175 Kč"), jinak s haléři.
export function kcInvoice(v: number): string {
  const cents = Math.round(Math.abs(v) * 100) % 100;
  if (cents === 0) return formatKc(v);
  return kc2(v);
}

// Vždy s haléři ("7 175,00 Kč") - platební údaje.
export function kc2(v: number): string {
  const abs = Math.round(Math.abs(v) * 100);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${v < 0 && abs !== 0 ? '−' : ''}${whole},${String(abs % 100).padStart(2, '0')}\u00A0Kč`;
}

// Adresa na řádky: podle konců řádků, jinak před PSČ ("Heřmaneč 21, 378 53 Strmilov").
export function addressLines(address: string): string[] {
  const t = address.trim();
  if (!t) return [];
  if (t.includes('\n')) return t.split('\n').map((l) => l.trim()).filter(Boolean);
  return t.split(/,\s*(?=\d{3}\s?\d{2}\b)/).map((l) => l.trim());
}

function partyHtml(p: InvoiceParty | null): string {
  if (!p || !p.name.trim()) return '<b>—</b>';
  const lines = [`<b>${esc(p.name)}</b>`, ...addressLines(p.address).map(esc)];
  if (p.ico) lines.push(`IČO: ${esc(p.ico)}`);
  if (p.dic) lines.push(`DIČ: ${esc(p.dic)}`);
  return lines.join('<br>');
}

const qtyText = (i: InvoiceItem) => `${formatDecimal(i.quantity)}${i.unit ? `\u00A0${esc(i.unit)}` : ''}`;

function itemHeight(i: InvoiceItem): number {
  const nameLines = Math.max(1, Math.ceil(i.name.length / 46));
  const descLines = i.description ? Math.ceil(i.description.length / 62) : 0;
  return 22 + nameLines * 20 + descLines * 16;
}

// Rozdělení řádků na strany: první strana má `first` px, další `next` px;
// na poslední musí zbýt `tail` px (součty), jinak přijde strana navíc.
export function paginate<T>(rows: T[], height: (r: T) => number, first: number, next: number, tail: number): T[][] {
  const pages: T[][] = [[]];
  let cap = first;
  let used = 0;
  for (const r of rows) {
    const h = height(r);
    if (used + h > cap && pages[pages.length - 1].length > 0) {
      pages.push([]);
      cap = next;
      used = 0;
    }
    pages[pages.length - 1].push(r);
    used += h;
  }
  if (used + tail > cap) pages.push([]);
  return pages;
}

const LOGO = `<svg viewBox="0 0 420 100" width="230" height="55" role="img" aria-label="Logo Docházka"><g transform="rotate(-12 30 50)"><rect x="12" y="20" width="10" height="60" rx="5" fill="#F2B705"/><path d="M23 22a28 28 0 0 1 0 56z" fill="#F2B705"/></g><circle cx="72" cy="52" r="25" fill="#fff" stroke="#fff" stroke-width="12"/><circle cx="72" cy="52" r="25" fill="none" stroke="#F2B705" stroke-width="10"/><path d="M72 39v13h10" fill="none" stroke="#131311" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><text x="106" y="81" textLength="296" lengthAdjust="spacingAndGlyphs" fill="#D3CFC4" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="86" letter-spacing="1">CHÁZKA</text></svg>`;

const MARK = `<svg viewBox="0 0 100 100" width="48" height="48" aria-hidden="true"><g transform="rotate(-12 30 48)"><rect x="14" y="18" width="9" height="60" rx="4.5" fill="#F2B705"/><path d="M24 21a27 27 0 0 1 0 54z" fill="#F2B705"/></g><circle cx="65" cy="62" r="20" fill="#fff" stroke="#fff" stroke-width="10"/><circle cx="65" cy="62" r="18" fill="none" stroke="#F2B705" stroke-width="8"/><path d="M65 53v9h7" fill="none" stroke="#131311" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// beforeNote: pod řádkem je poznámka dne -> bez čáry mezi nimi.
const logRow = (r: WorkLogRow, beforeNote: boolean) =>
  `<tr${beforeNote ? ' class="hasnote"' : ''}><td class="nw">${czDateWithWeekday(r.date)}</td><td class="ell">${esc(r.work)}</td><td class="ell">${esc(r.worker)}</td><td class="r">${esc(formatQuantity(r.quantity, r.unit))}</td><td class="r">${rateText(r)}</td><td class="r">${kcInvoice(r.amountKc)}</td></tr>`;

const rateText = (r: WorkLogRow) => {
  const rate = workLogRate(r);
  return r.unit === 'hour' ? kcInvoice(rate) : `${kcInvoice(rate)}/${r.unit === 'day' ? 'den' : 'km'}`;
};

function recapTable(groups: WorkLogGroup[]): string {
  return `<table><tbody>${groups.map((g) => `<tr><td class="ell">${esc(g.name)}</td><td class="r">${esc(quantityTotalsLabel(g.totals))}</td><td class="r">${kcInvoice(g.amountKc)}</td></tr>`).join('')}</tbody></table>`;
}

export function invoiceHtml(inv: Invoice, opts: InvoiceHtmlOptions): string {
  const no = esc(inv.number || '—');
  const total = inv.totalKc;
  const bank = inv.payment === 'transfer';
  const iban = bank ? inv.supplier.iban : null;
  const showLog = inv.withWorkLog && inv.workLog !== null && inv.orderId !== null;
  const log = showLog ? (inv.workLog as WorkLogRow[]) : [];
  const summary = summarizeWorkLog(log);
  const watermark = inv.status === 'draft' ? 'KONCEPT' : inv.status === 'cancelled' ? 'ZRUŠENO' : '';
  const wm = watermark ? `<div class="wm" aria-hidden="true"><span>${watermark}</span></div>` : '';
  const carried = inv.carries.reduce((s, c) => s + c.hours, 0);
  const carryNote = showLog && carried > 0
    ? `<div class="cnote">Navíc fakturováno ${esc(formatQuantity(carried, 'hour'))} dříve nevyfakturované práce (${inv.carries.map((c) => `z faktury č. ${esc(c.number)}`).join(', ')}).</div>`
    : '';

  const items = inv.items.filter((i) => i.name.trim() || i.quantity !== 0 || i.unitPriceKc !== 0);
  const itemPages = paginate(items, itemHeight, INNER - FOOT - P1_HEAD - THEAD - SAFETY, INNER - FOOT - CONT_HEAD - THEAD - SAFETY, ITEMS_TAIL);
  const recapRows = Math.max(summary.byWork.length, summary.byWorker.length);
  const logTail = 44 + 28 + 22 + recapRows * 32 + 8 + (carryNote ? 40 : 0);
  // Poznámka dne hned za jeho posledním řádkem (výpis je seřazený podle data).
  const notes = new Map((opts.withNotes ? (inv.workNotes ?? []) : []).map((n) => [n.date, n]));
  const entries: LogEntry[] = log.flatMap((row, i) => {
    const note = notes.get(row.date);
    return note && log[i + 1]?.date !== row.date ? [{ kind: 'row' as const, row }, { kind: 'note' as const, note }] : [{ kind: 'row' as const, row }];
  });
  const logPages = showLog ? paginate(entries, (e) => (e.kind === 'row' ? LOG_ROW : noteHeight(e.note)), INNER - FOOT - CONT_HEAD - THEAD - SAFETY, INNER - FOOT - CONT_HEAD - THEAD - SAFETY, logTail) : [];
  const pageCount = itemPages.length + logPages.length;
  const logFirstPage = itemPages.length + 1;
  const foot = (n: number, withNo: boolean) =>
    `<div class="foot"><span>${withNo ? `Faktura č. ${no} · ` : ''}Vytvořeno v appce Docházka</span><span>Strana ${n} z ${pageCount}</span></div>`;

  const pages: string[] = [];

  // --- faktura ---
  const itemsHead = '<thead><tr><th>Položka</th><th class="r">Množství</th><th class="r">Cena za jedn.</th><th class="r">Celkem</th></tr></thead>';
  const itemRows = (list: InvoiceItem[]) =>
    list
      .map(
        (i) =>
          `<tr><td>${esc(i.name || '—')}${i.description ? `<div class="sub">${esc(i.description)}</div>` : ''}</td><td class="r">${qtyText(i)}</td><td class="r">${kcInvoice(i.unitPriceKc)}</td><td class="r">${kcInvoice(itemTotal(i))}</td></tr>`
      )
      .join('');

  const attText = showLog
    ? `Příloha: výpis prací po dnech (${logPages.length === 1 ? `strana ${logFirstPage}` : `strany ${logFirstPage}–${pageCount}`}).`
    : '';
  const qr = (() => {
    if (!bank) return '';
    if (iban) {
      const spayd = buildSpayd({ iban, amountKc: total, vs: inv.number, dueDate: inv.dueDate, message: `Faktura ${inv.number}` });
      return `<div class="qr"><div class="box">${qrSvg(spayd, '100%')}</div><div class="cap">QR Platba</div></div>`;
    }
    // Bez účtu se QR nekreslí; v náhledu upozornění, v PDF nic.
    return opts.mode === 'preview' ? '<div class="qr"><div class="box miss">Doplň číslo účtu v Nastavení</div></div>' : '';
  })();
  const payRows = [
    iban ? `<dt>Číslo účtu</dt><dd>${esc(inv.supplier.bankAccount)}</dd><dt>IBAN</dt><dd>${esc(formatIban(iban))}</dd>` : '',
    `<dt>Forma úhrady</dt><dd>${bank ? 'Převodem' : 'Hotově'}</dd>`,
    bank ? `<dt>Variabilní symbol</dt><dd>${no}</dd>` : '',
    `<dt>Částka</dt><dd>${kc2(total)}</dd>`,
    `<dt>Splatnost</dt><dd>${czDate(inv.dueDate)}</dd>`,
  ].join('');
  const tail = `
  <div class="sum"><div><span>Celkem k úhradě</span><b>${kcInvoice(total)}</b></div></div>
  ${inv.supplier.vatPayer ? '' : '<div class="vat">Nejsem plátce DPH.</div>'}
  ${attText ? `<div class="att">${attText}</div>` : ''}
  <div class="pay">
    <div class="payinfo"><div class="lbl">Platební údaje</div><dl>${payRows}</dl></div>
    ${qr}
  </div>`;

  itemPages.forEach((chunk, idx) => {
    const last = idx === itemPages.length - 1;
    const head =
      idx === 0
        ? `<div class="top">${LOGO}<div class="ttl"><h1>Faktura</h1><div class="no">č. ${no}</div></div></div>
  <div class="bar"></div>
  <div class="parties">
    <div class="party"><div class="lbl">Dodavatel</div>${partyHtml(inv.supplier)}${inv.supplier.registryText ? `<div class="small">${esc(inv.supplier.registryText)}</div>` : ''}</div>
    <div class="party"><div class="lbl">Odběratel</div>${partyHtml(inv.client)}</div>
  </div>
  <div class="dates">
    <div><span>Datum vystavení</span><b>${czDate(inv.issueDate)}</b></div>
    <div><span>Datum splatnosti</span><b>${czDate(inv.dueDate)}</b></div>
    <div><span>Forma úhrady</span><b>${bank ? 'Převodem' : 'Hotově'}</b></div>
    <div><span>Variabilní symbol</span><b>${no}</b></div>
  </div>`
        : `<div class="p2h"><div><h2>Faktura č. ${no}</h2><p>Pokračování položek</p></div>${MARK}</div><div class="bar bar2"></div>`;
    const table = chunk.length > 0 ? `<table>${itemsHead}<tbody>${itemRows(chunk)}</tbody></table>` : '';
    pages.push(`<section class="page">${wm}${head}${table}${last ? tail : ''}${foot(idx + 1, idx > 0)}</section>`);
  });

  // --- výpis prací ---
  if (showLog) {
    const sub = [`Příloha k faktuře č. ${no}`, inv.orderName ? `Zakázka ${esc(inv.orderName)}` : '', esc(periodLabel(summary.from, summary.to))].filter(Boolean).join(' · ');
    const logHead =
      '<thead><tr><th>Datum</th><th>Druh práce</th><th>Pracovník</th><th class="r">Hodiny</th><th class="r">Sazba</th><th class="r">Částka</th></tr></thead>';
    logPages.forEach((chunk, idx) => {
      const last = idx === logPages.length - 1;
      const rows = chunk
        .map((e, i) =>
          e.kind === 'note'
            ? `<tr class="dnote"><td colspan="6">${esc(e.note.note).replace(/\n/g, '<br>')}</td></tr>`
            : logRow(e.row, chunk[i + 1]?.kind === 'note')
        )
        .join('');
      const tfoot = last
        ? `<tfoot><tr><td>Celkem</td><td>${daysLabel(summary.days)}</td><td></td><td class="r">${esc(quantityTotalsLabel(summary.totals))}</td><td></td><td class="r">${kcInvoice(summary.amountKc)}</td></tr></tfoot>`
        : '';
      const table = chunk.length > 0 || last ? `<table class="log">${logHead}<tbody>${rows}</tbody>${tfoot}</table>` : '';
      const recap = last
        ? `<div class="recap"><div><div class="lbl">Souhrn podle druhu práce</div>${recapTable(summary.byWork)}</div><div><div class="lbl">Souhrn podle pracovníků</div>${recapTable(summary.byWorker)}</div></div>`
        : '';
      pages.push(
        `<section class="page">${wm}<div class="p2h"><div><h2>Výpis prací${idx > 0 ? ' (pokračování)' : ''}</h2><p>${sub}</p></div>${MARK}</div><div class="bar bar2"></div>${table}${last ? carryNote : ''}${recap}${foot(logFirstPage + idx, true)}</section>`
      );
    });
  }

  const preview = opts.mode === 'preview';
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="${preview ? `width=${PAGE_W + 16}` : 'width=device-width, initial-scale=1'}">
<title>Faktura ${no}</title>
<style>
${opts.fontsCss ?? ''}
:root{--ink:#1A1A18;--muted:#6B675D;--line:#E4E1D8;--accent:#F2B705}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${preview ? '#0B0B0A' : '#fff'};font-family:'Barlow',-apple-system,Helvetica,sans-serif;color:var(--ink);-webkit-text-size-adjust:100%}
.page{width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;position:relative;background:#fff;padding:56px 56px 40px;display:flex;flex-direction:column;${preview ? 'margin:8px auto;' : 'zoom:0.7493;break-after:page;page-break-after:always;'}}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:5;overflow:hidden}
.wm span{transform:rotate(-35deg);font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:190px;letter-spacing:.06em;color:rgba(120,116,104,.16);white-space:nowrap}
.cnote{font-size:13px;color:var(--muted);margin-top:10px}
.page:last-child{break-after:auto;page-break-after:auto}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.ttl{text-align:right}
.ttl h1{margin:0;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:44px;letter-spacing:.02em;text-transform:uppercase;line-height:1}
.ttl .no{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:24px;margin-top:4px}
.bar{height:6px;background:var(--accent);margin:24px 0 28px;flex-shrink:0}
.bar2{margin:18px 0 20px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.lbl{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.party{font-size:14px;line-height:1.5}
.party b{font-size:17px}
.small{font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.4}
.dates{display:grid;grid-template-columns:repeat(4,1fr);margin:28px 0;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.dates div{padding:10px 14px;border-left:1px solid var(--line)}
.dates div:first-child{border-left:0}
.dates span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.dates b{font-size:15px}
table{width:100%;border-collapse:collapse;font-size:14px}
table.log{table-layout:fixed}
.log th:nth-child(1){width:128px}.log th:nth-child(3){width:120px}.log th:nth-child(4){width:84px}.log th:nth-child(5){width:96px}.log th:nth-child(6){width:96px}
th{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:8px 6px;border-bottom:2px solid var(--ink)}
td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:top}
tfoot td{font-weight:700;border-bottom:0;border-top:2px solid var(--ink)}
.r{text-align:right;white-space:nowrap}
.nw{white-space:nowrap}
.ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{font-size:12px;color:var(--muted);margin-top:2px}
.sum{display:flex;justify-content:flex-end;margin-top:14px}
.sum div{min-width:300px;display:flex;justify-content:space-between;align-items:baseline;gap:16px;background:#FFF6D6;border-left:6px solid var(--accent);padding:12px 16px}
.sum span{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.04em}
.sum b{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:32px;white-space:nowrap}
.vat{font-size:13px;margin-top:10px;text-align:right;color:var(--muted)}
.att{font-size:13px;margin-top:4px;text-align:right;color:var(--muted)}
.pay{margin-top:auto;padding-top:32px;display:flex;gap:28px;align-items:flex-end;justify-content:space-between}
.payinfo{flex:1;border:1px solid var(--line);border-radius:6px;padding:16px 18px}
.payinfo dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:0;font-size:14px}
.payinfo dt{color:var(--muted)}
.payinfo dd{margin:0;font-weight:600}
.qr{width:150px;text-align:center;flex-shrink:0}
.qr .box{width:150px;height:150px;border:1px solid var(--line);padding:8px;display:flex;align-items:center;justify-content:center}
.qr .box svg{width:100%;height:100%;display:block}
.qr .box.miss{border:2px dashed #E5484D;color:#B3261E;font-size:14px;font-weight:600;line-height:1.3}
.qr .cap{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;margin-top:6px}
.foot{margin-top:auto;padding-top:10px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11px;color:#A39F93}
.pay+.foot{margin-top:24px}
.p2h{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.p2h h2{margin:0;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:32px;text-transform:uppercase;line-height:1}
.p2h p{margin:6px 0 0;font-size:14px;color:var(--muted)}
.recap{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
.recap table{table-layout:auto}
.recap table td{padding:7px 6px}
.log tr.hasnote td{border-bottom:0;padding-bottom:4px}
.log tr.dnote td{font-size:12px;line-height:17px;font-style:italic;color:var(--muted);padding:0 6px 8px;white-space:normal}
.recap .ell{max-width:150px}
</style></head><body>
${pages.join('\n')}
${preview ? '' : `<script>(function(){var w=document.documentElement.clientWidth||window.innerWidth;if(!w)return;var z=Math.min(1,w/${PAGE_W});var p=document.querySelectorAll('.page');for(var i=0;i<p.length;i++)p[i].style.zoom=z;})();</script>`}
</body></html>`;
}

export function invoicePageCount(inv: Invoice, withNotes = false): number {
  return (invoiceHtml(inv, { mode: 'print', withNotes }).match(/<section class="page">/g) ?? []).length;
}
