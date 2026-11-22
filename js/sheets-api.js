/**
 * Client Google Apps Script (adaptat la schema Sheet v4):
 * - Apeluri autentificate exclusiv prin POST (niciodată PIN în URL/GET).
 * - Returnează `ApiError` structurat (`errorCode`, `retryable`) pentru separarea clară între
 *   erori temporare (rețea / LOCK_TIMEOUT) și erori permanente / conflicte (CONFLICT_ID, VERSION_CONFLICT, validare, UNAUTHORIZED).
 * - Trimite `expectedUpdatedAt` / `expectedModified` și `expectedVersion` pentru protecție optimistic locking.
 * - Transferul se trimite ca UN SINGUR RÂND v4 (`transfer`).
 */

const PERMANENT_CODES = new Set([
  "CONFLICT_ID",
  "VERSION_CONFLICT",
  "MISSING_ID",
  "INVALID_TX",
  "INVALID_DATE",
  "INVALID_TYPE",
  "INVALID_AMOUNT",
  "INVALID_ACCOUNT",
  "MISSING_CURRENCY",
  "INVALID_TRANSFER_GROUP",
  "INCOMPLETE_TRANSFER_GROUP",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNKNOWN_ACTION"
]);

export class ApiError extends Error {
  constructor(message, { errorCode = "UNKNOWN", retryable = false, data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.errorCode = errorCode;
    this.retryable = retryable;
    this.data = data;
  }
}

async function postToScript(webAppUrl, payload) {
  if (!webAppUrl) {
    throw new ApiError("URL-ul Google Apps Script nu este configurat.", {
      errorCode: "NO_URL",
      retryable: false
    });
  }
  const url = webAppUrl.trim();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (netErr) {
    throw new ApiError(netErr.message || "Eroare de rețea / răspuns pierdut.", {
      errorCode: "NETWORK_ERROR",
      retryable: true
    });
  }

  if (!res.ok) {
    throw new ApiError(`Eroare server (${res.status}). Verifică URL-ul și permisiunile Web App.`, {
      errorCode: `HTTP_${res.status}`,
      retryable: res.status >= 500 || res.status === 429
    });
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new ApiError("Răspuns invalid de la Google Apps Script.", {
      errorCode: "INVALID_JSON",
      retryable: true
    });
  }

  if (!data.ok) {
    const code = data.errorCode || "SERVER_ERROR";
    const retryable = Boolean(data.retryable) || code === "LOCK_TIMEOUT" || !PERMANENT_CODES.has(code);
    throw new ApiError(data.error || "Eroare necunoscută la Google Sheets.", {
      errorCode: code,
      retryable,
      data
    });
  }
  return data;
}

export async function pingSheet(webAppUrl, pin) {
  return postToScript(webAppUrl, { action: "ping", pin });
}

export async function initSheet(webAppUrl, pin, settings) {
  return postToScript(webAppUrl, { action: "init", pin, settings });
}

export async function syncFromSheet(webAppUrl, pin) {
  return postToScript(webAppUrl, { action: "sync", pin });
}

export async function pushAddExpense(webAppUrl, pin, expense) {
  return postToScript(webAppUrl, { action: "addExpense", pin, expense });
}

export async function pushAddTransfer(webAppUrl, pin, transferOrLegs) {
  if (Array.isArray(transferOrLegs)) {
    return postToScript(webAppUrl, { action: "addTransfer", pin, legs: transferOrLegs });
  }
  return postToScript(webAppUrl, { action: "addTransfer", pin, transfer: transferOrLegs });
}

export async function pushUpdateExpense(webAppUrl, pin, expense, expectedModified) {
  return postToScript(webAppUrl, {
    action: "updateExpense",
    pin,
    expense,
    expectedUpdatedAt: expectedModified,
    expectedModified
  });
}

export async function pushDeleteExpense(webAppUrl, pin, id, expectedModified) {
  return postToScript(webAppUrl, {
    action: "deleteExpense",
    pin,
    id,
    expectedUpdatedAt: expectedModified,
    expectedModified
  });
}

export async function pushBulkImport(webAppUrl, pin, expenses) {
  return postToScript(webAppUrl, { action: "bulkImport", pin, expenses });
}

export async function pushAccounts(webAppUrl, pin, accounts, expectedVersion) {
  return postToScript(webAppUrl, { action: "saveAccounts", pin, accounts, expectedVersion });
}

export async function pushSaveAccount(webAppUrl, pin, account) {
  return postToScript(webAppUrl, { action: "saveAccount", pin, account });
}

export async function pushDeleteAccount(webAppUrl, pin, id) {
  return postToScript(webAppUrl, { action: "deleteAccount", pin, id });
}

export async function pushCategories(webAppUrl, pin, categories, expectedVersion) {
  return postToScript(webAppUrl, { action: "saveCategories", pin, categories, expectedVersion });
}

export async function pushCurrencies(webAppUrl, pin, currencies, expectedVersion) {
  return postToScript(webAppUrl, { action: "saveCurrencies", pin, currencies, expectedVersion });
}

export async function pushSaveMerchant(webAppUrl, pin, merchant) {
  return postToScript(webAppUrl, { action: "saveMerchant", pin, merchant });
}

export async function pushDeleteMerchant(webAppUrl, pin, name) {
  return postToScript(webAppUrl, { action: "deleteMerchant", pin, name });
}

export async function pushSettings(webAppUrl, pin, settings, expectedVersion) {
  return postToScript(webAppUrl, { action: "saveSettings", pin, settings, expectedVersion });
}

export function encodeSetupCode({ webAppUrl }) {
  if (!webAppUrl || !webAppUrl.trim()) {
    throw new Error("Adresa Web App lipsește.");
  }
  const payload = JSON.stringify({ u: webAppUrl.trim() });
  const bytes = new TextEncoder().encode(payload);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return "BF2-" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSetupCode(rawCode) {
  let code = String(rawCode || "").trim();
  if (code.includes("#setup=")) {
    code = code.split("#setup=")[1].split("&")[0];
  }
  if (!code.startsWith("BF2-")) {
    throw new Error("Cod de configurare invalid (trebuie să înceapă cu BF2- și să nu conțină credențiale).");
  }
  const b64 = code.slice(4).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  if (!parsed.u) throw new Error("Codul nu conține un URL valid.");
  return { webAppUrl: parsed.u };
}

export function buildTransferLink(config) {
  const code = encodeSetupCode(config);
  const base = window.location.href.split("#")[0];
  return `${base}#setup=${code}`;
}
