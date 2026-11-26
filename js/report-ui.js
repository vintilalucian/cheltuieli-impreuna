import { formatMoney } from './insights.js';
import { baseEquivalentStatus, computeLedgerSummary } from './ledger.js';
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const modes = new Map();
export function detailAmount(tx, base, demo = false) {
  const original = formatMoney(tx.amount, tx.currency || base);
  if (!tx.currency || tx.currency === base) return original;
  return original + (!demo && baseEquivalentStatus(tx, base) === 'unverified'
    ? ` (fără echivalent ${base} verificat)` : ` (${formatMoney(tx.baseAmount, base)})`);
}
export function filteredSummary(rows, base, demo = false) {
  const ledger = computeLedgerSummary(rows, {baseCurrency: demo ? null : base});
  return `<div class="report-filter-total" role="status"><strong>${rows.length} înregistrări în filtru</strong><span>Cheltuieli nete: ${formatMoney(ledger.cheltuieliNete,base)}</span><span>Venituri: ${formatMoney(ledger.venituri,base)}</span><span>Balanță netă: ${formatMoney(ledger.balantaNeta,base)}</span>${ledger.exceptionRows.length ? `<small>${ledger.exceptionRows.length} fără echivalent ${esc(base)} verificat, excluse din totaluri.</small>` : ''}<small>Transferurile, investițiile și ajustările nu intră în cheltuieli sau venituri.</small></div>`;
}
export function reportView(key, chart, headers, rows, footer) {
  const table = modes.get(key) === 'table';
  return `<div class="report-view" data-report="${esc(key)}"><div class="report-toggle" role="group" aria-label="Afișare raport"><button type="button" data-report-mode="chart" aria-pressed="${!table}">Diagramă</button><button type="button" data-report-mode="table" aria-pressed="${table}">Tabel</button></div><div data-report-panel="chart" ${table?'hidden':''}>${chart}</div><div data-report-panel="table" ${table?'':'hidden'}><div class="report-table-wrap"><table class="report-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr ${r.attr||''}>${r.cells.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">${esc(footer[0])}</th><td colspan="${headers.length-1}">${esc(footer[1])}</td></tr></tfoot></table></div></div></div>`;
}
export function installReportToggle() {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-report-mode]');
    if (!button) return;
    const view = button.closest('[data-report]');
    const mode = button.dataset.reportMode;
    modes.set(view.dataset.report, mode);
    view.querySelectorAll('[data-report-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reportMode===mode)));
    view.querySelectorAll('[data-report-panel]').forEach(p=>p.hidden=p.dataset.reportPanel!==mode);
  });
}
