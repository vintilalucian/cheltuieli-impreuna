import { getPendingReviewCount } from './recurrences-ui.js';
// Shows a "de verificat" shortcut at the top of the dashboard while recurring items wait for review.
export function installReviewBanner() {
  const root = document.querySelector('#view-root');
  if (!root) return;
  const apply = () => {
    const n = getPendingReviewCount();
    const view = document.querySelector('.nav-item.active, .side-btn.active')?.dataset.view;
    const ex = root.querySelector('[data-rr-banner]');
    if (view !== 'dashboard' || !n) { if (ex) ex.remove(); return; }
    if (ex && ex.dataset.n === String(n)) return;
    if (ex) ex.remove();
    const b = document.createElement('button');
    b.className = 'rr-banner'; b.dataset.rrBanner = '1'; b.dataset.n = String(n); b.dataset.view = 'recurrences';
    b.textContent = `🔁 ${n} ${n === 1 ? 'scadență' : 'scadențe'} de verificat`;
    root.prepend(b);
  };
  new MutationObserver(apply).observe(root, { childList: true });
  setInterval(apply, 1500);
  apply();
}
