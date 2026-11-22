import { analyzeImportRows } from "./importer.js";

/**
 * Export & Import Excel (.xlsx / .csv) conform schemei Sheet v4 (A–T + Conturi/Categorii/Valute/Comercianți/Membri).
 */

let xlsxPromise = null;

function loadSheetJS() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!navigator.onLine) return Promise.resolve(null);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      script.async = true;
      script.onload = () => resolve(window.XLSX || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return xlsxPromise;
}

export function transactionsToV4Rows(transactions, store) {
  const header = [
    "ID", "Data", "Sumă", "Valută", "Curs", "Sumă (bază)", "Categorie",
    "Descriere", "Comerciant", "Metodă plată", "Privat", "Creat", "Modificat",
    "Tip", "Cont", "Cont destinație", "Sumă destinație", "Plătitor", "Factură", "Sursă"
  ];
  const rows = transactions.map((e) => {
    const type = e.type || "cheltuiala";
    return [
      e.id,
      e.date,
      Number(e.amount) || 0,
      e.currency || store.state.settings.baseCurrency,
      Number(e.rate ?? e.exchangeRate ?? 1),
      Number(e.baseAmount) || 0,
      e.category || "",
      e.description ?? e.title ?? "",
      e.merchant || "",
      e.method ?? e.paymentMethod ?? "",
      e.isPrivate ? "DA" : "",
      e.created ?? e.createdAt ?? "",
      e.modified ?? e.updatedAt ?? "",
      type === "cheltuiala" ? "" : type,
      e.account ?? e.accountId ?? "",
      e.toAccount ?? e.destAccountId ?? "",
      e.toAmount !== null && e.toAmount !== undefined && e.toAmount !== "" ? Number(e.toAmount) : "",
      e.payer || "",
      e.bill || "",
      e.source ?? e.sourceIdentity ?? ""
    ];
  });
  return [header, ...rows];
}

export async function exportToExcel(store) {
  const XLSX = await loadSheetJS();
  const visible = store.getVisibleExpenses({ scope: "all" });
  const p1Items = visible.filter((e) => !store.isPartner2(e.owner));
  const p2Items = visible.filter((e) => store.isPartner2(e.owner));
  const stamp = new Date().toISOString().slice(0, 10);

  if (XLSX) {
    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet(transactionsToV4Rows(p1Items, store));
    XLSX.utils.book_append_sheet(wb, ws1, (store.state.settings.partner1Tab || "Cheltuieli Eu").slice(0, 31));

    const ws2 = XLSX.utils.aoa_to_sheet(transactionsToV4Rows(p2Items, store));
    XLSX.utils.book_append_sheet(wb, ws2, (store.state.settings.partner2Tab || "Cheltuieli Soția").slice(0, 31));

    const accRows = [
      ["ID", "Nume", "Tip", "Monedă", "Sold inițial", "Data sold inițial", "Stare", "Proprietar", "Ordine", "Creat", "Modificat"],
      ...(store.state.accounts || []).map((a, idx) => [
        a.id, a.name, a.type, a.currency,
        a.visible === false ? "" : (Number(a.initialBalance) || 0),
        a.initialDate || "",
        a.archived ? "arhivat" : "activ",
        a.owner || "comun",
        a.order || idx + 1,
        a.created || "",
        a.modified || ""
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accRows), "Conturi");

    const catRows = [
      ["ID", "Nume", "Emoji", "Culoare", "Buget lunar", "Activă", "Ordine", "Tip"],
      ...store.state.categories.map((c, idx) => [
        c.id, c.name, c.emoji || c.icon || "📦", c.color,
        c.budget > 0 ? c.budget : "",
        c.active === false ? "NU" : "DA",
        c.order || idx + 1,
        (c.type || c.kind) === "venit" ? "venit" : ""
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catRows), "Categorii");

    const curRows = [
      ["Cod", "Nume", "Simbol", "Curs (în moneda de bază)", "Actualizat"],
      ...store.state.currencies.map((c) => [c.code, c.name, c.symbol, c.rate, c.updated || ""])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(curRows), "Valute");

    const merRows = [
      ["Nume", "Categorie implicită", "Creat"],
      ...(store.state.merchants || []).map((m) => [m.name, m.category || "", m.created || ""])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(merRows), "Comercianți");

    const memRows = [
      ["Email", "Nume", "Tab", "Culoare", "Adăugat"],
      ...(store.state.members || []).map((m) => [m.email, m.name, m.tab, m.color || "", ""])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(memRows), "Membri");

    XLSX.writeFile(wb, `BugetFamilie_v4_${stamp}.xlsx`);
    return { format: "xlsx", count: visible.length };
  }

  const rows = transactionsToV4Rows(visible, store);
  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `BugetFamilie_v4_${stamp}.csv`);
  return { format: "csv", count: visible.length };
}

/**
 * Citește fișierul (.csv / .xlsx) și rulează analiza de previzualizare FĂRĂ a scrie în baza de date.
 */
export async function previewImportFile(file, store) {
  const name = (file.name || "").toLowerCase();
  let rows = [];

  if (name.endsWith(".csv")) {
    const text = await file.text();
    rows = parseCsv(text);
  } else {
    const XLSX = await loadSheetJS();
    if (!XLSX) {
      throw new Error("Pentru import .xlsx este necesară conexiune la internet (sau folosește un fișier .csv).");
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  }

  return analyzeImportRows(rows, {
    categories: store.state.categories,
    currencies: store.state.currencies,
    accounts: store.state.accounts,
    existingTransactions: store.state.expenses,
    baseCurrency: store.state.settings.baseCurrency || "RON",
    defaultOwner: store.getActiveEmail()
  });
}

export function parseCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === ";") {
      cur.push(field);
      field = "";
    } else if (ch === "\n") {
      cur.push(field.replace(/\r$/, ""));
      rows.push(cur);
      cur = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || cur.length) {
    cur.push(field.replace(/\r$/, ""));
    rows.push(cur);
  }
  return rows;
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
