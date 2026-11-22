const normalize = (s) => String(s || '').trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('ro-RO');
const kindOf = (c) => (c.type || c.kind) === 'venit' ? 'venit' : 'cheltuiala';
const matches = (c, name, kind) => c && c.active !== false && normalize(c.name) === normalize(name) && kindOf(c) === kind;
export function createInlineCategorySession(store, { makeId = () => 'cat-' + crypto.randomUUID() } = {}) {
  const expectedVersion = store.state.tableVersions.categories;
  let entry = null, submitted = false, inflight = null;
  const pending = () => store.state.pendingQueue.find(q => q.type === 'saveCategories' && q.categoryDraftId === entry?.id);
  const failure = () => [...store.state.failedQueue].reverse().find(q => q.op?.type === 'saveCategories' && q.op.categoryDraftId === entry?.id);
  const result = () => {
    const failed = failure();
    if (failed) return {status:'rejected', entry, message:failed.error || 'Categoria nu a fost confirmată.'};
    if (pending()) return {status:'pending', entry, message:store.state.lastError || 'Așteaptă sincronizarea.'};
    const current = store.state.categories.find(c => c.id === entry.id);
    if (!store.isConnected()) {
      if (current) delete current.pendingInlineCategory;
      store.emit();
      return {status:'local', entry:current || entry};
    }
    return {status:'confirmed', entry:current || entry};
  };
  const save = async ({name, kind}) => {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    kind = kind === 'venit' ? 'venit' : 'cheltuiala';
    if (!name) throw new Error('Completează numele categoriei.');
    if (name.length > 60) throw new Error('Numele poate avea cel mult 60 de caractere.');
    if (!entry) {
      const queued = store.state.pendingQueue.find(q => q.type === 'saveCategories' && q.categoryDraftId && q.categories?.some(c => c.id === q.categoryDraftId && matches(c,name,kind)));
      if (queued) { entry = queued.categories.find(c => c.id === queued.categoryDraftId); submitted = true; }
      else {
        const existing = store.state.categories.find(c => matches(c,name,kind));
        if (existing && !existing.pendingInlineCategory) return {status:'existing',entry:existing};
        if (existing) {entry=existing;submitted=true;return result();}
        entry = {id:makeId(),name,type:kind,kind,emoji:'📦',icon:'📦',color:'#2a78d6',budget:0,active:true,order:store.state.categories.length+1,pendingInlineCategory:true};
      }
    }
    if (submitted) {
      if (failure()) return result();
      await store.flushQueue();
    } else {
      submitted = true;
      try {
        await store.saveCategories([...store.state.categories.filter(c=>c.id!==entry.id),entry],{categoryDraftId:entry.id,expectedVersion});
      } catch (error) {
        submitted = Boolean(pending() || failure());
        if (submitted) return result();
        throw error;
      }
    }
    return result();
  };
  return {
    get submitted(){return submitted;},
    save(draft) {
      if (inflight) return inflight;
      inflight=save(draft).finally(()=>{inflight=null;});
      return inflight;
    }
  };
}
