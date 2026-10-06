// Servisní kniha stroje jako PDF (etapa 6) - karta stroje, plán se
// stavem a záznamy. Ceny servisu se nikde nevypisují (zadání).

import { formatNumberCs, toIsoDate } from './format';
import type { MachineCard, ServiceItem, ServiceRecord } from './machines';
import { COUNTER_LABEL } from './machines';
import type { ServiceStatus } from './machineCalc';
import { esc, LOGO_SVG } from './report';

const cz = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}` : '');

export function serviceBookHtml(
  m: MachineCard,
  counter: number | null,
  plan: { item: ServiceItem; status: ServiceStatus }[],
  records: ServiceRecord[]
): string {
  const unit = COUNTER_LABEL[m.counterUnit];
  const card = [
    m.manufacturer && `Výrobce: ${esc(m.manufacturer)}`,
    m.model && `Model: ${esc(m.model)}`,
    m.serialNumber && `Výrobní číslo: ${esc(m.serialNumber)}`,
    m.yearBuilt && `Rok výroby: ${m.yearBuilt}`,
    m.plate && `SPZ: ${esc(m.plate)}`,
    counter !== null && unit && `Stav počitadla: ≈ ${formatNumberCs(Math.round(counter))} ${unit}`,
  ]
    .filter(Boolean)
    .join('<br/>');
  const planRows = plan
    .map(({ item, status }) => {
      const interval = [item.intervalValue ? `${formatNumberCs(item.intervalValue)} ${unit}` : '', item.intervalDays ? `${item.intervalDays} dní` : ''].filter(Boolean).join(' / ');
      const state =
        status.level === 'overdue' ? 'PO TERMÍNU' : status.remainingValue !== null && unit ? `zbývá ${formatNumberCs(Math.round(status.remainingValue))} ${unit}` : status.remainingDays !== null ? `zbývá ${status.remainingDays} dní` : '';
      return `<tr><td>${esc(item.name)}</td><td>${interval}</td><td>${item.lastDoneDate ? cz(item.lastDoneDate) : ''}${item.lastDoneValue !== null ? ` · ${formatNumberCs(item.lastDoneValue)} ${unit}` : ''}</td><td>${state}</td></tr>`;
    })
    .join('');
  const recordRows = records
    .map(
      (r) =>
        `<tr><td>${cz(r.doneAt.slice(0, 10))}</td><td>${r.counterValue !== null ? `${formatNumberCs(r.counterValue)} ${unit}` : ''}</td><td>${esc(r.serviceItemName ?? '')}${r.workDone ? `<br/>${esc(r.workDone)}` : ''}${r.material ? `<br/><i>${esc(r.material)}</i>` : ''}</td><td>${esc(r.doneBy)}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body{font-family:-apple-system,Helvetica,sans-serif;color:#131311;margin:28px;font-size:11px}
  .head{background:#131311;border-radius:8px;padding:14px 16px}
  h1{font-size:20px;margin:16px 0 6px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b685f;margin:18px 0 4px}
  table{width:100%;border-collapse:collapse} th{text-align:left;font-size:10px;color:#6b685f;border-bottom:1px solid #ccc;padding:4px}
  td{padding:5px 4px;border-bottom:1px solid #eee;vertical-align:top} .foot{margin-top:24px;font-size:9px;color:#8b877c}
  </style></head><body>
  <div class="head">${LOGO_SVG}</div>
  <h1>Servisní kniha · ${esc(m.name)}</h1><p>${card}</p>
  <h2>Servisní plán</h2><table><tr><th>Položka</th><th>Interval</th><th>Naposledy</th><th>Stav</th></tr>${planRows}</table>
  <h2>Servisní záznamy</h2><table><tr><th>Datum</th><th>Stav</th><th>Co se dělalo / materiál</th><th>Kdo</th></tr>${recordRows}</table>
  <div class="foot">Vytvořeno v appce Docházka ${cz(toIsoDate(new Date()))}</div></body></html>`;
}
