import { normalizeTx, validateTransaction } from './ledger.js';

// Only persisted transaction fields. Transport/version flags are deliberately excluded.
export function canonicalSavedTx(raw) {
  const t = normalizeTx(raw);
  if (!t || !validateTransaction(t).valid) throw new Error('Înregistrare invalidă; confirmarea este oprită.');
  for (const k of ['amount','rate','baseAmount']) {
    if (raw[k] === '' || raw[k] == null || !Number.isFinite(Number(raw[k]))) throw new Error('Date incomplete; confirmarea este oprită.');
  }
  return {
    id:String(t.id), date:String(t.date), type:t.type,
    amount:Number(t.amount), currency:String(t.currency).toUpperCase(), rate:Number(t.rate), baseAmount:Number(t.baseAmount),
    category:String(t.category || ''), description:t.description, merchant:t.merchant, method:t.method,
    isPrivate:!!t.isPrivate, created:t.created, account:t.account, toAccount:t.toAccount, toAmount:t.toAmount,
    payer:t.payer, owner:String(t.owner || '').toLowerCase(), bill:t.bill, source:t.source,
    person:String(t.person || ''), loan:!!t.loan
  };
}
export function savedTxDifferences(a,b) {
  const x=canonicalSavedTx(a),y=canonicalSavedTx(b);
  return Object.keys(x).filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]));
}
export async function acknowledgeSavedConflict(store, failed, readFresh, storage=localStorage) {
  if (failed?.errorCode!=='VERSION_CONFLICT'||failed?.op?.type!=='updateExpense') throw new Error('Acest conflict nu poate fi confirmat aici.');
  const original=JSON.stringify(failed);
  const id=failed.op.expense?.id;
  if (!id || store.state.pendingQueue.some(o=>(o.expense?.id||o.id)===id)) throw new Error('Există o salvare în curs pentru acest rând. Așteaptă confirmarea.');
  const data=await readFresh();
  const matches=(data?.expenses||[]).filter(t=>t.id===id);
  if(matches.length!==1) throw new Error('Nu am găsit exact o înregistrare salvată. Nu schimb nimic.');
  const differences=savedTxDifferences(failed.op.expense,matches[0]);
  if(differences.length) throw new Error('Există diferențe: '+differences.join(', ')+'. Editarea rămâne păstrată.');
  const index=store.state.failedQueue.indexOf(failed);
  if(index<0||JSON.stringify(failed)!==original||store.state.pendingQueue.some(o=>(o.expense?.id||o.id)===id)) throw new Error('Starea locală s-a schimbat. Redeschide verificarea.');
  const key='buget_familie_acknowledged_conflicts_v1';
  const archive=JSON.parse(storage.getItem(key)||'[]');
  if(!Array.isArray(archive)) throw new Error('Arhiva locală nu poate fi citită.');
  archive.push({acknowledgedAt:new Date().toISOString(),reason:'fresh-server-payload-identical',failed:JSON.parse(original),server:matches[0]});
  const encoded=JSON.stringify(archive);
  storage.setItem(key,encoded);
  if(storage.getItem(key)!==encoded) throw new Error('Copia de diagnostic nu a putut fi verificată.');
  store.state.failedQueue.splice(index,1);
  try {store.persist(true);} catch(error) {store.state.failedQueue.splice(index,0,failed);throw error;}
  store.emit();
  return {id,archived:true};
}
