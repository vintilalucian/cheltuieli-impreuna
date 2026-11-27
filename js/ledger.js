import { TX_TYPES, SHARED_OWNER } from "./defaults.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normStr(v) {
  const map = { "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t" };
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ăâîșşțţ]/g, (c) => map[c])
    .replace(/\s+/g, " ");
}

/**
 * Normalizare tip înregistrare conform contractului v4:
 * gol = cheltuială; altfel venit, transfer, investitie, ajustare.
 * Nu ghicește tipuri necunoscute (returnează "" pentru necunoscut).
 */
export function normalizeRecordType(v) {
  const s = normStr(v);
  if (!s || s === "cheltuiala" || s === "cheltuieli" || s === "expense") return "cheltuiala";
  if (s === "venit" || s === "venituri" || s === "income") return "venit";
  if (s === "transfer" || s === "transferuri") return "transfer";
  if (s === "investitie" || s === "investitii" || s === "investment") return "investitie";
  if (s === "ajustare" || s === "ajustare sold" || s === "adjustment") return "ajustare";
  return "";
}

/** Un cont cu Proprietar gol este citit ca `comun`. */
export function normalizeAccountOwner(owner) {
  const s = String(owner ?? "").trim().toLowerCase();
  return s || SHARED_OWNER;
}

/**
 * Normalizează câmpurile unei înregistrări la forma canonică v4 (acceptând și aliasurile ZIP #3).
 */
export function normalizeTx(tx) {
  if (!tx || typeof tx !== "object") return null;
  const rawType = tx.type === undefined || tx.type === null ? "" : tx.type;
  const type = normalizeRecordType(rawType);
  const account = String(tx.account ?? tx.accountId ?? "").trim();
  const toAccount = String(tx.toAccount ?? tx.destAccountId ?? "").trim();
  const rawToAmt = tx.toAmount !== undefined ? tx.toAmount : tx.destAmount;
  const toAmount = (rawToAmt === "" || rawToAmt === null || rawToAmt === undefined) ? null : Number(rawToAmt);
  const rawRate = tx.rate !== undefined && tx.rate !== "" && tx.rate !== null ? tx.rate : tx.exchangeRate;
  const rate = rawRate !== undefined && rawRate !== "" && rawRate !== null ? Number(rawRate) : 1;
  const description = String(tx.description ?? tx.title ?? "").trim();
  const method = String(tx.method ?? tx.paymentMethod ?? "").trim();
  const source = String(tx.source ?? tx.clientOpId ?? tx.sourceIdentity ?? "").trim();
  const created = String(tx.created ?? tx.createdAt ?? "");
  const modified = String(tx.modified ?? tx.updatedAt ?? "");

  return {
    ...tx,
    type,
    account,
    toAccount,
    toAmount,
    rate,
    description,
    merchant: String(tx.merchant || "").trim(),
    method,
    payer: String(tx.payer || "").trim().toLowerCase(),
    bill: String(tx.bill || "").trim(),
    source,
    created,
    modified
  };
}

/**
 * Verifică dacă Sumă (bază) corespunde cu Sumă * Curs (toleranță max(0.05, 1%)).
 * Nu suprascrie tăcut Sumă (bază) — returnează un verdict explicit.
 */
export function checkBaseAmountConsistency(amount, rate, baseAmount) {
  const amt = Number(amount);
  const r = Number(rate);
  const base = Number(baseAmount);
  if (!Number.isFinite(amt) || !Number.isFinite(r) || r <= 0 || !Number.isFinite(base)) {
    return { checked: false, mismatch: false, expected: null, diff: null };
  }
  const expected = round2(amt * r);
  const diff = round2(Math.abs(base - expected));
  const tolerance = Math.max(0.05, Math.abs(expected) * 0.01);
  return {
    checked: true,
    mismatch: diff > tolerance,
    expected,
    diff
  };
}

/**
 * Validează o înregistrare conform contractului v4 fără a inventa valori tăcute
 * (fără abs(), fără data de azi, fără ghicire de tip necunoscut, fără ID gol).
 */
export function validateTransaction(rawTx) {
  const errors = [];
  const warnings = [];

  if (!rawTx || typeof rawTx !== "object") {
    return { valid: false, errors: ["INVALID_TX: Obiect tranzacție invalid"], warnings: [], baseMismatch: false };
  }

  const tx = normalizeTx(rawTx);

  if (!tx.id || !String(tx.id).trim()) {
    errors.push("MISSING_ID: Rândul nu are ID stabil.");
  }

  if (!tx.date || !DATE_RE.test(String(tx.date).trim())) {
    errors.push("INVALID_DATE: Data lipsește sau nu respectă formatul YYYY-MM-DD.");
  }

  if (!tx.type || !TX_TYPES[tx.type]) {
    errors.push(`INVALID_TYPE: Tip tranzacție necunoscut (${rawTx.type}).`);
  }

  const rawAmt = Number(tx.amount);
  if (tx.type === "ajustare") {
    if (!Number.isFinite(rawAmt) || rawAmt === 0) {
      errors.push("INVALID_AMOUNT: Ajustarea trebuie să fie un număr nenul.");
    }
  } else if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
    errors.push("INVALID_AMOUNT: Suma trebuie să fie un număr strict pozitiv (nu se aplică abs() tăcut).");
  }

  if (!tx.currency || !String(tx.currency).trim()) {
    errors.push("MISSING_CURRENCY: Valuta lipsește.");
  }

  if (tx.type === "transfer") {
    if (!tx.account) errors.push("INVALID_ACCOUNT: Transferul necesită cont sursă.");
    if (!tx.toAccount) errors.push("INVALID_ACCOUNT: Transferul necesită cont destinație.");
    if (tx.account && tx.toAccount && tx.account === tx.toAccount) {
      errors.push("INVALID_ACCOUNT: Contul sursă și contul destinație trebuie să fie diferite.");
    }
  } else if (tx.type === "investitie" || tx.type === "ajustare") {
    if (!tx.account) {
      errors.push(`INVALID_ACCOUNT: ${tx.type === "ajustare" ? "Ajustarea" : "Investiția"} necesită un cont.`);
    }
    if (tx.toAccount && tx.toAccount === tx.account) {
      errors.push("INVALID_ACCOUNT: Contul sursă și contul destinație trebuie să fie diferite.");
    }
  }

  if (tx.toAmount !== null && tx.toAmount !== undefined && (!Number.isFinite(tx.toAmount) || tx.toAmount <= 0)) {
    errors.push("INVALID_AMOUNT: Suma destinație trebuie să fie strict pozitivă sau goală (conversie la curs).");
  }

  let baseMismatch = Boolean(tx.baseMismatch);
  if (tx.baseAmount !== undefined && tx.baseAmount !== null && tx.baseAmount !== "") {
    const rawBase = Number(tx.baseAmount);
    if (!Number.isFinite(rawBase) || (tx.type !== "ajustare" && rawBase < 0)) {
      errors.push("INVALID_BASE_AMOUNT: Suma în moneda de bază este invalidă.");
    } else if (Number.isFinite(tx.rate) && tx.rate > 0) {
      const check = checkBaseAmountConsistency(rawAmt, tx.rate, rawBase);
      if (check.mismatch) {
        baseMismatch = true;
        warnings.push(
          `BASE_MISMATCH: Sumă (bază) (${rawBase}) diferă de Sumă × Curs (${check.expected}, diferență ${check.diff}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    baseMismatch
  };
}

/**
 * Creează o înregistrare de transfer pe UN SINGUR RÂND (contract Sheet v4):
 *   Cont (sursă), Cont destinație, Sumă destinație (opțional; gol = conversie la curs).
 */
export function createTransferRecord({
  id,
  idPrefix,
  date,
  description,
  title,
  account,
  sourceAccountId,
  toAccount,
  destAccountId,
  amount,
  sourceAmount,
  currency,
  sourceCurrency,
  toAmount,
  destAmount,
  rate,
  sourceExchangeRate = 1,
  baseAmount,
  sourceBaseAmount,
  baseCurrency = "RON",
  method = "Transfer bancar",
  payer = "",
  owner = "",
  isPrivate = false,
  source = ""
}) {
  const srcAcc = String(account || sourceAccountId || "").trim();
  const dstAcc = String(toAccount || destAccountId || "").trim();
  if (!srcAcc || !dstAcc) {
    throw new Error("INVALID_ACCOUNT: Transferul necesită atât cont sursă, cât și cont destinație.");
  }
  if (srcAcc === dstAcc) {
    throw new Error("INVALID_ACCOUNT: Contul sursă și contul destinație trebuie să fie diferite.");
  }

  const sAmt = Number(amount ?? sourceAmount);
  if (!Number.isFinite(sAmt) || sAmt <= 0) {
    throw new Error("INVALID_AMOUNT: Suma transferului trebuie să fie strict pozitivă.");
  }

  const rawToAmt = toAmount !== undefined ? toAmount : destAmount;
  let finalToAmount = null;
  if (rawToAmt !== "" && rawToAmt !== null && rawToAmt !== undefined) {
    const dAmt = Number(rawToAmt);
    if (!Number.isFinite(dAmt) || dAmt <= 0) {
      throw new Error("INVALID_AMOUNT: Suma destinație trebuie să fie strict pozitivă.");
    }
    finalToAmount = round2(dAmt);
  }

  const now = new Date().toISOString();
  const recId = id || ("tr_" + (idPrefix || (Date.now() + "_" + Math.random().toString(36).slice(2, 6))));
  const sCur = String(currency || sourceCurrency || baseCurrency).toUpperCase();
  const sRate = Number(rate ?? sourceExchangeRate) || 1;
  const bAmt = round2(baseAmount ?? sourceBaseAmount ?? sAmt * sRate);

  return {
    id: recId,
    date,
    type: "transfer",
    amount: round2(sAmt),
    currency: sCur,
    rate: sRate,
    baseAmount: bAmt,
    category: "",
    description: String(description ?? title ?? "Transfer între conturi").trim(),
    merchant: "",
    method,
    isPrivate: Boolean(isPrivate),
    account: srcAcc,
    toAccount: dstAcc,
    toAmount: finalToAmount,
    payer: String(payer || owner || "").toLowerCase(),
    bill: "",
    source: source || `op:${recId}`,
    owner,
    created: now,
    modified: now
  };
}

/**
 * Calculează soldul nativ al fiecărui cont (în moneda contului) conform formulei v4:
 *   sold inițial + venituri − cheltuieli − transferuri/investiții ieșite + transferuri/investiții intrate ± ajustări.
 * - Înregistrările dinainte de `initialDate` nu se adună (sunt deja în soldul inițial).
 * - Transfer / investiție pe UN singur rând: ieșire din `account`, intrare în `toAccount`
 *   (cu `toAmount` dacă e completat, altfel conversie la curs prin moneda de bază).
 * - Un cont cu `owner` gol este tratat ca `comun`.
 * - Dacă `viewerEmail` este furnizat, setează `visible = owner === 'comun' || owner === viewerEmail`.
 */
const RECONCILIATION_PREFIX = "tb-reconcile-v1:";

function reconciliationScope(transactions, accountId, at, excludeId = "") {
  return (transactions || []).filter((raw) => {
    if (!validateTransaction(raw).valid) return false;
    const r = normalizeTx(raw);
    return r.id !== excludeId && (r.account === accountId || r.toAccount === accountId) && (!r.created || r.created <= at);
  });
}

function reconciliationFingerprint(account, transactions) {
  // Detect changes to the native movement used by the reconciliation. This is a
  // consistency checksum, not authentication or a cryptographic signature.
  const rows = transactions.map(normalizeTx).map(r => [r.id, r.date, r.type, Number(r.amount), r.currency, Number(r.rate), r.account, r.toAccount, r.toAmount, r.source]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
  const text = JSON.stringify([account.id, account.currency, Number(account.initialBalance) || 0, account.initialDate || "", rows]);
  let h = 2166136261;
  for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619); }
  return (h >>> 0).toString(16).padStart(8,"0");
}

function readReconciliation(r) {
  if (r.type !== "ajustare" || !String(r.source || "").startsWith(RECONCILIATION_PREFIX)) return null;
  try {
    const m = JSON.parse(r.source.slice(RECONCILIATION_PREFIX.length));
    if (m.account !== r.account || m.currency !== r.currency || !Number.isFinite(m.target) || !Number.isFinite(m.before) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.at) || r.created !== m.at || r.date !== m.at.slice(0,10) || !/^[0-9a-f]{8}$/.test(m.fingerprint)) return null;
    return m;
  } catch { return null; }
}

// Build the source metadata only from a freshly checked account and target.
// Callers still own source verification and permission to append the adjustment.
export function buildReconciliationSource(account, transactions, currencies, baseCurrency, target, at) {
  if (!Number.isFinite(target) || !Number.isFinite(Date.parse(at))) throw new Error("Invalid reconciliation target/time");
  const scope = reconciliationScope(transactions, account.id, at);
  const before = computeAccountBalances([account], scope, currencies, baseCurrency, null, {skipReconciliation:true,skipServerSnapshot:true})[0].balance;
  return RECONCILIATION_PREFIX + JSON.stringify({account:account.id,currency:account.currency,target:round2(target),before,at,fingerprint:reconciliationFingerprint(account,scope)});
}

export function computeAccountBalances(accounts, transactions, currencies = [], baseCurrency = "RON", viewerEmail = null, options = {}) {
  const rates = {};
  (currencies || []).forEach((c) => {
    if (c && c.code) rates[String(c.code).toUpperCase()] = Number(c.rate) || 1;
  });
  const baseCode = String(baseCurrency || "RON").toUpperCase();
  rates[baseCode] = 1;

  const map = new Map();
  (accounts || []).forEach((acc) => {
    const owner = normalizeAccountOwner(acc.owner);
    const cur = String(acc.currency || baseCode).toUpperCase();
    map.set(acc.id, {
      ...acc,
      owner,
      currency: cur,
      initialBalance: Number(acc.initialBalance) || 0,
      initialDate: String(acc.initialDate || "").slice(0, 10),
      balance: Number(acc.initialBalance) || 0,
      // Sold inițial necunoscut: 0 fără dată de start nu este un sold cunoscut, doar punctul de plecare al mișcărilor.
      balanceKnown: (Number(acc.initialBalance) || 0) !== 0 || Boolean(String(acc.initialDate || "").slice(0, 10)),
      count: 0,
      txCount: 0
    });
  });

  function inAccCurrency(r, acc, amount) {
    if (r.currency === acc.currency) return amount;
    const base = amount * (r.rate || 1);
    return base / (rates[acc.currency] || 1);
  }

  function apply(acc, r, delta) {
    if (!acc) return;
    if (acc.initialDate && r.date && r.date < acc.initialDate) return;
    acc.balance += delta;
    acc.count += 1;
    acc.txCount += 1;
  }

  (transactions || []).forEach((rawTx) => {
    const v = validateTransaction(rawTx);
    if (!v.valid) return;
    const r = normalizeTx(rawTx);
    r.currency = String(r.currency || baseCode).toUpperCase();
    const amt = Number(r.amount);
    const a = r.account ? map.get(r.account) : null;
    const b = r.toAccount ? map.get(r.toAccount) : null;

    if (r.type === "cheltuiala") {
      if (a) apply(a, r, -inAccCurrency(r, a, amt));
    } else if (r.type === "venit") {
      if (a) apply(a, r, inAccCurrency(r, a, amt));
    } else if (r.type === "ajustare") {
      if (a) apply(a, r, inAccCurrency(r, a, amt));
    } else if (r.type === "transfer" || r.type === "investitie") {
      if (a) apply(a, r, -inAccCurrency(r, a, amt));
      if (b) {
        const hasDest = r.toAmount !== null && r.toAmount !== undefined && r.toAmount > 0;
        if (!hasDest && /^tb-/.test(String(r.source || "")) && b.currency && r.currency && b.currency !== r.currency) {
          // Imported source transfer, currencies differ, destination amount not shown by the source: do not invent a conversion
          // (manual rows keep the documented v4 contract: empty destination amount = conversion at the rate).
          b.unconvertedIn = (b.unconvertedIn || 0) + 1;
        } else {
          if (!hasDest && b.currency && r.currency && b.currency !== r.currency) b.estimatedIn = (b.estimatedIn || 0) + 1; // manual row: converted at the Valute rate, shown as estimate
          apply(b, r, hasDest ? r.toAmount : inAccCurrency(r, b, amt));
        }
      }
    }
  });

  if (!options.skipReconciliation) {
    for (const acc of map.values()) {
      const candidates = [];
      for (const r of (transactions || []).map(normalizeTx)) {
        if (!validateTransaction(r).valid) continue;
        const m = readReconciliation(r);
        if (!m) continue;
        if (r.account === acc.id && r.currency === acc.currency) candidates.push({r,m,delta:Number(r.amount)});
        // A verified zero-delta snapshot has no movement row. Its audit metadata
        // rides on an actual nonzero adjustment from the same reconciliation run.
        for (const z of (Array.isArray(m.zeroSnapshots) ? m.zeroSnapshots : [])) {
          if (z.account === acc.id && z.currency === acc.currency && z.at === m.at && Number.isFinite(z.target) && z.before === z.target && /^[0-9a-f]{8}$/.test(z.fingerprint)) candidates.push({r,m:z,delta:0});
        }
      }
      candidates.sort((a,b) => b.m.at.localeCompare(a.m.at));
      if (!candidates.length) continue;
      const {r,m,delta} = candidates[0];
      const scope = reconciliationScope(transactions, acc.id, m.at, r.id);
      const before = computeAccountBalances([acc], scope, currencies, baseCurrency, null, {skipReconciliation:true})[0].balance;
      if (reconciliationFingerprint(acc,scope) === m.fingerprint && Math.abs(before-m.before)<0.005 && Math.abs(round2(before + delta)-m.target)<0.005) {
        acc.balanceKnown = true;
        acc.reconciledAt = m.at;
        acc.reconciliationTarget = m.target;
        const later = (transactions || []).map(normalizeTx).filter(t => t.id !== r.id && t.created && t.created > m.at && t.toAccount === acc.id && t.currency !== acc.currency && !(Number(t.toAmount)>0));
        const unknownLater = later.filter(t => /^tb-/.test(String(t.source || "")) && (t.type === "transfer" || t.type === "investitie"));
        if (unknownLater.length) {
          acc.balanceKnown = false;
          acc.reconciliationWarning = `${unknownLater.length} intrări ulterioare fără sumă destinație; soldul actual trebuie reverificat.`;
        }
        acc.balanceEstimated = later.some(t => !/^tb-/.test(String(t.source || "")) && (t.type === "transfer" || t.type === "investitie"));
      } else {
        acc.reconciliationWarning = "Istoricul folosit la reconciliere s-a schimbat; soldul trebuie reverificat.";
        acc.balanceKnown = false;
      }
    }
  }

  // A server snapshot includes private foreign movements without disclosing their rows.
  // Use it only for its authenticated viewer and the exact visible-row state it accompanied.
  const snapshotViewer = viewerEmail ? String(viewerEmail).trim().toLowerCase() : null;
  if (!options.skipServerSnapshot && snapshotViewer) {
    for (const acc of map.values()) {
      const snapshot = acc.serverBalanceSnapshot;
      if (!snapshot || snapshot.schema !== 1 || snapshot.viewer !== snapshotViewer) continue;
      const relevant = (transactions || []).filter(raw => {
        const row = normalizeTx(raw);
        return row && (row.account === acc.id || row.toAccount === acc.id);
      });
      const currentFingerprint = reconciliationFingerprint(acc, relevant);
      if (snapshot.visibleFingerprint !== currentFingerprint) {
        if (Number.isFinite(snapshot.balance)) acc.balance = snapshot.balance;
        acc.balanceKnown = false;
        acc.reconciliationWarning = 'Operații locale sau istoric schimbat. Soldul complet se confirmă după sincronizare.';
        acc.serverBalancePending = true;
        continue;
      }
      if (!Number.isFinite(snapshot.balance) || !Number.isFinite(snapshot.baseBalance)) continue;
      acc.balance = snapshot.balance;
      acc.balanceKnown = snapshot.balanceKnown === true;
      acc.balanceEstimated = snapshot.balanceEstimated === true;
      acc.reconciliationWarning = snapshot.reconciliationWarning || '';
      acc.reconciledAt = snapshot.reconciledAt || '';
      acc.estimatedIn = Number(snapshot.estimatedIn) || 0;
      acc.unconvertedIn = Number(snapshot.unconvertedIn) || 0;
      acc.serverBalanceApplied = true;
    }
  }

  const me = viewerEmail ? String(viewerEmail).trim().toLowerCase() : null;
  return Array.from(map.values()).map((acc) => {
    const rounded = round2(acc.balance);
    const baseBalance = round2(rounded * (rates[acc.currency] || 1));
    const visible = me ? (acc.owner === SHARED_OWNER || acc.owner === me || (acc.accessSnapshot?.viewer === me && acc.accessSnapshot?.coadmin === true)) : (acc.visible ?? true);
    if (!visible) {
      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        archived: Boolean(acc.archived),
        owner: acc.owner,
        order: acc.order,
        visible: false
      };
    }
    return {
      ...acc,
      balance: rounded,
      baseBalance,
      visible: true
    };
  });
}

/**
 * Calculează sumarul contabil v4 (venituri, cheltuieli brute/nete, rambursări, transferuri, investiții, ajustări)
 * strict pe baza tipului explicit, fără ghicire după semn.
 */
/**
 * Status of the base-currency (EUR) equivalent of a row.
 * "base": row is in the base currency. "source": non-base row that carries an explicit equivalent
 * imported from TimelyBills (Sursă "tb-..."), with a coherent rate.
 * "manual": explicit coherent native equivalent, counted as approximate. "unverified": anything else,
 * never counted in base totals (no fallback to the Valute table rate).
 */
export function baseEquivalentStatus(tx, baseCurrency) {
  const cur = String((tx && tx.currency) || baseCurrency || "").toUpperCase();
  const base = String(baseCurrency || "").toUpperCase();
  if (!base || !cur || cur === base) return "base";
  const src = String((tx && (tx.source || tx.clientOpId || tx.sourceIdentity)) || "");
  const b = Number(tx && tx.baseAmount), a = Number(tx && tx.amount), r = Number(tx && tx.rate);
  // A source prefix alone proves nothing: the equivalent must be explicit, positive, in a valid
  // currency code, and amount x rate must reproduce it (same tolerance as the integrity check).
  const okNums = Number.isFinite(b) && b > 0 && Number.isFinite(a) && a > 0 && Number.isFinite(r) && r > 0;
  const explicit = tx && tx.rate !== undefined && tx.rate !== null && tx.rate !== "" && tx.baseAmount !== undefined && tx.baseAmount !== null && tx.baseAmount !== "";
  const coherent = explicit && /^[A-Z]{3}$/.test(cur) && okNums && !checkBaseAmountConsistency(a, r, b).mismatch;
  if (/^tb-/.test(src) && coherent) return "source";
  // Native saved entries carry the user's explicit stored equivalent. Never fill missing values.
  if (/^op:entry_/.test(src) && coherent) return "manual";
  return "unverified";
}

export function computeLedgerSummary(transactions, opts = {}) {
  const exceptionRows = [];
  const approximateRows = [];
  let venituri = 0;
  let cheltuieliBrute = 0;
  let rambursariComerciant = 0;
  let transferuriVolum = 0;
  let investitiiVolum = 0;
  let ajustariCount = 0;
  const invalidRows = [];
  const mismatchRows = [];

  (transactions || []).forEach((rawTx) => {
    const v = validateTransaction(rawTx);
    if (!v.valid) {
      invalidRows.push({ tx: rawTx, errors: v.errors });
      return;
    }
    const tx = normalizeTx(rawTx);
    if (opts.baseCurrency && tx.type !== "ajustare" && baseEquivalentStatus(rawTx, opts.baseCurrency) === "unverified") {
      exceptionRows.push(tx);
      return;
    }
    if (opts.baseCurrency && baseEquivalentStatus(rawTx, opts.baseCurrency) === "manual") approximateRows.push(tx);
    if (v.baseMismatch) {
      mismatchRows.push({ tx, warnings: v.warnings });
    }

    const base = Number(tx.baseAmount) || round2(Number(tx.amount) * (Number(tx.rate) || 1));
    switch (tx.type) {
      case "venit":
        // Rambursările de comerciant (categorie `rambursari`) scad cheltuiala netă fără a umfla venitul.
        if (normStr(tx.category) === "rambursari") {
          rambursariComerciant += base;
        } else {
          venituri += base;
        }
        break;
      case "cheltuiala":
        cheltuieliBrute += base;
        break;
      case "transfer":
        // Un singur rând per transfer — 0 impact în cheltuieli sau venituri.
        transferuriVolum += base;
        break;
      case "investitie":
        investitiiVolum += base;
        break;
      case "ajustare":
        ajustariCount += 1;
        break;
      default:
        break;
    }
  });

  const cheltuieliNete = round2(Math.max(0, cheltuieliBrute - rambursariComerciant));
  const balantaNeta = round2(venituri - cheltuieliNete);

  return {
    venituri: round2(venituri),
    cheltuieliBrute: round2(cheltuieliBrute),
    rambursariComerciant: round2(rambursariComerciant),
    cheltuieliNete,
    balantaNeta,
    transferuriVolum: round2(transferuriVolum),
    investitiiVolum: round2(investitiiVolum),
    ajustariCount,
    invalidRows,
    mismatchRows,
    exceptionRows,
    approximateRows
  };
}
