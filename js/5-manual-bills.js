import { store } from './store.js';

// "De plătit manual": read-only agenda built from the private Facturi tab (store.state.bills).
// It is a reminder view only. It never posts to the ledger, never marks anything paid and has no payment state.
// Row convention (private Sheet data, nothing hardcoded here):
//   category "automat" -> bank debits automatically (AUTO); "manual" -> user pays (MANUAL); anything else -> METODĂ NECONFIRMATĂ (never assumed AUTO).
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

// Machine metadata: last line of note is `agenda-v1:{json}` (never shown to the user), e.g. agenda-v1:{"bankMethod":"auto|manual|unknown","amountKind":"reference|unknown","taskUrls":[...],"ruleId":"<recurrence rule id>","agenda":false}
// bankMethod = how it is really paid (bank debits = auto, user pays = manual). Missing or unknown stays unknown, never guessed.
// ruleId links the row to a recurrence-rule card; agenda:false keeps a metadata-only row out of the agenda list.
function meta(b) {
  const lines = String(b.note || '').split('\n'); let m = {};
  for (let i = lines.length - 1; i >= 0; i--) { const l = lines[i].trim(); if (!l) continue; const j = l.replace(/^agenda-v1:\s*/, ''); if (j[0] === '{') { try { m = JSON.parse(j); lines.splice(i, 1); } catch { /* not metadata */ } } break; }
  return { m: m && typeof m === 'object' ? m : {}, note: lines.join('\n') };
}
const norm = v => { v = String(v || '').toLowerCase(); return v === 'auto' || v === 'automat' ? 'auto' : v === 'manual' ? 'manual' : 'unknown'; };
const kind = b => { const { m } = meta(b); return m.bankMethod ? norm(m.bankMethod) : norm(b.category); };
export function ruleMethodLabel(ruleId) {
  const b = (store.state.bills || []).find(x => x && meta(x).m.ruleId === ruleId);
  const k = b ? kind(b) : 'unknown';
  return `<span class="mb-kind mb-${k}" title="${esc(KIND[k][1])}">${KIND[k][0]}</span>`;
}
var KIND = { auto: ['AUTO', 'banca debitează automat, doar verifici'], manual: ['MANUAL', 'tu plătești'], unknown: ['METODĂ NECONFIRMATĂ', 'nu se știe încă cum se plătește'] };

function row(b, t) {
  const mm = meta(b), noteText = mm.note;
  const links = [...new Set([...(Array.isArray(mm.m.taskUrls) ? mm.m.taskUrls.filter(u => /^https:\/\/tasks\.google\.com\//.test(String(u))) : []), ...(noteText.match(TASKS_RE) || [])])];
  const text = noteText.replace(TASKS_RE, '').replace(/[ \t]*[|·-]?[ \t]*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  const r = rel(b.due, t);
  const unknown = mm.m.amountKind === 'unknown' || !(Number(b.amount) > 1);
  const amount = unknown ? '<span class="mb-amt mb-unk">sumă de confirmat</span>' : `<span class="mb-amt">${esc(money(b.amount, b.currency))} <i>reper</i></span>`;
  const metaTxt = [FREQ[b.frequency] || b.frequency, b.merchant, b.account].filter(Boolean).map(esc).join(' · ');
  const k = kind(b);
  return `<li class="mb-row">
    <div class="mb-top"><span class="mb-name">${esc(b.name)}</span>${amount}</div>
    <div class="mb-mid"><span class="mb-kind mb-${k}" title="${esc(KIND[k][1])}">${KIND[k][0]}</span><span class="mb-due ${r.cls}">${esc(r.text)}</span><span class="mb-meta">${metaTxt}</span></div>
    ${text ? `<div class="mb-note">${esc(text)}</div>` : ''}
    ${links.map((l, i) => `<a class="mb-link" href="${esc(l)}" target="_blank" rel="noopener">Deschide în Tasks${links.length > 1 ? ' ' + (i + 1) : ''} ↗</a>`).join('')}
  </li>`;
}

function grouped(list, t) {
  const days = [];
  list.forEach(b => { let g = days[days.length - 1]; if (!g || g.due !== b.due) days.push(g = { due: b.due, items: [] }); g.items.push(b); });
  return days.map(g => `<div class="mb-day"><h3 class="mb-dayh">${esc(fmtDate(g.due))} <span class="mb-count">${g.items.length}</span></h3><ul class="mb-list">${g.items.map(b => row(b, t)).join('')}</ul></div>`).join('');
}

function build() {
  const t = today();
  const all = (store.state.bills || []).filter(b => b && b.due && b.status !== 'oprita' && meta(b).m.agenda !== false).sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
  const near = all.filter(b => dayNum(b.due) - dayNum(t) <= 31);
  const later = all.filter(b => dayNum(b.due) - dayNum(t) > 31);
  const payer = b => kind(b) !== 'auto';
  const soon = near.filter(b => payer(b) && dayNum(b.due) - dayNum(t) <= 7);
  const head = `<div class="card-header"><div><h2 class="card-title">🧾 Facturi pe date</h2>
    <div class="card-sub"><b>MANUAL</b> = tu plătești. <b>AUTO</b> = banca debitează, doar verifici. Doar reminder: fără plată, fără înregistrare, fără „plătit”. După ce plătești, bifezi în Tasks și introduci cheltuiala normal.</div></div></div>`;
  let html = `<section class="card mb-card" data-mb="1">${head}`;
  if (!all.length) html += '<div class="card-sub">Nu există încă facturi în fila „Facturi”.</div>';
  else {
    html += near.length ? grouped(near, t) : '<div class="card-sub">Nimic în următoarele 30 de zile.</div>';
    if (later.length) html += `<details class="mb-more"><summary>Mai târziu (${later.length})</summary>${grouped(later, t)}</details>`;
    const sheet = store.state.connection && store.state.connection.sheetUrl;
    html += `<div class="mb-foot">Datele vin din fila privată „Facturi” din Sheet${sheet ? ` · <a href="${esc(sheet)}" target="_blank" rel="noopener">Deschide Sheet-ul</a>` : ''}. Scadențele și metoda (AUTO/MANUAL) se schimbă acolo.</div>`;
  }
  html += '</section>';
  return { html, sig: JSON.stringify([t, all.map(b => [b.id, b.name, b.amount, b.currency, b.due, b.note, b.category, b.status, b.frequency])]), dueSoon: soon.length, late: soon.filter(b => b.due < t).length };
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
      btn.textContent = `🧾 De plătit (manual): ${n} ${n === 1 ? 'scadență' : 'scadențe'} în 7 zile${b.late ? `, ${b.late} întârziate` : ''}`;
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
