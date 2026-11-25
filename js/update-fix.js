// Robust "Actualizează": always uses the CURRENT service worker registration, waits for an install in progress,
// asks the waiting worker to take over, and if the page has not reloaded after a few seconds, falls back to
// dropping the app-shell caches and reloading. Only the code cache is touched; Sheet data and the local save queue are not.
window.__applyUpdate = async function (reg0) {
  const hard = async () => {
    try {
      (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
      const ks = await caches.keys();
      await Promise.all(ks.filter(k => k.startsWith('buget-familie-')).map(k => caches.delete(k)));
    } catch { /* reload anyway */ }
    location.reload();
  };
  window.__updateRequested = true;
  setTimeout(hard, 5000);
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || reg0;
    try { await reg.update(); } catch { /* offline: use what is there */ }
    if (reg.installing) {
      const w = reg.installing;
      await new Promise(res => { if (w.state === 'installed' || w.state === 'activated' || w.state === 'redundant') return res(); w.addEventListener('statechange', () => { if (['installed', 'activated', 'redundant'].includes(w.state)) res(); }); });
    }
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch { /* the timer above still falls back */ }
};
