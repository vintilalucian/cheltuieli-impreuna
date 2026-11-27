import { store } from './store.js';
import { syncFromSheet } from './sheets-api.js';
import { acknowledgeSavedConflict } from './conflict-ack-core.js';

export function installConflictAcknowledgement() {
  const modal=document.getElementById('modal-main');
  if(!modal)return;
  const install=()=>{
    if(!modal.classList.contains('open')||!modal.textContent.includes('Operații neconfirmate')||modal.querySelector('[data-ack-panel]'))return;
    const candidates=store.state.failedQueue.filter(f=>f.errorCode==='VERSION_CONFLICT'&&f.op?.type==='updateExpense');
    if(!candidates.length)return;
    const panel=document.createElement('section');panel.className='card';panel.dataset.ackPanel='true';
    const title=document.createElement('h3');title.textContent='Confirmă o editare deja salvată';panel.append(title);
    const note=document.createElement('p');note.textContent='Verificăm din nou rândul din Sheets. Numai dacă toate datele coincid, închidem avertizarea locală și păstrăm o copie de diagnostic. Nu retrimitem și nu modificăm tranzacția.';panel.append(note);
    for(const failed of candidates){
      const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent='Verifică și confirmă ca deja salvată';
      const status=document.createElement('p');status.setAttribute('role','status');
      button.addEventListener('click',async()=>{
        button.disabled=true;status.textContent='Citesc versiunea salvată, fără modificări…';
        try{
          const {webAppUrl,pin}=store.state.connection;
          await acknowledgeSavedConflict(store,failed,()=>syncFromSheet(webAppUrl,pin));
          status.textContent='Confirmat: editarea este deja salvată. Avertizarea locală a fost închisă, copia de diagnostic este păstrată. Nicio tranzacție modificată.';
          button.textContent='Deja salvată, confirmată';
        }catch(error){status.textContent=error.message||'Verificarea a eșuat. Editarea rămâne păstrată.';button.disabled=false;}
      });
      panel.append(button,status);
    }
    modal.querySelector('.modal-sheet')?.append(panel);
  };
  new MutationObserver(install).observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  install();
}
