import { analyze, gradeKey, GRADE_TONE, DIMENSIONS, METRIC_FORMAT, ENGINE_VERSION, PROFILES, OVERALL_WEIGHTS, FLAG_PENALTY } from "./scoring.js";
import { LANGS, lang, setLang, t, fill, fmt, money, date, num } from "./i18n/index.js";
import { barChart, lineChart, wireCharts } from "./charts.js";

const app = document.getElementById("app");
const PAGE_SIZE = 50;
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Data ----------

let indexCache = null;
async function loadIndex() {
  if (!indexCache) {
    const r = await fetch("data/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("index.json");
    const idx = await r.json();
    const keys = idx.scoreKeys || ["overall", ...DIMENSIONS];
    for (const c of idx.companies) if (Array.isArray(c.sc)) c.sc = Object.fromEntries(keys.map((k, i) => [k, c.sc[i]]));
    indexCache = idx;
  }
  return indexCache;
}

const companyCache = new Map();
async function loadCompany(ticker) {
  if (!companyCache.has(ticker)) {
    const r = await fetch(`data/companies/${encodeURIComponent(ticker)}.json`, { cache: "no-cache" });
    companyCache.set(ticker, r.ok ? await r.json() : null);
  }
  return companyCache.get(ticker);
}

// ---------- Watchlist (per browser) ----------

function getWatch() { try { return JSON.parse(localStorage.getItem("tsx-watch") || "[]"); } catch { return []; } }
function toggleWatch(tk) {
  const w = new Set(getWatch());
  w.has(tk) ? w.delete(tk) : w.add(tk);
  try { localStorage.setItem("tsx-watch", JSON.stringify([...w])); } catch {}
  return w.has(tk);
}
const starSvg = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`;

// ---------- Sector percentile ----------

function sectorRank(idx, sector, key, value) {
  if (!sector || !isNum(value)) return null;
  const peers = idx.companies.filter((c) => c.s === sector && c.sc && isNum(c.sc[key]));
  if (peers.length < 5) return null;
  const inverse = key === "risk";
  const worse = peers.filter((c) => (inverse ? c.sc[key] > value : c.sc[key] < value)).length;
  return Math.round((worse / (peers.length - 1 || 1)) * 100);
}

// ---------- Shared UI pieces ----------

function grade(score, inverse) {
  const k = gradeKey(score, inverse);
  return { key: k, tone: GRADE_TONE[k], label: t(`${inverse ? "riskGrades" : "grades"}.${k}`) };
}

function scorePill(score, inverse = false) {
  const g = grade(score, inverse);
  return `<span class="pill tone-${g.tone}" title="${esc(g.label)}"><span class="dot"></span>${isNum(score) ? score : "–"}</span>`;
}

// Sector keys are translated; older data files may still carry a raw SIC description.
const sectorName = (s) => (s && t(`sectors.${s}`) !== `sectors.${s}` ? t(`sectors.${s}`) : s || "");
const metricLabel = (k) => t(`metrics.${k}`)?.[0] ?? k;
const metricDesc = (k) => t(`metrics.${k}`)?.[1] ?? "";
const fm = (metrics, k) => fmt(metrics[k], METRIC_FORMAT[k]);

function summaryText(dim, a) {
  const tpl = t(`dims.${dim}.summary`);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "windowYears") return a.metrics.windowYears;
    if (k === "distress") return t(`distress.${a.distress.level}`).toLowerCase();
    return fm(a.metrics, k);
  });
}

const FLAG_FORMAT = {
  lowCurrentRatio: "x", interestCoverageCritical: "x", interestCoverageWeak: "x", altmanDistress: "num", altmanGrey: "num", altmanSafe: "num",
  highLeverage: "xyears", revenueDecline: "spct", heavyDilution: "spct", buybacks: "spct", highSbc: "pct", lowEarningsQuality: "pct",
  dividendUncovered: "pct0", goodwillHeavy: "pct", deepDrawdown: "pct", netCash: "money", highMargin: "pct", highRoic: "pct",
  strongGrowth: "spct", strongCashConversion: "pct0",
};
function flagText(f) {
  const [title, text] = t(`flags.${f.id}`);
  const p = { ...f.params };
  if ("value" in p) p.value = f.id === "staleData" ? date(p.value) : fmt(p.value, FLAG_FORMAT[f.id]);
  return { title, text: fill(text, p) };
}

// ---------- Header / navigation ----------

function renderChrome() {
  const icon = (d) => `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
  document.getElementById("nav").innerHTML = `
    <a href="#/" data-nav="list" title="${esc(t("ui.navCompanies"))}">${icon("M4 6h16M4 12h16M4 18h10")}<span class="nav-label">${esc(t("ui.navCompanies"))}</span></a>
    <a href="#/compare" data-nav="compare" title="${esc(t("ui.navCompare"))}">${icon("M8 4v16M16 4v16M4 8h8M12 16h8")}<span class="nav-label">${esc(t("ui.navCompare"))}</span></a>
    <a href="#/methodology" data-nav="method" title="${esc(t("ui.navMethod"))}">${icon("M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01")}<span class="nav-label">${esc(t("ui.navMethod"))}</span></a>
    <select class="lang-select" id="lang" aria-label="${esc(t("ui.language"))}">
      ${Object.entries(LANGS).map(([code, d]) => `<option value="${code}" ${code === lang() ? "selected" : ""}>${d.meta.short}</option>`).join("")}
    </select>`;
  document.getElementById("lang").addEventListener("change", (e) => { setLang(e.target.value); renderChrome(); route(false); });
  document.getElementById("footer-text").textContent = t("ui.footer");
  markNav();
}

function markNav() {
  const page = location.hash.replace(/^#\/?/, "").split("/")[0];
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active",
    (a.dataset.nav === "list" && (page === "" || page === "c")) || (a.dataset.nav === "compare" && page === "compare") || (a.dataset.nav === "method" && page === "methodology")));
}

// ---------- Router ----------

const listState = { q: "", sector: "", filter: "analyzed", sort: "overall", dir: -1, page: 0 };

async function route(scroll = true) {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  markNav();
  if (scroll) window.scrollTo(0, 0);
  document.title = "TeraStockX";
  try {
    if (page === "c" && arg) await renderCompany(decodeURIComponent(arg).toUpperCase());
    else if (page === "compare") await renderCompare(arg ? decodeURIComponent(arg).toUpperCase().split(",").filter(Boolean).slice(0, 3) : []);
    else if (page === "methodology") renderMethod();
    else await renderList();
  } catch (e) {
    app.innerHTML = `<div class="glass empty">${esc(t("ui.errorLoad", { e: e.message }))}<br><span class="small">${esc(t("ui.serveHint"))}</span></div>`;
  }
}
addEventListener("hashchange", () => route());

// ---------- List page ----------

const LIST_COLS = [
  { key: "overall", label: () => t("ui.overallScore") },
  { key: "profitability", cls: "col-lg" },
  { key: "balanceSheet", cls: "col-lg" },
  { key: "growthLong", cls: "col-md" },
  { key: "valuation", cls: "col-lg" },
  { key: "risk", inverse: true },
];

async function renderList() {
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const sectors = [...new Set(idx.companies.map((c) => c.s).filter(Boolean))].sort((a, b) => sectorName(a).localeCompare(sectorName(b), lang()));
  const analyzed = idx.companies.filter((c) => c.sc).length;

  app.innerHTML = `
    <section class="glass hero">
      <div>
        <h1>TeraStock<b>X</b></h1>
        <div class="tagline">${esc(t("ui.tagline"))}</div>
        <p>${esc(t("ui.heroText"))}</p>
        <div class="hero-stats">
          <div class="hero-stat"><div class="v">${num(analyzed, 0)}</div><div class="k">${esc(t("ui.onlyAnalyzed"))}</div></div>
          <div class="hero-stat"><div class="v">10</div><div class="k">${esc(t("ui.sectionScores"))}</div></div>
          <div class="hero-stat"><div class="v">${esc(date(idx.generated))}</div><div class="k">${esc(t("ui.updated", { d: "" }).replace(/[:\s]+$/, ""))}</div></div>
        </div>
      </div>
      <img class="hero-art" src="assets/img/hero.svg" alt="" width="560" height="360">
    </section>
    <div class="controls">
      <label class="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg>
        <input id="q" type="search" placeholder="${esc(t("ui.searchPlaceholder"))}" autocomplete="off" value="${esc(listState.q)}" aria-label="${esc(t("ui.searchPlaceholder"))}">
      </label>
      <select class="select" id="sector" aria-label="${esc(t("ui.sector"))}">
        <option value="">${esc(t("ui.allSectors"))}</option>
        ${sectors.map((s) => `<option value="${esc(s)}" ${s === listState.sector ? "selected" : ""}>${esc(sectorName(s))}</option>`).join("")}
      </select>
      <select class="select" id="filter" aria-label="Filter">
        ${["analyzed", "all", "watch"].map((f) => `<option value="${f}" ${listState.filter === f ? "selected" : ""}>${esc(t({ analyzed: "ui.onlyAnalyzed", all: "ui.allCompanies", watch: "ui.watchlist" }[f]))}</option>`).join("")}
      </select>
    </div>
    <div class="list-meta"><span id="count"></span><span>${esc(t("ui.analyzedOf", { a: num(analyzed, 0), n: num(idx.count, 0) }))}</span></div>
    <div class="glass table-wrap"><table class="list">
      <thead><tr>
        <th data-sort="t">${esc(t("ui.company"))}</th>
        <th class="num col-md" data-sort="mc">${esc(t("ui.marketCap"))}</th>
        ${LIST_COLS.map((c) => `<th class="num ${c.cls || ""}" data-sort="${c.key}">${esc(c.label ? c.label() : t(`dims.${c.key}.name`))}</th>`).join("")}
        <th aria-label="${esc(t("ui.watchlist"))}"></th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="pager" id="pager"></div>
    ${idx.companies.some((c) => c.demo) ? `<p class="small muted" style="margin-top:16px">${esc(t("ui.demoNote"))}</p>` : ""}
  `;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    const watch = new Set(getWatch());
    let rows = idx.companies.filter((c) =>
      (listState.filter !== "analyzed" || c.sc) && (listState.filter !== "watch" || watch.has(c.t)) &&
      (!listState.sector || c.s === listState.sector) &&
      (!q || c.t.toLowerCase().startsWith(q) || c.n.toLowerCase().includes(q)));
    const k = listState.sort;
    const val = (c) => (k === "mc" ? c.mc : c.sc?.[k]);
    rows.sort((a, b) => {
      if (k === "t") return listState.dir * a.t.localeCompare(b.t);
      const va = val(a), vb = val(b);
      if (!isNum(va) && !isNum(vb)) return a.t.localeCompare(b.t);
      if (!isNum(va)) return 1;
      if (!isNum(vb)) return -1;
      return listState.dir * (va - vb) || a.t.localeCompare(b.t);
    });
    const exact = rows.findIndex((c) => c.t.toLowerCase() === q);
    if (exact > 0) rows.unshift(rows.splice(exact, 1)[0]);

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    listState.page = Math.min(listState.page, pages - 1);
    const slice = rows.slice(listState.page * PAGE_SIZE, (listState.page + 1) * PAGE_SIZE);
    document.getElementById("count").textContent = t("ui.results", { n: num(rows.length, 0) });
    document.getElementById("rows").innerHTML = slice.length ? slice.map((c) => `
      <tr data-t="${esc(c.t)}" tabindex="0">
        <td><span class="tick">${esc(c.t)}</span>${c.demo ? `<span class="badge">${esc(t("ui.demoBadge"))}</span>` : ""}<br><span class="cname small">${esc(c.n)}</span></td>
        <td class="num col-md small">${isNum(c.mc) ? money(c.mc) : "–"}</td>
        ${LIST_COLS.map((col) => `<td class="num ${col.cls || ""}">${c.sc ? scorePill(c.sc[col.key], col.inverse) : `<span class="small muted">${esc(t("ui.noData"))}</span>`}</td>`).join("")}
        <td><button class="star ${watch.has(c.t) ? "on" : ""}" data-star="${esc(c.t)}" aria-label="${esc(t(watch.has(c.t) ? "ui.removeWatch" : "ui.addWatch"))}">${starSvg(watch.has(c.t))}</button></td>
      </tr>`).join("") : `<tr><td colspan="${LIST_COLS.length + 3}" class="empty">${esc(t("ui.noResults"))}</td></tr>`;

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const on = th.dataset.sort === k;
      th.toggleAttribute("aria-sort", on);
      if (on) th.setAttribute("aria-sort", listState.dir > 0 ? "ascending" : "descending");
      th.textContent = th.textContent.replace(/ [▲▼]$/, "") + (on ? (listState.dir > 0 ? " ▲" : " ▼") : "");
    });
    document.getElementById("pager").innerHTML = pages > 1 ? `
      <button class="btn" data-p="-1" ${listState.page === 0 ? "disabled" : ""}>‹ ${esc(t("ui.prev"))}</button>
      <span class="small muted">${listState.page + 1} / ${pages}</span>
      <button class="btn" data-p="1" ${listState.page >= pages - 1 ? "disabled" : ""}>${esc(t("ui.next"))} ›</button>` : "";
  };

  const q = document.getElementById("q");
  q.addEventListener("input", () => { listState.q = q.value; listState.page = 0; draw(); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = document.querySelector("#rows tr[data-t]"); if (first) location.hash = `#/c/${first.dataset.t}`; } });
  document.getElementById("sector").addEventListener("change", (e) => { listState.sector = e.target.value; listState.page = 0; draw(); });
  document.getElementById("filter").addEventListener("change", (e) => { listState.filter = e.target.value; listState.page = 0; draw(); });
  document.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]"); if (!th) return;
    if (listState.sort === th.dataset.sort) listState.dir *= -1;
    else { listState.sort = th.dataset.sort; listState.dir = th.dataset.sort === "t" || th.dataset.sort === "risk" ? 1 : -1; }
    draw();
  });
  const rowsEl = document.getElementById("rows");
  rowsEl.addEventListener("click", (e) => {
    const star = e.target.closest("[data-star]");
    if (star) { e.stopPropagation(); toggleWatch(star.dataset.star); draw(); return; }
    const tr = e.target.closest("tr[data-t]"); if (tr) location.hash = `#/c/${tr.dataset.t}`;
  });
  rowsEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-t]")) location.hash = `#/c/${e.target.dataset.t}`; });
  document.getElementById("pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    listState.page += Number(b.dataset.p); draw(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  draw();
}

// ---------- Company page ----------

async function renderCompany(ticker) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const [c, idx] = await Promise.all([loadCompany(ticker), loadIndex().catch(() => null)]);
  if (!c) {
    app.innerHTML = `<a class="back" href="#/">‹ ${esc(t("ui.back"))}</a><div class="glass empty">${esc(t("ui.notFound", { t: ticker }))}</div>`;
    return;
  }
  const a = analyze(c);
  document.title = `${c.ticker} · ${c.name} | TeraStockX`;
  const watched = getWatch().includes(c.ticker);
  const mk = c.market || {};

  app.innerHTML = `
    <a class="back" href="#/">‹ ${esc(t("ui.back"))}</a>
    <div class="company-head">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="sub">
          <span class="ticker-chip">${esc(c.ticker)}</span><span>${esc(c.exchange || "NASDAQ")}</span>
          ${c.sector ? `<span>· ${esc(sectorName(c.sector))}</span>` : ""}
          ${c.industry ? `<span>· ${esc(c.industry)}</span>` : ""}
          ${a.ok ? `<span>· ${esc(t("ui.lastFy", { y: a.latestYear }))}</span>` : ""}
        </div>
      </div>
      <div class="head-actions">
        ${isNum(mk.price) ? `<div class="quote"><div class="px">${fmt(mk.price, "usd")}</div><div class="mc">${esc(t("ui.marketCap"))}: ${a.ok ? money(a.metrics.marketCap) : "–"}</div></div>` : ""}
        <button class="btn" id="watch">${starSvg(watched)}<span>${esc(t(watched ? "ui.removeWatch" : "ui.addWatch"))}</span></button>
        <a class="btn" href="#/compare/${encodeURIComponent(c.ticker)}">${esc(t("ui.compareWith"))}</a>
      </div>
    </div>
    <div class="glass tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-tab="analysis">${esc(t("ui.tabAnalysis"))}</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="raw">${esc(t("ui.tabRaw"))}</button>
    </div>
    ${c.demo ? `<div class="notice"><span>ℹ️</span><span>${esc(t("ui.demoNotice"))}</span></div>` : ""}
    <div id="tab-analysis">${a.ok ? analysisView(c, a, idx) : `<div class="glass empty">${esc(t("ui.notEnough"))}</div>`}</div>
    <div id="tab-raw" class="hidden">${rawView(c, a)}</div>`;

  app.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    app.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.getElementById("tab-analysis").classList.toggle("hidden", b.dataset.tab !== "analysis");
    document.getElementById("tab-raw").classList.toggle("hidden", b.dataset.tab !== "raw");
  });
  document.getElementById("watch").addEventListener("click", (e) => {
    const on = toggleWatch(c.ticker);
    e.currentTarget.innerHTML = `${starSvg(on)}<span>${esc(t(on ? "ui.removeWatch" : "ui.addWatch"))}</span>`;
  });
  wireCharts(app);
  document.getElementById("csv")?.addEventListener("click", () => downloadCsv(c));
}

function ring(score) {
  const g = grade(score);
  const r = 80, C = 2 * Math.PI * r, v = isNum(score) ? score : 0;
  const color = { good: "#22c55e", warning: "#fab219", serious: "#ec835a", critical: "#e5484d", none: "#4b5568" }[g.tone];
  return `<div class="ring" role="img" aria-label="${esc(t("ui.overallScore"))}: ${isNum(score) ? score : "–"} – ${esc(g.label)}">
    <svg viewBox="0 0 190 190" width="190" height="190" aria-hidden="true">
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="14"/>
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(C * v) / 100} ${C}" style="filter:drop-shadow(0 0 8px ${color}88)"/>
    </svg>
    <div class="ring-label"><div class="ring-value">${isNum(score) ? score : "–"}<small>/100</small></div><div class="ring-caption">${esc(g.label)}</div></div>
  </div>`;
}

const DISTRESS_TONE = { low: "good", medium: "warning", high: "critical" };
const OUTLOOK_TONE = { up: "good", flat: "warning", down: "critical", unknown: "none" };
const OUTLOOK_ICON = { up: "↗", flat: "→", down: "↘", unknown: "?" };
const KEY_METRICS = ["peRatio", "evToEbit", "fcfYield", "dividendYield", "roic", "operatingMargin", "netDebtToEbitda", "revenueCagr", "epsCagr", "priceReturn1y", "volatility", "maxDrawdown"];

function analysisView(c, a, idx) {
  const riskG = grade(a.scores.risk, true);
  const rankOverall = idx ? sectorRank(idx, c.sector, "overall", a.scores.overall) : null;
  const vg = gradeKey(a.scores.overall);
  const profileNote = a.profile === "financial" ? t("ui.profileFinancial") : a.profile === "realEstate" ? t("ui.profileRealEstate") : "";

  const summary = `
    <div class="glass pad summary">
      ${ring(a.scores.overall)}
      <div>
        <div class="verdict">${esc(t(`verdict.${vg}`))}</div>
        ${a.styles.length ? `<div class="styles">${a.styles.map((s) => `<span class="tag">${esc(t(`styles.${s}`))}</span>`).join("")}</div>` : ""}
        <div class="facts">
          <div class="fact"><div class="k">${esc(t("ui.risk"))}</div><div class="v"><span class="pill tone-${riskG.tone}"><span class="dot"></span>${a.scores.risk ?? "–"}</span>${esc(riskG.label)}</div></div>
          <div class="fact"><div class="k">${esc(t("ui.distress"))}</div><div class="v"><span class="pill tone-${DISTRESS_TONE[a.distress.level]}"><span class="dot"></span>${esc(t(`distress.${a.distress.level}`))}</span></div></div>
          <div class="fact"><div class="k">${esc(t("ui.trend"))}</div><div class="v"><span class="pill tone-${OUTLOOK_TONE[a.outlook.level]}">${OUTLOOK_ICON[a.outlook.level]} ${esc(t(`outlook.${a.outlook.level}`))}</span></div></div>
          <div class="fact"><div class="k">${esc(t("ui.coverage"))}</div><div class="v">${a.coverage}% <span class="small muted">(${esc(t("ui.years", { n: a.metrics.yearsOfData }))})</span></div></div>
        </div>
        <p class="small muted" style="margin:12px 0 0">${esc(t(`distress.${a.distress.level}Text`))} ${esc(t(`outlook.${a.outlook.level}Text`))}
          ${isNum(rankOverall) ? `<br>${esc(t("ui.sectorRank", { p: rankOverall, s: sectorName(c.sector) }))}` : ""}</p>
      </div>
    </div>
    ${profileNote ? `<div class="notice" style="margin-top:14px"><span>ℹ️</span><span>${esc(profileNote)}</span></div>` : ""}`;

  const cards = DIMENSIONS.map((d) => {
    const inverse = d === "risk";
    const s = a.scores[d];
    if (!isNum(s) && !(a.parts[d]?.length)) return "";
    const g = grade(s, inverse);
    const parts = a.parts[d];
    const rank = idx ? sectorRank(idx, c.sector, d, s) : null;
    const detail = parts
      ? `<table class="parts-table">${parts.map((p) => `<tr>
          <td><span class="info" title="${esc(metricDesc(p.key))}">${esc(metricLabel(p.key))}</span></td>
          <td>${fmt(p.value, METRIC_FORMAT[p.key])}</td>
          <td class="pts">${isNum(p.score) ? `${p.score} ${esc(t("ui.points"))}` : esc(t("ui.notScored"))} · ${Math.round(p.weight * 100)}%</td>
        </tr>`).join("")}</table>`
      : `<p class="small muted">${esc(t("ui.riskExplain", { c: FLAG_PENALTY.critical, w: FLAG_PENALTY.warning }))}</p>
         ${a.parts.marketRisk?.length ? `<table class="parts-table">${a.parts.marketRisk.map((p) => `<tr><td>${esc(metricLabel(p.key))}</td><td>${fmt(p.value, METRIC_FORMAT[p.key])}</td><td class="pts">${isNum(p.score) ? `${p.score} ${esc(t("ui.points"))}` : esc(t("ui.notScored"))}</td></tr>`).join("")}</table>` : ""}`;
    return `
      <div class="glass score-card">
        <div class="score-top">
          <div><div class="score-name">${esc(t(`dims.${d}.name`))}</div><div class="score-q">${esc(t(`dims.${d}.q`))}</div></div>
          <div class="score-val">${isNum(s) ? s : "–"}<small>/100</small></div>
        </div>
        <div class="bar tone-${g.tone}" role="img" aria-label="${esc(t(`dims.${d}.name`))}: ${isNum(s) ? s : "–"} – ${esc(g.label)}"><span style="width:${isNum(s) ? s : 0}%"></span></div>
        <div class="score-meta"><span class="pill tone-${g.tone}"><span class="dot"></span>${esc(g.label)}</span>${isNum(rank) ? `<span class="rank">${esc(t("ui.sectorRankShort", { p: Math.max(1, 100 - rank) }))}</span>` : ""}</div>
        <p class="score-text">${esc(summaryText(d, a))}</p>
        <details class="parts"><summary>${esc(t("ui.howCalculated"))}</summary>${detail}</details>
      </div>`;
  }).join("");

  const order = { critical: 0, warning: 1, positive: 2 };
  const tag = { critical: t("ui.critical"), warning: t("ui.warningTag"), positive: t("ui.strength") };
  const icon = { critical: "!", warning: "!", positive: "✓" };
  const flags = [...a.flags].sort((x, y) => order[x.level] - order[y.level]);
  const flagsHtml = flags.length ? `<div class="flags">${flags.map((f) => {
    const ft = flagText(f);
    return `<div class="glass flag flag-${f.level}"><div class="flag-icon" aria-hidden="true">${icon[f.level]}</div>
      <div><div class="flag-title">${esc(ft.title)}<span class="flag-tag">${esc(tag[f.level])}</span></div><div class="flag-text">${esc(ft.text)}</div></div></div>`;
  }).join("")}</div>` : `<div class="glass empty">${esc(t("ui.noFlags"))}</div>`;

  const keyGrid = `<div class="keygrid">${KEY_METRICS.filter((k) => a.metrics[k] !== null && a.metrics[k] !== undefined).map((k) => `
    <div class="glass kv"><div class="k"><span class="info" title="${esc(metricDesc(k))}">${esc(metricLabel(k))}</span></div><div class="v">${fm(a.metrics, k)}</div></div>`).join("")}</div>`;

  const s = a.series;
  const nfEmpty = t("ui.notEnough");
  const priceData = c.prices?.data || [];
  const charts = `<div class="charts">
    ${priceData.length ? lineChart(t("ui.chartPrice"), t("ui.chartPriceSub"), priceData, (v) => fmt(v, "usd"), nfEmpty) : ""}
    ${barChart(t("ui.chartRevenue"), t("ui.chartRevenueSub"), s.map((y) => [y.year, y.revenue]), money, nfEmpty)}
    ${barChart(t("ui.chartNetIncome"), t("ui.chartNetIncomeSub"), s.map((y) => [y.year, y.netIncome]), money, nfEmpty)}
    ${barChart(t("ui.chartFcf"), t("ui.chartFcfSub"), s.map((y) => [y.year, y.freeCashFlow]), money, nfEmpty)}
    ${barChart(t("ui.chartMargin"), t("ui.chartMarginSub"), s.map((y) => [y.year, y.operatingMargin]), (v) => fmt(v, "pct"), nfEmpty)}
  </div>`;

  const basis = a.valuationBasis === "ttm" ? t("ui.ttmBasis", { d: date(c.ttm?.periodEnd) }) : t("ui.annualBasis");
  return `
    ${summary}
    <h2 class="section-title">${esc(t("ui.sectionKey"))} <span class="small muted">${esc(basis)}</span></h2>
    ${keyGrid}
    <h2 class="section-title">${esc(t("ui.sectionScores"))}</h2>
    <div class="score-grid">${cards}</div>
    <h2 class="section-title">${esc(t("ui.sectionFlags"))}</h2>
    ${flagsHtml}
    <h2 class="section-title">${esc(t("ui.sectionCharts"))}</h2>
    ${charts}
    <p class="small muted" style="margin-top:22px">${esc(t("ui.engine", { v: ENGINE_VERSION }))}</p>`;
}

// ---------- Financial statements ----------

const RAW_GROUPS = [
  ["income", ["revenue", "costOfRevenue", "grossProfit", "researchAndDevelopment", "operatingIncome", "depreciationAndAmortization", "interestExpense", "pretaxIncome", "incomeTaxExpense", "netIncome", "epsDiluted", "sharesDiluted"]],
  ["cashflow", ["operatingCashFlow", "capex", "freeCashFlow", "shareBasedCompensation", "dividendsPaid", "buybacks"]],
  ["balance", ["totalAssets", "currentAssets", "cash", "inventory", "accountsReceivable", "goodwill", "intangibleAssets", "totalLiabilities", "currentLiabilities", "totalDebt", "equity", "retainedEarnings", "sharesOutstanding"]],
];
const BALANCE_KEYS = new Set(RAW_GROUPS[2][1]);
const SERIES_ROWS = ["grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roic", "roe", "roa", "currentRatio", "debtToEquity", "netDebtToEbitda", "interestCoverage"];

function rawValue(y, k) {
  if (k === "freeCashFlow" && !isNum(y.freeCashFlow) && isNum(y.operatingCashFlow) && isNum(y.capex)) return y.operatingCashFlow - y.capex;
  return y[k];
}
function rawCell(v, k, cls = "") {
  if (!isNum(v)) return `<td class="na ${cls}">–</td>`;
  if (k === "epsDiluted") return `<td class="${cls}">${num(v, 2)}</td>`;
  if (k === "sharesDiluted" || k === "sharesOutstanding") return `<td class="${cls}">${num(v / 1e6, 0)} M</td>`;
  return `<td class="${cls}">${money(v)}</td>`;
}

function rawView(c, a) {
  const years = [...(c.annual || [])].sort((x, y) => x.year - y.year);
  if (!years.length) return `<div class="glass empty">${esc(t("ui.notEnough"))}</div>`;
  const ttm = c.ttm ? { ...c.ttm, ...(c.latestBalance || {}) } : null;
  const head = `<tr><th>${esc(t("ui.fiscalYear"))}</th>${years.map((y) => `<th>${y.year}${y.periodEnd ? `<br><span class="small">${esc(y.periodEnd)}</span>` : ""}</th>`).join("")}${ttm ? `<th class="ttm">${esc(t("ui.ttm"))}<br><span class="small">${esc(ttm.periodEnd)}</span></th>` : ""}</tr>`;
  const n = years.length + 1 + (ttm ? 1 : 0);
  let body = RAW_GROUPS.map(([g, keys]) => `<tr class="group"><td colspan="${n}">${esc(t(`raw.${g}`))}</td></tr>` +
    keys.map((k) => `<tr><td>${esc(t(`raw.${k}`))}</td>${years.map((y) => rawCell(rawValue(y, k), k)).join("")}${ttm ? rawCell(rawValue(ttm, k), k, "ttm") : ""}</tr>`).join("")).join("");
  if (a.ok) {
    const byYear = new Map(a.series.map((s) => [s.year, s]));
    body += `<tr class="group"><td colspan="${n}">${esc(t("ui.computedRatios"))}</td></tr>` + SERIES_ROWS.map((k) =>
      `<tr><td>${esc(metricLabel(k))}</td>${years.map((y) => { const v = byYear.get(y.year)?.[k]; return isNum(v) || v === Infinity ? `<td>${fmt(v, METRIC_FORMAT[k])}</td>` : `<td class="na">–</td>`; }).join("")}${ttm ? `<td class="ttm na"></td>` : ""}</tr>`).join("");
  }
  const src = c.source ? `${esc(t("ui.source"))}: ${c.source.url ? `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)}</a>` : esc(c.source.name)}${c.source.retrieved ? ` · ${esc(t("ui.retrieved", { d: date(c.source.retrieved) }))}` : ""}` : "";
  return `
    <div class="raw-actions">
      <span class="small muted">${esc(t("ui.currencyNote"))} ${src}</span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="csv" type="button">${esc(t("ui.downloadCsv"))}</button>
        <a class="btn" href="data/companies/${encodeURIComponent(c.ticker)}.json" download>${esc(t("ui.downloadJson"))}</a>
      </span>
    </div>
    <div class="glass table-wrap"><table class="raw"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function downloadCsv(c) {
  const years = [...c.annual].sort((x, y) => x.year - y.year);
  const keys = RAW_GROUPS.flatMap(([, k]) => k);
  const ttm = c.ttm ? { ...c.ttm, ...(c.latestBalance || {}) } : null;
  const lines = [["field", ...years.map((y) => y.year), ...(ttm ? ["TTM"] : [])].join(";")];
  for (const k of keys) lines.push([k, ...years.map((y) => (isNum(rawValue(y, k)) ? rawValue(y, k) : "")), ...(ttm ? [isNum(rawValue(ttm, k)) ? rawValue(ttm, k) : ""] : [])].join(";"));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `${c.ticker}_financials.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Compare ----------

const CMP_METRICS = ["marketCap", "peRatio", "evToEbit", "fcfYield", "dividendYield", "grossMargin", "operatingMargin", "roic", "fcfMargin", "netDebtToEbitda", "currentRatio", "revenueYoY", "revenueCagr", "epsCagr", "shareChangeYearly", "volatility", "maxDrawdown"];
const LOWER_BETTER = new Set(["peRatio", "evToEbit", "netDebtToEbitda", "volatility", "shareChangeYearly"]);

async function renderCompare(tickers) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const comps = (await Promise.all(tickers.map(loadCompany))).filter(Boolean);
  const as = comps.map((c) => analyze(c));
  const go = (list) => { location.hash = `#/compare/${list.join(",")}`; };

  const best = (vals, lower) => {
    const nums = vals.filter(isNum);
    if (nums.length < 2) return null;
    return lower ? Math.min(...nums) : Math.max(...nums);
  };
  const row = (label, vals, display, lower) => {
    const b = best(vals, lower);
    return `<tr><td>${label}</td>${vals.map((v, i) => `<td class="${isNum(v) && v === b ? "best" : ""}">${display[i]}</td>`).join("")}</tr>`;
  };

  let table = "";
  if (comps.length) {
    const head = `<tr><th></th>${comps.map((c) => `<th><a href="#/c/${encodeURIComponent(c.ticker)}">${esc(c.ticker)}</a><br><span class="small muted">${esc(c.name)}</span></th>`).join("")}</tr>`;
    const dimRows = ["overall", ...DIMENSIONS].map((d) => {
      const vals = as.map((a) => (a.ok ? a.scores[d] : null));
      return row(esc(d === "overall" ? t("ui.overallScore") : t(`dims.${d}.name`)), vals, vals.map((v) => scorePill(v, d === "risk")), d === "risk");
    }).join("");
    const mRows = CMP_METRICS.map((k) => {
      const vals = as.map((a) => (a.ok ? a.metrics[k] : null));
      if (vals.every((v) => v === null || v === undefined)) return "";
      return row(`<span class="info" title="${esc(metricDesc(k))}">${esc(metricLabel(k))}</span>`, vals, vals.map((v) => fmt(v, METRIC_FORMAT[k])), LOWER_BETTER.has(k));
    }).join("");
    const n = comps.length + 1;
    table = `<div class="glass table-wrap"><table class="cmp"><thead>${head}</thead><tbody>
      <tr class="group"><td colspan="${n}">${esc(t("ui.sectionScores"))}</td></tr>${dimRows}
      <tr class="group"><td colspan="${n}">${esc(t("ui.sectionKey"))}</td></tr>${mRows}
    </tbody></table></div>`;
  }

  app.innerHTML = `
    <div class="prose" style="max-width:none;margin-top:8px">
      <h1>${esc(t("ui.compareTitle"))}</h1>
      <p>${esc(t("ui.compareHint"))}</p>
    </div>
    <div class="compare-pick">
      ${comps.map((c) => `<span class="glass chip">${esc(c.ticker)}<button data-rm="${esc(c.ticker)}" aria-label="${esc(t("ui.remove"))}">×</button></span>`).join("")}
      ${comps.length < 3 ? `<input id="cmp-add" list="cmp-list" placeholder="${esc(t("ui.addCompany"))}" autocomplete="off">
        <datalist id="cmp-list">${idx.companies.filter((c) => c.sc).map((c) => `<option value="${esc(c.t)}">${esc(c.n)}</option>`).join("")}</datalist>` : ""}
    </div>
    ${table}`;

  app.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => go(tickers.filter((x) => x !== b.dataset.rm))));
  const add = document.getElementById("cmp-add");
  if (add) {
    const commit = () => {
      const v = add.value.trim().toUpperCase();
      if (v && idx.companies.some((c) => c.t === v) && !tickers.includes(v)) go([...tickers, v]);
    };
    add.addEventListener("change", commit);
    add.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  }
}

// ---------- Methodology ----------

function renderMethod() {
  document.title = `${t("method.title")} | TeraStockX`;
  const thr = (k, v) => fmt(v, METRIC_FORMAT[k]);
  const table = (parts) => `<div class="glass method-card"><table class="method-table">
    <thead><tr><th>${esc(t("ui.metric"))}</th><th>${esc(t("method.zero"))}</th><th>${esc(t("method.hundred"))}</th><th class="n">${esc(t("ui.weight"))}</th></tr></thead>
    <tbody>${parts.map((p) => `<tr><td><b>${esc(metricLabel(p.key))}</b><br><span class="small">${esc(metricDesc(p.key))}</span></td><td class="n">${thr(p.key, p.bad)}</td><td class="n">${thr(p.key, p.good)}</td><td class="n">${Math.round(p.weight * 100)}%</td></tr>`).join("")}</tbody></table></div>`;
  const dims = Object.keys(OVERALL_WEIGHTS).concat("marketRisk").map((d) => {
    const gen = PROFILES.general[d];
    const variants = ["financial", "realEstate"].filter((p) => PROFILES[p][d] !== gen);
    return `<h2>${esc(t(`dims.${d}.name`))}</h2><p>${esc(t(`dims.${d}.q`))}</p>${table(gen)}
      ${variants.map((p) => `<p class="small"><b>${esc(t(`method.profile${p[0].toUpperCase()}${p.slice(1)}`))}</b></p>${PROFILES[p][d].length ? table(PROFILES[p][d]) : `<p class="small muted">${esc(t("ui.notScored"))}</p>`}`).join("")}`;
  }).join("");
  const bands = ["excellent", "strong", "moderate", "weak", "poor"].map((k) => `<span class="pill tone-${GRADE_TONE[k]}"><span class="dot"></span>${esc(t(`grades.${k}`))}</span>`).join(" ");
  app.innerHTML = `<div class="prose">
    <h1>${esc(t("method.title"))}</h1>
    <p>${esc(t("method.intro"))}</p>
    <p>${esc(t("method.scaling"))}</p>
    <p>${esc(t("method.bands"))} ${bands} <span class="small">(80–100 · 65–79 · 45–64 · 25–44 · 0–24)</span></p>
    <p>${esc(t("method.profiles"))}</p>
    <h2>${esc(t("method.overall"))}</h2><p>${esc(t("method.overallText"))}</p>
    <div class="glass method-card"><table class="method-table"><tbody>${Object.entries(OVERALL_WEIGHTS).map(([k, w]) => `<tr><td>${esc(t(`dims.${k}.name`))}</td><td class="n">${Math.round(w * 100)}%</td></tr>`).join("")}</tbody></table></div>
    ${dims}
    <h2>${esc(t("method.riskTitle"))}</h2><p>${esc(t("ui.riskExplain", { c: FLAG_PENALTY.critical, w: FLAG_PENALTY.warning }))}</p>
    <h2>${esc(t("method.distressTitle"))}</h2><p>${esc(t("method.distressText"))}</p>
    <h2>${esc(t("method.trendTitle"))}</h2><p>${esc(t("method.trendText"))}</p>
    <h2>${esc(t("method.stylesTitle"))}</h2><p>${esc(t("method.stylesText"))}</p>
    <h2>${esc(t("method.sectorTitle"))}</h2><p>${esc(t("method.sectorText"))}</p>
    <h2>${esc(t("method.limitsTitle"))}</h2><p>${esc(t("method.limitsText"))}</p>
  </div>`;
}

renderChrome();
route();
