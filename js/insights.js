import { DAYS_RO, MONTHS_SHORT_RO } from "./defaults.js";
import { computeLedgerSummary, computeAccountBalances, round2 } from "./ledger.js";

export function formatMoney(amount, currencySymbolOrCode = "RON") {
  const num = Number(amount) || 0;
  const formatted = new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(num);
  return `${formatted} ${currencySymbolOrCode}`;
}

export function computeMonthlyAnalytics(store, year, month, scope = "all") {
  const baseCur = store.state.settings.baseCurrency || "RON";
  const allVisibleMonth = store.getVisibleExpenses({ year, month, scope });
  const ledger = computeLedgerSummary(allVisibleMonth);

  // Solduri conturi calculate conform formulei v4 (respectând vizibilitatea Proprietar email vs comun)
  const allVisible = store.getVisibleExpenses({ scope: "all" });
  const accountBalances = computeAccountBalances(
    store.state.accounts || [],
    allVisible,
    store.state.currencies || [],
    baseCur,
    store.getActiveEmail()
  );

  // Luna precedentă pentru comparație (cheltuieli nete)
  const prevDate = new Date(year, month - 1, 1);
  const prevTransactions = store.getVisibleExpenses({
    year: prevDate.getFullYear(),
    month: prevDate.getMonth(),
    scope
  });
  const prevLedger = computeLedgerSummary(prevTransactions);

  const total = ledger.cheltuieliNete;
  const prevTotal = prevLedger.cheltuieliNete;
  const diffPrev = round2(total - prevTotal);
  const diffPrevPct = prevTotal > 0 ? Math.round((diffPrev / prevTotal) * 100) : null;

  // Tranzacții care intră în cheltuieli (cheltuieli + rambursări care reduc cheltuiala netă; exclus transferuri/investiții/ajustări)
  const expenseLike = allVisibleMonth.filter((e) => {
    const t = e.type || "cheltuiala";
    return t === "cheltuiala" || (t === "venit" && String(e.category || "").toLowerCase() === "rambursari");
  });

  // Împărțire pe parteneri (cheltuieli nete)
  let p1Total = 0;
  let p2Total = 0;
  let p1Shared = 0;
  let p2Shared = 0;

  expenseLike.forEach((e) => {
    const type = e.type || "cheltuiala";
    const val = type === "venit" ? -(Number(e.baseAmount) || 0) : (Number(e.baseAmount) || 0);
    if (store.isPartner2(e.owner)) {
      p2Total += val;
      if (!e.isPrivate) p2Shared += val;
    } else if (store.isPartner1(e.owner)) {
      p1Total += val;
      if (!e.isPrivate) p1Shared += val;
    }
  });
  p1Total = round2(Math.max(0, p1Total));
  p2Total = round2(Math.max(0, p2Total));
  p1Shared = round2(Math.max(0, p1Shared));
  p2Shared = round2(Math.max(0, p2Shared));

  // Pe categorii (cheltuieli nete)
  const catMap = new Map();
  expenseLike.forEach((e) => {
    const type = e.type || "cheltuiala";
    const val = type === "venit" ? -(Number(e.baseAmount) || 0) : (Number(e.baseAmount) || 0);
    if (val === 0) return;

    const cat = store.getCategory(e.category);
    const cur = catMap.get(cat.id) || { ...cat, total: 0, count: 0 };
    cur.total = round2(cur.total + val);
    cur.count += 1;
    catMap.set(cat.id, cur);
  });

  const byCategory = Array.from(catMap.values())
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({
      ...c,
      pct: total > 0 ? (c.total / total) * 100 : 0,
      budgetPct: c.budget > 0 ? (c.total / c.budget) * 100 : 0
    }));

  // Pe valute originale (toate tranzacțiile)
  const curMap = new Map();
  allVisibleMonth.forEach((e) => {
    const code = e.currency || baseCur;
    const entry = curMap.get(code) || { code, originalTotal: 0, baseTotal: 0, count: 0 };
    entry.originalTotal = round2(entry.originalTotal + (Number(e.amount) || 0));
    entry.baseTotal = round2(entry.baseTotal + (Number(e.baseAmount) || 0));
    entry.count += 1;
    curMap.set(code, entry);
  });
  const byCurrency = Array.from(curMap.values()).sort((a, b) => b.baseTotal - a.baseTotal);

  // Pe zile din lună & zile din săptămână (cheltuieli)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailyTotals = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, total: 0 }));
  const weekdayTotals = Array.from({ length: 7 }, (_, i) => ({ dayIndex: i, name: DAYS_RO[i], total: 0, count: 0 }));

  expenseLike.forEach((e) => {
    if (!e.date || (e.type || "cheltuiala") !== "cheltuiala") return;
    const parts = e.date.split("-").map(Number);
    if (parts.length === 3) {
      const dayIdx = parts[2] - 1;
      if (dayIdx >= 0 && dayIdx < daysInMonth) {
        dailyTotals[dayIdx].total = round2(dailyTotals[dayIdx].total + (Number(e.baseAmount) || 0));
      }
      const wd = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
      weekdayTotals[wd].total = round2(weekdayTotals[wd].total + (Number(e.baseAmount) || 0));
      weekdayTotals[wd].count += 1;
    }
  });

  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const elapsedDays = isCurrentMonth ? Math.max(1, now.getDate()) : daysInMonth;
  const dailyAvg = total / elapsedDays;
  const projectedTotal = isCurrentMonth ? dailyAvg * daysInMonth : total;

  const monthlyBudget = Number(store.state.settings.monthlyBudget) || 0;
  const budgetPct = monthlyBudget > 0 ? (total / monthlyBudget) * 100 : 0;
  const remainingBudget = round2(monthlyBudget - total);

  // Trend ultimele 6 luni (cheltuieli pe parteneri)
  const trend6Months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    const mTx = store.getVisibleExpenses({ year: d.getFullYear(), month: d.getMonth(), scope });
    let mP1 = 0;
    let mP2 = 0;
    mTx.forEach((e) => {
      if ((e.type || "cheltuiala") !== "cheltuiala") return;
      if (store.isPartner2(e.owner)) mP2 += Number(e.baseAmount) || 0;
      else if (store.isPartner1(e.owner)) mP1 += Number(e.baseAmount) || 0;
    });
    trend6Months.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: MONTHS_SHORT_RO[d.getMonth()],
      p1: round2(mP1),
      p2: round2(mP2),
      total: round2(mP1 + mP2)
    });
  }

  const insights = buildInsights({
    store, baseCur, transactions: allVisibleMonth, ledger,
    total, prevTotal, diffPrev, diffPrevPct,
    monthlyBudget, budgetPct, projectedTotal, isCurrentMonth,
    byCategory, byCurrency, weekdayTotals, p1Shared, p2Shared
  });

  return {
    baseCur,
    expenses: allVisibleMonth,
    ledger,
    accountBalances,
    count: allVisibleMonth.length,
    total,
    prevTotal,
    diffPrev,
    diffPrevPct,
    dailyAvg,
    projectedTotal,
    isCurrentMonth,
    monthlyBudget,
    budgetPct,
    remainingBudget,
    p1Total,
    p2Total,
    p1Shared,
    p2Shared,
    byCategory,
    byCurrency,
    dailyTotals,
    weekdayTotals,
    trend6Months,
    insights
  };
}

function buildInsights(ctx) {
  const {
    store, baseCur, transactions, ledger, prevTotal, diffPrev, diffPrevPct,
    monthlyBudget, budgetPct, projectedTotal, isCurrentMonth,
    byCategory, byCurrency, weekdayTotals, p1Shared, p2Shared
  } = ctx;

  const list = [];

  if (!transactions.length) {
    list.push({
      type: "info",
      icon: "✨",
      title: "Nicio tranzacție înregistrată încă",
      text: "Apasă butonul + de jos pentru a adăuga o cheltuială, un venit, un transfer sau o investiție."
    });
    return list;
  }

  if (ledger.mismatchRows.length > 0 || ledger.invalidRows.length > 0) {
    list.push({
      type: "danger",
      icon: "🔎",
      title: "Verificare integritate date",
      text: `${ledger.mismatchRows.length} rând(uri) cu discrepanță Sumă (bază) vs Sumă × Curs, ${ledger.invalidRows.length} rând(uri) invalide excluse din totaluri.`
    });
  }

  if (ledger.venituri > 0) {
    list.push({
      type: ledger.balantaNeta >= 0 ? "positive" : "warning",
      icon: ledger.balantaNeta >= 0 ? "💚" : "⚖️",
      title: `Balanță netă: ${ledger.balantaNeta >= 0 ? "+" : ""}${formatMoney(ledger.balantaNeta, baseCur)}`,
      text: `Venituri ${formatMoney(ledger.venituri, baseCur)} − Cheltuieli nete ${formatMoney(ledger.cheltuieliNete, baseCur)}${ledger.rambursariComerciant > 0 ? ` (include rambursări -${formatMoney(ledger.rambursariComerciant, baseCur)})` : ""}.`
    });
  }

  if (ledger.investitiiVolum > 0) {
    list.push({
      type: "positive",
      icon: "📈",
      title: `Investiții în această lună: ${formatMoney(ledger.investitiiVolum, baseCur)}`,
      text: "Investițiile sunt urmărite separat și nu umflă totalul cheltuielilor."
    });
  }

  if (prevTotal > 0 && diffPrevPct !== null) {
    if (diffPrevPct > 10) {
      list.push({
        type: "warning",
        icon: "📈",
        title: `Cheltuieli cu ${diffPrevPct}% mai mari față de luna trecută`,
        text: `Cu ${formatMoney(diffPrev, baseCur)} mai mult comparativ cu luna anterioară (${formatMoney(prevTotal, baseCur)}).`
      });
    } else if (diffPrevPct < -5) {
      list.push({
        type: "positive",
        icon: "🎉",
        title: `Economie de ${Math.abs(diffPrevPct)}% față de luna trecută`,
        text: `Sunteți cu ${formatMoney(Math.abs(diffPrev), baseCur)} sub nivelul lunii anterioare.`
      });
    }
  }

  if (isCurrentMonth && monthlyBudget > 0) {
    if (budgetPct >= 100) {
      list.push({
        type: "danger",
        icon: "🚨",
        title: "Bugetul lunar a fost depășit",
        text: `Ați atins ${Math.round(budgetPct)}% din bugetul de ${formatMoney(monthlyBudget, baseCur)}.`
      });
    } else if (projectedTotal > monthlyBudget * 1.05) {
      list.push({
        type: "warning",
        icon: "⏱️",
        title: `Proiecție peste buget: ~${formatMoney(projectedTotal, baseCur)}`,
        text: `La ritmul actual, veți depăși bugetul lunar cu aproximativ ${formatMoney(projectedTotal - monthlyBudget, baseCur)}.`
      });
    }
  }

  if (byCategory.length > 0) {
    const top = byCategory[0];
    list.push({
      type: "info",
      icon: top.emoji || top.icon,
      title: `Top categorie: ${top.name} (${Math.round(top.pct)}%)`,
      text: `${formatMoney(top.total, baseCur)} din ${top.count} ${top.count === 1 ? "tranzacție" : "tranzacții"}.`
    });
  }

  if (p1Shared > 0 || p2Shared > 0) {
    const diff = Math.abs(p1Shared - p2Shared) / 2;
    if (diff >= 10) {
      const p1Name = store.state.settings.partner1Name;
      const p2Name = store.state.settings.partner2Name;
      const payer = p1Shared < p2Shared ? p1Name : p2Name;
      const receiver = p1Shared < p2Shared ? p2Name : p1Name;
      list.push({
        type: "info",
        icon: "🤝",
        title: "Echilibru cheltuieli comune (50/50)",
        text: `${p1Name}: ${formatMoney(p1Shared, baseCur)} vs ${p2Name}: ${formatMoney(p2Shared, baseCur)}. Compensare 50/50: ${payer} → ${receiver} (${formatMoney(diff, baseCur)}).`
      });
    }
  }

  const topDay = [...weekdayTotals].sort((a, b) => b.total - a.total)[0];
  if (topDay && topDay.total > 0) {
    list.push({
      type: "info",
      icon: "📅",
      title: `Ziua de vârf: ${topDay.name}`,
      text: `Cheltuieli de ${formatMoney(topDay.total, baseCur)} în zilele de ${topDay.name}.`
    });
  }

  const foreign = byCurrency.filter((c) => c.code !== baseCur);
  if (foreign.length > 0) {
    list.push({
      type: "info",
      icon: "💱",
      title: "Tranzacții în alte valute",
      text: foreign.map((c) => formatMoney(c.originalTotal, c.code)).join(", ")
    });
  }

  return list;
}
