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
  if (d < 0) return { text: `dată trecută (${-d} ${-d === 1 ? 'zi' : 'zile'}), verifică în Tasks`, cls: 'past' };
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
export function ruleMethodLabel(ruleId, ruleType) {
  const bills = store.state.bills || [];
  let k = '';
  for (const x of bills) { const mp = meta(x).m.ruleBankMethods; if (mp && Object.prototype.hasOwnProperty.call(mp, ruleId)) { k = String(mp[ruleId]).toLowerCase(); break; } }
  if (!k) { const b = bills.find(x => x && meta(x).m.ruleId === ruleId); if (b) k = kind(b); }
  if (k === 'income' || (!k && ruleType === 'venit')) return '<span class="mb-kind mb-income" title="venit, nu plată">VENIT</span>';
  k = norm(k);
  return `<span class="mb-kind mb-${k}" title="${esc(KIND[k][1])}">${KIND[k][0]}</span>`;
}
var KIND = { auto: ['AUTO', 'banca debitează automat, doar verifici'], manual: ['MANUAL', 'tu plătești'], unknown: ['METODĂ NECONFIRMATĂ', 'nu se știe încă cum se plătește'] };

export function billOccurrenceState(b, state) {
  const due = meta(b).m.reminderDue || b.due;
  const source = 'bill-review-v1:' + b.id + '@' + due;
  const id = 'billreview_' + b.id + '_' + due;
  const record = (state.expenses || []).find(x => x.id === id || x.source === source);
  if ((state.pendingQueue || []).some(x => { const op = x.op || x; const tx = op.expense || op.transfer || {}; return tx.id === id || tx.source === source; }) || record?.pendingSync) return 'pending';
  if (record) return 'recorded';
  return 'open';
}

function row(b, t) {
  const mm = meta(b), noteText = mm.note;
  const links = [...new Set([...(Array.isArray(mm.m.taskUrls) ? mm.m.taskUrls.filter(u => /^https:\/\/tasks\.google\.com\//.test(String(u))) : []), ...(noteText.match(TASKS_RE) || [])])];
  const text = noteText.replace(TASKS_RE, '').replace(/[ \t]*[|·-]?[ \t]*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  const occurrenceState = billOccurrenceState(b, store.state);
  const r = occurrenceState === 'recorded' ? {text:'Înregistrată',cls:''} : occurrenceState === 'pending' ? {text:'În curs de sincronizare',cls:''} : rel(b.due, t);
  const unknown = mm.m.amountKind === 'unknown' || !(Number(b.amount) > 1);
  const amount = unknown ? '<span class="mb-amt mb-unk">sumă de confirmat</span>' : `<span class="mb-amt">${esc(money(b.amount, b.currency))} <i>reper</i></span>`;
  const ver = /^\d{4}-\d{2}-\d{2}$/.test(String(mm.m.verifiedAt || '')) ? 'verificat ' + new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(mm.m.verifiedAt + 'T12:00:00Z')) : '';
  const metaTxt = [FREQ[b.frequency] || b.frequency, b.merchant, b.account, ver].filter(Boolean).map(esc).join(' · ');
  const k = kind(b);
  return `<li class="mb-row" data-mb-entry="${esc(b.id)}">
    <div class="mb-top"><button type="button" class="mb-name" ${occurrenceState==='open'?`data-mb-open="${esc(b.id)}"`:''} style="border:0;background:none;color:inherit;font:inherit;font-weight:700;text-align:left;padding:0;cursor:pointer">${esc(b.name)} <small aria-hidden="true">✎</small></button>${amount}</div>
    <div class="mb-mid"><span class="mb-kind mb-${k}" title="${esc(KIND[k][1])}">${KIND[k][0]}</span><span class="mb-due ${r.cls}">${esc(r.text)}</span><span class="mb-meta">${metaTxt}</span></div>
    ${text ? `<div class="mb-note">${esc(text)}</div>` : ''}
    ${occurrenceState==='open'?`<button type="button" class="mb-link" data-mb-open="${esc(b.id)}">Înregistrează</button>`:`<span class="mb-link" role="status">${occurrenceState==='recorded'?'Înregistrată în Cheltuieli':'În așteptare pe dispozitiv. Nu introduce din nou.'}</span>`}
    <button type="button" class="mb-link" data-mb-edit="${esc(b.id)}">Editează recurența</button>
    ${links.map((l, i) => `<a class="mb-link" href="${esc(l)}" target="_blank" rel="noopener">Task${links.length > 1 ? ' ' + (i + 1) : ''} ↗</a>`).join('')}
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
  const unresolved = all.filter(b => billOccurrenceState(b, store.state) === 'open');
  const recorded = all.filter(b => billOccurrenceState(b, store.state) === 'recorded');
  const pending = all.filter(b => billOccurrenceState(b, store.state) === 'pending');
  const near = unresolved.filter(b => dayNum(b.due) - dayNum(t) <= 31);
  const later = unresolved.filter(b => dayNum(b.due) - dayNum(t) > 31);
  const payer = b => kind(b) !== 'auto';
  const soon = near.filter(b => payer(b) && dayNum(b.due) >= dayNum(t) && dayNum(b.due) - dayNum(t) <= 7);
  const pastN = near.filter(b => payer(b) && b.due < t).length;
  const head = `<div class="card-header"><div><h2 class="card-title">🧾 Facturi pe date</h2>
    <div class="card-sub"><b>MANUAL</b> = tu plătești. <b>AUTO</b> = banca debitează, doar verifici. Doar reminder: fără plată, fără înregistrare, fără „plătit”. Apeși factura, ajustezi datele și confirmi Înregistrează. Taskul se bifează separat.</div></div></div>`;
  let html = `<section class="card mb-card" data-mb="1">${head}`;
  if (!all.length) html += '<div class="card-sub">Nu există încă facturi în fila „Facturi”.</div>';
  else {
    const pastL = near.filter(b => b.due < t), upL = near.filter(b => b.due >= t);
    if (pastL.length) html += `<div class="mb-pastbox"><h3 class="mb-dayh">Dată trecută, de actualizat <span class="mb-count">${pastL.length}</span></h3><div class="card-sub">Data din Sheet a trecut. Nu înseamnă plătit sau neplătit: verifică în Tasks.</div>${grouped(pastL, t)}</div>`;
    html += upL.length ? grouped(upL, t) : '<div class="card-sub">Nimic în următoarele 30 de zile.</div>';
    if (later.length) html += `<details class="mb-more"><summary>Mai târziu (${later.length})</summary>${grouped(later, t)}</details>`;
    const sheet = store.state.connection && store.state.connection.sheetUrl;
    html += `<div class="mb-foot">Datele vin din fila privată „Facturi” din Sheet${sheet ? ` · <a href="${esc(sheet)}" target="_blank" rel="noopener">Deschide Sheet-ul</a>` : ''}. Taskurile păstrează reminderele. Cardul deschide înregistrarea cheltuielii, fără plată automată.</div>`;
  }
  if (pending.length) html += `<div class="mb-pastbox"><h3>În curs de sincronizare (${pending.length})</h3>${grouped(pending,t)}</div>`;
  if (recorded.length) html += `<details class="mb-more"><summary>Înregistrate în Cheltuieli (${recorded.length})</summary><p>Scadențele de mai jos sunt înregistrate. Recurența și reminderele viitoare se păstrează.</p>${grouped(recorded,t)}</details>`;
  html += '</section>';
  return { html, sig: JSON.stringify([t, all.map(b => [b.id, b.name, b.amount, b.currency, b.due, b.note, b.category, b.status, b.frequency, billOccurrenceState(b, store.state)])]), dueSoon: soon.length, late: pastN };
}

// One date-first agenda for both private-sheet reminders and review occurrences.
// Presentation only: existing entry handlers and save paths remain unchanged.
export function renderDatedAgenda(reviews = []) {
  const t = today();
  const bills = (store.state.bills || []).filter(b => b && b.due && b.status !== 'oprita' && meta(b).m.agenda !== false);
  const open = bills.filter(b => billOccurrenceState(b, store.state) === 'open');
  const pending = bills.filter(b => billOccurrenceState(b, store.state) === 'pending');
  const recorded = bills.filter(b => billOccurrenceState(b, store.state) === 'recorded');
  const items = [...open.map(b => ({ date: b.due, name: b.name || '', html: `<ul class="mb-list">${row(b,t)}</ul>` })), ...reviews]
    .sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name,'ro'));
  const groups = [];
  items.forEach(item => { let g=groups[groups.length-1]; if(!g || g.date!==item.date)groups.push(g={date:item.date,items:[]}); g.items.push(item); });
  const renderGroups = gs => gs.map(g => `<section class="mb-day" data-agenda-date="${esc(g.date)}"><h3 class="mb-dayh">${g.date===t?'Azi · ':''}${esc(fmtDate(g.date))} <span class="mb-count">${g.items.length}</span></h3>${g.items.map(i=>i.html).join('')}</section>`).join('');
  const near = groups.filter(g => dayNum(g.date)-dayNum(t)<=31), later=groups.filter(g => dayNum(g.date)-dayNum(t)>31);
  let html = `<section class="card mb-card" data-dated-agenda="1"><div class="card-header"><div><h2 class="card-title">Facturi pe date</h2><div class="card-sub">Facturi și recurențe împreună, după data scadenței. MANUAL = tu plătești. AUTO = banca debitează, tu verifici suma și conturile înainte de Înregistrează. Nimic nu se plătește sau înregistrează automat.</div></div></div>`;
  html += near.length ? renderGroups(near) : '<p class="card-sub">Nicio scadență de verificat în următoarele 31 de zile.</p>';
  if(later.length)html += `<details class="mb-more"><summary>Mai târziu (${later.reduce((n,g)=>n+g.items.length,0)})</summary>${renderGroups(later)}</details>`;
  if(pending.length)html += `<div class="mb-pastbox"><h3>În curs de sincronizare (${pending.length})</h3>${grouped(pending.slice().sort((a,b)=>a.due.localeCompare(b.due)),t)}</div>`;
  if(recorded.length)html += `<details class="mb-more"><summary>Înregistrate în Cheltuieli (${recorded.length})</summary><p>Scadențele de mai jos sunt înregistrate. Recurența și reminderele viitoare se păstrează.</p>${grouped(recorded.slice().sort((a,b)=>a.due.localeCompare(b.due)),t)}</details>`;
  return html + '<p class="card-sub">Data trecută nu înseamnă plătit sau neplătit. Taskurile se verifică și se bifează separat.</p></section>';
}

export function installManualBills() {
  const root = document.querySelector('#view-root');
  if (!root) return;
  const apply = () => {
    const view = document.querySelector('.nav-item.active, .side-btn.active')?.dataset.view;
    const ex = root.querySelector('[data-mb]');
    const exb = root.querySelector('[data-mb-banner]');
    if (view !== 'recurrences' && view !== 'dashboard') { ex?.remove(); exb?.remove(); return; }
    if (view === 'recurrences') { ex?.remove(); exb?.remove(); return; }
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
      btn.textContent = `🧾 Facturi pe date: ${n} ${n === 1 ? 'scadență' : 'scadențe'} în 7 zile${b.late ? `, ${b.late} cu data trecută de verificat în Tasks` : ''} (reminder, nu sold)`;
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

// A bill tap prepares a transaction only. Tasks and bill dates are never mutated here.
function openBillEntry(id, editing=false) {
  const b=(store.state.bills||[]).find(x=>x.id===id); if(!b)return;
  const mm=meta(b);
  if(!editing && billOccurrenceState(b,store.state)!=='open')return;
  if(mm.m.ruleId&&!editing){const ruleButton=[...document.querySelectorAll('[data-rr-open]')].find(x=>x.dataset.rrOpen===mm.m.ruleId);if(ruleButton){ruleButton.click();return;}}
  const defaults=mm.m.entryDefaults||{};
  const occurrence=mm.m.reminderDue||b.due, source='bill-review-v1:'+b.id+'@'+occurrence;
  const requestId='billreview_'+b.id+'_'+occurrence;
  const known=()=>store.state.expenses.some(x=>x.id===requestId||x.source===source)||(store.state.pendingQueue||[]).some(x=>(x.expense||x.transfer||{}).id===requestId);
  const el=document.createElement('dialog');el.className='mb-entry-dialog';
  el.style.cssText='width:min(94vw,560px);max-height:90dvh;overflow:auto;border:1px solid var(--border);border-radius:16px;padding:20px;background:var(--surface,#fff);color:var(--text);box-sizing:border-box';
  const accounts=(store.state.accounts||[]).filter(a=>!a.archived&&a.status!=='arhivat'&&(!store.isAccountVisible||store.isAccountVisible(a)));
  const categories=(store.state.categories||[]).filter(c=>c.active!==false).sort((a,b)=>a.name.localeCompare(b.name,'ro',{sensitivity:'base'}));
  const options=(arr,label,sel)=>'<option value="">Alege</option>'+arr.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?'selected':''}>${esc(label(x))}</option>`).join('');
  const account=accounts.find(a=>a.id===(defaults.account||b.account));
  const unknown=mm.m.amountKind==='unknown'||!(Number(b.amount)>1);
  el.innerHTML=`<form class="form-grid"><div class="btn-row" style="justify-content:space-between;position:sticky;top:-20px;z-index:2;margin:-20px -20px 0;padding:16px 20px 10px;background:var(--surface,#fff);border-bottom:1px solid var(--border)"><h3 style="margin:0">${editing?'Editează recurența':'Înregistrează'}: ${esc(b.name)}</h3><button type="button" data-mb-close class="btn btn-secondary" aria-label="Închide">✕</button></div><p class="card-sub">Ajustează datele din plata reală. Nimic nu se înregistrează până nu confirmi. Nu inițiază o plată și nu bifează taskul.</p>${!editing&&known()?'<p role="alert">Această scadență are deja o înregistrare sau o cerere în așteptare. Verifică în Cheltuieli, fără să o introduci din nou.</p>':''}<div class="field"><label>Tip</label><select class="input" name="type" required><option value="">Alege tipul înregistrării</option><option value="cheltuiala">Cheltuială</option><option value="venit">Venit</option><option value="transfer">Transfer între conturi</option><option value="investitie">Investiție</option></select></div><div class="field"><label>Sumă</label><input class="input" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${defaults.amount!=null?esc(defaults.amount):unknown?'':esc(b.amount)}"></div><div class="field"><label>Cont</label><select class="input" name="account" required>${options(accounts,a=>a.name+' ('+a.currency+')',account?.id)}</select></div><div class="field" data-mb-destination hidden><label>Cont destinație</label><select class="input" name="toAccount">${options(accounts,a=>a.name+' ('+a.currency+')','')}</select><label>Suma primită (din extras, în moneda destinației)</label><input class="input" name="toAmount" type="number" step="0.01" min="0.01"></div><p class="card-sub" data-mb-currency>Reperul facturii: ${esc(b.currency||'monedă de confirmat')}. Verifică suma în moneda contului ales. Nu calculăm conversia.</p><div class="field"><label>Categorie</label><input class="input" name="categorySearch" type="search" placeholder="Caută categorie…" autocomplete="off"><select class="input" name="category">${options(categories,c=>(c.emoji||'')+' '+c.name,defaults.category||b.category)}</select></div><div class="field"><label>Data tranzacției</label><input class="input" name="date" type="date" required value="${today()}"></div><div class="field"><label>Descriere (opțional)</label><input class="input" name="description" value="${esc(defaults.description??b.name)}"></div><div class="field"><label>Metodă plată</label><select class="input" name="method"><option value="">Alege</option>${(store.state.settings.paymentMethods||['Card','Transfer bancar','Numerar']).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div><p class="card-sub" style="white-space:pre-wrap">${esc(mm.note.replace(TASKS_RE,''))}</p><p role="status" data-mb-status></p><div class="btn-row"><button type="button" class="btn btn-secondary" data-mb-close data-mb-cancel>Renunță</button><button class="btn btn-primary" type="submit" ${!editing&&known()?'disabled':''}>${editing?'Salvează recurența':'Înregistrează'}</button></div></form>`;
  document.body.append(el);el.showModal();const form=el.querySelector('form'),status=el.querySelector('[data-mb-status]'),submit=form.querySelector('[type=submit]');
  let busy=false,session=null;
  if(defaults.type)form.elements.type.value=defaults.type;if(defaults.method)form.elements.method.value=defaults.method;if(defaults.toAccount)form.elements.toAccount.value=defaults.toAccount;if(defaults.toAmount)form.elements.toAmount.value=defaults.toAmount;
  if(editing){form.elements.date.closest('.field').hidden=true;el.querySelector('.card-sub').textContent='Salvezi setările pentru lunile următoare. Nu creează tranzacții, nu schimbă scadența și nu confirmă plata.';}
  form.elements.categorySearch.oninput=()=>{const sel=form.elements.category,current=sel.value,q=form.elements.categorySearch.value.toLocaleLowerCase('ro');sel.innerHTML=options(categories.filter(c=>c.id===current||c.name.toLocaleLowerCase('ro').includes(q)),c=>(c.emoji||'')+' '+c.name,current);};
  el.querySelectorAll('[data-mb-close]').forEach(x=>x.onclick=()=>{if(!busy){el.close();el.remove();}});
  el.addEventListener('cancel',e=>{if(busy)e.preventDefault();else el.remove();});
  form.elements.account.onchange=()=>{const a=accounts.find(x=>x.id===form.elements.account.value);el.querySelector('[data-mb-currency]').textContent=a?'Suma va fi în '+a.currency+'. Reperul facturii: '+(b.currency||'necunoscut')+'. Verifică suma reală; nu calculăm conversia.':'Alege contul din care s-a plătit.';};
  form.elements.type.onchange=()=>{el.querySelector('[data-mb-destination]').hidden=!['transfer','investitie'].includes(form.elements.type.value);};
  form.elements.type.onchange();
const done=msg=>{const t=document.createElement('div');t.setAttribute('role','status');t.textContent=msg;t.style.cssText='position:fixed;left:50%;bottom:84px;transform:translateX(-50%);max-width:90vw;padding:12px 16px;border-radius:12px;background:#111827;color:#fff;font-size:14px;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.3)';document.body.append(t);setTimeout(()=>t.remove(),4500);try{el.close();}catch{}el.remove();};
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;if(!editing&&known()&&!session){status.textContent='Scadență deja înregistrată sau în așteptare.';submit.disabled=true;return;}
    const a=accounts.find(x=>x.id===form.elements.account.value);if(!a)return;
    const type=form.elements.type.value,isTransfer=['transfer','investitie'].includes(type),dst=accounts.find(x=>x.id===form.elements.toAccount.value),received=Number(form.elements.toAmount.value);if(isTransfer&&(!dst||dst.id===a.id||!(received>0))){status.textContent='Alege un cont destinație diferit și suma primită din extras. Nu estimăm conversia.';return;}
    busy=true;submit.disabled=true;form.querySelectorAll('[data-mb-cancel]').forEach(x=>x.disabled=true);status.textContent='Se păstrează aceeași cerere, fără dublare…';
    try{if(editing){const {saveBillDefaults}=await import('./sheets-api.js');const connection=store.state.connection;const result=await saveBillDefaults(connection.webAppUrl,connection.pin,b.id,{type,amount:Number(form.elements.amount.value),account:a.id,category:form.elements.category.value,description:form.elements.description.value,method:form.elements.method.value,toAccount:isTransfer?dst.id:'',toAmount:isTransfer?received:null},b.note||'');store.state.bills=result.bills;store.persist();busy=false;done('Recurența a fost salvată. Nu s-a înregistrat nicio tranzacție.');return;}session=session||(await import('./transaction-save.js')).createTransactionSaveSession(store,{requestId});
      const result=await session.save({date:form.elements.date.value,type,toAccount:isTransfer?dst.id:'',toAmount:isTransfer?received:null,amount:Number(form.elements.amount.value),currency:a.currency,account:a.id,category:form.elements.category.value,description:form.elements.description.value,method:form.elements.method.value,merchant:b.merchant||'',source,bill:b.id});
      status.textContent=['confirmed','local','pending'].includes(result.status)?(result.status==='confirmed'?'Înregistrat. Taskul și data facturii au rămas neschimbate.':result.status==='pending'?'Păstrat pe dispozitiv, se trimite în fundal. Nu introduce din nou.':'Salvat pe acest dispozitiv.'):(result.message||'Salvare neconfirmată. Verifică sincronizarea, fără o cerere nouă.');
      if(['confirmed','local','pending'].includes(result.status)){busy=false;done(result.status==='confirmed'?'Înregistrat. Taskul și data facturii au rămas neschimbate.':result.status==='pending'?'Păstrat pe dispozitiv, se trimite în fundal. Nu introduce din nou.':'Salvat pe acest dispozitiv.');return;}
      form.querySelectorAll('input,select').forEach(x=>x.disabled=true);
    }catch(err){status.textContent=err.message;submit.disabled=false;form.querySelectorAll('[data-mb-cancel]').forEach(x=>x.disabled=false);}finally{busy=false;}
  };
}

document.addEventListener('click',e=>{const edit=e.target.closest('[data-mb-edit]');if(edit){openBillEntry(edit.dataset.mbEdit,true);return;}const btn=e.target.closest('[data-mb-open]');const row=e.target.closest('[data-mb-entry]');if(!btn&&(!row||e.target.closest('a,button,input,select,textarea')))return;openBillEntry(btn?btn.dataset.mbOpen:row.dataset.mbEntry);});
