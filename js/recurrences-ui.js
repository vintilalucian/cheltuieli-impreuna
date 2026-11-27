import { readRecurrences, saveRecurrence, skipRecurrenceOccurrence, savePushSubscription, removePushSubscription } from './sheets-api.js';
import { createTransactionSaveSession } from './transaction-save.js';
import { store } from './store.js';
import { ruleMethodLabel, renderDatedAgenda } from './manual-bills.js';

// Review-before-post. A due occurrence is only a card. Nothing reaches the ledger until the user taps "Înregistrează",
// and then it goes through the same save pipeline as a manual entry, with a stable ID and source for the occurrence.
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const unitLabel = {day:'zi',week:'săptămână',month:'lună',year:'an'};
const unitPlural = {day:'zile',week:'săptămâni',month:'luni',year:'ani'};
const every = r => { const n=Number(r.interval)||1; if(r.unit==='day'&&n===1) return 'în fiecare zi'; return n>1 ? `la ${n} ${unitPlural[r.unit]||r.unit}` : `la ${unitLabel[r.unit]||r.unit}`; };
const typeLabel = {cheltuiala:'Cheltuială',venit:'Venit',transfer:'Transfer',investitie:'Investiție'};
const fmtDate = s => s ? new Intl.DateTimeFormat('ro-RO',{dateStyle:'medium',timeZone:'Europe/Brussels'}).format(new Date(s+'T12:00:00Z')) : 'Fără altă scadență';
const money = (n,c) => { try { return new Intl.NumberFormat('ro-RO',{style:'currency',currency:c||'EUR'}).format(Number(n)||0); } catch { return `${n} ${c||''}`; } };
const daysLate = (today,date) => Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000);
let pendingCount = 0;
export const getPendingReviewCount = () => pendingCount;
const urlKey = k => { const p='='.repeat((4-k.length%4)%4), b=(k+p).replace(/-/g,'+').replace(/_/g,'/'), r=atob(b); return Uint8Array.from([...r].map(ch=>ch.charCodeAt(0))); };

export function createRecurrenceView({ context, refresh, notify }) {
  let data=null, error='', busy=false, selected='', editing=false, draft=null, ownerKey='', epoch=0, early=null;
  const drafts={}, cardErrors={}, done=new Set(), sessions={};
  const connected = () => Boolean(context().connection.webAppUrl && context().connection.pin && !context().isDemoMode);
  const auth = () => [context().connection.webAppUrl, context().connection.pin];
  const accounts = () => (context().accounts||[]).filter(a=>!a.archived && a.status!=='arhivat');
  const accObj = id => (context().accounts||[]).find(a=>a.id===id);
  const accountName = id => accObj(id)?.name || id || 'Neselectat';
  const rule = () => data?.rules?.find(r=>r.id===selected);
  const identity = () => { const c=context(); return [c.connection.webAppUrl,c.connection.pin,c.isDemoMode,c.activePartner||'',c.activeEmail||''].join('|'); };
  function syncOwner() { const key=identity(); if(key!==ownerKey){ownerKey=key;epoch++;data=null;error='';busy=false;selected='';editing=false;draft=null;early=null;Object.keys(drafts).forEach(k=>delete drafts[k]);done.clear();pendingCount=0;} }
  async function request(action,...args) { syncOwner(); const token=epoch, result=await action(...auth(),...args); syncOwner(); if(token!==epoch)throw Object.assign(new Error('Conexiunea s-a schimbat.'),{stale:true}); return result; }
  function setData(state) { data=state; pendingCount=pendingItems().length; }
  function fail(e) { error=e.message; notify('Recurențe: '+error,5500); }
  async function perform(fn) { syncOwner(); if(busy)return; const token=epoch; busy=true;error='';refresh();try{await fn();}catch(e){if(!e.stale&&token===epoch)fail(e);}finally{if(token===epoch){busy=false;refresh();}} }
  async function load() { syncOwner(); if(!connected())return; return perform(async()=>{setData((await request(readRecurrences)).recurrenceState);}); }
  const known = id => (context().expenses||[]).some(x=>x.id===id) || (context().pendingQueue||[]).some(o=>(o.op||o).expense?.id===id || (o.op||o).transfer?.id===id);
  function pendingItems() { return (data?.review||[]).filter(i=>!done.has(i.key) && !known(i.id)); }

  // Early entry ("Introdu acum"): registers a FUTURE occurrence now. It uses the same stable id/source as the due card,
  // so once it exists in the ledger the occurrence is settled and no card appears at the due date.
  function occAt(r,n){ const [y,m,d]=r.startDate.split('-').map(Number), k=n*(Number(r.interval)||1);
    if(r.unit==='day') return new Date(Date.UTC(y,m-1,d+k,12)).toISOString().slice(0,10);
    if(r.unit==='week') return new Date(Date.UTC(y,m-1,d+k*7,12)).toISOString().slice(0,10);
    const t=y*12+m-1+k*(r.unit==='year'?12:1), yy=Math.floor(t/12), mm=t%12+1, dim=new Date(Date.UTC(yy,mm,0,12)).getUTCDate();
    return `${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(Math.min(d,dim)).padStart(2,'0')}`; }
  const occId = (r,date) => 'review_'+r.id+'_'+date;
  function upcoming(r,limit) { const out=[], sk=Array.isArray(r.skipped)?r.skipped:[];
    if(!r||r.status!=='active'||!r.startDate||!data) return out;
    for(let n=0;n<10000&&out.length<limit;n++){ const d=occAt(r,n);
      if((r.maxOccurrences&&n>=r.maxOccurrences)||(r.endDate&&d>r.endDate)) break;
      if(d<=data.today||sk.includes(d)||known(occId(r,d))) continue; out.push(d); }
    return out; }
  const nextOcc = r => upcoming(r,1)[0] || (r.status==='active'?'':r.nextDate);
  function earlyItem(r,date) { return {key:'review-v1:'+r.id+'@'+date,id:occId(r,date),source:'review-v1:'+r.id+'@'+date,ruleId:r.id,date,entryDate:data.today,state:'early',name:r.name,note:r.note,type:r.type,amount:r.amount,currency:r.currency,account:r.account,toAccount:r.toAccount||'',toAmount:r.toAmount,category:r.category||'',merchant:r.merchant||'',method:r.method||''}; }
  const findItem = key => (data?.review||[]).find(x=>x.key===key) || (early&&early.item.key===key?early.item:null);
  function startEarly(r) { const o=upcoming(r,4); if(!o.length){error='Nu mai există scadențe viitoare neînregistrate pentru această recurență.';refresh();return;} error=''; early={ruleId:r.id,occ:o[0]}; early.item=earlyItem(r,o[0]); refresh(); }
  function earlyView() {
    const r=data.rules.find(x=>x.id===early.ruleId); if(!r){early=null;return render();}
    const o=upcoming(r,4); if(!o.includes(early.occ)) early.occ=o[0]||early.occ;
    if(early.item.date!==early.occ) early.item=earlyItem(r,early.occ);
    const sel=`<div class="field"><label>Ce scadență înregistrezi acum</label><select class="input" id="rr-early-occ">${o.map(d=>`<option value="${esc(d)}" ${d===early.occ?'selected':''}>${esc(fmtDate(d))}</option>`).join('')}</select></div>`;
    return `<section class="card"><div class="rr-rule-head"><h2 class="card-title">Introdu acum: ${esc(r.name)}</h2></div><p class="card-sub">Verifici suma, conturile și data, apoi apeși Înregistrează. Scadența aleasă mai jos se consideră rezolvată: la scadență nu mai apare niciun card și nu se înregistrează a doua oară.</p>${sel}</section>`+reviewCard(early.item);
  }
  function reviewCard(i) {
    const d=drafts[i.key]||(drafts[i.key]={amount:i.amount,account:accObj(i.account)?accObj(i.account).id:'',toAccount:accObj(i.toAccount)?i.toAccount:'',toAmount:i.toAmount===''||i.toAmount==null?'':i.toAmount,date:i.entryDate||i.date});
    const isE=i.state==='early', late=daysLate(data.today,i.date), cls=isE?'rr-early':i.state==='today'?'rr-due-today':'rr-due-overdue';
    const label=isE?'Mai devreme':i.state==='today'?'Azi':`Întârziat ${late} ${late===1?'zi':'zile'}`;
    const opts=(sel,skip)=>'<option value="">Alege contul</option>'+accounts().filter(a=>a.id!==skip).map(a=>`<option value="${esc(a.id)}" ${sel===a.id?'selected':''}>${esc(a.name)} (${esc(a.currency)})</option>`).join('');
    const cur=accObj(d.account)?.currency||i.currency, k=esc(i.key), isT=i.type==='transfer'||i.type==='investitie', dcur=accObj(d.toAccount)?.currency||'';
    return `<article class="card rr-review-card ${cls}" data-card="${k}"><div class="rr-rule-head"><strong class="rr-title">${esc(i.name)}</strong><strong>${esc(money(i.amount,i.currency))} <small class="card-sub">sugerat</small></strong></div><div class="card-sub">${ruleMethodLabel(i.ruleId,i.type)} · ${esc(typeLabel[i.type]||i.type)} · ${esc(label)} · ${esc(accountName(i.account))}${i.toAccount?' → '+esc(accountName(i.toAccount)):''}</div>`+
      (!isE?`<button type="button" class="mb-link" data-rr-edit="${esc(i.ruleId)}">Editează recurența</button>`:'')+
      `<details class="mb-more" ${isE||cardErrors[i.key]?'open':''}><summary>Înregistrează</summary>`+
      (i.note?`<details class="mb-more"><summary>Detalii și surse</summary><p class="rr-note" style="white-space:pre-wrap">${esc(i.note)}</p></details>`:'')+
      `<div class="form-grid rr-editor-grid"><div class="field"><label>Sumă (<span data-cur="${k}">${esc(cur)}</span>)</label><input class="input" inputmode="decimal" data-f="amount" data-k="${k}" value="${esc(d.amount)}"></div>`+
      `<div class="field"><label>${isT?'Din contul':'Cont'}</label><select class="input" data-f="account" data-k="${k}">${opts(d.account)}</select></div>`+
      (isT?`<div class="field"><label>În contul</label><select class="input" data-f="toAccount" data-k="${k}">${opts(d.toAccount,d.account)}</select></div><div class="field"><label>Suma primită${dcur?' ('+esc(dcur)+')':''}${dcur&&dcur!==cur?'':' (opțional)'}</label><input class="input" inputmode="decimal" data-f="toAmount" data-k="${k}" value="${esc(d.toAmount)}" placeholder="${dcur&&dcur!==cur?'obligatoriu, din extras':''}"></div>`:'')+
      `<div class="field"><label>${isE?'Data tranzacției (scadența: '+esc(fmtDate(i.date))+')':'Data înregistrării'}</label><input class="input" type="date" data-f="date" data-k="${k}" value="${esc(d.date)}"></div></div>`+
      (i.currency!==cur?`<p class="card-sub">Suma sugerată era în ${esc(i.currency)}. Contul ales este în ${esc(cur)}: verifică suma.</p>`:'')+
      (cardErrors[i.key]?`<p class="rr-error" role="alert">${esc(cardErrors[i.key])}</p>`:'')+
      `<div class="btn-row"><button class="btn btn-primary" data-rr-post="${k}" ${busy?'disabled':''}>Înregistrează</button>${isE?`<button class="btn btn-secondary" id="rr-early-cancel">Renunță</button>`:`<button class="btn btn-secondary" data-rr-skip="${k}" ${busy?'disabled':''}>Omite această scadență</button>`}</div></details></article>`;
  }
  function pushSection() {
    const p=data.push||{}, supported='Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    let msg, btn='';
    if(!supported) msg='Acest browser nu permite notificări de la aplicație. Pe iPhone, instalează mai întâi aplicația pe ecranul principal.';
    else if(!p.relayConfigured||!p.vapidPublicKey) msg='Serviciul de notificări nu este încă pornit pe server.';
    else if(Notification.permission==='denied') msg='Notificările sunt blocate pentru aplicație în setările telefonului.';
    else if(p.devices>0 && Notification.permission==='granted') { msg=`Notificările de seară sunt active (${p.devices} ${p.devices===1?'dispozitiv':'dispozitive'}). Primești un mesaj seara, după 19:30, doar când ai scadențe de verificat.`; btn='<button class="btn btn-secondary" id="rr-push-off">Oprește pe acest telefon</button>'; }
    else { msg='Primești seara, după 19:30, o notificare doar când ai scadențe de verificat.'; btn='<button class="btn btn-primary" id="rr-push-on">Activează notificările</button>'; }
    return `<section class="card"><h2 class="card-title">Notificări</h2><p>${esc(msg)}</p>${btn}</section>`;
  }
  function header() { return `<div class="view-head"><div><h1>Recurențe</h1><p class="card-sub">La scadență apare un card de verificat. Nimic nu intră în evidență până nu apeși Înregistrează.</p></div><div class="btn-row"><button class="btn btn-secondary" id="rr-refresh" ${busy?'disabled':''}>Reîncarcă</button><button class="btn btn-primary" id="rr-new" ${busy||!data?'disabled':''}>Adaugă recurență</button></div></div>`; }
  function rulesList() {
    const rules=(data.rules||[]).filter(r=>r.mode==='review');
    if(!rules.length) return '<section class="card"><h2 class="card-title">Nicio recurență adăugată</h2><p>Adaugă o recurență ca să primești carduri de verificat la scadență.</p></section>';
    const rows=rules.map(r=>({r,date:r.status==='active'?(pendingItems().filter(i=>i.ruleId===r.id).map(i=>i.date).sort()[0]||nextOcc(r)):nextOcc(r)}));
    const cmp=(a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.r.name.localeCompare(b.r.name,'ro');
    const active=rows.filter(x=>x.r.status==='active'&&x.date).sort(cmp);
    const other=rows.filter(x=>x.r.status!=='active'||!x.date).sort(cmp);
    const card=({r})=>`<article class="card rr-rule"><div class="rr-rule-head"><button class="rr-title" data-rr-open="${esc(r.id)}">${esc(r.name)}</button>${ruleMethodLabel(r.id,r.type)}<span class="badge">${r.status==='active'?'Activă':r.status==='paused'?'În pauză':esc(r.status)}</span></div><p><strong>${esc(money(r.amount,r.currency))}</strong> · ${esc(typeLabel[r.type]||r.type)}</p><p class="card-sub">${esc(accountName(r.account))}${r.toAccount?' → '+esc(accountName(r.toAccount)):''} · ${esc(every(r))}</p></article>`;
    const groups=new Map();active.forEach(x=>{if(!groups.has(x.date))groups.set(x.date,[]);groups.get(x.date).push(x);});
    return `<h2 class="card-title">Recurențe programate</h2><p class="card-sub">În ordine crescătoare, grupate după următoarea scadență neînregistrată. Facturile manuale rămân în Google Tasks. Înregistrarea în evidență nu confirmă plata sau debitarea bancară.</p>`+
      [...groups].map(([date,list])=>`<section aria-label="Scadențe ${esc(fmtDate(date))}"><h3 class="card-title" style="margin:20px 0 12px">${esc(fmtDate(date))} <span class="badge">${list.length}</span></h3><div class="rr-list">${list.map(card).join('')}</div></section>`).join('')+
      (other.length?`<section><h3 class="card-title" style="margin:20px 0 12px">În pauză / fără scadențe viitoare</h3><div class="rr-list">${other.map(card).join('')}</div></section>`:'');
  }
  function detail(r) {
    return `<section class="card"><div class="rr-rule-head"><h2 class="card-title">${esc(r.name)}</h2><button class="btn btn-secondary" id="rr-back">Înapoi</button></div><div class="rr-facts"><div><span>Sumă sugerată</span><strong>${esc(money(r.amount,r.currency))}</strong></div><div><span>Tip</span><strong>${esc(typeLabel[r.type]||r.type)}</strong></div><div><span>Cont</span><strong>${esc(accountName(r.account))}${r.type==='transfer'?' → '+esc(accountName(r.toAccount)):''}</strong></div><div><span>Repetare</span><strong>${esc(every(r))}</strong></div><div><span>Următoarea</span><strong>${esc(fmtDate(nextOcc(r)))}</strong></div></div>${r.note?`<p style="white-space:pre-wrap">${esc(r.note)}</p>`:''}${r.readinessError?`<p class="card-sub">${esc(r.readinessError)}</p>`:''}<div class="btn-row">${r.status==='active'?`<button class="btn btn-primary" data-rr-early="${esc(r.id)}" ${busy?'disabled':''}>Introdu acum</button>`:''}<button class="btn btn-secondary" data-rr-edit="${esc(r.id)}">Modifică</button><button class="btn btn-secondary" id="rr-toggle">${r.status==='active'?'Pune în pauză':'Reia'}</button></div></section>`;
  }
  function form(r) {
    r=r||{id:'rule-'+crypto.randomUUID(),name:'',note:'',mode:'review',status:'active',startDate:data.today,interval:1,unit:'month',type:'cheltuiala',amount:'',currency:context().settings?.baseCurrency||'EUR',category:'',account:'',toAccount:''};
    draft=r;
    const acc=accounts(), o=(key)=>'<option value="">Alege contul</option>'+acc.map(a=>`<option value="${esc(a.id)}" ${r[key]===a.id?'selected':''}>${esc(a.name)} (${esc(a.currency)})</option>`).join('');
    const cats=(context().categories||[]).filter(c=>c.active!==false&&(c.type||c.kind||'cheltuiala')===(r.type==='venit'?'venit':'cheltuiala'));
    const sel=(id,opts,val)=>`<select class="input" id="rr-${id}">${opts.map(([v,l])=>`<option value="${esc(v)}" ${v===val?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
    return `<section class="card"><div class="rr-rule-head"><h2 class="card-title">${rule()?'Modifică recurența':'Recurență nouă'}</h2><button class="btn btn-secondary" id="rr-cancel">Renunță</button></div><form id="rr-form" class="form-grid rr-editor-grid" data-rule-id="${esc(r.id)}">`+
      `<div class="field"><label>Nume</label><input class="input" id="rr-name" maxlength="100" required value="${esc(r.name)}"></div>`+
      `<div class="field"><label>Tip</label>${sel('type',[['cheltuiala','Cheltuială'],['venit','Venit'],['transfer','Transfer'],['investitie','Investiție']],r.type)}</div>`+
      `<div class="field"><label>Sumă sugerată</label><input class="input" id="rr-amount" inputmode="decimal" required value="${esc(r.amount)}"></div>`+
      `<div class="field"><label>Monedă</label><input class="input" id="rr-currency" maxlength="3" required value="${esc(r.currency)}"></div>`+
      `<div class="field"><label>Cont</label><select class="input" id="rr-account">${o('account')}</select></div>`+
      `<div class="field" id="rr-target-field" ${r.type==='transfer'||r.type==='investitie'?'':'hidden'}><label>Cont destinație</label><select class="input" id="rr-toaccount">${o('toAccount')}</select></div>`+
      `<div class="field" id="rr-cat-field" ${r.type==='transfer'||r.type==='investitie'?'hidden':''}><label>Categorie</label><select class="input" id="rr-category"><option value="">Alege categoria</option>${cats.map(c=>`<option value="${esc(c.id)}" ${r.category===c.id?'selected':''}>${esc((c.emoji||'')+' '+c.name)}</option>`).join('')}</select></div>`+
      `<div class="field"><label>Prima scadență</label><input class="input" type="date" id="rr-start" required value="${esc(r.startDate)}"></div>`+
      `<div class="field"><label>Se repetă la</label><input class="input" type="number" min="1" max="120" id="rr-interval" value="${esc(r.interval)}">${sel('unit',[['day','zile'],['week','săptămâni'],['month','luni'],['year','ani']],r.unit)}</div>`+
      `<div class="field"><label>Ultima scadență (opțional)</label><input class="input" type="date" id="rr-end" value="${esc(r.endDate||'')}"></div>`+
      `<div class="field"><label>Notiță (se păstrează exact)</label><textarea class="input" id="rr-note" rows="3">${esc(r.note)}</textarea></div>`+
      `<div class="btn-row"><button class="btn btn-primary" type="submit" ${busy?'disabled':''}>Salvează</button></div></form></section>`;
  }
  function render() {
    syncOwner();
    if(!connected()) return header()+'<section class="card"><p>Recurențele sunt disponibile după conectarea la datele tale. În modul demo nu pornește nimic.</p><button class="btn btn-primary" data-view="settings">Deschide setările</button></section>';
    const errorHtml=error?`<p class="rr-error card" role="alert">${esc(error)}</p>`:'';
    if(!data) return header()+errorHtml+`<section class="card"><p>${busy?'Se citesc scadențele…':'Reîncarcă pentru a vedea scadențele.'}</p></section>`;
    if(early) return header()+errorHtml+earlyView();
    if(editing) return header()+errorHtml+form(draft||rule());
    if(selected&&rule()) return header()+errorHtml+detail(rule());
    const items=pendingItems().slice().sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'ro'));
    const agenda = renderDatedAgenda(items.map(i => ({date:i.date,name:i.name||'',html:reviewCard(i)})));
    return header()+errorHtml+agenda+pushSection()+rulesList();
  }

  async function post(key) {
    const i=findItem(key), d=drafts[key]; if(!i||!d) return;
    const amount=Number(String(d.amount).replace(',','.')), acc=accObj(d.account);
    const err=!(amount>0)?'Suma trebuie să fie mai mare decât 0.':!acc?'Alege contul.':((i.type==='transfer'||i.type==='investitie')&&(!d.toAccount||d.toAccount===d.account))?'Alege un cont destinație diferit.':!/^\d{4}-\d\d-\d\d$/.test(d.date)?'Alege data.':'';
    if(err){cardErrors[key]=err;refresh();return;}
    delete cardErrors[key]; busy=true; refresh();
    try {
      const session=sessions[key]||(sessions[key]=createTransactionSaveSession(store,{requestId:i.id}));
      const payload={id:i.id,date:d.date,type:i.type,amount,currency:acc.currency,account:d.account,category:i.category,description:i.name,merchant:i.merchant,method:i.method||'Transfer bancar',source:i.source,bill:i.ruleId};
      if(i.type==='transfer'||i.type==='investitie'){const dst=accObj(d.toAccount),raw=String(d.toAmount==null?'':d.toAmount).replace(',','.').trim();let ta=raw===''?null:Number(raw);if(ta!==null&&!(ta>0)){cardErrors[key]='Suma primită trebuie să fie mai mare decât 0.';busy=false;refresh();return;}if(ta===null){if(dst&&dst.currency===acc.currency)ta=amount;else{cardErrors[key]='Completează suma primită'+(dst?' în '+dst.currency:'')+', așa cum apare în extras. Nu estimăm cursul.';busy=false;refresh();return;}}payload.toAccount=d.toAccount;payload.toAmount=ta;}
      const res=await session.save(payload);
      if(res.status==='rejected'||res.status==='unconfirmed'){cardErrors[key]=res.message;}
      else{done.add(key);delete sessions[key];if(i.state==='early'){early=null;selected='';delete drafts[key];}notify(res.status==='confirmed'?'Înregistrat.':'Salvat. Se trimite în fundal.',3200);}
    } catch(e){cardErrors[key]=e.message;}
    finally{busy=false;pendingCount=pendingItems().length;refresh();if(i.state==='early'&&!early)load();}
  }
  async function subscribe(on) {
    const reg=await navigator.serviceWorker.ready;
    if(!on){const s=await reg.pushManager.getSubscription();if(s){await request(removePushSubscription,s.endpoint);await s.unsubscribe();}setData((await request(readRecurrences)).recurrenceState);return;}
    const perm=await Notification.requestPermission(); if(perm!=='granted')throw new Error('Permisiunea pentru notificări nu a fost acordată.');
    const s=(await reg.pushManager.getSubscription())||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlKey(data.push.vapidPublicKey)});
    await request(savePushSubscription,s.endpoint);
    setData((await request(readRecurrences)).recurrenceState); notify('Notificările sunt active pe acest telefon.',4000);
  }
  function bind(root) {
    const on=(sel,fn)=>{const e=root.querySelector(sel);if(e)e.onclick=fn;};
    on('#rr-refresh',load);on('#rr-new',()=>{error='';selected='';draft=null;editing=true;refresh();});
    on('#rr-early-cancel',()=>{early=null;error='';refresh();});
    root.querySelectorAll('[data-rr-early]').forEach(b=>b.onclick=()=>{const r=data.rules.find(x=>x.id===b.dataset.rrEarly);if(r)startEarly(r);});
    const eo=root.querySelector('#rr-early-occ');if(eo)eo.onchange=()=>{early.occ=eo.value;const r=data.rules.find(x=>x.id===early.ruleId);early.item=earlyItem(r,early.occ);refresh();};
    on('#rr-back',()=>{error='';selected='';refresh();});
    on('#rr-push-on',()=>perform(()=>subscribe(true)));on('#rr-push-off',()=>perform(()=>subscribe(false)));
    const cancel=()=>{error='';editing=false;draft=null;refresh();};on('#rr-cancel',cancel);
    root.querySelectorAll('[data-rr-open]').forEach(b=>b.onclick=()=>{error='';selected=b.dataset.rrOpen;editing=false;refresh();});
    root.querySelectorAll('[data-rr-edit]').forEach(b=>b.onclick=()=>{error='';selected=b.dataset.rrEdit;draft={...rule()};editing=true;refresh();});
    root.querySelectorAll('[data-rr-post]').forEach(b=>b.onclick=()=>post(b.dataset.rrPost));
    root.querySelectorAll('[data-rr-skip]').forEach(b=>b.onclick=()=>{const i=(data.review||[]).find(x=>x.key===b.dataset.rrSkip);if(!i||!confirm(`Omiți scadența ${fmtDate(i.date)} pentru ${i.name}? Nu se înregistrează nimic.`))return;perform(async()=>{setData((await request(skipRecurrenceOccurrence,i.ruleId,i.date)).recurrenceState);});});
    root.querySelectorAll('[data-f]').forEach(el=>{const h=()=>{const d=drafts[el.dataset.k];if(!d)return;d[el.dataset.f]=el.value;if(el.dataset.f==='account'){const c=root.querySelector(`[data-cur="${CSS.escape(el.dataset.k)}"]`);if(c)c.textContent=accObj(el.value)?.currency||'';}};el.oninput=h;el.onchange=h;});
    on('#rr-toggle',()=>perform(async()=>{const r=rule();setData((await request(saveRecurrence,{...r,status:r.status==='active'?'paused':'active'},r.revision)).recurrenceState);}));
    const f=root.querySelector('#rr-form');if(!f)return;
    const q=id=>root.querySelector('#rr-'+id);
    const collect=()=>{const old=rule()||{};return {...old,id:f.dataset.ruleId,name:q('name').value,note:q('note').value,mode:'review',status:old.status||'active',type:q('type').value,amount:q('amount').value,currency:q('currency').value.toUpperCase(),account:q('account').value,toAccount:q('toaccount')?q('toaccount').value:'',category:q('category')?q('category').value:'',startDate:q('start').value,endDate:q('end').value,interval:Number(q('interval').value)||1,unit:q('unit').value};};
    q('type').onchange=()=>{draft=collect();refresh();};
    f.onsubmit=e=>{e.preventDefault();const old=rule()||{};
      const next={...old,id:f.dataset.ruleId,name:q('name').value,note:q('note').value,mode:'review',status:old.status||'active',type:q('type').value,amount:Number(String(q('amount').value).replace(',','.')),currency:q('currency').value.toUpperCase(),account:q('account').value,toAccount:q('toaccount')?q('toaccount').value:'',category:q('category')?q('category').value:'',startDate:q('start').value,endDate:q('end').value,interval:Number(q('interval').value)||1,unit:q('unit').value,confirmFixed:false};
      draft=next;perform(async()=>{setData((await request(saveRecurrence,next,old.revision)).recurrenceState);selected=next.id;editing=false;draft=null;notify('Recurența a fost salvată.');});};
  }
  return {render,bind,load};
}
