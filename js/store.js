import {
  DEFAULT_SETTINGS,
  DEFAULT_MEMBERS,
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_CURRENCIES,
  DEFAULT_MERCHANTS,
  SHARED_OWNER,
  createDemoExpenses
} from "./defaults.js";
import * as api from "./sheets-api.js";
import {
  validateTransaction,
  createTransferRecord,
  normalizeAccountOwner,
  normalizeRecordType,
  round2
} from "./ledger.js";

const STORAGE_KEY = "buget_familie_state_v4";

function safeGetStorage(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function safeSetStorage(key, val) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {}
}

function safeRemoveStorage(key) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch (_) {}
}

function detectTheme() {
  try {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  } catch (_) {}
  return "light";
}

function defaultTableVersions() {
  return { accounts: 1, categories: 1, currencies: 1, settings: 1, merchants: 1 };
}

function createInitialState() {
  const now = new Date();
  const saved = safeGetStorage(STORAGE_KEY);
  if (saved) {
    return {
      connection: saved.connection || { webAppUrl: "", pin: "", sheetName: "", sheetUrl: "", lastSyncedAt: null },
      activePartner: saved.activePartner || "p1",
      activeEmail: saved.activeEmail || DEFAULT_MEMBERS[0].email,
      theme: saved.theme || detectTheme(),
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
      members: Array.isArray(saved.members) && saved.members.length ? saved.members : structuredClone(DEFAULT_MEMBERS),
      accounts: Array.isArray(saved.accounts) && saved.accounts.length ? saved.accounts : structuredClone(DEFAULT_ACCOUNTS),
      categories: saved.categories && saved.categories.length ? saved.categories : structuredClone(DEFAULT_CATEGORIES),
      currencies: saved.currencies && saved.currencies.length ? saved.currencies : structuredClone(DEFAULT_CURRENCIES),
      merchants: Array.isArray(saved.merchants) ? saved.merchants : structuredClone(DEFAULT_MERCHANTS),
      bills: Array.isArray(saved.bills) ? saved.bills : [],
      tableVersions: { ...defaultTableVersions(), ...(saved.tableVersions || {}) },
      expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
      auditWarnings: Array.isArray(saved.auditWarnings) ? saved.auditWarnings : [],
      pendingQueue: Array.isArray(saved.pendingQueue) ? saved.pendingQueue : [],
      failedQueue: Array.isArray(saved.failedQueue) ? saved.failedQueue : [],
      isDemoMode: saved.isDemoMode ?? false,
      selectedYear: now.getFullYear(),
      selectedMonth: now.getMonth(),
      scope: "all",
      syncing: false,
      lastError: null
    };
  }

  return {
    connection: { webAppUrl: "", pin: "", sheetName: "", sheetUrl: "", lastSyncedAt: null },
    activePartner: "p1",
    activeEmail: DEFAULT_MEMBERS[0].email,
    theme: detectTheme(),
    settings: structuredClone(DEFAULT_SETTINGS),
    members: structuredClone(DEFAULT_MEMBERS),
    accounts: structuredClone(DEFAULT_ACCOUNTS),
    categories: structuredClone(DEFAULT_CATEGORIES),
    currencies: structuredClone(DEFAULT_CURRENCIES),
    merchants: structuredClone(DEFAULT_MERCHANTS),
    bills: [],
    tableVersions: defaultTableVersions(),
    expenses: createDemoExpenses(),
    auditWarnings: [],
    pendingQueue: [],
    failedQueue: [],
    isDemoMode: true,
    selectedYear: now.getFullYear(),
    selectedMonth: now.getMonth(),
    scope: "all",
    syncing: false,
    lastError: null
  };
}

/**
 * Combină lista venită de pe server cu operațiile încă aflate în `pendingQueue`,
 * marcându-le cu `pendingSync: true` astfel încât intrările netrimise să nu dispară la `sync()`.
 */
function mergeServerWithPending(serverExpenses, pendingQueue) {
  const map = new Map();
  (serverExpenses || []).forEach((e) => {
    map.set(e.id, { ...e, pendingSync: false });
  });

  (pendingQueue || []).forEach((op) => {
    if (op.type === "addExpense" && op.expense) {
      map.set(op.expense.id, { ...op.expense, pendingSync: true });
    } else if (op.type === "addTransfer") {
      if (op.transfer) {
        map.set(op.transfer.id, { ...op.transfer, pendingSync: true });
      } else if (Array.isArray(op.legs)) {
        op.legs.forEach((leg) => map.set(leg.id, { ...leg, pendingSync: true }));
      }
    } else if (op.type === "updateExpense" && op.expense) {
      map.set(op.expense.id, { ...op.expense, pendingSync: true });
    } else if (op.type === "deleteExpense" && op.id) {
      map.delete(op.id);
    } else if (op.type === "bulkImport" && Array.isArray(op.expenses)) {
      op.expenses.forEach((e) => map.set(e.id, { ...e, pendingSync: true }));
    }
  });

  return Array.from(map.values()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export class Store {
  constructor() {
    this.state = createInitialState();
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.persist();
    this.listeners.forEach((fn) => fn(this.state));
  }

  persist(strict = false) {
    const toSave = {
      connection: {
        webAppUrl: this.state.connection.webAppUrl,
        pin: this.state.connection.pin,
        sheetName: this.state.connection.sheetName,
        sheetUrl: this.state.connection.sheetUrl || "",
        lastSyncedAt: this.state.connection.lastSyncedAt
      },
      activePartner: this.state.activePartner,
      activeEmail: this.state.activeEmail,
      theme: this.state.theme,
      settings: this.state.settings,
      members: this.state.members,
      accounts: this.state.accounts,
      categories: this.state.categories,
      currencies: this.state.currencies,
      merchants: this.state.merchants,
      bills: this.state.bills,
      tableVersions: this.state.tableVersions,
      expenses: this.state.expenses,
      auditWarnings: this.state.auditWarnings,
      pendingQueue: this.state.pendingQueue,
      failedQueue: this.state.failedQueue,
      isDemoMode: this.state.isDemoMode
    };
    if (strict) {
      if (typeof localStorage === "undefined") throw new Error("Stocarea locală nu este disponibilă. Formularul rămâne deschis.");
      const encoded = JSON.stringify(toSave);
      localStorage.setItem(STORAGE_KEY, encoded);
      if (localStorage.getItem(STORAGE_KEY) !== encoded) throw new Error("Coada locală nu a putut fi verificată. Formularul rămâne deschis.");
    } else safeSetStorage(STORAGE_KEY, toSave);
  }

  isConnected() {
    return Boolean(this.state.connection.webAppUrl && this.state.connection.webAppUrl.trim() && this.state.connection.pin);
  }

  getPartnerEmail(partnerKey) {
    const idx = partnerKey === "p2" ? 1 : 0;
    const m = (this.state.members || [])[idx];
    if (m && m.email) return m.email.toLowerCase();
    return (partnerKey === "p2" ? this.state.settings.partner2Email : this.state.settings.partner1Email || DEFAULT_MEMBERS[idx].email).toLowerCase();
  }

  getActiveEmail() {
    if (this.state.activeEmail) return this.state.activeEmail.toLowerCase();
    return this.getPartnerEmail(this.state.activePartner);
  }

  isPartner1(ownerOrKey) {
    const val = String(ownerOrKey || "").trim().toLowerCase();
    return val === "p1" || val === this.getPartnerEmail("p1");
  }

  isPartner2(ownerOrKey) {
    const val = String(ownerOrKey || "").trim().toLowerCase();
    return val === "p2" || val === this.getPartnerEmail("p2");
  }

  isOwnRecord(exp) {
    if (!exp) return true;
    if (exp.own === true) return true;
    if (exp.own === false) return false;
    const owner = String(exp.owner || "").trim().toLowerCase();
    if (!owner) return true;
    return owner === this.getActiveEmail() || owner === this.state.activePartner;
  }

  isAccountVisible(acc) {
    if (!acc) return false;
    if (acc.visible === false) return false;
    const owner = normalizeAccountOwner(acc.owner);
    const me = this.getActiveEmail();
    return owner === SHARED_OWNER || owner === me || owner === this.state.activePartner;
  }

  setTheme(theme) {
    this.state.theme = theme;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    this.emit();
  }

  toggleTheme() {
    this.setTheme(this.state.theme === "dark" ? "light" : "dark");
  }

  setMonth(year, month) {
    this.state.selectedYear = year;
    this.state.selectedMonth = month;
    this.emit();
  }

  shiftMonth(delta) {
    const d = new Date(this.state.selectedYear, this.state.selectedMonth + delta, 1);
    this.setMonth(d.getFullYear(), d.getMonth());
  }

  setScope(scope) {
    this.state.scope = scope;
    this.emit();
  }

  setActivePartner(partner) {
    if (this.isConnected()) return;
    this.state.activePartner = partner === "p2" ? "p2" : "p1";
    this.state.activeEmail = this.getPartnerEmail(this.state.activePartner);
    this.emit();
  }

  getPartnerName(partnerOrEmail) {
    const raw = String(partnerOrEmail || "").trim().toLowerCase();
    if (!raw || raw === SHARED_OWNER) return "Comun";
    if (raw === "p1") return this.state.settings.partner1Name || this.state.members[0]?.name || "Eu";
    if (raw === "p2") return this.state.settings.partner2Name || this.state.members[1]?.name || "Soția";
    const m = (this.state.members || []).find((mem) => String(mem.email || "").toLowerCase() === raw);
    if (m) return m.name;
    if (raw === this.getPartnerEmail("p1")) return this.state.settings.partner1Name || "Eu";
    if (raw === this.getPartnerEmail("p2")) return this.state.settings.partner2Name || "Soția";
    return partnerOrEmail;
  }

  getAccount(accId) {
    return (this.state.accounts || []).find((a) => a.id === accId) || null;
  }

  getCategory(catId) {
    const found = this.state.categories.find((c) => c.id === catId || c.name === catId);
    if (found) {
      return {
        ...found,
        emoji: found.emoji || found.icon || "📦",
        icon: found.icon || found.emoji || "📦",
        type: found.type || found.kind || "cheltuiala"
      };
    }
    return {
      id: "altele",
      name: catId || "Altele",
      emoji: "📦",
      icon: "📦",
      color: "#8a8984",
      budget: 0,
      active: true,
      type: "cheltuiala",
      kind: "cheltuiala"
    };
  }

  getCurrency(code) {
    const upper = String(code || this.state.settings.baseCurrency || "RON").toUpperCase();
    return (
      this.state.currencies.find((c) => c.code === upper) || {
        code: upper,
        name: upper,
        symbol: upper,
        rate: 1
      }
    );
  }

  getRateToBase(currencyCode) {
    const cur = this.getCurrency(currencyCode);
    const base = this.getCurrency(this.state.settings.baseCurrency);
    if (cur.code === base.code) return 1;
    return base.rate ? round2((cur.rate / base.rate) * 10000) / 10000 : cur.rate;
  }

  toBaseCurrency(amount, currencyCode) {
    const val = Number(amount) || 0;
    const rate = this.getRateToBase(currencyCode);
    return round2(val * rate);
  }

  getVisibleExpenses({ year = null, month = null, scope = null } = {}) {
    const activeScope = scope ?? this.state.scope;

    return this.state.expenses.filter((exp) => {
      const own = this.isOwnRecord(exp);
      if (!own && exp.isPrivate) return false;

      if (year !== null && month !== null) {
        if (!exp.date) return false;
        const [y, m] = exp.date.split("-").map(Number);
        if (y !== year || m - 1 !== month) return false;
      }

      if (activeScope === "mine") return own;
      if (activeScope === "partner") return !own;
      if (activeScope === "shared") return !exp.isPrivate;
      if (activeScope === "private") return own && exp.isPrivate;
      return true;
    });
  }

  dismissFailedOp(index) {
    this.state.failedQueue = this.state.failedQueue.filter((_, i) => i !== index);
    this.emit();
  }

  clearFailedQueue() {
    this.state.failedQueue = [];
    this.emit();
  }

  rememberMerchantLocal(name, category) {
    const clean = String(name || "").trim();
    if (!clean) return;
    const exists = (this.state.merchants || []).some(
      (m) => m.name.toLowerCase() === clean.toLowerCase()
    );
    if (!exists) {
      this.state.merchants = [...(this.state.merchants || []), { name: clean, category: category || "" }]
        .sort((a, b) => a.name.localeCompare(b.name, "ro"));
    }
  }

  commitFinancialLocal(record, op, { replaceIndex = null, merchant = "", category = "" } = {}) {
    const before = { expenses: this.state.expenses, pendingQueue: this.state.pendingQueue, merchants: this.state.merchants };
    this.state.expenses = [...this.state.expenses];
    if (replaceIndex === null) this.state.expenses.unshift(record);
    else this.state.expenses[replaceIndex] = record;
    if (op) this.state.pendingQueue = [...this.state.pendingQueue, op];
    if (merchant) this.rememberMerchantLocal(merchant, category);
    try { this.persist(true); }
    catch (error) { Object.assign(this.state, before); throw error; }
    this.listeners.forEach(fn => fn(this.state));
  }

  async finishFinancialSave(background) {
    if (!this.isConnected()) return;
    if (background) { this.flushQueue().catch(error => { this.state.lastError = error.message; this.emit(); }); return; }
    await this.flushQueue();
  }

  async addExpense(data, { background = false } = {}) {
    const now = new Date().toISOString();
    const type = normalizeRecordType(data.type || "cheltuiala") || String(data.type || "");
    const account = String(data.account ?? data.accountId ?? "").trim();
    const toAccount = String(data.toAccount ?? data.destAccountId ?? "").trim();
    const accObj = account ? this.getAccount(account) : null;
    const currency = String(data.currency || (accObj && accObj.currency) || this.state.settings.baseCurrency).toUpperCase();
    const rawRate = data.rate !== undefined && data.rate !== "" ? data.rate : data.exchangeRate;
    const rate = rawRate !== undefined && rawRate !== "" ? Number(rawRate) : this.getRateToBase(currency);
    const amount = Number(data.amount);
    const baseAmount = data.baseAmount !== undefined && data.baseAmount !== ""
      ? Number(data.baseAmount)
      : round2(amount * rate);
    const rawToAmt = data.toAmount !== undefined ? data.toAmount : data.destAmount;
    const toAmount = (rawToAmt !== "" && rawToAmt !== null && rawToAmt !== undefined) ? round2(Number(rawToAmt)) : null;

    const myEmail = this.getActiveEmail();
    const id = data.id || ("tx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
    const payer = String(data.payer || (accObj && normalizeAccountOwner(accObj.owner) === SHARED_OWNER ? SHARED_OWNER : myEmail)).toLowerCase();
    const category = data.category || (type === "venit" ? "alte-venituri" : type === "cheltuiala" ? "altele" : "");
    const description = String(data.description ?? data.title ?? data.notes ?? "").trim();
    const merchant = String(data.merchant || "").trim();
    const method = String(data.method ?? data.paymentMethod ?? "Card").trim();
    const source = String(data.source ?? data.clientOpId ?? data.sourceIdentity ?? `op:${id}`).trim();

    const tx = {
      id,
      date: data.date,
      type,
      amount: round2(amount),
      currency,
      rate,
      baseAmount: round2(baseAmount),
      category,
      description,
      merchant,
      method,
      isPrivate: Boolean(data.isPrivate),
      account,
      toAccount: (type === "transfer" || type === "investitie") ? toAccount : "",
      toAmount: (type === "transfer" || type === "investitie") ? toAmount : null,
      payer,
      bill: String(data.bill || "").trim(),
      source,
      owner: myEmail,
      own: true,
      created: now,
      modified: now,
      pendingSync: this.isConnected()
    };

    const check = validateTransaction(tx);
    if (!check.valid) {
      throw new Error(check.errors.join(" "));
    }
    tx.baseMismatch = check.baseMismatch;

    this.commitFinancialLocal(tx, this.isConnected() ? { type: "addExpense", expense: tx } : null,
      { merchant: (type === "cheltuiala" || type === "venit") ? merchant : "", category });
    await this.finishFinancialSave(background);
    return tx;
  }

  /**
   * Creează un transfer pe UN SINGUR RÂND v4 (Cont sursă + Cont destinație + Sumă destinație opțională).
   */
  async addTransfer(params, { background = false } = {}) {
    const baseCurrency = this.state.settings.baseCurrency || "RON";
    const srcAcc = this.getAccount(params.account || params.sourceAccountId);
    const sCur = String(params.currency || params.sourceCurrency || (srcAcc && srcAcc.currency) || baseCurrency).toUpperCase();
    const sRate = params.rate ?? params.sourceExchangeRate ?? this.getRateToBase(sCur);
    const myEmail = this.getActiveEmail();
    const payer = params.payer || (srcAcc && normalizeAccountOwner(srcAcc.owner) === SHARED_OWNER ? SHARED_OWNER : myEmail);

    const transfer = {
      ...createTransferRecord({
        ...params,
        currency: sCur,
        baseCurrency,
        rate: sRate,
        payer,
        owner: myEmail
      }),
      own: true,
      pendingSync: this.isConnected()
    };

    this.commitFinancialLocal(transfer, this.isConnected() ? { type: "addTransfer", transfer } : null);
    await this.finishFinancialSave(background);
    return transfer;
  }

  async updateExpense(id, updates, expectedVersion = null, { background = false } = {}) {
    const idx = this.state.expenses.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const existing = this.state.expenses[idx];
    const expectedModified = expectedVersion ?? existing.modified ?? existing.updatedAt ?? "";
    const currency = String(updates.currency || existing.currency).toUpperCase();
    const amount = Number(updates.amount ?? existing.amount);
    const rawRate = updates.rate !== undefined && updates.rate !== ""
      ? updates.rate
      : (updates.exchangeRate !== undefined && updates.exchangeRate !== "" ? updates.exchangeRate : null);
    const rate = rawRate !== null
      ? Number(rawRate)
      : (currency === existing.currency ? (existing.rate || existing.exchangeRate || 1) : this.getRateToBase(currency));
    const baseAmount = updates.baseAmount !== undefined && updates.baseAmount !== ""
      ? Number(updates.baseAmount)
      : round2(amount * rate);
    const rawToAmt = updates.toAmount !== undefined ? updates.toAmount : existing.toAmount;
    const toAmount = (rawToAmt !== "" && rawToAmt !== null && rawToAmt !== undefined) ? round2(Number(rawToAmt)) : null;

    const updated = {
      ...existing,
      ...updates,
      description: String(updates.description ?? updates.title ?? existing.description ?? "").trim(),
      merchant: String(updates.merchant ?? existing.merchant ?? "").trim(),
      method: String(updates.method ?? updates.paymentMethod ?? existing.method ?? "Card").trim(),
      account: String(updates.account ?? updates.accountId ?? existing.account ?? "").trim(),
      toAccount: String(updates.toAccount ?? updates.destAccountId ?? existing.toAccount ?? "").trim(),
      toAmount,
      amount: round2(amount),
      currency,
      rate,
      baseAmount: round2(baseAmount),
      modified: new Date().toISOString(),
      pendingSync: this.isConnected()
    };

    const check = validateTransaction(updated);
    if (!check.valid) {
      throw new Error(check.errors.join(" "));
    }
    updated.baseMismatch = check.baseMismatch;

    this.commitFinancialLocal(updated, this.isConnected() ? {
      type: "updateExpense", expense: updated, expectedUpdatedAt: expectedModified
    } : null, { replaceIndex: idx });
    await this.finishFinancialSave(background);
    return updated;
  }

  async deleteExpense(id, expectedVersion = null) {
    const existing = this.state.expenses.find((e) => e.id === id);
    if (!existing) return;

    this.state.expenses = this.state.expenses.filter((e) => e.id !== id);
    this.emit();

    if (this.isConnected()) {
      await this.enqueueAndFlush({
        type: "deleteExpense",
        id: existing.id,
        expectedUpdatedAt: expectedVersion ?? existing.modified ?? existing.updatedAt ?? ""
      });
    }
  }

  async commitImportRows(readyRows) {
    const now = new Date().toISOString();
    const myEmail = this.getActiveEmail();
    const toInsert = (readyRows || []).map((row) => ({
      ...row,
      description: row.description ?? row.title ?? "",
      rate: row.rate ?? row.exchangeRate ?? 1,
      account: row.account ?? row.accountId ?? "",
      toAccount: row.toAccount ?? row.destAccountId ?? "",
      toAmount: row.toAmount ?? row.destAmount ?? null,
      method: row.method ?? row.paymentMethod ?? "Card",
      source: row.source ?? row.sourceIdentity ?? `imp:${row.id}`,
      owner: myEmail,
      own: true,
      created: row.created || now,
      modified: now,
      pendingSync: this.isConnected()
    }));

    this.state.expenses = [...toInsert, ...this.state.expenses];
    this.emit();

    if (this.isConnected() && toInsert.length) {
      await this.enqueueAndFlush({ type: "bulkImport", expenses: toInsert });
    }
    return toInsert.length;
  }

  async saveAccounts(accounts, expectedVersion = this.state.tableVersions.accounts) {
    this.state.accounts = accounts;
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({
        type: "saveAccounts",
        accounts,
        expectedVersion
      });
    }
  }

  /** Salvează UN cont (upsert pe rând, server-side). Nu rescrie tabul Conturi și nu poate pierde conturi adăugate în altă parte. */
  async saveAccount(entry, expectedVersion = this.state.tableVersions.accounts) {
    const i = this.state.accounts.findIndex((a) => a.id === entry.id);
    this.state.accounts = i >= 0
      ? this.state.accounts.map((a) => (a.id === entry.id ? entry : a))
      : [...this.state.accounts, entry];
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({ type: "saveAccount", account: entry, expectedVersion });
    }
  }

  async saveCategories(categories, { categoryDraftId, expectedVersion = this.state.tableVersions.categories } = {}) {
    this.state.categories = categories;
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({
        type: "saveCategories",
        categories,
        categoryDraftId,
        expectedVersion
      });
    }
  }

  async saveCurrencies(currencies, expectedVersion = this.state.tableVersions.currencies) {
    this.state.currencies = currencies;
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({
        type: "saveCurrencies",
        currencies,
        expectedVersion
      });
    }
  }

  async saveMerchant(merchant, expectedVersion = this.state.tableVersions.merchants) {
    const name = String(merchant?.name || "").trim();
    if (!name) throw new Error("Comerciantul are nevoie de un nume.");
    const oldName = merchant.oldName || name;
    const category = String(merchant.category || "").trim();
    const rest = (this.state.merchants || []).filter(
      (m) => m.name.toLowerCase() !== oldName.toLowerCase() && m.name.toLowerCase() !== name.toLowerCase()
    );
    this.state.merchants = [...rest, { name, category }].sort((a, b) => a.name.localeCompare(b.name, "ro"));
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({ type: "saveMerchant", merchant: { name, oldName, category }, expectedVersion });
    }
  }

  async deleteMerchant(name, expectedVersion = this.state.tableVersions.merchants) {
    this.state.merchants = (this.state.merchants || []).filter(
      (m) => m.name.toLowerCase() !== String(name || "").toLowerCase()
    );
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({ type: "deleteMerchant", name, expectedVersion });
    }
  }

  async saveSettings(newSettings, expectedVersion = this.state.tableVersions.settings) {
    this.state.settings = { ...this.state.settings, ...newSettings };
    if (this.state.members[0]) {
      if (newSettings.partner1Name) this.state.members[0].name = newSettings.partner1Name;

    }
    if (this.state.members[1]) {
      if (newSettings.partner2Name) this.state.members[1].name = newSettings.partner2Name;

    }
    this.emit();
    if (this.isConnected()) {
      await this.enqueueTableAndFlush({
        type: "saveSettings",
        settings: this.state.settings,
        expectedVersion
      });
    }
  }

  async enqueueTableAndFlush(op) {
    const failedBefore = this.state.failedQueue.length;
    await this.enqueueAndFlush(op);
    const failed = this.state.failedQueue.slice(failedBefore).find(item=>item.op===op);
    if (failed) {
      try { await this.sync(); } catch (_) {}
      throw new Error(failed.error || 'Conflict de versiune. Recitește datele.');
    }
    if (this.state.pendingQueue.includes(op)) throw new Error(this.state.lastError || 'Operația rămâne în coadă. Nu o crea din nou.');
  }

  async enqueueAndFlush(op) {
    this.state.pendingQueue.push(op);
    this.persist();
    return this.flushQueue();
  }

  /**
   * Trimite operațiile din `pendingQueue`:
   * - Succes / confirmare idempotentă -> scoate din coadă și actualizează versiunea / timestamp-ul local.
   * - Eroare permanentă sau conflict (CONFLICT_ID, VERSION_CONFLICT, validare, UNAUTHORIZED) ->
   *   mută în `failedQueue` și CONTINUĂ cu operațiile independente următoare.
   * - Eroare temporară (rețea, LOCK_TIMEOUT, HTTP 5xx) -> păstrează în `pendingQueue` pentru reîncercare.
   */
  async flushQueue() {
    if (this._flushing) return this._flushing; // one flush at a time: no parallel double-send of the same op
    this._flushing = this._flushQueueInner().finally(() => { this._flushing = null; });
    return this._flushing;
  }

  async _flushQueueInner() {
    if (!this.isConnected() || !this.state.pendingQueue.length) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const { webAppUrl, pin } = this.state.connection;
    while (this.state.pendingQueue.length > 0) {
      const op = this.state.pendingQueue[0];
      try {
        let res = null;
        if (op.type === "addExpense") {
          res = await api.pushAddExpense(webAppUrl, pin, op.expense);
          if (res && res.id) this.markLocalTxSynced(res.id, res.modified || res.updatedAt);
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
          if (Array.isArray(res?.merchants)) this.state.merchants = res.merchants;
        } else if (op.type === "addTransfer") {
          res = await api.pushAddTransfer(webAppUrl, pin, op.transfer || op.legs);
          if (res && res.id) this.markLocalTxSynced(res.id, res.modified || res.updatedAt);
          if (Array.isArray(res?.results)) {
            res.results.forEach((r) => {
              if (r.rezultat === "aplicat" || r.rezultat === "deja_aplicat") {
                this.markLocalTxSynced(r.id, r.updatedAt);
              }
            });
          }
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
        } else if (op.type === "updateExpense") {
          res = await api.pushUpdateExpense(webAppUrl, pin, op.expense, op.expectedUpdatedAt);
          if (res && res.id) this.markLocalTxSynced(res.id, res.modified || res.updatedAt);
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
          if (Array.isArray(res?.merchants)) this.state.merchants = res.merchants;
        } else if (op.type === "deleteExpense") {
          res = await api.pushDeleteExpense(webAppUrl, pin, op.id, op.expectedUpdatedAt);
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
        } else if (op.type === "bulkImport") {
          res = await api.pushBulkImport(webAppUrl, pin, op.expenses);
          const rowResults = Array.isArray(res?.results) ? res.results : [];
          const byId = new Map((op.expenses || []).map((e) => [e.id, e]));
          const rejectedIds = new Set();

          rowResults.forEach((r) => {
            if (r.rezultat === "aplicat" || r.rezultat === "deja_aplicat") {
              this.markLocalTxSynced(r.id, r.updatedAt);
            } else {
              if (r.id) rejectedIds.add(r.id);
              this.state.failedQueue.push({
                op: { type: "bulkImportRow", id: r.id, expense: byId.get(r.id) || null },
                errorCode: r.cod || "REJECTED",
                error: r.mesaj || "Rând respins sau în conflict.",
                failedAt: new Date().toISOString()
              });
            }
          });

          if (rejectedIds.size > 0) {
            this.state.expenses = this.state.expenses.filter(
              (e) => !(rejectedIds.has(e.id) && e.pendingSync)
            );
          }
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
          if (Array.isArray(res?.merchants)) this.state.merchants = res.merchants;
        } else if (op.type === "saveAccount") {
          res = await api.pushSaveAccount(webAppUrl, pin, op.account, op.expectedVersion);
          if (res?.version) this.state.tableVersions.accounts = res.version;
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
        } else if (op.type === "saveAccounts") {
          res = await api.pushAccounts(webAppUrl, pin, op.accounts, op.expectedVersion);
          if (res?.version) this.state.tableVersions.accounts = res.version;
          if (Array.isArray(res?.accounts)) this.state.accounts = res.accounts;
        } else if (op.type === "saveCategories") {
          res = await api.pushCategories(webAppUrl, pin, op.categories, op.expectedVersion);
          if (res?.version) this.state.tableVersions.categories = res.version;
          if (Array.isArray(res?.categories)) this.state.categories = res.categories;
        } else if (op.type === "saveCurrencies") {
          res = await api.pushCurrencies(webAppUrl, pin, op.currencies, op.expectedVersion);
          if (res?.version) this.state.tableVersions.currencies = res.version;
          if (Array.isArray(res?.currencies)) this.state.currencies = res.currencies;
        } else if (op.type === "saveMerchant") {
          res = await api.pushSaveMerchant(webAppUrl, pin, op.merchant, op.expectedVersion);
          if (res?.version) this.state.tableVersions.merchants = res.version;
          if (Array.isArray(res?.merchants)) this.state.merchants = res.merchants;
        } else if (op.type === "deleteMerchant") {
          res = await api.pushDeleteMerchant(webAppUrl, pin, op.name, op.expectedVersion);
          if (res?.version) this.state.tableVersions.merchants = res.version;
          if (Array.isArray(res?.merchants)) this.state.merchants = res.merchants;
        } else if (op.type === "saveSettings") {
          res = await api.pushSettings(webAppUrl, pin, op.settings, op.expectedVersion);
          if (res?.version) {
            // Our own successful save bumped the version: later queued settings ops created from the same base are not conflicts with another device.
            // Never silently rebase a queued snapshot onto a newer table version.
            this.state.tableVersions.settings = res.version;
          }
          if (res?.settings) this.state.settings = { ...this.state.settings, ...res.settings };
          if (Array.isArray(res?.members)) this.state.members = res.members;
        }
        this.state.pendingQueue.shift();
        this.state.lastError = null;
        this.persist();
      } catch (err) {
        const isPermanent = err && err.retryable === false;
        if (isPermanent) {
          this.state.pendingQueue.shift();
          if (op.type === "addTransfer") {
            if (op.transfer) {
              this.state.expenses = this.state.expenses.filter((e) => !(e.id === op.transfer.id && e.pendingSync));
            } else if (Array.isArray(op.legs)) {
              const legIds = new Set(op.legs.map((l) => l.id));
              this.state.expenses = this.state.expenses.filter((e) => !(legIds.has(e.id) && e.pendingSync));
            }
          } else if (op.type === "addExpense" && op.expense) {
            this.state.expenses = this.state.expenses.filter((e) => !(e.id === op.expense.id && e.pendingSync));
          }
          this.state.failedQueue.push({
            op,
            errorCode: err.errorCode || "FAILED",
            error: err.message || String(err),
            failedAt: new Date().toISOString()
          });
          this.persist();
          continue;
        }
        this.state.lastError = err.message || String(err);
        this.emit();
        break;
      }
    }
    this.emit();
  }

  markLocalTxSynced(id, modified) {
    const found = this.state.expenses.find((e) => e.id === id);
    if (found) {
      found.pendingSync = false;
      if (modified) {
        found.modified = modified;
        found.updatedAt = modified;
      }
    }
  }

  async connectAndSync({ webAppUrl, pin, initialize = true }) {
    this.state.syncing = true;
    this.state.lastError = null;
    this.emit();

    try {
      const cleanUrl = webAppUrl.trim();
      const cleanPin = String(pin || "").trim();
      if (!cleanPin || cleanPin.length < 32) {
        throw new Error("Introdu cheia de acces generată la configurare (minim 32 de caractere).");
      }

      const authRes = initialize
        ? await api.initSheet(cleanUrl, cleanPin, this.state.settings)
        : await api.pingSheet(cleanUrl, cleanPin);

      this.state.activePartner = authRes.partner === "p2" ? "p2" : "p1";
      if (authRes.email) this.state.activeEmail = authRes.email.toLowerCase();
      this.state.connection = {
        ...this.state.connection,
        webAppUrl: cleanUrl,
        pin: cleanPin,
        sheetUrl: authRes.sheetUrl || this.state.connection.sheetUrl || ""
      };
      if (authRes.tableVersions) {
        this.state.tableVersions = { ...this.state.tableVersions, ...authRes.tableVersions };
      }
      this.state.isDemoMode = false;
      this.persist();

      return await this.sync();
    } catch (err) {
      this.state.syncing = false;
      this.state.lastError = err.message;
      this.emit();
      throw err;
    }
  }

  async sync() {
    if (!this.isConnected()) return null;
    this.state.syncing = true;
    this.state.lastError = null;
    this.emit();

    try {
      await this.flushQueue();
      const { webAppUrl, pin } = this.state.connection;
      const data = await api.syncFromSheet(webAppUrl, pin);

      if (data.partner) this.state.activePartner = data.partner === "p2" ? "p2" : "p1";
      if (data.email) this.state.activeEmail = data.email.toLowerCase();
      if (data.settings) this.state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (Array.isArray(data.members) && data.members.length) this.state.members = data.members;
      if (Array.isArray(data.accounts)) this.state.accounts = data.accounts;
      if (Array.isArray(data.categories) && data.categories.length) this.state.categories = data.categories;
      if (Array.isArray(data.currencies) && data.currencies.length) this.state.currencies = data.currencies;
      if (Array.isArray(data.merchants)) this.state.merchants = data.merchants;
      if (Array.isArray(data.bills)) this.state.bills = data.bills;
      if (data.tableVersions) this.state.tableVersions = { ...defaultTableVersions(), ...data.tableVersions };

      if (Array.isArray(data.expenses)) {
        this.state.expenses = mergeServerWithPending(data.expenses, this.state.pendingQueue);
      }

      this.state.auditWarnings = Array.isArray(data.auditWarnings) ? data.auditWarnings : [];
      this.state.connection.sheetName = data.sheetName || this.state.connection.sheetName;
      this.state.connection.sheetUrl = data.sheetUrl || this.state.connection.sheetUrl || "";
      this.state.connection.lastSyncedAt = data.syncedAt || data.serverTime || new Date().toISOString();
      this.state.isDemoMode = false;
      this.state.syncing = false;
      this.emit();
      return data;
    } catch (err) {
      this.state.syncing = false;
      this.state.lastError = err.message;
      this.emit();
      throw err;
    }
  }

  disconnectSheet() {
    this.state.connection = { webAppUrl: "", pin: "", sheetName: "", sheetUrl: "", lastSyncedAt: null };
    this.state.expenses = [];
    this.state.auditWarnings = [];
    this.state.pendingQueue = [];
    this.state.failedQueue = [];
    this.state.tableVersions = defaultTableVersions();
    this.state.lastError = null;
    this.state.isDemoMode = false;
    safeRemoveStorage(STORAGE_KEY);
    this.emit();
  }

  resetDemoData() {
    this.state.members = structuredClone(DEFAULT_MEMBERS);
    this.state.accounts = structuredClone(DEFAULT_ACCOUNTS);
    this.state.expenses = createDemoExpenses();
    this.state.categories = structuredClone(DEFAULT_CATEGORIES);
    this.state.currencies = structuredClone(DEFAULT_CURRENCIES);
    this.state.merchants = structuredClone(DEFAULT_MERCHANTS);
    this.state.bills = [];
    this.state.auditWarnings = [];
    this.state.pendingQueue = [];
    this.state.failedQueue = [];
    this.state.activePartner = "p1";
    this.state.activeEmail = DEFAULT_MEMBERS[0].email;
    this.state.isDemoMode = true;
    this.emit();
  }

  clearAllLocalExpenses() {
    this.state.expenses = [];
    this.state.auditWarnings = [];
    this.state.pendingQueue = [];
    this.state.failedQueue = [];
    this.state.isDemoMode = false;
    this.emit();
  }
}

export const store = new Store();
