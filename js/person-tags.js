import {savePersonTag} from './sheets-api.js';
export const isLoanAccount = a => /împrumut|imprumut/i.test(a?.name || '');
export function loanPersonFields(store,tx,editable,esc){
 const names=[...new Set(store.state.expenses.map(t=>t.person).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ro'));
 return `<div class="field" id="loan-person-field"><label for="exp-person">Persoană (împrumut)</label><input class="input" id="exp-person" maxlength="80" list="loan-people" autocomplete="off" value="${esc(tx?.person||'')}" ${editable?'':'disabled'} placeholder="Nume nou sau persoană existentă"><datalist id="loan-people">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist><p class="card-sub">Tag de persoană. Nu schimbă soldurile sau tipul financiar al istoricului.</p></div>`;
}
export function bindLoanForm(store,tx,editable,esc){
 const type=document.querySelector('#exp-type'),field=document.querySelector('#loan-person-field'),person=document.querySelector('#exp-person');
 type.add(new Option('🤝 Împrumut','imprumut'));
 if(tx?.loan && tx.type==='transfer')type.value='imprumut';
 const show=()=>{const a=store.getAccount(document.querySelector('#exp-account').value),b=store.getAccount(document.querySelector('#exp-dest-account').value);field.hidden=!(type.value==='imprumut'||isLoanAccount(a)||isLoanAccount(b)||person.value);person.required=type.value==='imprumut';};
 type.addEventListener('change',show);document.querySelector('#exp-account').addEventListener('change',show);document.querySelector('#exp-dest-account').addEventListener('change',show);show();
}
export function accountDelta(t,account){
 const amt=Number(t.amount)||0,cur=account.currency;
 if(t.account===account.id){if(t.currency!==cur)return null;return t.type==='venit'||t.type==='ajustare'?amt:-amt;}
 if(t.toAccount===account.id){if(Number(t.toAmount)>0)return Number(t.toAmount);if(t.currency===cur)return amt;return null;}
 return 0;
}
export function renderPersonView(store,accountId,renderTx,esc,money){
 const account=store.getAccount(accountId);if(!isLoanAccount(account))return '';
 const rows=store.getVisibleExpenses({scope:'all'}).filter(t=>t.account===accountId||t.toAccount===accountId),groups=new Map();
 rows.forEach(t=>{const name=t.person||'Neprecizat';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(t);});
 return `<section id="loan-person-view"><h2 class="card-title">🤝 Împrumuturi pe persoane</h2><p class="card-sub">Toate lunile. Intrări în cont = plus; ieșiri = minus. Totalul fiecărei persoane include numai mișcările etichetate. Notele istorice sunt păstrate.</p>${[...groups].sort(([a],[b])=>a.localeCompare(b,'ro')).map(([name,items])=>{let total=0,unknown=0;items.forEach(t=>{const d=accountDelta(t,account);d===null?unknown++:total+=d;});return `<details class="mini-card" style="display:block;margin:12px 0;padding:14px" ${name==='Neprecizat'?'':'open'}><summary style="cursor:pointer;font-weight:700;display:flex;gap:12px;justify-content:space-between"><span>${esc(name)} <small>(${items.length})</small></span><span>${total>=0?'+':''}${money(total,account.currency)}${unknown?' + ?':''}</span></summary>${items.sort((a,b)=>b.date.localeCompare(a.date)).map(t=>{const d=accountDelta(t,account);return `<article style="padding:12px 0;border-top:1px solid var(--border);margin-top:10px"><div style="display:flex;justify-content:space-between;gap:12px"><strong style="overflow-wrap:anywhere">${esc(t.description||t.title||t.merchant||'Împrumut')}</strong><strong style="white-space:nowrap">${d===null?'Sumă neconfirmată':(d>=0?'+':'')+money(d,account.currency)}</strong></div><p class="card-sub">${esc(t.date)} · ${esc(t.type==='transfer'?'Împrumut (transfer)':t.type)}${t.pendingSync?' · În așteptare':''}</p><button class="btn btn-sm btn-secondary" data-view-expense="${esc(t.id)}">Detalii</button> ${store.isOwnRecord(t)?`<button class="btn btn-sm btn-secondary" data-person-edit="${esc(t.id)}">Editează persoana</button>`:''}</article>`;}).join('')}</details>`;}).join('')}</section>`;
}
export function bindPersonView(store,refresh,notify){document.querySelectorAll('[data-person-edit]').forEach(button=>button.onclick=()=>{
 const tx=store.state.expenses.find(t=>t.id===button.dataset.personEdit);if(!tx)return;
 const modal=document.querySelector('#modal-main'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 modal.innerHTML=`<div class="modal-sheet"><div class="modal-header"><h3>Persoana împrumutului</h3><button class="close-btn" data-close-modal>✕</button></div><form id="person-only-form" class="form-grid"><p>Se schimbă numai persoana, nu suma, conturile sau nota.</p><label for="person-only-name">Persoană</label><input id="person-only-name" class="input" maxlength="80" value="${esc(tx.person||'')}" required><p role="status" id="person-only-status"></p><button class="btn btn-primary" type="submit">Salvează persoana</button></form></div>`;modal.classList.add('open');
 document.querySelector('#person-only-form').onsubmit=async e=>{e.preventDefault();const submit=e.target.querySelector('button[type=submit]'),status=document.querySelector('#person-only-status');submit.disabled=true;try{const person=document.querySelector('#person-only-name').value.trim();if(!person)throw Error('Completează persoana.');if(store.isConnected()){const conn=store.state.connection;await savePersonTag(conn.webAppUrl,conn.pin,{id:tx.id,person,loan:true,expectedPersonModified:tx.personModified||''});await store.sync();}else{tx.person=person;tx.loan=true;store.emit();}modal.classList.remove('open');refresh();notify('Persoană salvată. Valorile financiare nu s-au schimbat.');}catch(err){status.textContent=err.message;submit.disabled=false;}};
 });}
