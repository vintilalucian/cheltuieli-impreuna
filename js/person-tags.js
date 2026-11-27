import {savePersonTag} from './sheets-api.js';
export const isLoanAccount = a => /împrumut|imprumut/i.test(a?.name || '');
export const normalizePerson = value => String(value||'').trim().replace(/\s+/g,' ');
export function personNames(store){return [...new Set(store.state.expenses.map(t=>normalizePerson(t.person)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ro'));}
export function canonicalPerson(store,value){const name=normalizePerson(value);return personNames(store).find(n=>n.toLocaleLowerCase('ro')===name.toLocaleLowerCase('ro'))||name;}
export function personPicker(store,value,editable,esc,id){
 const names=personNames(store),current=canonicalPerson(store,value),known=names.includes(current),disabled=editable?'':'disabled';
 return `<label for="${id}-select">Persoană</label><select class="select" id="${id}-select" ${disabled}><option value="">Alege persoana…</option>${names.map(n=>`<option value="${esc(n)}" ${n===current?'selected':''}>${esc(n)}</option>`).join('')}<option value="__new__" ${current&&!known?'selected':''}>＋ Persoană nouă…</option></select><div id="${id}-new-field" ${current&&!known?'':'hidden'}><label for="${id}-new">Numele persoanei noi</label><input class="input" id="${id}-new" maxlength="80" autocomplete="off" value="${esc(!known?current:'')}" ${disabled}></div><input type="hidden" id="${id}" value="${esc(current)}">`;
}
export function bindPersonPicker(store,id){const select=document.getElementById(id+'-select'),field=document.getElementById(id+'-new-field'),input=document.getElementById(id+'-new'),value=document.getElementById(id);const update=()=>{field.hidden=select.value!=='__new__';input.required=select.value==='__new__';value.value=canonicalPerson(store,select.value==='__new__'?input.value:select.value);};select.addEventListener('change',update);input.addEventListener('input',update);update();}
export function loanPersonFields(store,tx,editable,esc){return `<div class="field" id="loan-person-field">${personPicker(store,tx?.person,editable,esc,'exp-person')}<p class="card-sub">Tag de persoană. Nu schimbă soldurile sau tipul financiar al istoricului.</p></div>`;}
export function bindLoanForm(store,tx,editable,esc){
 const type=document.querySelector('#exp-type'),field=document.querySelector('#loan-person-field'),person=document.querySelector('#exp-person');
 bindPersonPicker(store,'exp-person');
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
 modal.innerHTML=`<div class="modal-sheet"><div class="modal-header"><h3>Persoana împrumutului</h3><button class="close-btn" data-close-modal>✕</button></div><form id="person-only-form" class="form-grid"><p>Se schimbă numai persoana, nu suma, conturile sau nota.</p>${personPicker(store,tx.person,true,esc,'person-only-name')}<p role="status" id="person-only-status"></p><button class="btn btn-primary" type="submit">Salvează persoana</button></form></div>`;modal.classList.add('open');
 bindPersonPicker(store,'person-only-name');
 document.querySelector('#person-only-form').onsubmit=async e=>{
 e.preventDefault();const form=e.target,submit=form.querySelector('button[type=submit]'),status=document.querySelector('#person-only-status');submit.disabled=true;submit.textContent='Se salvează…';status.textContent='Se așteaptă confirmarea salvării.';
 try{const person=canonicalPerson(store,document.querySelector('#person-only-name').value);if(!person)throw Error('Alege persoana sau completează un nume nou.');let tag={person,loan:true};
 if(store.isConnected()){const conn=store.state.connection;const result=await savePersonTag(conn.webAppUrl,conn.pin,{id:tx.id,person,loan:true,expectedPersonModified:tx.personModified||''});tag=result.tag||tag;}
 const current=store.state.expenses.find(t=>t.id===tx.id);if(current)Object.assign(current,tag);store.emit();
 if(document.querySelector('#person-only-form')===form)modal.classList.remove('open');refresh();notify('Persoană salvată. Valorile financiare nu s-au schimbat.');
 if(store.isConnected())store.sync().catch(()=>notify('Persoana este salvată. Reîmprospătarea listei nu a reușit; poți sincroniza din nou.'));
 }catch(err){status.textContent=err.message;submit.disabled=false;submit.textContent='Salvează persoana';}
 };
 });}
