import { store } from './store.js';

// "De plătit manual": read-only agenda built from the private Facturi tab (store.state.bills).
// It is a reminder view only. It never posts to the ledger, never marks anything paid and has no payment state.
// Row convention (private Sheet data, nothing hardcoded here):
//   category "automat" -> debited automatically, shown only as a review reminder; anything else -> manual.
//   amount <= 1 (0 = unknown) is a placeholder; other amounts are shown as 'reper' (reference, not a verified debt), shown as "sumă de confirmat".
//   note: multiline text; every https://tasks.google.com/... link in it becomes a "Deschide în Tasks" button.
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TZ = 'Europe/Brussels';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
const dayNum = s => Math.round(Date.parse(s + 'T12:00:00Z') / 86400000);
const fmtDate = s => new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(s + 'T12:00:00Z'));
const money = (n, c) => { try { return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: c || 'EUR' }).format(Number(n) || 0); } catch { return `${n} ${c || ''}`; } };
const FREQ = { 'o-data': 'o dată', saptamanal: 'săptămânal', lunar: 'lunar', '2-luni': 'la 2 luni', trimestrial: 'trimestrial', semestrial: 'semestrial', anual: 'anual' };
const TASKS_RE = /https:\/\/tasks\.google\.com\/[^\s)]+/g;

function rel(due, t) {
  const d = dayNum(due) - dayNum(t);
  if (d < 0) return { text: `întârziat ${-d} ${-d === 1 ? 'zi' : 'zile'}`, cls: 'late' };
  if (d === 0) return { text: 'azi', cls: 'soon' };
  if (d === 1) return { text: 'mâine', cls: 'soon' };
  return { text: `în ${d} zile`, cls: d <= 7 ? 'soon' : '' };
}

function row(b, t) {
  const links = [...new Set(String(b.note || '').match(TASKS_RE) || [])];
  const text = String(b.note || '').replace(TASKS_RE, '').replace(/[ \t]*[|·-]?[ \t]*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  const r = rel(b.due, t);
  const unknown = !(Number(b.amount) > 1);
  const amount = unknown ? '<span class="mb-amt mb-unk">sumă de confirmat</span>' : `<span class="mb-amt">${esc(money(b.amount, b.currency))} <i>reper</i></span>`;
  const meta = [FREQ[b.frequency] || b.frequency, b.merchant, b.account].filter(Boolean).map(esc).join(' · ');
  return `<li class="mb-row">
    <div class="mb-top"><span class="mb-name">${esc(b.name)}</span>${amount}</div>
    <div class="mb-mid"><span class="mb-due ${r.cls}">${esc(fmtDate(b.due))} · ${esc(r.text)}</span><span class="mb-meta">${meta}</span></div>
    ${text ? `<div class="mb-note">${esc(text)}</div>` : ''}
    ${links.map((l, i) => `<a class="mb-link" href="${esc(l)}" target="_blank" rel="noopener">Deschide în Tasks${links.length > 1 ? ' ' + (i + 1) : ''} ↗</a>`).join('')}
  </li>`;
}

function build() {
  const t = today();
  const all = (store.state.bills || []).filter(b => b && b.due && b.status !== 'oprita');
  const manual = all.filter(b => String(b.category || '').toLowerCase() !== 'automat');
  const auto = all.filter(b => String(b.category || '').toLowerCase() === 'automat');
  const sorted = a => a.slice().sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
  const groups = [];
  const m = sorted(manual);
  const toPay = m.filter(b => dayNum(b.due) - dayNum(t) <= 31);
  const later = m.filter(b => dayNum(b.due) - dayNum(t) > 31);
  const sum = {};
  toPay.filter(b => Number(b.amount) > 1).forEach(b => { sum[b.currency] = (sum[b.currency] || 0) + Number(b.amount); });
  const sumTxt = Object.entries(sum).map(([c, v]) => money(v, c)).join(' + ');
  const head = `<div class="card-header"><div><h2 class="card-title">🧾 De plătit manual</h2>
    <div class="card-sub">Doar reminder, fără plată și fără înregistrare automată. Nu arată „plătit”: după ce plătești, bifezi sau ștergi în Tasks și introduci cheltuiala normal.</div></div></div>`;
  let html = `<section class="card mb-card" data-mb="1">${head}`;
  html += toPay.length
    ? `<div class="mb-sum">Următoarele 30 de zile: <b>${toPay.length}</b> ${toPay.length === 1 ? 'factură' : 'facturi'}${sumTxt ? ` · sume de reper ${esc(sumTxt)}` : ''}</div><ul class="mb-list">${toPay.map(b => row(b, t)).join('')}</ul>`
    : '<div class="card-sub">Nicio factură manuală în următoarele 30 de zile.</div>';
  if (later.length) html += `<details class="mb-more"><summary>Mai târziu (${later.length})</summary><ul class="mb-list">${later.map(b => row(b, t)).join('')}</ul></details>`;
  if (auto.length) html += `<details class="mb-more"><summary>Debit automat, doar reminder de verificare (${auto.length})</summary><ul class="mb-list">${sorted(auto).map(b => row(b, t)).join('')}</ul></details>`;
  const sheet = store.state.connection && store.state.connection.sheetUrl;
  html += `<div class="mb-foot">Datele vin din fila privată „Facturi” din Sheet${sheet ? ` · <a href="${esc(sheet)}" target="_blank" rel="noopener">Deschide Sheet-ul</a>` : ''}. Scadențele se schimbă acolo.</div></section>`;
  if (!all.length) html = `<section class="card mb-card" data-mb="1">${head}<div class="card-sub">Nu există încă facturi în fila „Facturi”.</div></section>`;
  return { html, sig: JSON.stringify([t, all.map(b => [b.id, b.name, b.amount, b.currency, b.due, b.note, b.category, b.status, b.frequency])]) , dueSoon: toPay.filter(b => dayNum(b.due) - dayNum(t) <= 7).length, late: toPay.filter(b => b.due < t).length };
}

export function installManualBills() {
  const root = document.querySelector('#view-root');
  if (!root) return;
  const apply = () => {
    const view = document.querySelector('.nav-item.active, .side-btn.active')?.dataset.view;
    const ex = root.querySelector('[data-mb]');
    const exb = root.querySelector('[data-mb-banner]');
    if (view !== 'recurrences' && view !== 'dashboard') { ex?.remove(); exb?.remove(); return; }
    const b = build();
    if (view === 'dashboard') {
      ex?.remove();
      const n = b.dueSoon;
      const key = b.sig + '|d';
      if (!(store.state.bills || []).length) { exb?.remove(); return; }
      if (exb && exb.dataset.sig === key) return;
      exb?.remove();
      const btn = document.createElement('button');
      btn.className = 'mb-banner'; btn.dataset.mbBanner = '1'; btn.dataset.sig = key; btn.dataset.view = 'recurrences';
      btn.textContent = `🧾 De plătit manual: ${n} ${n === 1 ? 'scadență' : 'scadențe'} în 7 zile${b.late ? `, ${b.late} întârziate` : ''}`;
      root.prepend(btn);
      return;
    }
    exb?.remove();
    if (ex && ex.dataset.sig === b.sig) return;
    ex?.remove();
    const tpl = document.createElement('div');
    tpl.innerHTML = b.html;
    const el = tpl.firstElementChild;
    el.dataset.sig = b.sig;
    if (ex) { const open = [...ex.querySelectorAll('details')].map(d => d.open); [...el.querySelectorAll('details')].forEach((d, i) => { d.open = !!open[i]; }); }
    root.prepend(el);
  };
  new MutationObserver(apply).observe(root, { childList: true });
  setInterval(apply, 1500);
  apply();
}
installManualBills();
