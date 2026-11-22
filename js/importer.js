import { TX_TYPES, SHARED_OWNER } from "./defaults.js";
import { checkBaseAmountConsistency, round2 } from "./ledger.js";

const EXACT_HEADER_MAP = {
  id: ["id", "transaction id", "tx id", "tx_id", "source_id", "cod"],
  date: ["data", "date", "transaction date", "data tranzactiei", "data_tranzactiei"],
  type: ["tip", "type", "transaction type", "tip tranzactie", "tip_tranzactie"],
  direction: ["directie", "direcție", "direction", "sens"],
  description: ["descriere", "description", "titlu", "title", "notite", "notițe", "note", "notes", "memo"],
  merchant: ["comerciant", "merchant", "payee", "magazin", "furnizor"],
  amount: ["suma", "sumă", "amount", "valoare", "suma nativa", "sumă nativă"],
  currency: ["valuta", "valută", "moneda", "monedă", "currency"],
  rate: ["curs", "rate", "exchange rate", "exchange_rate", "curs_schimb"],
  baseAmount: ["suma (baza)", "sumă (bază)", "suma(baza)", "sumă(bază)", "suma_baza", "suma baza", "sumă bază", "base amount", "base_amount", "amount in base currency"],
  baseCurrency: ["moneda_baza", "moneda baza", "base_currency", "base currency"],
  account: ["cont", "cont_id", "account", "account_id", "wallet", "portofel"],
  toAccount: ["cont destinatie", "cont destinație", "cont_destinatie", "destination account", "to account"],
  toAmount: ["suma destinatie", "sumă destinație", "suma_destinatie", "destination amount", "to amount"],
  transferGroupId: ["transfer_group_id", "transfer group id", "grup transfer"],
  category: ["categorie", "category"],
  method: ["metoda plata", "metodă plată", "metoda_plata", "payment method", "payment_method"],
  isPrivate: ["privat", "private"],
  payer: ["platitor", "plătitor", "payer", "proprietar", "proprietar_sursa", "owner", "partener", "partner"],
  bill: ["factura", "factură", "bill"],
  source: ["sursa", "sursă", "source", "source_identity", "source identity"]
};

const TYPE_ALIASES = {
  cheltuiala: "cheltuiala",
  cheltuială: "cheltuiala",
  cheltuieli: "cheltuiala",
  expense: "cheltuiala",
  debit: "cheltuiala",
  venit: "venit",
  venituri: "venit",
  income: "venit",
  credit: "venit",
  transfer: "transfer",
  transferuri: "transfer",
  "transfer intre conturi": "transfer",
  "transfer între conturi": "transfer",
  investitie: "investitie",
  investiție: "investitie",
  investitii: "investitie",
  investiții: "investitie",
  investment: "investitie",
  ajustare: "ajustare",
  "ajustare sold": "ajustare",
  adjustment: "ajustare"
};

function normHeader(h) {
  const map = { "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t" };
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ăâîșşțţ]/g, (c) => map[c])
    .replace(/\s+/g, " ");
}

function mapColumnsExact(headerRow) {
  const normalized = headerRow.map(normHeader);
  const cols = {};
  const ambiguous = [];

  for (const [field, aliases] of Object.entries(EXACT_HEADER_MAP)) {
    const normAliases = aliases.map(normHeader);
    const matches = [];
    normalized.forEach((h, idx) => {
      if (normAliases.includes(h)) matches.push(idx);
    });
    if (matches.length === 1) {
      cols[field] = matches[0];
    } else if (matches.length > 1) {
      cols[field] = matches[0];
      ambiguous.push({ field, headers: matches.map((i) => headerRow[i]) });
    } else {
      cols[field] = -1;
    }
  }
  return { cols, ambiguous };
}

function parseStrictDate(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number" && val > 20000 && val < 80000) {
    const utcDays = Math.floor(val - 25569);
    const iso = new Date(utcDays * 86400 * 1000).toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${dmy[3]}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function parseStrictNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  let s = String(val).trim();
  if (!s) return null;
  s = s.replace(/\s+/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+(,\d+)$/.test(s)) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function buildContentFingerprint(row) {
  return [
    row.date,
    row.type,
    (row.description || "").trim().toLowerCase(),
    (row.merchant || "").trim().toLowerCase(),
    round2(row.amount).toFixed(2),
    row.currency,
    row.account || "",
    row.toAccount || "",
    row.toAmount !== null && row.toAmount !== undefined ? round2(row.toAmount).toFixed(2) : ""
  ].join("|");
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Analizează rândurile dintr-un fișier (CSV / XLSX) FĂRĂ a scrie în baza de date.
 * Adaptat la contractul Sheet v4 (A–T):
 * - Tipuri valide v4: gol = cheltuială, venit, transfer, investitie, ajustare (tip necunoscut -> pus deoparte).
 * - Perechile de transfer pe 2 rânduri (ex. Transfer_Group_ID sau OUT+IN în aceeași zi pe două conturi)
 *   sunt colapsate automat într-UN SINGUR rând v4 cu `account`, `toAccount`, `toAmount`.
 * - Deduplicare pe coloana `Sursă` (`source`), cu apariții numerotate (#1, #2) pentru tranzacții identice legitime în aceeași zi.
 */
export function analyzeImportRows(rawRows, ctx) {
  const {
    categories = [],
    currencies = [],
    accounts = [],
    existingTransactions = [],
    baseCurrency = "RON",
    defaultOwner = ""
  } = ctx || {};

  if (!Array.isArray(rawRows) || rawRows.length < 2) {
    return {
      ok: false,
      error: "Fișierul nu conține antet și rânduri de date.",
      totalRead: 0,
      readyRows: [],
      stagedRows: [],
      duplicateRows: [],
      mismatchRows: [],
      unknownCategories: [],
      unknownCurrencies: [],
      unknownAccounts: [],
      ambiguousColumns: [],
      overlapWarning: null,
      controlTotals: {
        sourceCredit: 0, sourceDebit: 0, sourceNet: 0,
        readyCredit: 0, readyDebit: 0, readyNet: 0,
        hasUnexplainedDiff: false
      }
    };
  }

  const { cols, ambiguous } = mapColumnsExact(rawRows[0]);
  const catByKey = new Map();
  categories.forEach((c) => {
    catByKey.set(String(c.id).toLowerCase(), c);
    catByKey.set(String(c.name).toLowerCase(), c);
  });
  const curByCode = new Map(currencies.map((c) => [String(c.code).toUpperCase(), c]));
  const accByKey = new Map();
  accounts.forEach((a) => {
    accByKey.set(String(a.id).toLowerCase(), a);
    accByKey.set(String(a.name).toLowerCase(), a);
  });

  // Index surse / identități existente pentru idempotență (0 duplicate la reimport)
  const existingSources = new Set();
  const existingDates = [];
  existingTransactions.forEach((tx) => {
    if (tx.source) existingSources.add(String(tx.source).trim());
    if (tx.sourceIdentity) existingSources.add(String(tx.sourceIdentity).trim());
    if (tx.id) existingSources.add("src:" + String(tx.id).trim());
    if (tx.date) existingDates.push(tx.date);
  });

  const readyRows = [];
  const stagedRows = [];
  const duplicateRows = [];
  const mismatchRows = [];
  const unknownCategories = new Set();
  const unknownCurrencies = new Set();
  const unknownAccounts = new Set();
  const occurrenceCounter = new Map();
  const pendingTransferLegs = [];

  let totalRead = 0;
  let sourceCredit = 0;
  let sourceDebit = 0;
  let readyCredit = 0;
  let readyDebit = 0;
  const importDates = [];

  const getCell = (r, field) => (cols[field] >= 0 ? r[cols[field]] : undefined);

  function finalizeRecord(rec, rowNumber, rawExplicitSource, rawExplicitId) {
    let sourceKey;
    if (rawExplicitSource) {
      sourceKey = rawExplicitSource;
    } else if (rawExplicitId) {
      sourceKey = "src:" + rawExplicitId;
    } else {
      const fp = buildContentFingerprint(rec);
      const count = (occurrenceCounter.get(fp) || 0) + 1;
      occurrenceCounter.set(fp, count);
      sourceKey = `fp:${fp}#${count}`;
    }

    if (existingSources.has(sourceKey)) {
      duplicateRows.push({
        rowNumber,
        description: rec.description,
        title: rec.description,
        date: rec.date,
        amount: rec.amount,
        currency: rec.currency,
        source: sourceKey
      });
      return;
    }

    rec.source = sourceKey;
    rec.id = rawExplicitId || `imp_${simpleHash(sourceKey)}`;
    existingSources.add(sourceKey);

    if (rec.baseMismatch) {
      mismatchRows.push({
        rowNumber,
        id: rec.id,
        title: rec.description,
        description: rec.description,
        detail: rec._mismatchInfo || ""
      });
    }
    delete rec._mismatchInfo;

    if (rec.type === "venit" || (rec.type === "ajustare" && rec.amount > 0)) {
      readyCredit = round2(readyCredit + Math.abs(rec.amount));
    } else if (rec.type === "cheltuiala" || (rec.type === "ajustare" && rec.amount < 0)) {
      readyDebit = round2(readyDebit + Math.abs(rec.amount));
    }
    readyRows.push(rec);
  }

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || r.every((cell) => String(cell ?? "").trim() === "")) continue;
    totalRead += 1;

    const reasons = [];
    const rawId = String(getCell(r, "id") ?? "").trim();
    const rawDate = getCell(r, "date");
    const rawType = String(getCell(r, "type") ?? "").trim().toLowerCase();
    const rawDir = String(getCell(r, "direction") ?? "").trim().toLowerCase();
    const description = String(getCell(r, "description") ?? "").trim();
    const merchant = String(getCell(r, "merchant") ?? "").trim();
    const rawAmount = parseStrictNumber(getCell(r, "amount"));
    const rawCurrency = String(getCell(r, "currency") ?? "").trim().toUpperCase();
    const rawRate = parseStrictNumber(getCell(r, "rate"));
    const rawBaseAmount = parseStrictNumber(getCell(r, "baseAmount"));
    const rawBaseCur = String(getCell(r, "baseCurrency") ?? baseCurrency).trim().toUpperCase();
    const rawCat = String(getCell(r, "category") ?? "").trim();
    const rawAcc = String(getCell(r, "account") ?? "").trim();
    const rawToAcc = String(getCell(r, "toAccount") ?? "").trim();
    const rawToAmt = parseStrictNumber(getCell(r, "toAmount"));
    const rawTransferGroup = String(getCell(r, "transferGroupId") ?? "").trim();
    const rawMethod = String(getCell(r, "method") ?? "").trim() || "Card";
    const rawPrivate = String(getCell(r, "isPrivate") ?? "").trim().toLowerCase();
    const rawPayer = String(getCell(r, "payer") ?? "").trim();
    const rawBill = String(getCell(r, "bill") ?? "").trim();
    const rawSource = String(getCell(r, "source") ?? "").trim();

    // 1. Data (nu inventăm data de azi)
    const date = parseStrictDate(rawDate);
    if (!date) reasons.push("Data lipsește sau are format invalid");
    else importDates.push(date);

    // 2. Tip explicit (gol = cheltuială conform v4; tip necunoscut -> pus deoparte, nu ghicit!)
    let type = null;
    if (rawType) {
      type = TYPE_ALIASES[rawType] || null;
      if (!type) reasons.push(`Tip necunoscut: "${rawType}"`);
    } else {
      type = "cheltuiala";
    }

    // 3. Suma (nu aplicăm Math.abs() tăcut; ajustarea permite +/- nenul)
    if (rawAmount === null) {
      reasons.push("Suma nu este un număr valid");
    } else if (type === "ajustare") {
      if (rawAmount === 0) reasons.push("Ajustarea nu poate fi 0");
    } else if (rawAmount <= 0) {
      reasons.push(`Sumă negativă sau zero (${rawAmount}) — nu se aplică abs() tăcut`);
    }

    // 4. Valuta
    const currency = rawCurrency || baseCurrency;
    const curObj = curByCode.get(currency);
    if (!curObj) {
      unknownCurrencies.add(currency);
      reasons.push(`Valută necunoscută: "${currency}"`);
    }

    // 5. Categorie (nu înlocuim tăcut cu altele pentru cheltuieli/venituri)
    let categoryId = "";
    if (type === "transfer" || type === "investitie" || type === "ajustare") {
      categoryId = rawCat ? (catByKey.get(rawCat.toLowerCase())?.id || "") : "";
    } else if (rawCat) {
      const matched = catByKey.get(rawCat.toLowerCase());
      if (matched) {
        categoryId = matched.id;
      } else {
        unknownCategories.add(rawCat);
        reasons.push(`Categorie necunoscută: "${rawCat}"`);
      }
    } else {
      reasons.push("Categoria lipsește");
    }

    // 6. Cont sursă
    let accountId = "";
    if (rawAcc) {
      const matchedAcc = accByKey.get(rawAcc.toLowerCase());
      if (matchedAcc) accountId = matchedAcc.id;
      else {
        unknownAccounts.add(rawAcc);
        reasons.push(`Cont necunoscut: "${rawAcc}"`);
      }
    } else if (type === "transfer" || type === "investitie" || type === "ajustare") {
      reasons.push("Lipsește contul");
    }

    // 7. Cont destinație (dacă există pe rând)
    let toAccountId = "";
    if (rawToAcc) {
      const matchedDest = accByKey.get(rawToAcc.toLowerCase());
      if (matchedDest) toAccountId = matchedDest.id;
      else {
        unknownAccounts.add(rawToAcc);
        reasons.push(`Cont destinație necunoscut: "${rawToAcc}"`);
      }
    }
    if (toAccountId && toAccountId === accountId) {
      reasons.push("Contul sursă și contul destinație sunt identice");
    }

    // 8. Totaluri de control din sursă (doar cheltuieli / venituri / ajustări; transferurile au efect net 0)
    if (rawAmount !== null && type) {
      if (type === "venit" && rawAmount > 0) sourceCredit = round2(sourceCredit + rawAmount);
      else if (type === "cheltuiala" && rawAmount > 0) sourceDebit = round2(sourceDebit + rawAmount);
      else if (type === "ajustare" && rawAmount > 0) sourceCredit = round2(sourceCredit + rawAmount);
      else if (type === "ajustare" && rawAmount < 0) sourceDebit = round2(sourceDebit + Math.abs(rawAmount));
    }

    // 9. Curs și Sumă (bază)
    let rate = rawRate;
    let baseAmount = rawBaseAmount;
    let baseMismatch = false;
    let mismatchInfo = null;

    if (rate === null) {
      if (currency === rawBaseCur) {
        rate = 1;
      } else if (baseAmount !== null && rawAmount && rawAmount !== 0) {
        rate = round2((baseAmount / rawAmount) * 10000) / 10000;
      } else if (curObj) {
        rate = curObj.rate;
      }
    }
    if (baseAmount === null && rawAmount !== null && rate !== null) {
      baseAmount = round2(rawAmount * rate);
    }
    if (rawAmount !== null && rate !== null && rate > 0 && baseAmount !== null) {
      const check = checkBaseAmountConsistency(rawAmount, rate, baseAmount);
      if (check.mismatch) {
        baseMismatch = true;
        mismatchInfo = `Sumă (bază) (${baseAmount}) != Sumă × Curs (${check.expected})`;
      }
    }

    if (reasons.length > 0) {
      stagedRows.push({
        rowNumber: i + 1,
        rawTitle: description || merchant || "(fără descriere)",
        rawAmount: getCell(r, "amount"),
        rawType: rawType || "(gol=cheltuială)",
        reasons
      });
      continue;
    }

    const payer = rawPayer ? rawPayer.toLowerCase() : (defaultOwner || SHARED_OWNER);
    const toAmount = (rawToAmt !== null && rawToAmt > 0) ? round2(rawToAmt) : null;

    const baseRec = {
      date,
      type,
      amount: round2(rawAmount),
      currency,
      rate,
      baseAmount: round2(baseAmount),
      baseMismatch,
      _mismatchInfo: mismatchInfo,
      category: categoryId,
      description: description || merchant || TX_TYPES[type].label,
      merchant,
      method: rawMethod,
      isPrivate: ["da", "yes", "true", "1", "x"].includes(rawPrivate),
      account: accountId,
      toAccount: toAccountId,
      toAmount,
      payer,
      bill: rawBill,
      owner: defaultOwner || payer
    };

    // Dacă e transfer fără `toAccount` pe același rând -> colectăm pentru împerechere 2-rânduri -> 1 rând v4!
    if (type === "transfer" && !toAccountId) {
      pendingTransferLegs.push({
        rowNumber: i + 1,
        direction: rawDir === "in" || rawDir === "out" ? rawDir : "",
        transferGroupId: rawTransferGroup,
        rawId,
        rawSource,
        rec: baseRec
      });
      continue;
    }

    finalizeRecord(baseRec, i + 1, rawSource, rawId);
  }

  // Împerechere transferuri pe 2 rânduri (OUT + IN) -> UN SINGUR rând v4!
  if (pendingTransferLegs.length > 0) {
    const used = new Set();

    function collapsePair(outLeg, inLeg) {
      const diffCurOrAmt =
        inLeg.rec.currency !== outLeg.rec.currency ||
        Math.abs(inLeg.rec.amount - outLeg.rec.amount) > 0.005;
      const merged = {
        ...outLeg.rec,
        type: "transfer",
        account: outLeg.rec.account,
        toAccount: inLeg.rec.account,
        toAmount: diffCurOrAmt ? inLeg.rec.amount : null,
        description: outLeg.rec.description || inLeg.rec.description || "Transfer între conturi",
        isPrivate: outLeg.rec.isPrivate || inLeg.rec.isPrivate
      };
      const groupSrc = outLeg.transferGroupId
        ? `src:${outLeg.transferGroupId}`
        : (outLeg.rawSource && inLeg.rawSource ? `pair:${outLeg.rawSource}+${inLeg.rawSource}` : "");
      const groupId = outLeg.transferGroupId || "";
      finalizeRecord(merged, outLeg.rowNumber, groupSrc, groupId);
    }

    // Pas 1: potrivire exactă după Transfer_Group_ID
    for (let a = 0; a < pendingTransferLegs.length; a++) {
      if (used.has(a)) continue;
      const legA = pendingTransferLegs[a];
      if (!legA.transferGroupId) continue;
      const matchIdx = pendingTransferLegs.findIndex((legB, b) =>
        b > a && !used.has(b) && legB.transferGroupId === legA.transferGroupId &&
        legB.rec.account !== legA.rec.account &&
        ((legA.direction === "out" && legB.direction === "in") || (legA.direction === "in" && legB.direction === "out"))
      );
      if (matchIdx !== -1) {
        used.add(a);
        used.add(matchIdx);
        const legB = pendingTransferLegs[matchIdx];
        const outLeg = legA.direction === "out" ? legA : legB;
        const inLeg = legA.direction === "out" ? legB : legA;
        collapsePair(outLeg, inLeg);
      }
    }

    // Pas 2: potrivire OUT + IN în aceeași zi, conturi diferite, aceeași sumă sau aceeași Sumă (bază)
    for (let a = 0; a < pendingTransferLegs.length; a++) {
      if (used.has(a)) continue;
      const legA = pendingTransferLegs[a];
      if (legA.direction !== "out" && legA.direction !== "in") continue;
      const matchIdx = pendingTransferLegs.findIndex((legB, b) => {
        if (b <= a || used.has(b)) return false;
        if (legB.rec.date !== legA.rec.date) return false;
        if (legB.rec.account === legA.rec.account) return false;
        const oppositeDir = (legA.direction === "out" && legB.direction === "in") || (legA.direction === "in" && legB.direction === "out");
        if (!oppositeDir) return false;
        if (legA.rec.currency === legB.rec.currency) {
          return Math.abs(legA.rec.amount - legB.rec.amount) < 0.01;
        }
        return Math.abs((legA.rec.baseAmount || 0) - (legB.rec.baseAmount || 0)) <= Math.max(0.5, (legA.rec.baseAmount || 0) * 0.02);
      });
      if (matchIdx !== -1) {
        used.add(a);
        used.add(matchIdx);
        const legB = pendingTransferLegs[matchIdx];
        const outLeg = legA.direction === "out" ? legA : legB;
        const inLeg = legA.direction === "out" ? legB : legA;
        collapsePair(outLeg, inLeg);
      }
    }

    // Rândurile de transfer rămase fără pereche -> stagedRows (NU se scriu parțial!)
    for (let a = 0; a < pendingTransferLegs.length; a++) {
      if (used.has(a)) continue;
      const orphan = pendingTransferLegs[a];
      stagedRows.push({
        rowNumber: orphan.rowNumber,
        rawTitle: orphan.rec.description || "Transfer",
        rawAmount: orphan.rec.amount,
        rawType: "transfer",
        reasons: ["Transfer fără cont destinație sau fără pereche corespondentă (în v4 transferul este un singur rând cu Cont și Cont destinație)"]
      });
    }
  }

  // Audit de suprapunere de perioade
  let overlapWarning = null;
  if (importDates.length && existingDates.length) {
    const impMin = [...importDates].sort()[0];
    const impMax = [...importDates].sort()[importDates.length - 1];
    const exMin = [...existingDates].sort()[0];
    const exMax = [...existingDates].sort()[existingDates.length - 1];
    if (impMin <= exMax && impMax >= exMin) {
      overlapWarning = `Perioada importată (${impMin} → ${impMax}) se suprapune cu datele existente (${exMin} → ${exMax}). Verifică dublurile și totalurile de control.`;
    }
  }

  const sourceNet = round2(sourceCredit - sourceDebit);
  const readyNet = round2(readyCredit - readyDebit);
  const hasUnexplainedDiff = stagedRows.length > 0 || (duplicateRows.length === 0 && Math.abs(sourceNet - readyNet) > 0.01);

  return {
    ok: true,
    totalRead,
    readyRows,
    stagedRows,
    duplicateRows,
    mismatchRows,
    unknownCategories: Array.from(unknownCategories),
    unknownCurrencies: Array.from(unknownCurrencies),
    unknownAccounts: Array.from(unknownAccounts),
    ambiguousColumns: ambiguous,
    overlapWarning,
    controlTotals: {
      sourceCredit,
      sourceDebit,
      sourceNet,
      readyCredit,
      readyDebit,
      readyNet,
      hasUnexplainedDiff
    }
  };
}
