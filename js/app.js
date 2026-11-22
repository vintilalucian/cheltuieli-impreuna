import {
  MONTHS_RO,
  PAYMENT_METHODS,
  TX_TYPES,
  ACCOUNT_TYPES,
  SHARED_OWNER
} from "./defaults.js";
import { store } from "./store.js";
import { computeMonthlyAnalytics, formatMoney } from "./insights.js";
import { computeAccountBalances, normalizeAccountOwner } from "./ledger.js";
import { renderDonutChart, renderMonthlyTrendChart, renderDailyBarsChart } from "./charts.js";
import { exportToExcel, previewImportFile } from "./excel.js";
import { encodeSetupCode, decodeSetupCode, buildTransferLink } from "./sheets-api.js";

let currentView = "dashboard";
let txSearch = "";
let txTypeFilter = "all";
let txCategoryFilter = "all";
let txAccountFilter = "all";
let txDayFilter = "";
let txWeekdayFilter = ""; // weekday index (as in insights) within the selected month
let txNote = ""; // short banner text for card drilldowns
let txBalanceFilter = false; // net balance drill: only income + expenses (no transfers/investments/adjustments)
let txForeignFilter = false; // transactions in a currency other than the base currency
let txAllMonths = false; // category opened from a detail view: all months, newest first, grouped by month

function resetTxFilters() {
  txAllMonths = false;
  txNote = "";
  txBalanceFilter = false;
  txForeignFilter = false;
  txWeekdayFilter = "";
  txTypeFilter = "all";
  txCategoryFilter = "all";
  txAccountFilter = "all";
  txDayFilter = "";
  txSearch = "";
}

let editingExpenseId = null;

const $ = (sel, root = document) => root.querySelector(sel);

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function accountIcon(type) {
  const found = ACCOUNT_TYPES.find((t) => t.id === type);
  return found ? found.icon : "🏦";
}

function showToast(msg, duration = 3200) {
  const wrap = $("#toast-container");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s";
    setTimeout(() => el.remove(), 260);
  }, duration);
}

// =========================================================================
// Inițializare & Portabilitate FĂRĂ credențiale în URL (#setup=BF2-...)
// =========================================================================
function checkUrlSetupHash() {
  const hash = window.location.hash || "";
  if (!hash.includes("setup=BF2-")) return;
  try {
    const cfg = decodeSetupCode(hash);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    store.state.connection.webAppUrl = cfg.webAppUrl;
    store.persist();
    currentView = "settings";
    render();
    showToast("Adresa Web App a fost preluată. Introdu cheia ta de acces în Setări pentru conectare.", 5000);
  } catch (err) {
    showToast("Eroare la link-ul de configurare: " + err.message, 5000);
  }
}

// Update flow: a new version waits in the background; the user chooses when to switch.
// Nothing reloads automatically, so unsaved forms and the offline queue (persisted in localStorage) are never cut off.
function hasUnsavedForm() {
  const open = document.querySelectorAll(".modal-backdrop.open");
  for (const m of open) {
    for (const el of m.querySelectorAll("input, select, textarea")) {
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked !== el.defaultChecked) return true; }
      else if (el.tagName === "SELECT") { if ([...el.options].some((o) => o.selected !== o.defaultSelected)) return true; }
      else if (el.value !== el.defaultValue) return true;
    }
  }
  return false;
}

// Link back to the user's own Sheet. The URL comes from the user's own bridge after authentication and is kept only in this
// device's local storage (never in the public source). Only genuine Google Sheets URLs are linked; Google's own sharing rules still decide who can open it.
function sheetLinkHtml(url) {
  const u = String(url || "");
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(\/[^\s"'<>]*)?$/.test(u)) return "";
  return ` • <a id="link-open-sheet" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Deschide Sheet-ul</a>`;
}

function showUpdateBanner(reg) {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:8px;right:8px;bottom:72px;z-index:9999;background:#1f2937;color:#fff;padding:10px 12px;border-radius:10px;display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:14px";
  bar.innerHTML = '<span>Versiune nouă disponibilă.</span><button type="button" id="update-apply" style="padding:8px 12px;border-radius:8px;border:0;background:#fff;color:#111827;font-weight:600;font-size:14px">Actualizează</button>';
  document.body.appendChild(bar);
  document.getElementById("update-apply").onclick = () => {
    // An open form with unsaved typing would be lost on reload: ask first. Queued (pending) writes are persisted and survive.
    if (hasUnsavedForm() && !window.confirm("Ai o intrare nesalvată în formular. Dacă actualizezi acum, ce ai completat se pierde. Actualizezi oricum?")) return;
    window.__updateRequested = true;
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  };
}

function registerServiceWorker() {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !window.__updateRequested) return; // reload only after the user tapped the button
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    const offer = () => { if (navigator.serviceWorker.controller && reg.waiting) showUpdateBanner(reg); };
    offer();
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(); });
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

function initApp() {
  document.documentElement.setAttribute("data-theme", store.state.theme);

  if ("serviceWorker" in navigator) {
    registerServiceWorker();
  }

  window.addEventListener("online", () => {
    if (store.isConnected()) {
      store.flushQueue().then(() => {
        if (!store.state.pendingQueue.length) showToast("Conexiune restabilită — date sincronizate!");
      });
    }
  });

  store.subscribe(() => render());
  bindGlobalEvents();
  render();
  checkUrlSetupHash();

  if (store.isConnected() && navigator.onLine) {
    store.sync().catch(() => {});
  }
}

function bindGlobalEvents() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest && e.target.closest('[role="button"][data-open-account], [role="button"][data-chart-category], [role="button"][data-view-expense], [role="button"][data-insight-drill], [role="button"][data-open-category]');
    if (el) { e.preventDefault(); el.click(); }
  });

  document.addEventListener("click", (e) => {
    const navBtn = e.target.closest("[data-view]");
    if (navBtn) {
      currentView = navBtn.dataset.view;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const openAcc = e.target.closest("[data-open-account]");
    if (openAcc) {
      resetTxFilters();
      txAccountFilter = openAcc.dataset.openAccount;
      currentView = "transactions";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const chartCat = e.target.closest("[data-chart-category]");
    if (chartCat) {
      resetTxFilters();
      txTypeFilter = "cheltuiala";
      txCategoryFilter = chartCat.dataset.chartCategory;
      currentView = "transactions";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const chartMonth = e.target.closest("[data-chart-month]");
    if (chartMonth) {
      const [yy, mm] = chartMonth.dataset.chartMonth.split("-").map(Number);
      store.setMonth(yy, mm);
      return;
    }

    const chartDay = e.target.closest("[data-chart-day]");
    if (chartDay) {
      resetTxFilters();
      txTypeFilter = "cheltuiala";
      const st = store.state;
      txDayFilter = `${st.selectedYear}-${String(st.selectedMonth + 1).padStart(2, "0")}-${String(chartDay.dataset.chartDay).padStart(2, "0")}`;
      currentView = "transactions";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (e.target.closest("#btn-clear-tx-filters")) {
      resetTxFilters();
      render();
      return;
    }

    const partnerBtn = e.target.closest("[data-switch-partner]");
    if (partnerBtn) {
      if (store.isConnected()) {
        showToast("Când ești conectat, profilul este determinat automat de cheia ta de acces.", 3500);
        return;
      }
      store.setActivePartner(partnerBtn.dataset.switchPartner);
      showToast(`Profil demo activ: ${store.getPartnerName(store.state.activePartner)}`);
      return;
    }

    const scopeBtn = e.target.closest("[data-scope]");
    if (scopeBtn) {
      store.setScope(scopeBtn.dataset.scope);
      return;
    }

    if (e.target.closest("#btn-prev-month")) { store.shiftMonth(-1); return; }
    if (e.target.closest("#btn-next-month")) { store.shiftMonth(1); return; }
    if (e.target.closest("#btn-theme")) { store.toggleTheme(); return; }
    if (e.target.closest("#btn-sync")) { handleManualSync(); return; }
    if (e.target.closest("#fab-add")) { openExpenseModal(null); return; }

    const insDrill = e.target.closest("[data-insight-drill]");
    if (insDrill) {
      resetTxFilters();
      if (insDrill.dataset.insightDrill === "weekday") { txTypeFilter = "cheltuiala"; txWeekdayFilter = insDrill.dataset.insightIndex; }
      else if (insDrill.dataset.insightDrill === "shared") { store.setScope("shared"); }
      else if (insDrill.dataset.insightDrill === "balance") { txBalanceFilter = true; txNote = "⚖️ Venituri și cheltuieli (fără transferuri, investiții și ajustări)"; }
      else if (insDrill.dataset.insightDrill === "foreign") { txForeignFilter = true; txNote = "💱 Tranzacții în alte valute decât moneda de bază"; }
      else if (insDrill.dataset.insightDrill === "type") { txTypeFilter = insDrill.dataset.insightIndex; txNote = "📌 Tip: " + ((TX_TYPES[txTypeFilter] || {}).label || txTypeFilter); }
      else if (insDrill.dataset.insightDrill === "category") { txTypeFilter = "cheltuiala"; txCategoryFilter = insDrill.dataset.insightIndex; }
      currentView = "transactions"; render(); window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const openCat = e.target.closest("[data-open-category]");
    if (openCat) {
      resetTxFilters();
      txCategoryFilter = openCat.dataset.openCategory; txAllMonths = true;
      currentView = "transactions"; render(); window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const detailEdit = e.target.closest("[data-detail-edit]");
    if (detailEdit) { openExpenseModal(detailEdit.dataset.detailEdit); return; }
    const detailCat = e.target.closest("[data-detail-category]");
    if (detailCat) {
      closeModals(); resetTxFilters();
      txCategoryFilter = detailCat.dataset.detailCategory; txAllMonths = true;
      currentView = "transactions"; render(); window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const detailAcc = e.target.closest("[data-detail-account]");
    if (detailAcc) {
      closeModals(); resetTxFilters();
      txAccountFilter = detailAcc.dataset.detailAccount;
      currentView = "transactions"; render(); window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const txRow = e.target.closest("[data-view-expense]");
    if (txRow) {
      openExpenseDetail(txRow.dataset.viewExpense);
      return;
    }

    if (e.target.closest("[data-close-modal]") || e.target.classList.contains("modal-backdrop")) {
      closeModals();
      return;
    }
  });
}

async function handleManualSync() {
  if (!store.isConnected()) {
    currentView = "settings";
    render();
    showToast("Conectează fișierul Google Sheets din Setări.");
    return;
  }
  try {
    await store.sync();
    showToast("Sincronizat cu Google Sheets (schema v4)!");
  } catch (err) {
    showToast("Eroare sincronizare: " + err.message, 4500);
  }
}

// =========================================================================
// Render principal
// =========================================================================
function render() {
  renderChrome();
  const root = $("#view-root");
  if (currentView === "dashboard") root.innerHTML = renderDashboard();
  else if (currentView === "transactions") root.innerHTML = renderTransactions();
  else if (currentView === "analytics") root.innerHTML = renderAnalytics();
  else if (currentView === "catalog") root.innerHTML = renderCatalog();
  else if (currentView === "settings") root.innerHTML = renderSettings();

  bindViewSpecificEvents();
}

function singleMemberView() {
  const s = store.state;
  return store.isConnected() && Array.isArray(s.members) && s.members.length === 1;
}

function renderChrome() {
  const s = store.state;
  if (s.scope === "partner" && store.isConnected() && Array.isArray(s.members) && s.members.length === 1) s.scope = "all";
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });

  const p1Btn = $("#pill-p1");
  const p2Btn = $("#pill-p2");
  if (p1Btn && p2Btn) {
    p1Btn.textContent = s.settings.partner1Name || "Eu";
    p2Btn.textContent = s.settings.partner2Name || "Soția";
    p1Btn.classList.toggle("active", s.activePartner === "p1");
    p2Btn.classList.toggle("active", s.activePartner === "p2");
    // Un singur membru configurat în Sheet: nu sugerăm un al doilea profil cu acces.
    const single = store.isConnected() && Array.isArray(s.members) && s.members.length === 1;
    p2Btn.hidden = single;
    p2Btn.style.display = single ? "none" : "";
  }

  const themeBtn = $("#btn-theme");
  if (themeBtn) themeBtn.textContent = s.theme === "dark" ? "☀️" : "🌙";

  const syncDot = $("#sync-dot");
  const syncLabel = $("#sync-label");
  if (syncDot && syncLabel) {
    syncDot.className = "sync-dot";
    if (s.syncing) {
      syncDot.classList.add("spinning");
      syncLabel.textContent = "Sincronizare...";
    } else if (!store.isConnected()) {
      syncLabel.textContent = s.isDemoMode ? "Demo" : "Local";
    } else if (s.lastError) {
      syncDot.classList.add("error");
      syncLabel.textContent = "Eroare";
    } else if (s.pendingQueue.length > 0) {
      syncDot.classList.add("pending");
      syncLabel.textContent = `Coadă (${s.pendingQueue.length})`;
    } else {
      syncDot.classList.add("online");
      syncLabel.textContent = "Sheets v4 OK";
    }
  }
}

function renderControlsRow(opts = {}) {
  const s = store.state;
  const monthName = opts.allMonths ? "Toate lunile" : `${MONTHS_RO[s.selectedMonth]} ${s.selectedYear}`;
  const singleMember = store.isConnected() && Array.isArray(s.members) && s.members.length === 1;
  const meName = store.getPartnerName(s.activePartner);
  const otherName = store.getPartnerName(s.activePartner === "p1" ? "p2" : "p1");

  const scopes = singleMember
    ? [
        { id: "all", label: "Toate" },
        { id: "shared", label: "Doar Comune" },
        { id: "mine", label: `Doar ${meName}` },
        { id: "private", label: "🔒 Private (doar în app)" }
      ]
    : [
        { id: "all", label: "Împreună" },
        { id: "shared", label: "Doar Comune" },
        { id: "mine", label: `Doar ${meName}` },
        { id: "partner", label: `Doar ${otherName}` },
        { id: "private", label: "🔒 Private (doar în app)" }
      ];

  return `
    <div class="controls-row">
      <div class="month-nav">
        <button id="btn-prev-month" aria-label="Luna anterioară"${opts.allMonths ? " disabled" : ""}>‹</button>
        <div class="month-label">${monthName}</div>
        <button id="btn-next-month" aria-label="Luna următoare"${opts.allMonths ? " disabled" : ""}>›</button>
      </div>
      <div class="scope-pills">
        ${scopes.map((sc) => `<button class="chip ${s.scope === sc.id ? "active" : ""}" data-scope="${sc.id}">${esc(sc.label)}</button>`).join("")}
      </div>
    </div>
  `;
}

function renderStatusBanners() {
  const s = store.state;
  let html = "";
  if (s.failedQueue && s.failedQueue.length > 0) {
    html += `
      <div class="banner error">
        <div class="banner-text">
          <strong>Conflicte / Operații eșuate (${s.failedQueue.length}):</strong>
          ${s.failedQueue.slice(0, 2).map((f) => `[${esc(f.errorCode)}] ${esc(f.error)}`).join(" • ")}
        </div>
        <button class="btn btn-sm btn-secondary" id="btn-clear-failed">Am înțeles</button>
      </div>
    `;
  }
  if (s.lastError) {
    html += `
      <div class="banner error">
        <div class="banner-text"><strong>Atenție sincronizare:</strong> ${esc(s.lastError)}</div>
        <button class="btn btn-sm btn-secondary" id="btn-retry-sync">Reîncearcă</button>
      </div>
    `;
  } else if (s.auditWarnings && s.auditWarnings.length > 0) {
    html += `
      <div class="banner error">
        <div class="banner-text"><strong>Audit date Sheet:</strong> ${s.auditWarnings.length} avertisment(e) (ex. rânduri fără ID, sume negative sau Sumă (bază) necorelată).</div>
        <button class="btn btn-sm btn-secondary" data-view="analytics">Detalii</button>
      </div>
    `;
  } else if (!store.isConnected() && s.isDemoMode) {
    html += `
      <div class="banner">
        <div class="banner-text"><strong>Mod Demo (date sintetice v4)</strong> — Conturi, venituri, transferuri pe un rând, investiții și import cu previzualizare.</div>
        <button class="btn btn-sm btn-primary" data-view="settings">Setări Sheets</button>
      </div>
    `;
  }
  return html;
}

// =========================================================================
// 1. DASHBOARD (ACASĂ)
// =========================================================================
function renderDashboard() {
  const s = store.state;
  const a = computeMonthlyAnalytics(store, s.selectedYear, s.selectedMonth, s.scope);
  const p1Name = s.settings.partner1Name;
  const p2Name = s.settings.partner2Name;

  const progressClass = a.budgetPct >= 100 ? "danger" : a.budgetPct >= 80 ? "warn" : "";
  const deltaText =
    a.diffPrevPct === null
      ? "Prima lună cu date"
      : `${a.diffPrevPct >= 0 ? "↑" : "↓"} ${Math.abs(a.diffPrevPct)}% față de luna trecută`;

  const splitTotal = a.p1Total + a.p2Total;
  const p1Pct = splitTotal > 0 ? Math.round((a.p1Total / splitTotal) * 100) : 50;
  const p2Pct = splitTotal > 0 ? 100 - p1Pct : 50;

  const activeAccounts = a.accountBalances.filter((acc) => !acc.archived);
  const availVisible = activeAccounts.filter((acc) => acc.visible !== false);
  const sumBase = (list) => Math.round(list.reduce((t, acc) => t + (Number(acc.baseBalance) || 0), 0) * 100) / 100;
  const knownVisible = availVisible.filter((acc) => acc.balanceKnown !== false);
  const unknownBalCount = availVisible.length - knownVisible.length;
  const totalAccounts = sumBase(knownVisible);
  const reservedTotal = sumBase(knownVisible.filter((acc) => acc.includeInAvailable === false));
  const availableTotal = Math.round((totalAccounts - reservedTotal) * 100) / 100;
  const hiddenAccCount = activeAccounts.length - availVisible.length;
  const recent = a.expenses.slice(0, 6);

  return `
    ${renderStatusBanners()}
    ${renderControlsRow()}

    <section class="card hero-card">
      <div class="hero-top">
        <div>
          <div class="hero-label">Cheltuieli nete (${MONTHS_RO[s.selectedMonth]})</div>
          <div class="hero-amount">${formatMoney(a.total, a.baseCur)}</div>
          <span class="hero-delta">${deltaText}</span>
        </div>
        <div style="text-align:right">
          <div class="hero-label">${a.count} ${a.count === 1 ? "tranzacție" : "tranzacții"}</div>
        </div>
      </div>

      ${a.monthlyBudget > 0 ? `
        <div class="budget-progress">
          <div class="progress-meta">
            <span>Buget: ${formatMoney(a.monthlyBudget, a.baseCur)}</span>
            <span>${Math.round(a.budgetPct)}% (${a.remainingBudget >= 0 ? "rămas " + formatMoney(a.remainingBudget, a.baseCur) : "depășit cu " + formatMoney(Math.abs(a.remainingBudget), a.baseCur)})</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${progressClass}" style="width:${Math.min(100, Math.round(a.budgetPct))}%"></div>
          </div>
        </div>
      ` : ""}

      <div class="hero-stats">
        <div>
          <div class="hero-stat-label">Venituri</div>
          <div class="hero-stat-val">${formatMoney(a.ledger.venituri, a.baseCur)}</div>
        </div>
        <div>
          <div class="hero-stat-label">Balanță netă</div>
          <div class="hero-stat-val">${a.ledger.balantaNeta >= 0 ? "+" : ""}${formatMoney(a.ledger.balantaNeta, a.baseCur)}</div>
        </div>
        <div>
          <div class="hero-stat-label">Medie / zi</div>
          <div class="hero-stat-val">${formatMoney(a.dailyAvg, a.baseCur)}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">🏦 Conturi & Solduri (${activeAccounts.length})</h2>
        <button class="btn btn-sm btn-secondary" data-view="catalog">Gestionează</button>
      </div>
      <div class="mini-card" style="margin-bottom:10px; display:block">
        <div style="display:flex; justify-content:space-between; font-weight:800"><span>Disponibil</span><span>${formatMoney(availableTotal, a.baseCur)}</span></div>
        <div style="display:flex; justify-content:space-between" class="card-sub"><span>Rezervat (exclus din disponibil)</span><span>${formatMoney(reservedTotal, a.baseCur)}</span></div>
        <div style="display:flex; justify-content:space-between" class="card-sub"><span>Total conturi cu sold cunoscut (${knownVisible.length})</span><span>${formatMoney(totalAccounts, a.baseCur)}</span></div>
        ${unknownBalCount ? `<div class="card-sub" style="margin-top:6px">⚠️ ${unknownBalCount} cont(uri) fără sold inițial setat: arată doar mișcările înregistrate, nu un sold, și nu intră în totaluri.</div>` : ""}
        <div class="card-sub" style="margin-top:6px">Calculat din soldurile conturilor (nu din buget sau venituri minus cheltuieli)${hiddenAccCount ? `; ${hiddenAccCount} cont(uri) personale ale celuilalt nu sunt incluse` : ""}.</div>
      </div>
      <div class="item-grid">
        ${activeAccounts.map((acc) => `
          <div class="mini-card${acc.visible === false ? "" : " tappable"}" ${acc.visible === false ? "" : `data-open-account="${esc(acc.id)}" role="button" tabindex="0" aria-label="Detalii cont ${esc(acc.name)}"`}>
            <div class="mini-left">
              <div class="mini-icon" style="background:var(--primary-soft); color:var(--primary)">${accountIcon(acc.type)}</div>
              <div>
                <div style="font-weight:700; font-size:0.86rem">${esc(acc.name)}</div>
                <div class="card-sub">${esc(store.getPartnerName(acc.owner))} • ${esc(acc.type)}${acc.initialDate ? ` • din ${esc(acc.initialDate)}` : ""}${acc.includeInAvailable === false ? " • Rezervat" : ""}</div>
              </div>
            </div>
            <div style="text-align:right; font-weight:800; font-size:0.88rem; color:${acc.visible === false ? "var(--text-muted)" : (acc.balance < 0 ? "var(--danger)" : "var(--text)")}">
              ${acc.visible === false ? "🔒 Personal" : (acc.balanceKnown === false ? `<span class="card-sub" style="font-weight:600">Mișcări ${formatMoney(acc.balance, acc.currency)}<br>sold necunoscut</span>` : formatMoney(acc.balance, acc.currency))}
            </div>
          </div>
        `).join("")}
      </div>
    </section>

    <div class="grid-2">
      ${singleMemberView() ? "" : `<section class="card">
        <div class="card-header">
          <h2 class="card-title">👥 Contribuție Cheltuieli Nete</h2>
          <span class="card-sub">Fără transferuri / investiții</span>
        </div>
        <div class="split-bar">
          <div class="split-p1" style="width:${p1Pct}%"></div>
          <div class="split-p2" style="width:${p2Pct}%"></div>
        </div>
        <div class="split-labels">
          <div class="split-partner">
            <span class="dot" style="background:var(--p1)"></span>
            <div>
              <div style="font-weight:700">${esc(p1Name)} (${p1Pct}%)</div>
              <div class="card-sub">${formatMoney(a.p1Total, a.baseCur)}</div>
            </div>
          </div>
          <div class="split-partner" style="text-align:right">
            <div>
              <div style="font-weight:700">${esc(p2Name)} (${p2Pct}%)</div>
              <div class="card-sub">${formatMoney(a.p2Total, a.baseCur)}</div>
            </div>
            <span class="dot" style="background:var(--p2)"></span>
          </div>
        </div>
      </section>`}

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">💡 Insights Automate</h2>
          <button class="btn btn-sm btn-secondary" data-view="analytics">Toate →</button>
        </div>
        <div class="insights-list">
          ${a.insights.slice(0, 2).map((ins) => `
            <div class="insight-item ${ins.type}${ins.drill ? " tappable" : ""}" ${ins.drill ? `data-insight-drill="${esc(ins.drill.kind)}" data-insight-index="${esc(ins.drill.index === undefined ? "" : ins.drill.index)}" role="button" tabindex="0"` : ""}>
              <div class="insight-icon">${ins.icon}</div>
              <div>
                <div class="insight-title">${esc(ins.title)}</div>
                <div class="insight-text">${esc(ins.text)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">🧾 Ultimele Tranzacții</h2>
        <button class="btn btn-sm btn-secondary" data-view="transactions">Vezi toate (${a.count})</button>
      </div>
      ${recent.length ? `<div class="tx-list">${recent.map((e) => renderTxRow(e, a.baseCur)).join("")}</div>` : `
        <div class="empty-state">
          <div class="big-ic">🛍️</div>
          <div>Nu ai tranzacții în ${MONTHS_RO[s.selectedMonth]}. Apasă <strong>+</strong> pentru a adăuga!</div>
        </div>
      `}
    </section>
  `;
}

function renderTxListBody(list, baseCur, grouped) {
  if (!grouped) return list.map((e) => renderTxRow(e, baseCur)).join("");
  let out = "";
  let cur = "";
  list.forEach((e) => {
    const ym = String(e.date).slice(0, 7);
    if (ym !== cur) {
      cur = ym;
      const [yy, mm] = ym.split("-").map(Number);
      out += `<div class="tx-month-head" style="font-weight:700;margin:14px 0 6px;color:var(--text-muted)">${esc(MONTHS_RO[(mm || 1) - 1] || ym)} ${esc(String(yy || ""))}</div>`;
    }
    out += renderTxRow(e, baseCur);
  });
  return out;
}

function renderTxRow(exp, baseCur) {
  const type = exp.type || "cheltuiala";
  const cat = exp.category ? store.getCategory(exp.category) : null;
  const typeMeta = TX_TYPES[type] || TX_TYPES.cheltuiala;
  const ownerName = store.getPartnerName(exp.owner);
  const ownerClass = store.isPartner2(exp.owner) ? "badge-p2" : "badge-p1";
  const acc = (exp.account || exp.accountId) ? store.getAccount(exp.account || exp.accountId) : null;
  const toAcc = (exp.toAccount || exp.destAccountId) ? store.getAccount(exp.toAccount || exp.destAccountId) : null;
  const showOrig = exp.currency && exp.currency !== baseCur;
  const isPositiveFlow = type === "venit" || (type === "ajustare" && Number(exp.amount) > 0);
  const titleText = exp.description || exp.title || exp.merchant || typeMeta.label;
  const iconBg = cat && type === "cheltuiala" ? `${cat.color}20` : "var(--primary-soft)";
  const iconCol = cat && type === "cheltuiala" ? cat.color : "var(--primary)";
  const iconGlyph = cat && type === "cheltuiala" ? (cat.emoji || cat.icon) : typeMeta.icon;
  const accFlow = acc && toAcc ? `${acc.name} → ${toAcc.name}` : (acc ? acc.name : "");
  const toAmtText = (toAcc && exp.toAmount !== null && exp.toAmount !== undefined && exp.toAmount !== "")
    ? ` → ${formatMoney(exp.toAmount, toAcc.currency)}`
    : "";

  return `
    <div class="tx-item tappable" data-view-expense="${esc(exp.id)}" role="button" tabindex="0">
      <div class="tx-icon" style="background:${iconBg}; color:${iconCol}">${iconGlyph}</div>
      <div class="tx-main">
        <div class="tx-title">
          <span>${esc(titleText)}</span>
          ${type !== "cheltuiala" ? `<span class="badge badge-private">${esc(typeMeta.label)}</span>` : ""}
          ${exp.isPrivate ? `<span class="badge badge-private">🔒 Privat</span>` : ""}
          ${exp.pendingSync ? `<span class="badge" style="background:var(--warning-soft); color:var(--warning)">⏳ În așteptare</span>` : ""}
          ${exp.baseMismatch ? `<span class="badge" style="background:var(--danger-soft); color:var(--danger)">⚠️ Curs</span>` : ""}
        </div>
        <div class="tx-meta">
          <span>${esc(exp.date)}</span>
          ${exp.merchant ? `<span>• ${esc(exp.merchant)}</span>` : ""}
          ${cat ? `<span>• ${esc(cat.name)}</span>` : ""}
          ${accFlow ? `<span>• ${esc(accFlow)}</span>` : ""}
          <span class="badge ${ownerClass}">${esc(ownerName)}</span>
          ${exp.payer === SHARED_OWNER ? `<span class="badge badge-private">Comun</span>` : ""}
        </div>
      </div>
      <div class="tx-right">
        <div class="tx-amount" style="color:${isPositiveFlow ? "var(--success)" : "var(--text)"}">
          ${isPositiveFlow ? "+" : ""}${formatMoney(exp.baseAmount, baseCur)}
        </div>
        ${(showOrig || toAmtText) ? `<div class="tx-orig">${formatMoney(exp.amount, exp.currency)}${esc(toAmtText)}</div>` : ""}
      </div>
    </div>
  `;
}

// =========================================================================
// 2. TRANZACȚII (LISTĂ COMPLETĂ + FILTRE + IMPORT CU PREVIZUALIZARE)
// =========================================================================
function renderTransactions() {
  const s = store.state;
  const baseCur = s.settings.baseCurrency || "RON";
  const byAccount = txAccountFilter !== "all";
  const allMonths = byAccount || txAllMonths;
  let list = allMonths
    ? store.getVisibleExpenses({ scope: s.scope })
    : store.getVisibleExpenses({ year: s.selectedYear, month: s.selectedMonth, scope: s.scope });

  if (byAccount) {
    list = list.filter((e) => (e.account || e.accountId) === txAccountFilter || (e.toAccount || e.destAccountId) === txAccountFilter);
  }
  if (allMonths) list.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  if (txDayFilter) {
    list = list.filter((e) => e.date === txDayFilter);
  }
  if (txWeekdayFilter !== "") {
    list = list.filter((e) => { const p = String(e.date).split("-").map(Number); return p.length === 3 && new Date(p[0], p[1] - 1, p[2]).getDay() === Number(txWeekdayFilter) || false; });
  }
  if (txBalanceFilter) {
    list = list.filter((e) => { const t = e.type || "cheltuiala"; return t === "cheltuiala" || t === "venit"; });
  }
  if (txForeignFilter) {
    list = list.filter((e) => (e.currency || e.valuta || baseCur) !== baseCur);
  }
  if (txTypeFilter !== "all") {
    list = list.filter((e) => (e.type || "cheltuiala") === txTypeFilter);
  }
  if (txCategoryFilter !== "all") {
    list = list.filter((e) => e.category === txCategoryFilter);
  }
  if (txSearch.trim()) {
    const q = txSearch.trim().toLowerCase();
    list = list.filter(
      (e) =>
        (e.description || e.title || "").toLowerCase().includes(q) ||
        (e.merchant || "").toLowerCase().includes(q) ||
        (e.category && store.getCategory(e.category).name.toLowerCase().includes(q))
    );
  }

  let activeFilterBar = "";
  if (byAccount || txDayFilter || txWeekdayFilter !== "" || txCategoryFilter !== "all" || txNote) {
    const parts = [];
    if (byAccount) {
      const accBal = computeAccountBalances(s.accounts || [], store.getVisibleExpenses({ scope: "all" }), s.currencies || [], baseCur, store.getActiveEmail())
        .find((x) => x.id === txAccountFilter);
      const accName = accBal ? accBal.name : store.getAccount(txAccountFilter)?.name || txAccountFilter;
      parts.push(`🏦 Cont: <strong>${esc(accName)}</strong>${accBal && accBal.visible !== false ? ` • ${accBal.balanceKnown === false ? "Mișcări" : "Sold"} ${formatMoney(accBal.balance, accBal.currency)}` : ""} • toate lunile`);
    }
    if (txCategoryFilter !== "all") parts.push(`🏷️ Categorie: <strong>${esc(store.getCategory(txCategoryFilter).name)}</strong> • ${txAllMonths ? "toate lunile" : MONTHS_RO[s.selectedMonth] + " " + s.selectedYear}`);
    if (txWeekdayFilter !== "") parts.push(`📅 Zilele de ${esc(["duminică","luni","marți","miercuri","joi","vineri","sâmbătă"][Number(txWeekdayFilter)])} • ${MONTHS_RO[s.selectedMonth]} ${s.selectedYear}`);
    if (txNote) parts.push(`${esc(txNote)} • ${MONTHS_RO[s.selectedMonth]} ${s.selectedYear}${s.scope === "shared" ? " • doar comune" : ""}`);
    if (txDayFilter) parts.push(`📅 Ziua: <strong>${esc(txDayFilter)}</strong>`);
    activeFilterBar = `
      <div class="banner">
        <div class="banner-text">${parts.join("<br>")}</div>
        <button class="btn btn-sm btn-secondary" id="btn-clear-tx-filters">✕ Șterge filtrul</button>
      </div>`;
  }

  return `
    ${renderControlsRow({ allMonths })}
    ${activeFilterBar}

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">📋 Toate Tranzacțiile (${list.length})</h2>
          <div class="card-sub">Schema Sheet v4 (A–T): transferuri pe un singur rând, previzualizare import și deduplicare pe Sursă</div>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-secondary" id="btn-export-excel">⬇️ Export Excel</button>
          <label class="btn btn-sm btn-primary" style="cursor:pointer">
            ⬆️ Import (cu previzualizare)
            <input type="file" id="input-import-excel" accept=".xlsx,.xls,.csv" hidden>
          </label>
        </div>
      </div>

      <div class="filter-bar" style="margin-bottom:14px">
        <input class="input" id="tx-search" type="search" placeholder="Caută descriere, comerciant, categorie..." value="${esc(txSearch)}">
        <select class="select" id="tx-type-filter">
          <option value="all">Toate tipurile</option>
          ${Object.values(TX_TYPES).map((t) => `<option value="${esc(t.id)}" ${txTypeFilter === t.id ? "selected" : ""}>${t.icon} ${esc(t.label)}</option>`).join("")}
        </select>
        <select class="select" id="tx-cat-filter">
          <option value="all">Toate categoriile</option>
          ${s.categories.map((c) => `<option value="${esc(c.id)}" ${txCategoryFilter === c.id ? "selected" : ""}>${c.emoji || c.icon} ${esc(c.name)}</option>`).join("")}
        </select>
      </div>

      ${list.length ? `<div class="tx-list">${renderTxListBody(list, baseCur, allMonths)}</div>` : `
        <div class="empty-state">
          <div class="big-ic">🔍</div>
          <div>Nicio tranzacție nu corespunde filtrelor selectate.</div>
        </div>
      `}
    </section>
  `;
}

// =========================================================================
// 3. STATISTICI & INSIGHTS
// =========================================================================
function renderAnalytics() {
  const s = store.state;
  const a = computeMonthlyAnalytics(store, s.selectedYear, s.selectedMonth, s.scope);

  return `
    ${renderControlsRow()}

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">🧠 Insights & Audit Contabil — ${MONTHS_RO[s.selectedMonth]}</h2>
        <span class="card-sub">${a.insights.length} analize</span>
      </div>
      <div class="insights-list">
        ${a.insights.map((ins) => `
          <div class="insight-item ${ins.type}${ins.drill ? " tappable" : ""}" ${ins.drill ? `data-insight-drill="${esc(ins.drill.kind)}" data-insight-index="${esc(ins.drill.index === undefined ? "" : ins.drill.index)}" role="button" tabindex="0"` : ""}>
            <div class="insight-icon">${ins.icon}</div>
            <div>
              <div class="insight-title">${esc(ins.title)}</div>
              <div class="insight-text">${esc(ins.text)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">🍩 Cheltuieli Nete pe Categorii</h2>
        <span class="card-sub">${a.byCategory.length} categorii active</span>
      </div>
      ${renderDonutChart(a.byCategory, a.total, a.baseCur)}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">📊 Evoluție Ultimele 6 Luni</h2>
          <span class="card-sub">Comparație parteneri</span>
        </div>
        ${renderMonthlyTrendChart(a.trend6Months, a.monthlyBudget, s.settings.partner1Name, singleMemberView() ? "" : s.settings.partner2Name, a.baseCur)}
      </section>

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">📅 Ritm Zilnic — ${MONTHS_RO[s.selectedMonth]}</h2>
          <span class="card-sub">Medie: ${formatMoney(a.dailyAvg, a.baseCur)}/zi</span>
        </div>
        ${renderDailyBarsChart(a.dailyTotals, a.baseCur)}
      </section>
    </div>
  `;
}

// =========================================================================
// 4. CONTURI, CATEGORII, COMERCIANȚI & VALUTE
// =========================================================================
function renderCatalog() {
  const s = store.state;
  const baseCur = s.settings.baseCurrency || "RON";
  const balances = computeAccountBalances(
    s.accounts || [],
    store.getVisibleExpenses({ scope: "all" }),
    s.currencies || [],
    baseCur,
    store.getActiveEmail()
  );

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">🏦 Conturi v4 (${balances.length})</h2>
          <div class="card-sub">Sold = sold inițial + venituri − cheltuieli ± transferuri/investiții ± ajustări</div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-add-account">+ Cont</button>
      </div>
      <div class="item-grid">
        ${balances.map((acc) => `
          <div class="mini-card">
            <div class="mini-left">
              <div class="mini-icon" style="background:var(--primary-soft); color:var(--primary)">${accountIcon(acc.type)}</div>
              <div>
                <div style="font-weight:700; font-size:0.86rem">${esc(acc.name)} ${acc.archived ? "(Arhivat)" : ""}</div>
                <div class="card-sub">
                  ${acc.visible === false
                    ? `🔒 Personal (${esc(store.getPartnerName(acc.owner))})`
                    : (acc.balanceKnown === false ? `Mișcări: <strong>${formatMoney(acc.balance, acc.currency)}</strong> • sold inițial necunoscut` : `Sold: <strong>${formatMoney(acc.balance, acc.currency)}</strong> • Inițial: ${acc.initialBalance}${acc.initialDate ? ` (${esc(acc.initialDate)})` : ""}`) + ` • ${esc(store.getPartnerName(acc.owner))}`}
                </div>
              </div>
            </div>
            ${acc.visible !== false ? `<button class="icon-btn" data-edit-acc="${esc(acc.id)}" title="Editează cont">✏️</button>` : ""}
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">🏷️ Categorii (${s.categories.length})</h2>
          <div class="card-sub">Categorii de cheltuieli și venituri (schema v4, coloane A–H)</div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-add-category">+ Categorie</button>
      </div>
      <div class="item-grid">
        ${s.categories.map((c) => `
          <div class="mini-card">
            <div class="mini-left tappable" data-open-category="${esc(c.id)}" role="button" tabindex="0" aria-label="Tranzacții ${esc(c.name)}">
              <div class="mini-icon" style="background:${c.color}20; color:${c.color}">${c.emoji || c.icon}</div>
              <div>
                <div style="font-weight:700; font-size:0.86rem">${esc(c.name)} ${c.active === false ? "(Inactivă)" : ""}</div>
                <div class="card-sub">${esc(c.type || c.kind || "cheltuiala")} ${c.budget > 0 ? `• Buget: ${formatMoney(c.budget, baseCur)}` : ""}</div>
              </div>
            </div>
            <button class="icon-btn" data-edit-cat="${esc(c.id)}" title="Editează">✏️</button>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">🏪 Comercianți (${(s.merchants || []).length})</h2>
          <div class="card-sub">Categorie implicită auto-completată la adăugare</div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-add-merchant">+ Comerciant</button>
      </div>
      <div class="item-grid">
        ${(s.merchants || []).map((m) => {
          const cat = m.category ? store.getCategory(m.category) : null;
          return `
            <div class="mini-card">
              <div class="mini-left">
                <div class="mini-icon" style="background:var(--primary-soft); color:var(--primary)">${cat ? (cat.emoji || cat.icon) : "🏪"}</div>
                <div>
                  <div style="font-weight:700; font-size:0.86rem">${esc(m.name)}</div>
                  <div class="card-sub">${cat ? esc(cat.name) : "Fără categorie implicită"}</div>
                </div>
              </div>
              <button class="icon-btn" data-edit-merchant="${esc(m.name)}" title="Editează comerciant">✏️</button>
            </div>
          `;
        }).join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">💱 Valute & Cursuri Curente (${s.currencies.length})</h2>
          <div class="card-sub">Monedă de bază: <strong>${esc(baseCur)}</strong>. Modificarea unui curs NU schimbă sumele istorice.</div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-add-currency">+ Valută</button>
      </div>
      <div class="item-grid">
        ${s.currencies.map((c) => `
          <div class="mini-card">
            <div class="mini-left">
              <div class="mini-icon" style="background:var(--primary-soft); color:var(--primary); font-weight:800; font-size:0.88rem">${esc(c.symbol)}</div>
              <div>
                <div style="font-weight:700; font-size:0.88rem">${esc(c.code)} — ${esc(c.name)}</div>
                <div class="card-sub">1 ${esc(c.code)} = <strong>${c.rate}</strong> ${esc(baseCur)}</div>
              </div>
            </div>
            <button class="icon-btn" data-edit-cur="${esc(c.code)}" title="Editează curs">✏️</button>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// =========================================================================
// 5. SETĂRI, SECURITATE PER PARTENER & PORTABILITATE FĂRĂ CREDENȚIALE
// =========================================================================
function renderSettings() {
  const s = store.state;
  const connected = store.isConnected();

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">☁️ Conectare Securizată Google Sheets (v4)</h2>
          <div class="card-sub">${connected ? `Autentificat ca: ${esc(store.getPartnerName(s.activePartner))} (${esc(store.getActiveEmail())}) • ${esc(s.connection.sheetName || "Sheet")}${sheetLinkHtml(s.connection.sheetUrl)}` : "Neconectat — autentificare prin PIN personal (minim 6 caractere, fără cheie implicit)"}</div>
        </div>
        ${connected ? `<span class="badge" style="background:var(--success-soft); color:var(--success)">● Conectat</span>` : ""}
      </div>

      <form id="form-connection" class="form-grid">
        <div class="field">
          <label>URL Google Apps Script (Web App)</label>
          <input class="input" id="conn-url" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(s.connection.webAppUrl)}" required>
        </div>
        <div class="field">
          <label>Cheia ta de acces (PIN_P1 sau PIN_P2 din Script Properties — minim 32 caractere)</label>
          <input class="input" id="conn-pin" type="password" placeholder="Cheia ta de acces (min. 32 caractere)" autocomplete="off" value="${esc(s.connection.pin)}" minlength="32" required>
        </div>
        <div class="card-sub">
          Identitatea partenerului este determinată <strong>exclusiv de server din cheie</strong> prin POST (niciodată în URL).
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">🔗 Conectează & Inițializează</button>
          ${connected ? `<button type="button" class="btn btn-secondary" id="btn-settings-sync">🔄 Sincronizează</button>` : ""}
          ${connected ? `<button type="button" class="btn btn-danger" id="btn-disconnect">Deconectează & Șterge cache local</button>` : ""}
        </div>
      </form>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">📱 Portabilitate Telefon Nou (Fără credențiale în link)</h2>
          <div class="card-sub">Link-ul <code>BF2-...</code> transmite DOAR adresa Web App. Fiecare partener își introduce cheia proprie separat.</div>
        </div>
      </div>

      ${s.connection.webAppUrl ? `
        <div class="btn-row" style="margin-bottom:12px">
          <button class="btn btn-primary" id="btn-gen-transfer">📤 Generează Link/Cod (fără cheie)</button>
        </div>
        <div id="transfer-output" style="display:none; margin-bottom:14px"></div>
      ` : `<div class="card-sub" style="margin-bottom:12px">Introdu adresa Web App mai sus pentru a genera un link de configurare fără cheie.</div>`}

      <div style="padding-top:12px; border-top:1px solid var(--border)">
        <label style="display:block; font-size:0.8rem; font-weight:700; color:var(--text-muted); margin-bottom:6px">Ai primit un cod BF2-...?</label>
        <div style="display:flex; gap:8px">
          <input class="input" id="input-setup-code" placeholder="Lipește aici codul BF2-... (fără cheie)">
          <button class="btn btn-primary" id="btn-apply-setup-code">Preia URL</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">⚙️ Preferințe Familie & Monedă de Bază</h2>
      </div>
      <form id="form-family-settings" class="form-grid">
        <div class="form-grid cols-2">
          <div class="field">
            <label>Nume Partener 1</label>
            <input class="input" id="set-p1-name" value="${esc(s.settings.partner1Name)}" required>
          </div>
          <div class="field">
            <label>Tab Partener 1 (v4)</label>
            <input class="input" id="set-p1-tab" value="${esc(s.settings.partner1Tab)}" required>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Nume Partener 2</label>
            <input class="input" id="set-p2-name" value="${esc(s.settings.partner2Name)}" required>
          </div>
          <div class="field">
            <label>Tab Partener 2 (v4)</label>
            <input class="input" id="set-p2-tab" value="${esc(s.settings.partner2Tab)}" required>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Monedă de bază (ex. EUR sau RON)</label>
            <select class="select" id="set-base-cur">
              ${s.currencies.map((c) => `<option value="${esc(c.code)}" ${s.settings.baseCurrency === c.code ? "selected" : ""}>${esc(c.code)} — ${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Buget lunar țintă (${esc(s.settings.baseCurrency)})</label>
            <input class="input" id="set-budget" type="number" min="0" step="50" value="${Number(s.settings.monthlyBudget) || 0}">
          </div>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary">💾 Salvează setările</button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">🛠️ Date locale & Demo</h2>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-export-excel-2">⬇️ Export Excel v4 (.xlsx)</button>
        <button class="btn btn-secondary" id="btn-load-demo">✨ Încarcă date Demo sintetice</button>
        <button class="btn btn-danger" id="btn-clear-local">🗑️ Golește datele locale</button>
      </div>
    </section>
  `;
}

// =========================================================================
// Evenimente specifice fiecărei pagini
// =========================================================================
function bindViewSpecificEvents() {
  const retryBtn = $("#btn-retry-sync");
  if (retryBtn) retryBtn.onclick = handleManualSync;
  const clearFailedBtn = $("#btn-clear-failed");
  if (clearFailedBtn) clearFailedBtn.onclick = () => store.clearFailedQueue();

  const searchEl = $("#tx-search");
  if (searchEl) {
    searchEl.oninput = (e) => {
      txSearch = e.target.value;
      render();
      const el = $("#tx-search");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    };
  }
  const typeF = $("#tx-type-filter");
  if (typeF) typeF.onchange = (e) => { txTypeFilter = e.target.value; render(); };
  const catF = $("#tx-cat-filter");
  if (catF) catF.onchange = (e) => { txCategoryFilter = e.target.value; txAllMonths = false; render(); };

  const handleExport = async () => {
    try {
      const res = await exportToExcel(store);
      showToast(`Exportat ${res.count} tranzacții în format v4 (.${res.format})!`);
    } catch (err) {
      showToast("Eroare export: " + err.message, 4000);
    }
  };
  const expBtn = $("#btn-export-excel");
  if (expBtn) expBtn.onclick = handleExport;
  const expBtn2 = $("#btn-export-excel-2");
  if (expBtn2) expBtn2.onclick = handleExport;

  const impInput = $("#input-import-excel");
  if (impInput) {
    impInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const report = await previewImportFile(file, store);
        openImportPreviewModal(file.name, report);
      } catch (err) {
        showToast("Eroare citire fișier: " + err.message, 4500);
      }
      e.target.value = "";
    };
  }

  // Conturi, Categorii, Comercianți, Valute
  const addAccBtn = $("#btn-add-account");
  if (addAccBtn) addAccBtn.onclick = () => openAccountModal(null);
  document.querySelectorAll("[data-edit-acc]").forEach((btn) => {
    btn.onclick = () => openAccountModal(btn.dataset.editAcc);
  });

  const addCatBtn = $("#btn-add-category");
  if (addCatBtn) addCatBtn.onclick = () => openCategoryModal(null);
  document.querySelectorAll("[data-edit-cat]").forEach((btn) => {
    btn.onclick = () => openCategoryModal(btn.dataset.editCat);
  });

  const addMerBtn = $("#btn-add-merchant");
  if (addMerBtn) addMerBtn.onclick = () => openMerchantModal(null);
  document.querySelectorAll("[data-edit-merchant]").forEach((btn) => {
    btn.onclick = () => openMerchantModal(btn.dataset.editMerchant);
  });

  const addCurBtn = $("#btn-add-currency");
  if (addCurBtn) addCurBtn.onclick = () => openCurrencyModal(null);
  document.querySelectorAll("[data-edit-cur]").forEach((btn) => {
    btn.onclick = () => openCurrencyModal(btn.dataset.editCur);
  });

  // Setări conectare
  const connForm = $("#form-connection");
  if (connForm) {
    connForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        showToast("Se autentifică și se sincronizează...");
        await store.connectAndSync({
          webAppUrl: $("#conn-url").value,
          pin: $("#conn-pin").value,
          initialize: true
        });
        showToast(`Conectat ca ${store.getPartnerName(store.state.activePartner)}!`);
      } catch (err) {
        showToast("Eroare conectare: " + err.message, 5000);
      }
    };
  }

  const setSyncBtn = $("#btn-settings-sync");
  if (setSyncBtn) setSyncBtn.onclick = handleManualSync;

  const discBtn = $("#btn-disconnect");
  if (discBtn) {
    discBtn.onclick = () => {
      if (confirm("Deconectezi Google Sheets și ștergi datele sincronizate din localStorage de pe acest telefon?")) {
        store.disconnectSheet();
        showToast("Deconectat și cache local curățat.");
      }
    };
  }

  const genTr = $("#btn-gen-transfer");
  if (genTr) {
    genTr.onclick = () => {
      const cfg = { webAppUrl: store.state.connection.webAppUrl };
      const code = encodeSetupCode(cfg);
      const link = buildTransferLink(cfg);
      const out = $("#transfer-output");
      out.style.display = "block";
      out.innerHTML = `
        <div class="code-box" style="margin-bottom:8px">
          <div style="font-weight:700; margin-bottom:4px; font-family:inherit">Cod configurare (DOAR URL, fără cheie):</div>
          <div>${esc(code)}</div>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-primary" id="btn-copy-link">🔗 Copiază Link</button>
          <button class="btn btn-sm btn-secondary" id="btn-copy-code">📋 Copiază Cod</button>
        </div>
      `;
      $("#btn-copy-link").onclick = () => copyText(link, "Link fără cheie copiat!");
      $("#btn-copy-code").onclick = () => copyText(code, "Cod BF2 copiat!");
    };
  }

  const applyCodeBtn = $("#btn-apply-setup-code");
  if (applyCodeBtn) {
    applyCodeBtn.onclick = () => {
      const raw = $("#input-setup-code").value;
      if (!raw.trim()) return;
      try {
        const cfg = decodeSetupCode(raw);
        store.state.connection.webAppUrl = cfg.webAppUrl;
        store.persist();
        render();
        showToast("URL preluat! Introdu acum cheia ta de acces mai sus și apasă Conectează.");
      } catch (err) {
        showToast("Eroare cod: " + err.message, 4500);
      }
    };
  }

  const famForm = $("#form-family-settings");
  if (famForm) {
    famForm.onsubmit = async (e) => {
      e.preventDefault();
      await store.saveSettings({
        partner1Name: $("#set-p1-name").value.trim() || "Eu",
        partner1Tab: $("#set-p1-tab").value.trim() || "Cheltuieli Eu",
        partner2Name: $("#set-p2-name").value.trim() || "Soția",
        partner2Tab: $("#set-p2-tab").value.trim() || "Cheltuieli Soția",
        baseCurrency: $("#set-base-cur").value,
        monthlyBudget: Number($("#set-budget").value) || 0
      });
      showToast("Setările au fost salvate!");
    };
  }

  const demoBtn = $("#btn-load-demo");
  if (demoBtn) {
    demoBtn.onclick = () => {
      store.resetDemoData();
      showToast("Datele Demo sintetice v4 au fost încărcate!");
    };
  }
  const clearBtn = $("#btn-clear-local");
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (confirm("Ștergi datele locale?")) {
        store.clearAllLocalExpenses();
        showToast("Datele locale au fost șterse.");
      }
    };
  }
}

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch (_) {
    showToast("Nu am putut copia automat.");
  }
}

// =========================================================================
// MODALE: Previzualizare Import, Tranzacție, Cont, Categorie, Comerciant, Valută
// =========================================================================
function closeModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.remove("open"));
  editingExpenseId = null;
}

function openImportPreviewModal(fileName, report) {
  const modal = $("#modal-main");
  const ct = report.controlTotals;
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">🔎 Previzualizare Import v4: ${esc(fileName)}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <div class="form-grid">
        <div class="insight-item info">
          <div class="insight-icon">📊</div>
          <div>
            <div class="insight-title">Raport analiză (${report.totalRead} rânduri citite)</div>
            <div class="insight-text">
              ✅ Gata de import: <strong>${report.readyRows.length}</strong> •
              ⏭️ Dubluri ignorate (Sursă): <strong>${report.duplicateRows.length}</strong> •
              ⚠️ Puse deoparte: <strong>${report.stagedRows.length}</strong>
            </div>
          </div>
        </div>

        ${report.overlapWarning ? `
          <div class="insight-item warning">
            <div class="insight-icon">📅</div>
            <div><div class="insight-title">Suprapunere perioade</div><div class="insight-text">${esc(report.overlapWarning)}</div></div>
          </div>
        ` : ""}

        ${(report.unknownCategories.length || report.unknownCurrencies.length || report.unknownAccounts.length) ? `
          <div class="insight-item danger">
            <div class="insight-icon">🚫</div>
            <div>
              <div class="insight-title">Elemente necunoscute (nu au fost înlocuite tăcut)</div>
              <div class="insight-text">
                ${report.unknownCategories.length ? `Categorii: <strong>${esc(report.unknownCategories.join(", "))}</strong><br>` : ""}
                ${report.unknownCurrencies.length ? `Valute: <strong>${esc(report.unknownCurrencies.join(", "))}</strong><br>` : ""}
                ${report.unknownAccounts.length ? `Conturi: <strong>${esc(report.unknownAccounts.join(", "))}</strong>` : ""}
              </div>
            </div>
          </div>
        ` : ""}

        <div class="mini-card" style="flex-direction:column; align-items:stretch">
          <div style="font-weight:700; font-size:0.84rem">Totaluri de control (sursă vs. gata de import)</div>
          <div class="card-sub">Sursă: Credit ${ct.sourceCredit} | Debit ${ct.sourceDebit} | Net ${ct.sourceNet}</div>
          <div class="card-sub">Valid: Credit ${ct.readyCredit} | Debit ${ct.readyDebit} | Net ${ct.readyNet}</div>
          ${ct.hasUnexplainedDiff ? `<div class="card-sub" style="color:var(--danger); font-weight:700">⚠️ Există diferențe / rânduri puse deoparte — importul NU este complet 100%.</div>` : ""}
        </div>

        ${report.stagedRows.length ? `
          <div style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:6px">
            ${report.stagedRows.slice(0, 15).map((st) => `
              <div class="card-sub" style="padding:6px 8px; background:var(--danger-soft); border-radius:8px">
                <strong>Rând ${st.rowNumber}</strong> (${esc(st.rawTitle)}): ${esc(st.reasons.join("; "))}
              </div>
            `).join("")}
          </div>
        ` : ""}

        <div class="btn-row" style="justify-content:flex-end; margin-top:6px">
          <button class="btn btn-secondary" data-close-modal>Anulează</button>
          ${report.readyRows.length > 0 ? `<button class="btn btn-primary" id="btn-confirm-import">✅ Importă ${report.readyRows.length} rânduri valide</button>` : ""}
        </div>
      </div>
    </div>
  `;
  modal.classList.add("open");

  const confirmBtn = $("#btn-confirm-import");
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      closeModals();
      const count = await store.commitImportRows(report.readyRows);
      showToast(`Importat ${count} rânduri v4 valide! (${report.stagedRows.length} puse deoparte, ${report.duplicateRows.length} dubluri ignorate)`);
    };
  }
}

function openExpenseDetail(expenseId) {
  const s = store.state;
  const exp = s.expenses.find((e) => e.id === expenseId);
  if (!exp) return;
  const baseCur = s.settings.baseCurrency || "RON";
  const type = exp.type || "cheltuiala";
  const typeMeta = TX_TYPES[type] || TX_TYPES.cheltuiala;
  const cat = exp.category ? store.getCategory(exp.category) : null;
  const accId = exp.account || exp.accountId || "";
  const toId = exp.toAccount || exp.destAccountId || "";
  const acc = accId ? store.getAccount(accId) : null;
  const toAcc = toId ? store.getAccount(toId) : null;
  const canEdit = store.isOwnRecord(exp);
  const row = (k, v) => v ? `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">${k}</span><span style="text-align:right">${v}</span></div>` : "";
  const link = (attr, id, label) => `<button type="button" class="btn btn-sm btn-secondary" ${attr}="${esc(id)}">${label} →</button>`;
  const amountTxt = formatMoney(exp.amount, exp.currency || baseCur) + (exp.currency && exp.currency !== baseCur ? ` (${formatMoney(exp.baseAmount, baseCur)})` : "");
  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">👁️ Detalii înregistrare</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <div>
        ${row("Titlu", esc(exp.description || exp.title || exp.merchant || typeMeta.label))}
        ${row("Tip", esc(typeMeta.label))}
        ${row("Data", esc(exp.date))}
        ${row("Sumă", esc(amountTxt))}
        ${row("Comerciant", esc(exp.merchant || ""))}
        ${row("Categorie", cat ? `${esc(cat.name)} ${link("data-detail-category", cat.id, "Toate tranzacțiile categoriei")}` : "")}
        ${row("Cont", acc ? `${esc(acc.name)} ${link("data-detail-account", acc.id, "Tranzacțiile contului")}` : "")}
        ${row("Cont destinație", toAcc ? `${esc(toAcc.name)} ${link("data-detail-account", toAcc.id, "Tranzacțiile contului")}` : "")}
        ${row("Metodă plată", esc(exp.method || ""))}
        ${row("Privat", exp.isPrivate ? "Da" : "")}
      </div>
      <div class="btn-row" style="margin-top:16px;justify-content:space-between">
        <button type="button" class="btn btn-secondary" data-close-modal>Închide</button>
        ${canEdit ? `<button type="button" class="btn btn-primary" data-detail-edit="${esc(exp.id)}">✏️ Editează</button>` : ""}
      </div>
    </div>`;
  modal.classList.add("open");
}

function openExpenseModal(expenseId) {
  const s = store.state;
  const exp = expenseId ? s.expenses.find((e) => e.id === expenseId) : null;
  editingExpenseId = exp ? exp.id : null;
  const isOwner = !exp || store.isOwnRecord(exp);
  const baseCur = s.settings.baseCurrency || "RON";
  const initialType = exp ? (exp.type || "cheltuiala") : "cheltuiala";
  const myAccounts = (s.accounts || []).filter((a) => !a.archived && store.isAccountVisible(a));
  const allActiveAccounts = (s.accounts || []).filter((a) => !a.archived);
  const paymentMethods = (s.settings.paymentMethods && s.settings.paymentMethods.length)
    ? s.settings.paymentMethods
    : PAYMENT_METHODS;
  const myEmail = store.getActiveEmail();
  const curAccount = exp ? (exp.account || exp.accountId || "") : (myAccounts[0]?.id || "");
  const curToAccount = exp ? (exp.toAccount || exp.destAccountId || "") : "";
  const curPayer = exp ? (exp.payer || myEmail) : myEmail;

  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">${exp ? (isOwner ? "✏️ Editează Înregistrarea" : "👁️ Detalii Înregistrare") : "➕ Înregistrare Nouă"}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <form id="form-expense" class="form-grid">
        <div class="form-grid cols-2">
          <div class="field">
            <label>Tip (v4)</label>
            <select class="select" id="exp-type" ${isOwner ? "" : "disabled"}>
              ${Object.values(TX_TYPES).map((t) => `<option value="${esc(t.id)}" ${initialType === t.id ? "selected" : ""}>${t.icon} ${esc(t.label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Data (YYYY-MM-DD)</label>
            <input class="input" id="exp-date" type="date" value="${esc(exp ? exp.date : new Date().toISOString().slice(0, 10))}" ${isOwner ? "required" : "disabled"}>
          </div>
        </div>

        <div class="form-grid cols-2">
          <div class="field">
            <label id="exp-amount-label">Sumă</label>
            <input class="input" id="exp-amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${exp ? exp.amount : ""}" ${isOwner ? "required" : "disabled"}>
          </div>
          <div class="field">
            <label>Valută</label>
            <select class="select" id="exp-currency" ${isOwner ? "" : "disabled"}>
              ${s.currencies.map((c) => `<option value="${esc(c.code)}" ${(exp ? exp.currency : baseCur) === c.code ? "selected" : ""}>${esc(c.code)} (${esc(c.symbol)})</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="form-grid cols-2">
          <div class="field">
            <label>Cont (sursă / propriu / comun)</label>
            <select class="select" id="exp-account" ${isOwner ? "" : "disabled"}>
              <option value="">— Fără cont —</option>
              ${myAccounts.map((a) => `<option value="${esc(a.id)}" ${curAccount === a.id ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Curs (față de ${esc(baseCur)})</label>
            <input class="input" id="exp-rate" type="number" step="0.0001" min="0.0001" value="${exp ? (exp.rate || exp.exchangeRate || 1) : 1}" ${isOwner ? "required" : "disabled"}>
          </div>
        </div>

        <div id="transfer-fields" class="form-grid cols-2" style="display:none">
          <div class="field">
            <label>Cont destinație (transfer / investiție)</label>
            <select class="select" id="exp-dest-account" ${isOwner ? "" : "disabled"}>
              <option value="">— Fără destinație —</option>
              ${allActiveAccounts.map((a) => `<option value="${esc(a.id)}" ${curToAccount === a.id ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Sumă destinație (gol = conversie la curs)</label>
            <input class="input" id="exp-dest-amount" type="number" step="0.01" min="0.01" value="${exp && exp.toAmount !== null && exp.toAmount !== undefined ? exp.toAmount : ""}" placeholder="Opțional (altfel curs)" ${isOwner ? "" : "disabled"}>
          </div>
        </div>

        <div class="form-grid cols-2">
          <div class="field">
            <label>Comerciant</label>
            <input class="input" id="exp-merchant" list="merchants-datalist" placeholder="ex: Supermarket Demo" value="${esc(exp ? exp.merchant : "")}" ${isOwner ? "" : "disabled"}>
            <datalist id="merchants-datalist">
              ${(s.merchants || []).map((m) => `<option value="${esc(m.name)}">`).join("")}
            </datalist>
          </div>
          <div class="field">
            <label>Plătitor</label>
            <select class="select" id="exp-payer" ${isOwner ? "" : "disabled"}>
              <option value="${esc(myEmail)}" ${curPayer === myEmail ? "selected" : ""}>${esc(store.getPartnerName(myEmail))} (${esc(myEmail)})</option>
              <option value="${SHARED_OWNER}" ${curPayer === SHARED_OWNER ? "selected" : ""}>Comun</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Descriere</label>
          <input class="input" id="exp-title" type="text" placeholder="ex: Cumpărături săptămânale, Salariu, Transfer economii..." value="${esc(exp ? (exp.description || exp.title || "") : "")}" ${isOwner ? "" : "disabled"}>
        </div>

        <div class="form-grid cols-2">
          <div class="field">
            <label>Categorie</label>
            <select class="select" id="exp-category" ${isOwner ? "" : "disabled"}>
              <option value="">— Fără categorie —</option>
              ${s.categories.filter((c) => c.active !== false || (exp && exp.category === c.id)).map((c) => `<option value="${esc(c.id)}" ${(exp ? exp.category : "alimente") === c.id ? "selected" : ""}>${c.emoji || c.icon} ${esc(c.name)} ${c.type === "venit" ? "(venit)" : ""}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Metodă plată</label>
            <select class="select" id="exp-payment" ${isOwner ? "" : "disabled"}>
              ${paymentMethods.map((pm) => `<option value="${esc(pm)}" ${(exp ? (exp.method || exp.paymentMethod) : "Card") === pm ? "selected" : ""}>${esc(pm)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="toggle-row">
          <div>
            <div style="font-weight:700; font-size:0.88rem">🔒 Înregistrare privată</div>
            <div class="card-sub">Ascunsă celuilalt în aplicație. Rămâne vizibilă în Google Sheet pentru oricine are acces la el.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="exp-private" ${exp && exp.isPrivate ? "checked" : ""} ${isOwner ? "" : "disabled"}>
            <span class="slider"></span>
          </label>
        </div>

        ${exp && exp.source ? `<div class="card-sub">Sursă (idempotență): <code>${esc(exp.source)}</code></div>` : ""}

        ${isOwner ? `
          <div class="btn-row" style="justify-content:space-between; margin-top:6px">
            ${exp ? `<button type="button" class="btn btn-danger" id="btn-del-expense">🗑️ Șterge</button>` : `<span></span>`}
            <div class="btn-row">
              <button type="button" class="btn btn-secondary" data-close-modal>Anulează</button>
              <button type="submit" class="btn btn-primary">${exp ? "💾 Salvează" : "➕ Adaugă"}</button>
            </div>
          </div>
        ` : `<div class="card-sub">Această înregistrare aparține tab-ului <strong>${esc(store.getPartnerName(exp.owner))}</strong>.</div>`}
      </form>
    </div>
  `;
  modal.classList.add("open");
  if (!exp) { const a0 = $("#exp-amount"); if (a0) a0.focus(); } // new record: amount focused right away

  const typeEl = $("#exp-type");
  const amtEl = $("#exp-amount");
  const amtLabelEl = $("#exp-amount-label");
  const curEl = $("#exp-currency");
  const rateEl = $("#exp-rate");
  const accEl = $("#exp-account");
  const trFields = $("#transfer-fields");
  const merEl = $("#exp-merchant");
  const catEl = $("#exp-category");

  const syncConditionalFields = () => {
    const t = typeEl.value;
    trFields.style.display = (t === "transfer" || t === "investitie") ? "grid" : "none";
    if (t === "ajustare") {
      amtEl.removeAttribute("min");
      amtLabelEl.textContent = "Sumă ajustare (+ / − nenulă)";
    } else {
      amtEl.setAttribute("min", "0.01");
      amtLabelEl.textContent = "Sumă (strict pozitivă)";
    }
  };

  typeEl.onchange = syncConditionalFields;
  curEl.onchange = () => { rateEl.value = store.getRateToBase(curEl.value); };
  accEl.onchange = () => {
    const chosen = store.getAccount(accEl.value);
    if (chosen && chosen.currency && !exp) {
      curEl.value = chosen.currency;
      rateEl.value = store.getRateToBase(chosen.currency);
    }
  };
  merEl.onchange = () => {
    if (exp) return;
    const m = (s.merchants || []).find((x) => x.name.toLowerCase() === merEl.value.trim().toLowerCase());
    if (m && m.category) catEl.value = m.category;
  };
  syncConditionalFields();

  $("#form-expense").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const type = typeEl.value;
      const amount = Number(amtEl.value);
      const currency = curEl.value;
      const rate = Number(rateEl.value) || 1;
      const date = $("#exp-date").value;
      const description = $("#exp-title").value.trim();
      const merchant = merEl.value.trim();
      const account = accEl.value;
      const toAccount = (type === "transfer" || type === "investitie") ? $("#exp-dest-account").value : "";
      const rawToAmt = (type === "transfer" || type === "investitie") ? $("#exp-dest-amount").value : "";
      const toAmount = rawToAmt !== "" ? Number(rawToAmt) : null;
      const payer = $("#exp-payer").value;
      const category = catEl.value;
      const method = $("#exp-payment").value;
      const isPrivate = $("#exp-private").checked;

      if (!exp && type === "transfer") {
        await store.addTransfer({
          date, description: description || "Transfer între conturi",
          account, toAccount, amount, currency, rate, toAmount,
          method, payer, isPrivate
        });
        closeModals();
        showToast("Transfer adăugat (1 rând v4)!");
        return;
      }

      const payload = {
        type, date, amount, currency, rate,
        category, description, merchant, method,
        isPrivate, account, toAccount, toAmount, payer
      };

      closeModals();
      if (exp) {
        await store.updateExpense(exp.id, payload);
        showToast("Înregistrare actualizată!");
      } else {
        await store.addExpense(payload);
        showToast("Înregistrare adăugată!");
      }
    } catch (err) {
      showToast("Eroare validare: " + err.message, 4500);
    }
  };

  const delBtn = $("#btn-del-expense");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm("Ștergi definitiv această înregistrare?")) {
        closeModals();
        await store.deleteExpense(exp.id);
        showToast("Înregistrare ștearsă.");
      }
    };
  }
}

function openAccountModal(accId) {
  const s = store.state;
  const acc = accId ? s.accounts.find((a) => a.id === accId) : null;
  const myEmail = store.getActiveEmail();
  const curOwner = acc ? normalizeAccountOwner(acc.owner) : myEmail;
  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">${acc ? "✏️ Editează Contul" : "➕ Cont Nou (v4)"}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <form id="form-acc" class="form-grid">
        <div class="field">
          <label>Nume cont</label>
          <input class="input" id="acc-name" value="${esc(acc ? acc.name : "")}" placeholder="ex: Cont Bancar RON, Economii EUR" required>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Tip cont (v4)</label>
            <select class="select" id="acc-type">
              ${ACCOUNT_TYPES.map((t) => `<option value="${esc(t.id)}" ${(acc ? acc.type : "cont bancar") === t.id ? "selected" : ""}>${t.icon} ${esc(t.label)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Monedă</label>
            <select class="select" id="acc-cur">
              ${s.currencies.map((c) => `<option value="${esc(c.code)}" ${(acc ? acc.currency : s.settings.baseCurrency) === c.code ? "selected" : ""}>${esc(c.code)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Sold inițial</label>
            <input class="input" id="acc-init" type="number" step="0.01" value="${acc ? (acc.initialBalance ?? 0) : 0}">
          </div>
          <div class="field">
            <label>Data sold inițial (opțional)</label>
            <input class="input" id="acc-init-date" type="date" value="${esc(acc ? (acc.initialDate || "") : "")}">
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Proprietar cont</label>
            <select class="select" id="acc-owner">
              <option value="${esc(myEmail)}" ${curOwner === myEmail ? "selected" : ""}>${esc(store.getPartnerName(myEmail))} (${esc(myEmail)})</option>
              <option value="${SHARED_OWNER}" ${curOwner === SHARED_OWNER ? "selected" : ""}>Comun</option>
            </select>
          </div>
          <div class="field">
            <label>Stare</label>
            <select class="select" id="acc-archived">
              <option value="no" ${!(acc && acc.archived) ? "selected" : ""}>Activ</option>
              <option value="yes" ${acc && acc.archived ? "selected" : ""}>Arhivat</option>
            </select>
          </div>
        </div>
        <div class="toggle-row">
          <div>
            <div style="font-weight:700; font-size:0.88rem">Include în disponibil</div>
            <div class="card-sub">Debifează pentru bani rezervați (taxe etc.): soldul rămâne vizibil, dar nu intră în Disponibil.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="acc-avail" ${acc && acc.includeInAvailable === false ? "" : "checked"}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="btn-row" style="justify-content:flex-end; margin-top:6px">
          <button type="button" class="btn btn-secondary" data-close-modal>Anulează</button>
          <button type="submit" class="btn btn-primary">💾 Salvează cont</button>
        </div>
      </form>
    </div>
  `;
  modal.classList.add("open");

  $("#form-acc").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#acc-name").value.trim();
    const entry = {
      id: acc ? acc.id : "cont-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36).slice(-4),
      name,
      type: $("#acc-type").value,
      currency: $("#acc-cur").value,
      initialBalance: Number($("#acc-init").value) || 0,
      initialDate: $("#acc-init-date").value || "",
      owner: $("#acc-owner").value,
      archived: $("#acc-archived").value === "yes",
      includeInAvailable: $("#acc-avail").checked,
      order: acc ? acc.order : (s.accounts.length + 1),
      visible: true
    };
    closeModals();
    await store.saveAccount(entry);
    showToast("Cont salvat!");
  };
}

function openCategoryModal(catId) {
  const cat = catId ? store.state.categories.find((c) => c.id === catId) : null;
  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">${cat ? "✏️ Editează Categoria" : "➕ Categorie Nouă"}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <form id="form-cat" class="form-grid">
        <div class="field">
          <label>Nume categorie</label>
          <input class="input" id="cat-name" value="${esc(cat ? cat.name : "")}" required>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Emoji</label>
            <input class="input" id="cat-icon" value="${esc(cat ? (cat.emoji || cat.icon) : "🛍️")}" maxlength="8">
          </div>
          <div class="field">
            <label>Culoare</label>
            <input class="input" id="cat-color" type="color" value="${esc(cat ? cat.color : "#2a78d6")}" style="height:42px; padding:4px">
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Tip categorie (v4)</label>
            <select class="select" id="cat-kind">
              <option value="cheltuiala" ${(cat ? (cat.type || cat.kind) : "cheltuiala") !== "venit" ? "selected" : ""}>Cheltuială</option>
              <option value="venit" ${(cat ? (cat.type || cat.kind) : "") === "venit" ? "selected" : ""}>Venit</option>
            </select>
          </div>
          <div class="field">
            <label>Buget lunar (${esc(store.state.settings.baseCurrency)})</label>
            <input class="input" id="cat-budget" type="number" min="0" step="50" value="${cat ? cat.budget : 0}">
          </div>
        </div>
        <div class="field">
          <label>Activă</label>
          <select class="select" id="cat-active">
            <option value="yes" ${!(cat && cat.active === false) ? "selected" : ""}>DA (Activă)</option>
            <option value="no" ${cat && cat.active === false ? "selected" : ""}>NU (Ascunsă)</option>
          </select>
        </div>
        <div class="btn-row" style="justify-content:space-between; margin-top:6px">
          ${cat ? `<button type="button" class="btn btn-danger" id="btn-del-cat">🗑️ Șterge</button>` : `<span></span>`}
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" data-close-modal>Anulează</button>
            <button type="submit" class="btn btn-primary">💾 Salvează</button>
          </div>
        </div>
      </form>
    </div>
  `;
  modal.classList.add("open");

  $("#form-cat").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#cat-name").value.trim();
    const emoji = $("#cat-icon").value.trim() || "📦";
    const ctype = $("#cat-kind").value === "venit" ? "venit" : "cheltuiala";
    const entry = {
      id: cat ? cat.id : name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36).slice(-4),
      name,
      emoji,
      icon: emoji,
      color: $("#cat-color").value || "#2a78d6",
      type: ctype,
      kind: ctype,
      budget: Number($("#cat-budget").value) || 0,
      active: $("#cat-active").value !== "no",
      order: cat ? cat.order : (store.state.categories.length + 1)
    };
    const next = cat
      ? store.state.categories.map((c) => (c.id === cat.id ? entry : c))
      : [...store.state.categories, entry];
    closeModals();
    await store.saveCategories(next);
    showToast("Categorie salvată!");
  };

  const delBtn = $("#btn-del-cat");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm("Ștergi această categorie?")) {
        closeModals();
        await store.saveCategories(store.state.categories.filter((c) => c.id !== cat.id));
        showToast("Categorie ștearsă.");
      }
    };
  }
}

function openMerchantModal(merchantName) {
  const mer = merchantName
    ? (store.state.merchants || []).find((m) => m.name.toLowerCase() === merchantName.toLowerCase())
    : null;
  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">${mer ? "✏️ Editează Comerciant" : "➕ Comerciant Nou"}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <form id="form-mer" class="form-grid">
        <div class="field">
          <label>Nume comerciant</label>
          <input class="input" id="mer-name" value="${esc(mer ? mer.name : "")}" placeholder="ex: Supermarket Demo" required>
        </div>
        <div class="field">
          <label>Categorie implicită</label>
          <select class="select" id="mer-cat">
            <option value="">— Fără —</option>
            ${store.state.categories.map((c) => `<option value="${esc(c.id)}" ${(mer ? mer.category : "") === c.id ? "selected" : ""}>${c.emoji || c.icon} ${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="btn-row" style="justify-content:space-between; margin-top:6px">
          ${mer ? `<button type="button" class="btn btn-danger" id="btn-del-mer">🗑️ Șterge</button>` : `<span></span>`}
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" data-close-modal>Anulează</button>
            <button type="submit" class="btn btn-primary">💾 Salvează</button>
          </div>
        </div>
      </form>
    </div>
  `;
  modal.classList.add("open");

  $("#form-mer").onsubmit = async (e) => {
    e.preventDefault();
    closeModals();
    await store.saveMerchant({
      name: $("#mer-name").value.trim(),
      oldName: mer ? mer.name : undefined,
      category: $("#mer-cat").value
    });
    showToast("Comerciant salvat!");
  };

  const delBtn = $("#btn-del-mer");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm(`Ștergi comerciantul ${mer.name}?`)) {
        closeModals();
        await store.deleteMerchant(mer.name);
        showToast("Comerciant șters.");
      }
    };
  }
}

function openCurrencyModal(code) {
  const cur = code ? store.state.currencies.find((c) => c.code === code) : null;
  const baseCur = store.state.settings.baseCurrency || "RON";
  const modal = $("#modal-main");
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h3 class="modal-title">${cur ? `✏️ Editează ${cur.code}` : "➕ Valută Nouă"}</h3>
        <button class="close-btn" data-close-modal>✕</button>
      </div>
      <form id="form-cur" class="form-grid">
        <div class="form-grid cols-2">
          <div class="field">
            <label>Cod valută</label>
            <input class="input" id="cur-code" value="${esc(cur ? cur.code : "")}" maxlength="5" ${cur ? "readonly" : "required"}>
          </div>
          <div class="field">
            <label>Simbol</label>
            <input class="input" id="cur-symbol" value="${esc(cur ? cur.symbol : "")}" maxlength="6" required>
          </div>
        </div>
        <div class="field">
          <label>Denumire</label>
          <input class="input" id="cur-name" value="${esc(cur ? cur.name : "")}" required>
        </div>
        <div class="field">
          <label>Curs curent față de ${esc(baseCur)} (nu modifică tranzacțiile istorice)</label>
          <input class="input" id="cur-rate" type="number" step="0.0001" min="0.0001" value="${cur ? cur.rate : 1}" required>
        </div>
        <div class="btn-row" style="justify-content:space-between; margin-top:6px">
          ${cur && cur.code !== baseCur ? `<button type="button" class="btn btn-danger" id="btn-del-cur">🗑️ Șterge</button>` : `<span></span>`}
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" data-close-modal>Anulează</button>
            <button type="submit" class="btn btn-primary">💾 Salvează</button>
          </div>
        </div>
      </form>
    </div>
  `;
  modal.classList.add("open");

  $("#form-cur").onsubmit = async (e) => {
    e.preventDefault();
    const entry = {
      code: $("#cur-code").value.trim().toUpperCase(),
      symbol: $("#cur-symbol").value.trim(),
      name: $("#cur-name").value.trim(),
      rate: Number($("#cur-rate").value) || 1
    };
    const exists = store.state.currencies.some((c) => c.code === entry.code);
    const next = exists
      ? store.state.currencies.map((c) => (c.code === entry.code ? entry : c))
      : [...store.state.currencies, entry];
    closeModals();
    await store.saveCurrencies(next);
    showToast(`Valuta ${entry.code} salvată (sumele istorice au rămas neschimbate).`);
  };

  const delBtn = $("#btn-del-cur");
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm(`Ștergi valuta ${cur.code}?`)) {
        closeModals();
        await store.saveCurrencies(store.state.currencies.filter((c) => c.code !== cur.code));
        showToast(`Valuta ${cur.code} ștearsă.`);
      }
    };
  }
}

document.addEventListener("DOMContentLoaded", initApp);
