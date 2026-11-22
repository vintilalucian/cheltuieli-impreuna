import { formatMoney } from "./insights.js";

/**
 * Grafic Donut SVG interactiv pe categorii
 */
export function renderDonutChart(byCategory, total, baseCur) {
  if (!byCategory.length || total <= 0) {
    return `<div class="chart-empty">Nu există date pentru graficul pe categorii în această lună.</div>`;
  }

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 82;
  const strokeWidth = 28;
  const circumference = 2 * Math.PI * radius;

  // Păstrăm top 7 categorii + restul grupate în "Altele"
  const top = byCategory.slice(0, 7);
  const rest = byCategory.slice(7);
  const slices = [...top];
  if (rest.length) {
    const restTotal = rest.reduce((s, c) => s + c.total, 0);
    slices.push({
      id: "_rest",
      name: `Alte ${rest.length} categorii`,
      icon: "⋯",
      color: "#94a3b8",
      total: restTotal,
      pct: (restTotal / total) * 100
    });
  }

  let cumulativePct = 0;
  const circles = slices
    .map((slice) => {
      const dash = (slice.pct / 100) * circumference;
      const gap = circumference - dash;
      const offset = -((cumulativePct / 100) * circumference);
      cumulativePct += slice.pct;
      return `
        <circle
          cx="${cx}" cy="${cy}" r="${radius}"
          fill="transparent"
          stroke="${slice.color}"
          stroke-width="${strokeWidth}"
          stroke-dasharray="${Math.max(0, dash - 2)} ${gap + 2}"
          stroke-dashoffset="${offset}"
          transform="rotate(-90 ${cx} ${cy})"
          class="donut-slice"
        >
          <title>${slice.name}: ${formatMoney(slice.total, baseCur)} (${Math.round(slice.pct)}%)</title>
        </circle>
      `;
    })
    .join("");

  const legend = byCategory
    .map((c) => {
      const overClass = c.budget > 0 && c.total > c.budget ? "over-budget" : "";
      const budgetNote =
        c.budget > 0
          ? `<span class="cat-budget-pill ${overClass}">${Math.round(c.budgetPct)}% din ${formatMoney(c.budget, baseCur)}</span>`
          : "";
      return `
        <div class="legend-row">
          <div class="legend-left">
            <span class="legend-dot" style="background:${c.color}"></span>
            <span class="legend-icon">${c.icon}</span>
            <div class="legend-info">
              <div class="legend-name">${escapeHtml(c.name)}</div>
              <div class="legend-sub">${c.count} ${c.count === 1 ? "tranzacție" : "tranzacții"} ${budgetNote}</div>
            </div>
          </div>
          <div class="legend-right">
            <div class="legend-amount">${formatMoney(c.total, baseCur)}</div>
            <div class="legend-pct">${Math.round(c.pct)}%</div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="donut-layout">
      <div class="donut-svg-wrap">
        <svg viewBox="0 0 ${size} ${size}" class="donut-svg" aria-label="Cheltuieli pe categorii">
          <circle cx="${cx}" cy="${cy}" r="${radius}" fill="transparent" stroke="var(--border)" stroke-width="${strokeWidth}" opacity="0.35"/>
          ${circles}
          <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="donut-center-label">Total</text>
          <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-center-value">${formatCompact(total)} ${baseCur}</text>
        </svg>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

/**
 * Grafic Bare Stivuite SVG pe ultimele 6 luni (Partener 1 + Partener 2 + linie buget)
 */
export function renderMonthlyTrendChart(trend6Months, budget, p1Name, p2Name, baseCur) {
  const maxVal = Math.max(
    ...trend6Months.map((m) => m.total),
    budget > 0 ? budget * 1.05 : 0,
    100
  );

  const w = 520;
  const h = 210;
  const padL = 14;
  const padR = 14;
  const padT = 22;
  const padB = 34;
  const chartH = h - padT - padB;
  const colW = (w - padL - padR) / trend6Months.length;
  const barW = Math.min(44, colW * 0.52);

  const bars = trend6Months
    .map((m, idx) => {
      const x = padL + idx * colW + (colW - barW) / 2;
      const h1 = (m.p1 / maxVal) * chartH;
      const h2 = (m.p2 / maxVal) * chartH;
      const y1 = padT + chartH - h1;
      const y2 = y1 - h2;
      const labelY = Math.max(12, y2 - 6);

      return `
        <g class="bar-group">
          ${m.p1 > 0 ? `<rect x="${x}" y="${y1}" width="${barW}" height="${h1}" rx="4" fill="#3b82f6"><title>${p1Name}: ${formatMoney(m.p1, baseCur)}</title></rect>` : ""}
          ${m.p2 > 0 ? `<rect x="${x}" y="${y2}" width="${barW}" height="${h2}" rx="4" fill="#ec4899"><title>${p2Name}: ${formatMoney(m.p2, baseCur)}</title></rect>` : ""}
          ${m.total > 0 ? `<text x="${x + barW / 2}" y="${labelY}" text-anchor="middle" class="bar-top-val">${formatCompact(m.total)}</text>` : ""}
          <text x="${x + barW / 2}" y="${h - 10}" text-anchor="middle" class="bar-axis-label">${m.label}</text>
        </g>
      `;
    })
    .join("");

  let budgetLine = "";
  if (budget > 0) {
    const by = padT + chartH - (budget / maxVal) * chartH;
    budgetLine = `
      <line x1="${padL}" y1="${by}" x2="${w - padR}" y2="${by}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${w - padR}" y="${by - 4}" text-anchor="end" class="budget-line-label">Buget: ${formatCompact(budget)}</text>
    `;
  }

  return `
    <div class="trend-chart-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="trend-svg" aria-label="Evoluție ultimele 6 luni">
        ${budgetLine}
        ${bars}
      </svg>
      <div class="trend-legend">
        <span><i class="dot" style="background:#3b82f6"></i> ${escapeHtml(p1Name)}</span>
        <span><i class="dot" style="background:#ec4899"></i> ${escapeHtml(p2Name)}</span>
        ${budget > 0 ? `<span><i class="dot dashed"></i> Buget lunar (${formatMoney(budget, baseCur)})</span>` : ""}
      </div>
    </div>
  `;
}

/**
 * Grafic zilnic al cheltuielilor în luna curentă
 */
export function renderDailyBarsChart(dailyTotals, baseCur) {
  const maxVal = Math.max(...dailyTotals.map((d) => d.total), 10);
  const w = 520;
  const h = 140;
  const padT = 14;
  const padB = 24;
  const chartH = h - padT - padB;
  const step = w / dailyTotals.length;
  const barW = Math.max(6, step * 0.62);

  const bars = dailyTotals
    .map((d, i) => {
      const bh = d.total > 0 ? Math.max(4, (d.total / maxVal) * chartH) : 2;
      const x = i * step + (step - barW) / 2;
      const y = padT + chartH - bh;
      const showTick = d.day === 1 || d.day % 5 === 0 || d.day === dailyTotals.length;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${d.total > 0 ? "var(--primary)" : "var(--border)"}" opacity="${d.total > 0 ? 0.9 : 0.35}">
            <title>Ziua ${d.day}: ${formatMoney(d.total, baseCur)}</title>
          </rect>
          ${showTick ? `<text x="${x + barW / 2}" y="${h - 6}" text-anchor="middle" class="bar-axis-label">${d.day}</text>` : ""}
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${w} ${h}" class="daily-svg" aria-label="Cheltuieli pe zile">
      ${bars}
    </svg>
  `;
}

function formatCompact(num) {
  if (num >= 10000) return (num / 1000).toFixed(1) + "k";
  if (num >= 1000) return Math.round(num).toLocaleString("ro-RO");
  return Math.round(num).toString();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
