import { analyze, scoreHistory, gradeKey, GRADE_TONE, DIMENSIONS, METRIC_FORMAT, ENGINE_VERSION, PROFILES, OVERALL_WEIGHTS, FLAG_PENALTY, dividendProfile, DIVIDEND_TONE, DIVIDEND_WEIGHTS, findPeers } from "./scoring.js";
import { portfolioSummary, PORTFOLIO_LIMITS } from "./portfolio.js";
import { LANGS, lang, setLang, t, fill, fmt, money, date, num, dict } from "./i18n/index.js";
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

let newsCache = null;
async function loadNews() {
  if (!newsCache) {
    const r = await fetch("data/news.json", { cache: "no-cache" });
    newsCache = r.ok ? await r.json() : { events: [] };
  }
  return newsCache;
}

let benchCache = null;
async function loadBenchmarks() {
  if (!benchCache) {
    try {
      const r = await fetch("data/benchmarks.json", { cache: "no-cache" });
      benchCache = r.ok ? (await r.json()).sectors || {} : {};
    } catch { benchCache = {}; }
  }
  return benchCache;
}
const analyzeWith = async (c) => analyze(c, { benchmarks: await loadBenchmarks() });

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
function getSnaps() { try { return JSON.parse(localStorage.getItem("tsx-watch-snap") || "{}"); } catch { return {}; } }
function setSnaps(s) { try { localStorage.setItem("tsx-watch-snap", JSON.stringify(s)); } catch {} }
// What the watchlist remembers about a company, to detect changes on later visits.
const snapOf = (row) => ({ o: row?.sc?.overall ?? null, r: row?.sc?.risk ?? null, d: row?.d ?? null, le: row?.le ?? null, cf: row?.cf ?? [] });
function toggleWatch(tk, row) {
  const w = new Set(getWatch());
  const snaps = getSnaps();
  if (w.has(tk)) { w.delete(tk); delete snaps[tk]; }
  else { w.add(tk); if (row) snaps[tk] = snapOf(row); }
  try { localStorage.setItem("tsx-watch", JSON.stringify([...w])); } catch {}
  setSnaps(snaps);
  return w.has(tk);
}

// Changes since the user last marked the watchlist as seen.
const DISTRESS_ORDER = { low: 0, medium: 1, high: 2 };
function watchAlerts(idx) {
  const snaps = getSnaps();
  const out = [];
  for (const tk of getWatch()) {
    const row = idx.companies.find((c) => c.t === tk);
    const s = snaps[tk];
    if (!row || !s) continue;
    const cur = snapOf(row);
    if (isNum(cur.o) && isNum(s.o) && Math.abs(cur.o - s.o) >= 5) out.push({ t: tk, tone: cur.o > s.o ? "good" : "critical", text: t("ui.alertScore", { t: tk, from: s.o, to: cur.o }) });
    if (isNum(cur.r) && isNum(s.r) && cur.r - s.r >= 10) out.push({ t: tk, tone: "serious", text: t("ui.alertRisk", { t: tk, from: s.r, to: cur.r }) });
    if (cur.d && s.d && DISTRESS_ORDER[cur.d] > DISTRESS_ORDER[s.d]) out.push({ t: tk, tone: "critical", text: t("ui.alertDistress", { t: tk, level: t(`distress.${cur.d}`) }) });
    for (const id of cur.cf.filter((x) => !(s.cf || []).includes(x))) out.push({ t: tk, tone: "critical", text: t("ui.alertCritical", { t: tk, flag: t(`flags.${id}`)?.[0] ?? id }) });
    if (cur.le && cur.le !== s.le) {
      const [d, items] = cur.le.split("|");
      out.push({ t: tk, tone: "serious", text: t("ui.alertEvent", { t: tk, event: items.split(",").map(eventName).join(", "), date: date(d) }) });
    }
  }
  return out;
}
const starSvg = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`;

// ---------- Portfolio (per browser) ----------

function getPortfolio() { try { return JSON.parse(localStorage.getItem("tsx-portfolio") || "[]").filter((h) => h && h.t); } catch { return []; } }
function setPortfolio(list) { try { localStorage.setItem("tsx-portfolio", JSON.stringify(list)); } catch {} }

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
// Market cap is in US dollars; every other amount is in the company's reporting currency.
const fm = (metrics, k, cur = "USD") => fmt(metrics[k], METRIC_FORMAT[k], k === "marketCap" ? "USD" : cur);

function summaryText(dim, a, cur) {
  const tpl = t(`dims.${dim}.summary`);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "windowYears") return a.metrics.windowYears;
    if (k === "distress") return t(`distress.${a.distress.level}`).toLowerCase();
    return fm(a.metrics, k, cur);
  });
}

const FLAG_FORMAT = {
  lowCurrentRatio: "x", interestCoverageCritical: "x", interestCoverageWeak: "x", altmanDistress: "num", altmanGrey: "num", altmanSafe: "num",
  highLeverage: "xyears", revenueDecline: "spct", heavyDilution: "spct", buybacks: "spct", highSbc: "pct", lowEarningsQuality: "pct",
  dividendUncovered: "pct0", goodwillHeavy: "pct", deepDrawdown: "pct", netCash: "money", highMargin: "pct", highRoic: "pct",
  strongGrowth: "spct", strongCashConversion: "pct0", insiderBuying: "money", insiderSelling: "money",
};
const USD_FLAGS = new Set(["insiderBuying", "insiderSelling"]);
function flagText(f, cur = "USD") {
  const [title, text] = t(`flags.${f.id}`);
  const p = { ...f.params };
  const isDate = ["staleData", "bankruptcyFiling", "restatement", "debtAcceleration", "delistingNotice", "auditorChange"].includes(f.id);
  if ("value" in p) p.value = isDate ? date(p.value) : fmt(p.value, FLAG_FORMAT[f.id], USD_FLAGS.has(f.id) ? "USD" : cur);
  if ("share" in p) p.share = fmt(p.share, "pct");
  return { title, text: fill(text, p) };
}

// ---------- Header / navigation ----------

function renderChrome() {
  const icon = (d) => `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
const links = (short) => `
    <a href="#/" data-nav="list" title="${esc(t("ui.navCompanies"))}">${icon("M4 6h16M4 12h16M4 18h10")}<span class="nav-label">${esc(t(short ? "ui.tabCompanies" : "ui.navCompanies"))}</span></a>
    <a href="#/trend" data-nav="trend" title="${esc(t("ui.navTrend"))}">${icon("M3 17l6-6 4 4 8-8M15 7h6v6")}<span class="nav-label">${esc(t(short ? "ui.tabTrend" : "ui.navTrend"))}</span></a>
    <a href="#/portfolio" data-nav="portfolio" title="${esc(t("ui.navPortfolio"))}">${icon("M12 3v9h9M12 3a9 9 0 1 0 9 9")}<span class="nav-label">${esc(t(short ? "ui.tabPortfolio" : "ui.navPortfolio"))}</span></a>
    <a href="#/news" data-nav="news" title="${esc(t("ui.navNews"))}">${icon("M5 4h11v16H5zM16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3")}<span class="nav-label">${esc(t(short ? "ui.tabNews" : "ui.navNews"))}</span></a>
    <a href="#/data" data-nav="data" title="${esc(t("ui.navData"))}">${icon("M4 5h16v14H4zM4 10h16M10 10v9")}<span class="nav-label">${esc(t(short ? "ui.tabData" : "ui.navData"))}</span></a>
    <a href="#/compare" data-nav="compare" title="${esc(t("ui.navCompare"))}">${icon("M8 4v16M16 4v16M4 8h8M12 16h8")}<span class="nav-label">${esc(t(short ? "ui.tabCompare" : "ui.navCompare"))}</span></a>
    <a href="#/methodology" data-nav="method" title="${esc(t("ui.navMethod"))}">${icon("M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01")}<span class="nav-label">${esc(t(short ? "ui.tabMethod" : "ui.navMethod"))}</span></a>
`;
  document.getElementById("nav").innerHTML = links(false);
  document.getElementById("tabbar").innerHTML = links(true);
  document.getElementById("lang-wrap").innerHTML = `<select class="lang-select" id="lang" aria-label="${esc(t("ui.language"))}">
      ${Object.entries(LANGS).map(([code, d]) => `<option value="${code}" ${code === lang() ? "selected" : ""}>${d.meta.short}</option>`).join("")}
    </select>`;
  document.getElementById("lang").addEventListener("change", (e) => { setLang(e.target.value); renderChrome(); route(false); });
  document.getElementById("footer-text").innerHTML = `${esc(t("ui.footer"))} <a href="#/methodology">${esc(t("ui.navMethod"))} ›</a>`;
  markNav();
}

function markNav() {
  const page = location.hash.replace(/^#\/?/, "").split("/")[0];
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active",
    (a.dataset.nav === "list" && (page === "" || page === "c")) || (a.dataset.nav === "compare" && page === "compare") || (a.dataset.nav === "news" && page === "news") || (a.dataset.nav === "trend" && page === "trend") || (a.dataset.nav === "data" && page === "data") || (a.dataset.nav === "portfolio" && page === "portfolio") || (a.dataset.nav === "method" && page === "methodology")));
}

// ---------- Router ----------

const listState = { q: "", sector: "", filter: "analyzed", sort: "overall", dir: -1, page: 0, ex: "", minScore: 0, maxRisk: 100, minCap: 0, minDy: 0, minDs: 0, styles: [], noCrit: false };
const LOWER_FIRST = new Set(["t", "risk", "pe"]);

async function route(scroll = true) {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  markNav();
  if (scroll) window.scrollTo(0, 0);
  document.title = "TeraStockX";
  try {
    if (page === "c" && arg) await renderCompany(decodeURIComponent(arg).toUpperCase());
    else if (page === "compare") await renderCompare(arg ? decodeURIComponent(arg).toUpperCase().split(",").filter(Boolean).slice(0, MAX_COMPARE) : []);
    else if (page === "portfolio") await renderPortfolio(arg ? decodeURIComponent(arg).toUpperCase() : "");
    else if (page === "report" && arg) await renderReport(decodeURIComponent(arg).toUpperCase());
    else if (page === "methodology") renderMethod();
    else if (page === "news") await renderNews();
    else if (page === "trend") await renderTrend();
    else if (page === "data") await renderData(arg ? decodeURIComponent(arg).toUpperCase() : null);
    else await renderList();
  } catch (e) {
    app.innerHTML = `<div class="glass empty">${esc(t("ui.errorLoad", { e: e.message }))}<br><span class="small">${esc(t("ui.serveHint"))}</span></div>`;
  }
}
addEventListener("hashchange", () => route());

// ---------- List page ----------

const LIST_COLS = [
  { key: "overall", label: () => t("ui.overallScore") },
  { key: "profitability", cls: "col-xl" },
  { key: "balanceSheet", cls: "col-xl" },
  { key: "growthLong", cls: "col-xl" },
  { key: "valuation", cls: "col-lg" },
  { key: "risk", inverse: true },
];
const SCORE_STEPS = [0, 50, 60, 70, 80];
const RISK_STEPS = [100, 50, 35, 20];
const CAP_STEPS = [0, 3e8, 2e9, 1e10, 2e11];
const DY_STEPS = [0, 0.01, 0.02, 0.04];
const DS_STEPS = [0, 55, 75];
const STYLE_KEYS = ["quality", "growth", "value", "income"];

async function renderList() {
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const sectors = [...new Set(idx.companies.map((c) => c.s).filter(Boolean))].sort((a, b) => sectorName(a).localeCompare(sectorName(b), lang()));
  const analyzed = idx.companies.filter((c) => c.sc).length;
  const exchanges = [...new Set(idx.companies.map((c) => c.ex).filter(Boolean))].sort();

  app.innerHTML = `
    <section class="glass hero">
      <div>
        <h1>TeraStock<b>X</b></h1>
        <div class="tagline">${esc(t("ui.tagline"))}</div>
        <p>${esc(t("ui.heroText"))}</p>
        <div class="hero-stats">
          <div class="hero-stat"><div class="v">${num(idx.companies.filter((c) => isNum(c.sc?.overall)).length, 0)}</div><div class="k">${esc(t("ui.ratedCompanies"))}</div></div>
          <div class="hero-stat"><div class="v">10</div><div class="k">${esc(t("ui.sectionScores"))}</div></div>
          <div class="hero-stat"><div class="v">${esc(date(idx.generated))}</div><div class="k">${esc(t("ui.updated", { d: "" }).replace(/[:\s]+$/, ""))}</div></div>
        </div>
      </div>
      <img class="hero-art" src="assets/img/hero.svg" alt="" width="560" height="360">
    </section>
    <div id="alerts"></div>
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
    <details class="glass filters" id="filters" ${filtersActive() ? "open" : ""}>
      <summary><span>${esc(t("ui.filters"))}</span> <span class="small muted" id="filters-count"></span></summary>
      <div class="filter-grid">
        <label>${esc(t("ui.exchange"))}<select class="select" data-f="ex"><option value="">${esc(t("ui.allExchanges"))}</option>${exchanges.map((x) => `<option ${listState.ex === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
        <label>${esc(t("ui.minScore"))}<select class="select" data-f="minScore">${SCORE_STEPS.map((v) => `<option value="${v}" ${listState.minScore === v ? "selected" : ""}>${v ? `≥ ${v}` : esc(t("ui.anyValue"))}</option>`).join("")}</select></label>
        <label>${esc(t("ui.maxRisk"))}<select class="select" data-f="maxRisk">${RISK_STEPS.map((v) => `<option value="${v}" ${listState.maxRisk === v ? "selected" : ""}>${v < 100 ? `≤ ${v}` : esc(t("ui.anyValue"))}</option>`).join("")}</select></label>
        <label>${esc(t("ui.minCap"))}<select class="select" data-f="minCap">${CAP_STEPS.map((v) => `<option value="${v}" ${listState.minCap === v ? "selected" : ""}>${v ? `≥ ${money(v)}` : esc(t("ui.anyValue"))}</option>`).join("")}</select></label>
        <label>${esc(t("ui.minDividend"))}<select class="select" data-f="minDy">${DY_STEPS.map((v) => `<option value="${v}" ${listState.minDy === v ? "selected" : ""}>${v ? `≥ ${fmt(v, "pct0")}` : esc(t("ui.anyValue"))}</option>`).join("")}</select></label>
        <label>${esc(t("ui.minDivSafety"))}<select class="select" data-f="minDs">${DS_STEPS.map((v) => `<option value="${v}" ${listState.minDs === v ? "selected" : ""}>${v ? `≥ ${v} · ${esc(t(`dividend.${v >= 75 ? "safe" : "moderate"}`))}` : esc(t("ui.anyValue"))}</option>`).join("")}</select></label>
      </div>
      <div class="filter-row">
        <span class="small muted">${esc(t("ui.styleFilter"))}</span>
        ${STYLE_KEYS.map((k) => `<button type="button" class="chip-toggle ${listState.styles.includes(k) ? "on" : ""}" data-style="${k}" aria-pressed="${listState.styles.includes(k)}">${esc(t(`styles.${k}`))}</button>`).join("")}
        <label class="check"><input type="checkbox" id="noCrit" ${listState.noCrit ? "checked" : ""}> ${esc(t("ui.noCritical"))}</label>
        <button type="button" class="btn" id="reset-filters">${esc(t("ui.reset"))}</button>
      </div>
    </details>
    <div class="list-meta"><span id="count"></span><span>${esc(t("ui.analyzedOf", { a: num(analyzed, 0), n: num(idx.count, 0) }))}</span></div>
    <div class="glass table-wrap"><table class="list">
      <thead><tr>
        <th data-sort="t">${esc(t("ui.company"))}</th>
        <th class="num col-md" data-sort="mc">${esc(t("ui.marketCap"))}</th>
        ${LIST_COLS.map((c) => `<th class="num ${c.cls || ""}" data-sort="${c.key}">${esc(c.label ? c.label() : t(`dims.${c.key}.name`))}</th>`).join("")}
        <th class="num col-lg" data-sort="pe">${esc(t("ui.pe"))}</th>
        <th class="num col-lg" data-sort="dy">${esc(t("ui.dividendYieldShort"))}</th>
        <th aria-label="${esc(t("ui.watchlist"))}"></th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="pager" id="pager"></div>
    <div id="home-news"></div>
    ${idx.companies.some((c) => c.demo) ? `<p class="small muted" style="margin-top:16px">${esc(t("ui.demoNote"))}</p>` : ""}
  `;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    const watch = new Set(getWatch());
    const L = listState;
    let rows = idx.companies.filter((c) =>
      (L.filter !== "analyzed" || c.sc) && (L.filter !== "watch" || watch.has(c.t)) &&
      (!L.sector || c.s === L.sector) && (!L.ex || c.ex === L.ex) &&
      (!L.minScore || (c.sc?.overall ?? -1) >= L.minScore) &&
      (L.maxRisk >= 100 || (isNum(c.sc?.risk) && c.sc.risk <= L.maxRisk)) &&
      (!L.minCap || (c.mc ?? 0) >= L.minCap) &&
      (!L.minDy || (c.dy ?? 0) >= L.minDy) &&
      (!L.minDs || (c.ds ?? -1) >= L.minDs) &&
      (!L.styles.length || L.styles.every((st) => (c.st || []).includes(st))) &&
      (!L.noCrit || !(c.cf || []).length) &&
      (!q || c.t.toLowerCase().startsWith(q) || c.n.toLowerCase().includes(q)));
    document.getElementById("filters-count").textContent = filtersActive() ? t("ui.filtersActive", { n: filtersActive() }) : "";
    const k = listState.sort;
    const val = (c) => (k === "mc" ? c.mc : k === "pe" ? c.pe : k === "dy" ? c.dy : c.sc?.[k]);
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
        <td><span class="tick">${esc(c.t)}</span>${c.demo ? `<span class="badge">${esc(t("ui.demoBadge"))}</span>` : ""}${c.ex && c.ex !== "NASDAQ" ? `<span class="badge ex">${esc(c.ex)}</span>` : ""}<br><span class="cname small">${esc(c.n)}</span></td>
        <td class="num col-md small">${isNum(c.mc) ? money(c.mc) : "–"}</td>
        ${LIST_COLS.map((col) => `<td class="num ${col.cls || ""}">${c.sc ? scorePill(c.sc[col.key], col.inverse) : `<span class="small muted">${esc(t("ui.noData"))}</span>`}</td>`).join("")}
        <td class="num col-lg small">${isNum(c.pe) ? fmt(c.pe, "mult") : "–"}</td>
        <td class="num col-lg small">${isNum(c.dy) && c.dy > 0 ? fmt(c.dy, "pct") : "–"}</td>
        <td><button class="star ${watch.has(c.t) ? "on" : ""}" data-star="${esc(c.t)}" aria-label="${esc(t(watch.has(c.t) ? "ui.removeWatch" : "ui.addWatch"))}">${starSvg(watch.has(c.t))}</button></td>
      </tr>`).join("") : `<tr><td colspan="${LIST_COLS.length + 5}" class="empty">${esc(t("ui.noResults"))}</td></tr>`;

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
    else { listState.sort = th.dataset.sort; listState.dir = LOWER_FIRST.has(th.dataset.sort) ? 1 : -1; }
    draw();
  });
  const rowsEl = document.getElementById("rows");
  rowsEl.addEventListener("click", (e) => {
    const star = e.target.closest("[data-star]");
    if (star) { e.stopPropagation(); toggleWatch(star.dataset.star, idx.companies.find((c) => c.t === star.dataset.star)); draw(); drawAlerts(); return; }
    const tr = e.target.closest("tr[data-t]"); if (tr) location.hash = `#/c/${tr.dataset.t}`;
  });
  rowsEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-t]")) location.hash = `#/c/${e.target.dataset.t}`; });
  document.getElementById("pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    listState.page += Number(b.dataset.p); draw(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const filters = document.getElementById("filters");
  filters.addEventListener("change", (e) => {
    const f = e.target.dataset.f;
    if (f) listState[f] = f === "ex" ? e.target.value : Number(e.target.value);
    if (e.target.id === "noCrit") listState.noCrit = e.target.checked;
    listState.page = 0; draw();
  });
  filters.addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]");
    if (b) {
      const k = b.dataset.style;
      listState.styles = listState.styles.includes(k) ? listState.styles.filter((x) => x !== k) : [...listState.styles, k];
      b.classList.toggle("on"); b.setAttribute("aria-pressed", String(b.classList.contains("on")));
      listState.page = 0; draw();
    }
    if (e.target.closest("#reset-filters")) {
      Object.assign(listState, { ex: "", minScore: 0, maxRisk: 100, minCap: 0, minDy: 0, minDs: 0, styles: [], noCrit: false, page: 0 });
      renderList();
    }
  });
  const drawAlerts = () => {
    const el = document.getElementById("alerts");
    const alerts = watchAlerts(idx);
    if (!el) return;
    el.innerHTML = alerts.length ? `<div class="glass alerts pad">
      <div class="section-title" style="margin:0 0 10px">${esc(t("ui.alertsTitle"))} <span class="pill tone-serious"><span class="dot"></span>${alerts.length}</span></div>
      <ul>${alerts.map((x) => `<li><span class="pill tone-${x.tone}"><span class="dot"></span>${esc(x.t)}</span> <a href="#/c/${encodeURIComponent(x.t)}">${esc(x.text)}</a></li>`).join("")}</ul>
      <button type="button" class="btn" id="alerts-seen">${esc(t("ui.alertsSeen"))}</button></div>` : "";
    document.getElementById("alerts-seen")?.addEventListener("click", () => {
      const snaps = {};
      for (const tk of getWatch()) snaps[tk] = snapOf(idx.companies.find((c) => c.t === tk));
      setSnaps(snaps); drawAlerts();
    });
  };
  draw();
  drawAlerts();
  loadNews().then((n) => {
    const top = (n.events || []).filter(isTopEvent).slice(0, 4);
    const el = document.getElementById("home-news");
    if (!top.length || !el) return;
    el.innerHTML = `<div class="section-title" style="margin-top:28px">${esc(t("ui.latestEvents"))} <a class="small" href="#/news">${esc(t("ui.allNews"))} ›</a></div>
      <div class="events" style="margin-bottom:20px">${top.map((e) => eventCard(e)).join("")}</div>`;
  }).catch(() => {});
}

function filtersActive() {
  const L = listState;
  return [L.ex, L.minScore, L.maxRisk < 100, L.minCap, L.minDy, L.minDs, L.styles.length, L.noCrit].filter(Boolean).length;
}

// ---------- TeraScore Trend ----------

const changePill = (v) => (isNum(v) ? `<span class="pill tone-${v > 0 ? "good" : v < 0 ? "critical" : "none"}"><span class="dot"></span>${v > 0 ? "+" : ""}${v}</span>` : "–");
const TREND_PERIODS = { ch: "ui.trendPeriodFy", c4: "ui.trendPeriod4w", c13: "ui.trendPeriod13w" };
const trendState = { period: "ch", sector: "", minCap: 2e9 };

async function renderTrend() {
  document.title = `TeraScore Trend | TeraStockX`;
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const sectors = [...new Set(idx.companies.map((c) => c.s).filter(Boolean))].sort((a, b) => sectorName(a).localeCompare(sectorName(b), lang()));
  app.innerHTML = `
    <div class="prose" style="max-width:none;margin-top:8px"><h1>TeraScore Trend</h1><p style="max-width:860px">${esc(t("ui.trendIntro"))}</p></div>
    <div class="controls">
      <select class="select" id="tr-period" aria-label="${esc(t("ui.trendPeriod"))}">${Object.entries(TREND_PERIODS).map(([k, l]) => `<option value="${k}" ${trendState.period === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select>
      <select class="select" id="tr-sector" aria-label="${esc(t("ui.sector"))}"><option value="">${esc(t("ui.allSectors"))}</option>${sectors.map((x) => `<option value="${esc(x)}" ${trendState.sector === x ? "selected" : ""}>${esc(sectorName(x))}</option>`).join("")}</select>
      <select class="select" id="tr-cap" aria-label="${esc(t("ui.minCap"))}">${CAP_STEPS.map((v) => `<option value="${v}" ${trendState.minCap === v ? "selected" : ""}>${v ? `${esc(t("ui.minCap"))}: ≥ ${money(v)}` : `${esc(t("ui.minCap"))}: ${esc(t("ui.anyValue"))}`}</option>`).join("")}</select>
    </div>
    <div id="tr-body"></div>`;
  const draw = () => {
    const k = trendState.period;
    const rows = idx.companies.filter((c) => isNum(c[k]) && isNum(c.sc?.overall) && (!trendState.sector || c.s === trendState.sector) && (c.mc ?? 0) >= trendState.minCap);
    const body = document.getElementById("tr-body");
    if (!rows.length) { body.innerHTML = `<div class="glass empty">${esc(t(k === "ch" ? "ui.noResults" : "ui.trendWeeklyEmpty"))}</div>`; return; }
    const list = (items) => `<div class="glass table-wrap"><table class="list"><thead><tr><th>${esc(t("ui.company"))}</th><th class="num">${esc(t("ui.overallScore"))}</th><th class="num">${esc(t("ui.trendChange"))}</th></tr></thead><tbody>
      ${items.map((c) => `<tr data-t="${esc(c.t)}" tabindex="0"><td><span class="tick">${esc(c.t)}</span><br><span class="cname small">${esc(c.n)}</span></td>
        <td class="num">${scorePill(c.sc.overall)}<br><span class="small muted">${esc(t("ui.trendFrom", { v: c.sc.overall - c[k] }))}</span></td><td class="num">${changePill(c[k])}</td></tr>`).join("")}</tbody></table></div>`;
    const up = [...rows].sort((a, b) => b[k] - a[k]).filter((c) => c[k] > 0).slice(0, 25);
    const down = [...rows].sort((a, b) => a[k] - b[k]).filter((c) => c[k] < 0).slice(0, 25);
    body.innerHTML = `<div class="trend-cols">
      <section><h2 class="section-title">↗ ${esc(t("ui.trendUp"))}</h2>${up.length ? list(up) : `<div class="glass empty">–</div>`}</section>
      <section><h2 class="section-title">↘ ${esc(t("ui.trendDown"))}</h2>${down.length ? list(down) : `<div class="glass empty">–</div>`}</section>
    </div>
    <p class="small muted" style="margin-top:16px">${esc(t("ui.trendNote"))}</p>`;
  };
  document.getElementById("tr-period").addEventListener("change", (e) => { trendState.period = e.target.value; draw(); });
  document.getElementById("tr-sector").addEventListener("change", (e) => { trendState.sector = e.target.value; draw(); });
  document.getElementById("tr-cap").addEventListener("change", (e) => { trendState.minCap = Number(e.target.value); draw(); });
  document.getElementById("tr-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-t]"); if (tr) location.hash = `#/c/${tr.dataset.t}`; });
  draw();
}

// Company page section: point-in-time score per fiscal year plus weekly snapshots.
function trendView(c, history, row) {
  if (!history.length && !(c.scoreHistory?.weekly || []).length) return `<div class="glass empty small">${esc(t("ui.notEnough"))}</div>`;
  const weekly = (c.scoreHistory?.weekly || []).map(([d, v]) => [d, v]);
  const chips = [["ui.trendPeriodFy", row?.ch], ["ui.trendPeriod4w", row?.c4], ["ui.trendPeriod13w", row?.c13]]
    .filter(([, v]) => isNum(v)).map(([l, v]) => `<div class="fact"><div class="k">${esc(t(l))}</div><div class="v">${changePill(v)}</div></div>`).join("");
  return `${chips ? `<div class="facts" style="margin:0 0 12px">${chips}</div>` : ""}
    <div class="charts">
      ${barChart(t("ui.trendAnnualChart"), t("ui.trendAnnualSub"), history.map((h) => [h.year, h.overall]), (v) => `${v}`, t("ui.notEnough"))}
      ${weekly.length >= 3 ? barChart(t("ui.trendWeeklyChart"), t("ui.trendWeeklySub"), weekly.map(([d, v]) => [d.slice(5), v]), (v) => `${v}`, t("ui.notEnough")) : ""}
    </div>`;
}

// ---------- Major events ----------

// Event item codes contain a dot ("3.01"), so they are looked up directly rather than via a t() path.
const eventName = (item) => dict().events?.[item] ?? LANGS.en.events[item] ?? item;
// "Most important": critical events of any company, major events of companies above $1 billion.
const isTopEvent = (e) => e.severity >= 5 || (e.severity >= 4 && (e.mc ?? 0) >= 1e9);
const SEV_TONE = { 5: "critical", 4: "serious", 3: "warning", 2: "none" };
function eventCard(e, withCompany = true) {
  const sev = e.severity;
  return `<div class="glass event">
    <div class="event-head">
      <span class="pill tone-${SEV_TONE[sev]}"><span class="dot"></span>${esc(t(`ui.sev${sev}`))}</span>
      <span class="small muted">${esc(date(e.date))}</span>
    </div>
    ${withCompany ? `<a class="event-co" href="#/c/${encodeURIComponent(e.t)}"><span class="tick">${esc(e.t)}</span> <span class="muted">${esc(e.n)}</span></a>` : ""}
    <div class="event-items">${e.items.map((i) => `<span>${esc(eventName(i))} <span class="small muted">(8-K ${esc(i)})</span></span>`).join("")}</div>
    <a class="small" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(t("ui.viewFiling"))} ↗</a>
  </div>`;
}

async function renderNews() {
  document.title = `${t("ui.newsTitle")} | TeraStockX`;
  app.innerHTML = `<div class="skeleton"></div>`;
  const n = await loadNews();
  const state = { filter: "top" };
  app.innerHTML = `
    <div class="prose" style="max-width:none;margin-top:8px"><h1>${esc(t("ui.newsTitle"))}</h1><p style="max-width:820px">${esc(t("ui.newsIntro"))}</p></div>
    <div class="controls"><select class="select" id="sev">
      <option value="top">${esc(t("ui.newsTop"))}</option><option value="4">${esc(t("ui.onlyCritical"))}</option><option value="3">${esc(t("ui.allSeverities"))}</option>
    </select></div>
    <div class="events" id="news-list"></div>`;
  const draw = () => {
    const list = (n.events || []).filter((e) => (state.filter === "top" ? isTopEvent(e) : e.severity >= Number(state.filter))).slice(0, 60);
    document.getElementById("news-list").innerHTML = list.length ? list.map((e) => eventCard(e)).join("") : `<div class="glass empty">${esc(t("ui.newsEmpty"))}</div>`;
  };
  document.getElementById("sev").addEventListener("change", (e) => { state.filter = e.target.value; draw(); });
  draw();
}

// ---------- Financial data page ----------

async function renderData(ticker) {
  document.title = `${t("ui.dataTitle")} | TeraStockX`;
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const c = ticker ? await loadCompany(ticker) : null;
  const top = idx.companies.filter((x) => isNum(x.mc)).sort((a, b) => b.mc - a.mc).slice(0, 16);
  const chips = (top.length ? top : idx.companies.filter((x) => x.sc).slice(0, 16));
  app.innerHTML = `
    <div class="prose" style="max-width:none;margin-top:8px"><h1>${esc(t("ui.dataTitle"))}</h1><p style="max-width:820px">${esc(t("ui.dataIntro"))}</p></div>
    <div class="compare-pick">
      <input id="data-pick" list="data-list" placeholder="${esc(t("ui.dataPick"))}" autocomplete="off" value="${esc(ticker || "")}">
      <datalist id="data-list">${idx.companies.map((x) => `<option value="${esc(x.t)}">${esc(x.n)}</option>`).join("")}</datalist>
    </div>
    ${c ? `<div class="company-head" style="margin-bottom:14px"><div><h2 style="font-size:24px">${esc(c.name)}</h2>
        <div class="sub"><span class="ticker-chip">${esc(c.ticker)}</span>${c.sector ? `<span>· ${esc(sectorName(c.sector))}</span>` : ""}</div></div>
        <a class="btn btn-primary" href="#/c/${encodeURIComponent(c.ticker)}">${esc(t("ui.openAnalysis"))} ›</a></div>
        ${rawView(c, await analyzeWith(c), true)}`
      : `<div class="styles">${chips.map((x) => `<a class="tag" href="#/data/${encodeURIComponent(x.t)}">${esc(x.t)}</a>`).join("")}</div>
         ${ticker ? `<div class="glass empty" style="margin-top:14px">${esc(t("ui.notFound", { t: ticker }))}</div>` : ""}`}`;
  const pick = document.getElementById("data-pick");
  const go = () => { const v = pick.value.trim().toUpperCase(); if (v && idx.companies.some((x) => x.t === v)) location.hash = `#/data/${encodeURIComponent(v)}`; };
  pick.addEventListener("change", go);
  pick.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  if (c) wireRaw(app, c);
}

// ---------- Company page ----------

async function renderCompany(ticker) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const [c, idx] = await Promise.all([loadCompany(ticker), loadIndex().catch(() => null)]);
  if (!c) {
    app.innerHTML = `<a class="back" href="#/">‹ ${esc(t("ui.back"))}</a><div class="glass empty">${esc(t("ui.notFound", { t: ticker }))}</div>`;
    return;
  }
  const a = await analyzeWith(c);
  const history = a.ok ? scoreHistory(c, { benchmarks: await loadBenchmarks() }) : [];
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
          ${c.country ? `<span>· ${esc(c.country)}</span>` : ""}
          ${c.sector ? `<span>· ${esc(sectorName(c.sector))}</span>` : ""}
          ${c.industry ? `<span>· ${esc(c.industry)}</span>` : ""}
          ${a.ok ? `<span>· ${esc(t("ui.lastFy", { y: a.latestYear }))}</span>` : ""}
        </div>
      </div>
      <div class="head-actions">
        ${isNum(mk.price) ? `<div class="quote"><div class="px">${fmt(mk.price, "usd")}</div><div class="mc">${esc(t("ui.marketCap"))}: ${a.ok ? money(a.metrics.marketCap) : "–"}</div></div>` : ""}
        <button class="btn" id="watch">${starSvg(watched)}<span>${esc(t(watched ? "ui.removeWatch" : "ui.addWatch"))}</span></button>
        <a class="btn" href="#/compare/${encodeURIComponent(c.ticker)}">${esc(t("ui.compareWith"))}</a>
        <a class="btn" href="#/portfolio/${encodeURIComponent(c.ticker)}">${esc(t(getPortfolio().some((h) => h.t === c.ticker) ? "ui.inPortfolio" : "ui.addPortfolio"))}</a>
        ${a.ok ? `<a class="btn" href="#/report/${encodeURIComponent(c.ticker)}">${esc(t("ui.pdfReport"))}</a>` : ""}
      </div>
    </div>
    <div class="glass tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-tab="analysis">${esc(t("ui.tabAnalysis"))}</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="raw">${esc(t("ui.tabRaw"))}</button>
    </div>
    ${c.demo ? `<div class="notice"><span>ℹ️</span><span>${esc(t("ui.demoNotice"))}</span></div>` : ""}
    <div id="tab-analysis">${a.ok ? analysisView(c, a, idx, history) : `<div class="glass empty">${esc(t("ui.notEnough"))}</div>`}</div>
    <div id="tab-raw" class="hidden">${rawView(c, a)}</div>`;

  app.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    app.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.getElementById("tab-analysis").classList.toggle("hidden", b.dataset.tab !== "analysis");
    document.getElementById("tab-raw").classList.toggle("hidden", b.dataset.tab !== "raw");
  });
  document.getElementById("watch").addEventListener("click", (e) => {
    const on = toggleWatch(c.ticker, idx?.companies.find((x) => x.t === c.ticker));
    e.currentTarget.innerHTML = `${starSvg(on)}<span>${esc(t(on ? "ui.removeWatch" : "ui.addWatch"))}</span>`;
  });
  wireCharts(app);
  wirePeers(app);
  wireRaw(app, c);
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

function analysisView(c, a, idx, history = []) {
  const cur = c.currency || "USD";
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
          <td>${fmt(p.value, METRIC_FORMAT[p.key], cur)}${isNum(p.median) ? `<br><span class="median">${esc(t("ui.sectorMedian"))}: ${fmt(p.median, METRIC_FORMAT[p.key], cur)}</span>` : ""}</td>
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
        <p class="score-text">${esc(summaryText(d, a, cur))}</p>
        <details class="parts"><summary>${esc(t("ui.howCalculated"))}</summary>${detail}</details>
      </div>`;
  }).join("");

  const order = { critical: 0, warning: 1, positive: 2 };
  const tag = { critical: t("ui.critical"), warning: t("ui.warningTag"), positive: t("ui.strength") };
  const icon = { critical: "!", warning: "!", positive: "✓" };
  const flags = [...a.flags].sort((x, y) => order[x.level] - order[y.level]);
  const flagsHtml = flags.length ? `<div class="flags">${flags.map((f) => {
    const ft = flagText(f, cur);
    return `<div class="glass flag flag-${f.level}"><div class="flag-icon" aria-hidden="true">${icon[f.level]}</div>
      <div><div class="flag-title">${esc(ft.title)}<span class="flag-tag">${esc(tag[f.level])}</span></div><div class="flag-text">${esc(ft.text)}</div></div></div>`;
  }).join("")}</div>` : `<div class="glass empty">${esc(t("ui.noFlags"))}</div>`;

  const keyGrid = `<div class="keygrid">${KEY_METRICS.filter((k) => a.metrics[k] !== null && a.metrics[k] !== undefined).map((k) => `
    <div class="glass kv"><div class="k"><span class="info" title="${esc(metricDesc(k))}">${esc(metricLabel(k))}</span></div><div class="v">${fm(a.metrics, k, cur)}</div></div>`).join("")}</div>`;

  const s = a.series;
  const nfEmpty = t("ui.notEnough");
  const priceData = c.prices?.data || [];
  const charts = `<div class="charts">
    ${priceData.length ? lineChart(t("ui.chartPrice"), t("ui.chartPriceSub"), priceData, (v) => fmt(v, "usd"), nfEmpty) : ""}
    ${barChart(t("ui.chartRevenue"), t("ui.chartRevenueSub"), s.map((y) => [y.year, y.revenue]), (v) => money(v, cur), nfEmpty)}
    ${barChart(t("ui.chartNetIncome"), t("ui.chartNetIncomeSub"), s.map((y) => [y.year, y.netIncome]), (v) => money(v, cur), nfEmpty)}
    ${barChart(t("ui.chartFcf"), t("ui.chartFcfSub"), s.map((y) => [y.year, y.freeCashFlow]), (v) => money(v, cur), nfEmpty)}
    ${barChart(t("ui.chartMargin"), t("ui.chartMarginSub"), s.map((y) => [y.year, y.operatingMargin]), (v) => fmt(v, "pct"), nfEmpty)}
  </div>`;

  let basis = a.valuationBasis === "ttm" ? t("ui.ttmBasis", { d: date(c.ttm?.periodEnd) }) : t("ui.annualBasis");
  if (cur !== "USD") basis += ` · ${t("ui.fxNote", { cur, rate: isNum(c.market?.fxToUsd) ? num(c.market.fxToUsd, 4) : "–" })}`;
  return `
    ${summary}
    <h2 class="section-title">${esc(t("ui.sectionKey"))} <span class="small muted">${esc(basis)}</span></h2>
    ${keyGrid}
    <h2 class="section-title">${esc(t("ui.sectionScores"))}</h2>
    <div class="score-grid">${cards}</div>
    <h2 class="section-title">${esc(t("ui.peersTitle"))}</h2>
    ${peersView(c, idx)}
    <h2 class="section-title">TeraScore Trend <a class="small" href="#/trend">${esc(t("ui.trendAll"))} ›</a></h2>
    ${trendView(c, history, idx?.companies.find((x) => x.t === c.ticker))}
    <h2 class="section-title">${esc(t("ui.sectionFlags"))}</h2>
    ${flagsHtml}
    <h2 class="section-title">${esc(t("ui.sectionEvents"))}</h2>
    ${(c.events || []).length ? `<div class="events">${c.events.map((e) => eventCard(e, false)).join("")}</div>` : `<div class="glass empty small">${esc(c.events ? t("ui.eventsNone") : t("ui.notEnough"))}</div>`}
    <h2 class="section-title">${esc(t("ui.dividendTitle"))}</h2>
    ${dividendView(c, a)}
    <h2 class="section-title">${esc(t("ui.insiderTitle"))}</h2>
    ${insiderView(c)}
    <h2 class="section-title">${esc(t("ui.sectionCharts"))}</h2>
    ${charts}
    <p class="small muted" style="margin-top:22px">${esc(t("ui.engine", { v: ENGINE_VERSION }))}</p>`;
}

// ---------- Similar companies ----------

const PEER_COLS = [["overall", ""], ["profitability", "col-lg"], ["balanceSheet", "col-xl"], ["growthLong", "col-xl"], ["valuation", "col-md"], ["risk", ""]];
const median = (xs) => { const v = xs.filter(isNum).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

function peersView(c, idx) {
  const self = idx?.companies.find((x) => x.t === c.ticker);
  if (!self || !isNum(self.sc?.overall)) return `<div class="glass empty small">${esc(t("ui.peersNone"))}</div>`;
  const peers = findPeers(idx.companies, self, 5);
  if (!peers.length) return `<div class="glass empty small">${esc(t("ui.peersNone"))}</div>`;
  const rank = 1 + peers.filter((p) => p.sc.overall > self.sc.overall).length;
  const pe = (v) => (isNum(v) ? `${num(v, 1)}×` : "–");
  const row = (r, cls) => `<tr class="${cls}" ${r === self ? "" : `data-t="${esc(r.t)}"`}>
    <td><div class="tick">${esc(r.t)}</div><div class="cname">${esc(r.n)}</div></td>
    <td class="num col-md">${isNum(r.mc) ? money(r.mc) : "–"}</td>
    ${PEER_COLS.map(([k, cl]) => `<td class="num ${cl}">${scorePill(r.sc?.[k], k === "risk")}</td>`).join("")}
    <td class="num col-lg">${pe(r.pe)}</td><td class="num col-lg">${isNum(r.dy) ? fmt(r.dy, "pct") : "–"}</td></tr>`;
  const med = (get) => median(peers.map(get));
  const mRow = `<tr class="peer-median"><td>${esc(t("ui.peerMedian"))}</td>
    <td class="num col-md">${isNum(med((r) => r.mc)) ? money(med((r) => r.mc)) : "–"}</td>
    ${PEER_COLS.map(([k, cl]) => { const v = med((r) => r.sc?.[k]); return `<td class="num ${cl}">${scorePill(isNum(v) ? Math.round(v) : null, k === "risk")}</td>`; }).join("")}
    <td class="num col-lg">${pe(med((r) => r.pe))}</td><td class="num col-lg">${isNum(med((r) => r.dy)) ? fmt(med((r) => r.dy), "pct") : "–"}</td></tr>`;
  const all = [self, ...peers].map((r) => r.t);
  return `<p class="small muted" style="margin:-4px 0 12px">${esc(t("ui.peersSub", { s: sectorName(c.sector) }))} ${esc(t("ui.peersRank", { t: c.ticker, r: rank, n: all.length }))}</p>
    <div class="glass table-wrap"><table class="list peers">
      <thead><tr><th>${esc(t("ui.company"))}</th><th class="num col-md">${esc(t("ui.marketCap"))}</th>
        ${PEER_COLS.map(([k, cl]) => `<th class="num ${cl}">${esc(k === "overall" ? t("ui.overallScore") : t(`dims.${k}.name`))}</th>`).join("")}
        <th class="num col-lg">${esc(t("ui.pe"))}</th><th class="num col-lg">${esc(t("ui.dividendYieldShort"))}</th></tr></thead>
      <tbody>${row(self, "self")}${peers.map((r) => row(r, "")).join("")}${mRow}</tbody>
    </table></div>
    <div style="margin-top:12px"><a class="btn" href="#/compare/${all.map(encodeURIComponent).join(",")}">${esc(t("ui.peersCompare"))} ›</a></div>`;
}

function wirePeers(root) {
  root.querySelector("table.peers")?.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-t]"); if (tr) location.hash = `#/c/${tr.dataset.t}`; });
}

// ---------- Dividend safety ----------

const payout = (v) => (v === Infinity ? t("ui.payoutUncovered") : isNum(v) ? fmt(v, "pct0") : "–");

function dividendView(c, a) {
  const d = dividendProfile(c, a);
  if (!d.payer) return `<div class="glass empty small">${esc(t(d.reason === "noDividend" ? "ui.dividendNone" : "ui.notEnough"))}</div>`;
  const cur = c.currency || "USD";
  const tone = DIVIDEND_TONE[d.level];
  const full = d.paidYears >= (c.annual || []).length;
  const fact = (k, v) => `<div class="fact"><div class="k">${esc(t(k))}</div><div class="v">${v}</div></div>`;
  const parts = Object.entries(DIVIDEND_WEIGHTS).map(([k, w]) => `<tr><td>${esc(t(`dividend.parts.${k}`))}</td><td class="pts">${isNum(d.parts[k]) ? `${d.parts[k]} ${esc(t("ui.points"))}` : esc(t("ui.notScored"))} · ${Math.round(w * 100)}%</td></tr>`).join("");
  return `<div class="div-grid">
    <div class="glass pad">
      <div class="score-top"><div><div class="score-name">${esc(t("ui.dividendSafety"))}</div><div class="score-q">${esc(t(`dividend.${d.level}Text`))}</div></div>
        <div class="score-val">${isNum(d.score) ? d.score : "–"}<small>/100</small></div></div>
      <div class="bar tone-${tone}"><span style="width:${isNum(d.score) ? d.score : 0}%"></span></div>
      <div class="score-meta"><span class="pill tone-${tone}"><span class="dot"></span>${esc(t(`dividend.${d.level}`))}</span></div>
      <div class="facts" style="margin-top:14px">
        ${fact("ui.dividendYield", isNum(d.yield) ? fmt(d.yield, "pct") : "–")}
        ${fact("ui.dps", isNum(d.dps) ? `${num(d.dps, 2)} ${esc(cur)}` : "–")}
        ${fact("ui.dpsCagr", isNum(d.dpsCagr) ? fmt(d.dpsCagr, "pct") : "–")}
        ${fact("ui.yearsPaid", esc(t("ui.yearsN", { n: full ? `${d.paidYears}+` : d.paidYears })))}
        ${fact("ui.yearsRaised", esc(t("ui.yearsN", { n: d.growthYears })))}
        ${fact("ui.dividendCuts", String(d.cuts))}
        ${fact("ui.earningsPayout", `${payout(d.earningsPayout)} <span class="small muted">${esc(d.basis === "ttm" ? t("ui.ttm") : t("ui.lastFy", { y: a.latestYear }))}</span>`)}
        ${fact("ui.fcfPayout", `${payout(d.fcfPayout)} <span class="small muted">${esc(d.basis === "ttm" ? t("ui.ttm") : t("ui.lastFy", { y: a.latestYear }))}</span>`)}
      </div>
      <details class="parts"><summary>${esc(t("ui.howCalculated"))}</summary><table class="parts-table">${parts}</table>
        <p class="small muted">${esc(t("ui.dividendNote"))}</p></details>
    </div>
    ${barChart(t("ui.chartDps"), t("ui.chartDpsSub"), d.history.map((h) => [h.year, h.dps]), (v) => `${num(v, 2)} ${cur}`, t("ui.notEnough"))}
  </div>`;
}

// ---------- Insider transactions ----------

function insiderView(c) {
  const ins = c.insiders;
  // Foreign private issuers (20-F / 40-F filers) are exempt from Form 4 reporting.
  const foreign = c.foreignPrivateIssuer ?? ((c.currency && c.currency !== "USD") || (c.country && c.country !== "United States"));
  const traded = ins && !ins.none && (ins.buy?.count || ins.sell?.count);
  if (!traded && foreign) return `<div class="glass empty small">${esc(t("ui.insiderForeign"))}</div>`;
  if (!ins) return `<div class="glass empty small">${esc(t("ui.notEnough"))}</div>`;
  if (!traded) return `<div class="glass empty small">${esc(t("ui.insiderNone"))}</div>`;
  const side = (key, s, tone) => `<div class="fact"><div class="k">${esc(t(key))}</div><div class="v"><span class="pill tone-${tone}"><span class="dot"></span>${money(s.value)}</span>
    <span class="small muted">${esc(t("ui.insiderCount", { n: s.count, p: s.insiders }))}</span></div></div>`;
  const rows = (ins.recent || []).map((r) => `<tr>
    <td>${esc(date(r.date))}</td><td>${esc(r.name)}${r.title ? `<br><span class="small muted">${esc(r.title)}</span>` : ""}</td>
    <td><span class="pill tone-${r.code === "P" ? "good" : "serious"}"><span class="dot"></span>${esc(t(r.code === "P" ? "ui.insiderPurchase" : "ui.insiderSale"))}</span>${r.plan ? ` <span class="badge">${esc(t("ui.insiderPlanTag"))}</span>` : ""}</td>
    <td class="num">${num(r.shares, 0)}</td><td class="num">${fmt(r.price, "usd")}</td><td class="num">${money(r.value)}</td></tr>`).join("");
  return `<div class="glass pad">
    <div class="facts" style="margin-top:0">
      ${side("ui.insiderBuys", ins.buy, "good")}
      ${side("ui.insiderSells", ins.sell, "serious")}
      ${ins.plannedSellValue ? `<div class="fact"><div class="k">${esc(t("ui.insiderPlanned"))}</div><div class="v">${money(ins.plannedSellValue)}</div></div>` : ""}
    </div>
    <p class="small muted">${esc(t("ui.insiderPeriod", { from: date(ins.from), to: date(ins.to) }))}</p>
    ${rows ? `<div class="table-wrap"><table class="cmp insider"><thead><tr><th>${esc(t("ui.insiderDate"))}</th><th>${esc(t("ui.insiderName"))}</th><th>${esc(t("ui.insiderType"))}</th><th>${esc(t("ui.insiderShares"))}</th><th>${esc(t("ui.price"))}</th><th>${esc(t("ui.insiderValue"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
  </div>`;
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
function rawCell(v, k, cls = "", cur = "USD") {
  if (!isNum(v)) return `<td class="na ${cls}">–</td>`;
  if (k === "epsDiluted") return `<td class="${cls}">${num(v, 2)}</td>`;
  if (k === "sharesDiluted" || k === "sharesOutstanding") return `<td class="${cls}">${num(v / 1e6, 0)} M</td>`;
  return `<td class="${cls}">${money(v, cur)}</td>`;
}

const QUARTER_RATIOS = [["grossMargin", (q) => (isNum(q.grossProfit) ? q.grossProfit : isNum(q.costOfRevenue) && isNum(q.revenue) ? q.revenue - q.costOfRevenue : null)], ["operatingMargin", (q) => q.operatingIncome], ["netMargin", (q) => q.netIncome], ["fcfMargin", (q) => rawValue(q, "freeCashFlow")]];

function quarterTable(c) {
  const cur = c.currency || "USD";
  const qs = [...(c.quarterly || [])].sort((x, y) => (x.periodEnd < y.periodEnd ? -1 : 1));
  if (!qs.length) return `<div class="glass empty small">${esc(t(c.foreignPrivateIssuer ? "ui.quarterlyForeign" : "ui.quarterlyNone"))}</div>`;
  const n = qs.length + 1;
  const head = `<tr><th>${esc(t("ui.quarterEnd"))}</th>${qs.map((q) => `<th>${esc(date(q.periodEnd))}</th>`).join("")}</tr>`;
  let body = RAW_GROUPS.map(([g, keys]) => `<tr class="group"><td colspan="${n}"><span class="sticky-label">${esc(t(`raw.${g}`))}</span></td></tr>` +
    keys.map((k) => `<tr><td>${esc(t(`raw.${k}`))}</td>${qs.map((q) => rawCell(rawValue(q, k), k, "", cur)).join("")}</tr>`).join("")).join("");
  body += `<tr class="group"><td colspan="${n}"><span class="sticky-label">${esc(t("ui.computedRatios"))}</span></td></tr>` + QUARTER_RATIOS.map(([k, f]) =>
    `<tr><td>${esc(metricLabel(k))}</td>${qs.map((q) => { const v = isNum(f(q)) && isNum(q.revenue) && q.revenue > 0 ? f(q) / q.revenue : null; return isNum(v) ? `<td>${fmt(v, "pct")}</td>` : `<td class="na">–</td>`; }).join("")}</tr>`).join("");
  return `<p class="small muted" style="margin:0 0 10px">${esc(t("ui.quarterlyNote"))}</p>
    <div class="glass table-wrap"><table class="raw"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function rawView(c, a, onDataPage = false) {
  const cur = c.currency || "USD";
  const years = [...(c.annual || [])].sort((x, y) => x.year - y.year);
  if (!years.length) return `<div class="glass empty">${esc(t("ui.notEnough"))}</div>`;
  const ttm = c.ttm ? { ...c.ttm, ...(c.latestBalance || {}) } : null;
  const head = `<tr><th>${esc(t("ui.fiscalYear"))}</th>${years.map((y) => `<th>${y.year}${y.periodEnd ? `<br><span class="small">${esc(y.periodEnd)}</span>` : ""}</th>`).join("")}${ttm ? `<th class="ttm">${esc(t("ui.ttm"))}<br><span class="small">${esc(ttm.periodEnd)}</span></th>` : ""}</tr>`;
  const n = years.length + 1 + (ttm ? 1 : 0);
  let body = RAW_GROUPS.map(([g, keys]) => `<tr class="group"><td colspan="${n}"><span class="sticky-label">${esc(t(`raw.${g}`))}</span></td></tr>` +
    keys.map((k) => `<tr><td>${esc(t(`raw.${k}`))}</td>${years.map((y) => rawCell(rawValue(y, k), k, "", cur)).join("")}${ttm ? rawCell(rawValue(ttm, k), k, "ttm", cur) : ""}</tr>`).join("")).join("");
  if (a.ok) {
    const byYear = new Map(a.series.map((s) => [s.year, s]));
    body += `<tr class="group"><td colspan="${n}"><span class="sticky-label">${esc(t("ui.computedRatios"))}</span></td></tr>` + SERIES_ROWS.map((k) =>
      `<tr><td>${esc(metricLabel(k))}</td>${years.map((y) => { const v = byYear.get(y.year)?.[k]; return isNum(v) || v === Infinity ? `<td>${fmt(v, METRIC_FORMAT[k], cur)}</td>` : `<td class="na">–</td>`; }).join("")}${ttm ? `<td class="ttm na"></td>` : ""}</tr>`).join("");
  }
  const src = c.source ? `${esc(t("ui.source"))}: ${c.source.url ? `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)}</a>` : esc(c.source.name)}${c.source.retrieved ? ` · ${esc(t("ui.retrieved", { d: date(c.source.retrieved) }))}` : ""}` : "";
  return `
    <div class="raw-actions">
      <span class="small muted">${esc(t("ui.currencyNote", { cur }))} ${src}</span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        ${onDataPage ? "" : `<a class="btn" href="#/data/${encodeURIComponent(c.ticker)}">${esc(t("ui.navData"))}</a>`}
        <button class="btn" id="csv" type="button">${esc(t("ui.downloadCsv"))}</button>
        <a class="btn" href="data/companies/${encodeURIComponent(c.ticker)}.json" download>${esc(t("ui.downloadJson"))}</a>
      </span>
    </div>
    <div class="seg" role="group" aria-label="${esc(t("ui.period"))}">
      <button type="button" data-period="annual" aria-pressed="true">${esc(t("ui.periodAnnual"))}</button>
      <button type="button" data-period="quarterly" aria-pressed="false">${esc(t("ui.periodQuarterly"))}</button>
    </div>
    <div data-pane="annual"><div class="glass table-wrap"><table class="raw"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>
    <div data-pane="quarterly" class="hidden">${quarterTable(c)}</div>`;
}

function wireRaw(root, c) {
  let period = "annual";
  root.querySelectorAll(".seg [data-period]").forEach((b) => b.addEventListener("click", () => {
    period = b.dataset.period;
    root.querySelectorAll(".seg [data-period]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    root.querySelectorAll("[data-pane]").forEach((x) => x.classList.toggle("hidden", x.dataset.pane !== period));
    showLatest();
  }));
  // The newest periods are on the right: start scrolled there when the table is wider than the screen.
  const showLatest = () => root.querySelectorAll("[data-pane]:not(.hidden) .table-wrap").forEach((w) => { w.scrollLeft = w.scrollWidth; });
  root.querySelectorAll(".tabs .tab").forEach((b) => b.addEventListener("click", () => requestAnimationFrame(showLatest)));
  requestAnimationFrame(showLatest);
  root.querySelector("#csv")?.addEventListener("click", () => downloadCsv(c, period));
}

function downloadCsv(c, period = "annual") {
  const keys = RAW_GROUPS.flatMap(([, k]) => k);
  if (period === "quarterly") {
    const qs = [...(c.quarterly || [])].sort((x, y) => (x.periodEnd < y.periodEnd ? -1 : 1));
    const rows = [["field", ...qs.map((q) => q.periodEnd)].join(";"), ...keys.map((k) => [k, ...qs.map((q) => (isNum(rawValue(q, k)) ? rawValue(q, k) : ""))].join(";"))];
    return saveFile(rows.join("\n"), `${c.ticker}_quarterly.csv`);
  }
  const years = [...c.annual].sort((x, y) => x.year - y.year);
  const ttm = c.ttm ? { ...c.ttm, ...(c.latestBalance || {}) } : null;
  const lines = [["field", ...years.map((y) => y.year), ...(ttm ? ["TTM"] : [])].join(";")];
  for (const k of keys) lines.push([k, ...years.map((y) => (isNum(rawValue(y, k)) ? rawValue(y, k) : "")), ...(ttm ? [isNum(rawValue(ttm, k)) ? rawValue(ttm, k) : ""] : [])].join(";"));
  saveFile(lines.join("\n"), `${c.ticker}_financials.csv`);
}

function saveFile(text, name) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Compare ----------

const MAX_COMPARE = 6;

const CMP_METRICS = ["marketCap", "peRatio", "evToEbit", "fcfYield", "dividendYield", "grossMargin", "operatingMargin", "roic", "fcfMargin", "netDebtToEbitda", "currentRatio", "revenueYoY", "revenueCagr", "epsCagr", "shareChangeYearly", "volatility", "maxDrawdown"];
const LOWER_BETTER = new Set(["peRatio", "evToEbit", "netDebtToEbitda", "volatility", "shareChangeYearly"]);

async function renderCompare(tickers) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const comps = (await Promise.all(tickers.map(loadCompany))).filter(Boolean);
  const as = await Promise.all(comps.map(analyzeWith));
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
      return row(`<span class="info" title="${esc(metricDesc(k))}">${esc(metricLabel(k))}</span>`, vals, vals.map((v, i) => fmt(v, METRIC_FORMAT[k], k === "marketCap" ? "USD" : comps[i].currency || "USD")), LOWER_BETTER.has(k));
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
      ${comps.length < MAX_COMPARE ? `<input id="cmp-add" list="cmp-list" placeholder="${esc(t("ui.addCompany"))}" autocomplete="off">
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

// ---------- Portfolio ----------

const PW_TEXT = {
  position: (w) => t("pw.position", { t: w.t, w: fmt(w.weight, "pct0"), l: fmt(PORTFOLIO_LIMITS.position, "pct0") }),
  sector: (w) => t("pw.sector", { s: sectorName(w.s), w: fmt(w.weight, "pct0"), l: fmt(PORTFOLIO_LIMITS.sector, "pct0") }),
  few: (w) => t("pw.few", { n: w.n, m: PORTFOLIO_LIMITS.minHoldings }),
  critical: (w) => t("pw.critical", { list: w.list.join(", ") }),
  distress: (w) => t("pw.distress", { list: w.list.join(", ") }),
  weak: (w) => t("pw.weak", { list: w.list.join(", "), s: PORTFOLIO_LIMITS.lowScore }),
  unscored: (w) => t("pw.unscored", { list: w.list.join(", ") }),
};

async function renderPortfolio(prefill = "") {
  document.title = `${t("ui.navPortfolio")} | TeraStockX`;
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const rows = new Map(idx.companies.map((c) => [c.t, c]));
  const list = getPortfolio();
  const p = portfolioSummary(list.map((h) => ({ ...h, row: rows.get(h.t) })));
  const stat = (k, v, sub = "") => `<div class="hero-stat"><div class="v">${v}</div><div class="k">${esc(t(k))}${sub ? ` <span class="muted">${sub}</span>` : ""}</div></div>`;
  const tone = { critical: "critical", warning: "warning", info: "none" };

  const summary = list.length ? `
    <div class="glass pad pf-summary">
      <div class="hero-stats">
        ${stat("ui.pfValue", p.total ? money(p.total) : "–")}
        ${stat("ui.pfScore", scorePill(p.score))}
        ${stat("ui.risk", scorePill(p.risk, true))}
        ${stat("ui.pfIncome", p.income ? money(p.income) : "–", isNum(p.yield) && p.yield > 0 ? `(${fmt(p.yield, "pct")})` : "")}
        ${stat("ui.pfPe", isNum(p.pe) ? `${num(p.pe, 1)}×` : "–")}
        ${stat("ui.pfHoldings", String(list.length))}
      </div>
    </div>
    <div class="pf-grid">
      <div class="glass pad">
        <div class="score-name" style="margin-bottom:12px">${esc(t("ui.pfSectors"))}</div>
        ${p.sectors.map((x) => `<div class="pf-bar"><span>${esc(x.s === "other" ? t("ui.pfOther") : sectorName(x.s))}</span><span class="num">${fmt(x.weight, "pct")}</span>
          <div class="bar"><span style="width:${Math.round(x.weight * 100)}%"></span></div></div>`).join("") || `<p class="small muted">${esc(t("ui.notEnough"))}</p>`}
      </div>
      <div class="glass pad">
        <div class="score-name" style="margin-bottom:12px">${esc(t("ui.pfChecks"))}</div>
        ${p.warnings.length ? `<ul class="pf-warn">${p.warnings.map((w) => `<li><span class="pill tone-${tone[w.level]}"><span class="dot"></span>${esc(t(w.level === "critical" ? "ui.critical" : w.level === "warning" ? "ui.warningTag" : "ui.pfInfo"))}</span> ${esc(PW_TEXT[w.id](w))}</li>`).join("")}</ul>`
          : `<p class="small"><span class="pill tone-good"><span class="dot"></span>${esc(t("ui.pfOk"))}</span></p>`}
      </div>
    </div>
    <div class="glass table-wrap"><table class="list pf-table">
      <thead><tr><th>${esc(t("ui.company"))}</th><th class="num">${esc(t("ui.pfShares"))}</th><th class="num col-md">${esc(t("ui.pfPrice"))}</th><th class="num">${esc(t("ui.pfValueCol"))}</th>
        <th class="num col-md">${esc(t("ui.pfWeight"))}</th><th class="num">${esc(t("ui.overallScore"))}</th><th class="num col-lg">${esc(t("ui.risk"))}</th>
        <th class="num col-lg">${esc(t("ui.dividendYieldShort"))}</th><th class="num col-xl">${esc(t("ui.dividendSafety"))}</th><th></th></tr></thead>
      <tbody>${p.positions.map((h) => `<tr>
        <td><a href="#/c/${encodeURIComponent(h.t)}"><div class="tick">${esc(h.t)}</div><div class="cname">${esc(h.row?.n || t("ui.notFound", { t: h.t }))}</div></a></td>
        <td class="num"><input class="pf-shares" type="number" min="0" step="any" inputmode="decimal" value="${esc(h.shares)}" data-t="${esc(h.t)}" aria-label="${esc(t("ui.pfShares"))} ${esc(h.t)}"></td>
        <td class="num col-md">${isNum(h.price) ? fmt(h.price, "usd") : "–"}</td>
        <td class="num">${isNum(h.value) ? money(h.value) : "–"}</td>
        <td class="num col-md">${isNum(h.weight) ? fmt(h.weight, "pct") : "–"}</td>
        <td class="num">${scorePill(h.row?.sc?.overall)}</td>
        <td class="num col-lg">${scorePill(h.row?.sc?.risk, true)}</td>
        <td class="num col-lg">${isNum(h.row?.dy) ? fmt(h.row.dy, "pct") : "–"}</td>
        <td class="num col-xl">${isNum(h.row?.ds) ? `<span class="pill tone-${DIVIDEND_TONE[dividendLevelOf(h.row.ds)]}"><span class="dot"></span>${h.row.ds}</span>` : "–"}</td>
        <td><button class="icon-btn" data-rm="${esc(h.t)}" aria-label="${esc(t("ui.remove"))} ${esc(h.t)}">×</button></td></tr>`).join("")}</tbody>
    </table></div>
    <p class="small muted" style="margin-top:12px">${esc(t("ui.pfNote", { d: date(idx.generated) }))}</p>` : `<div class="glass empty">${esc(t("ui.pfEmpty"))}</div>`;

  app.innerHTML = `
    <div class="prose" style="max-width:none;margin-top:8px"><h1>${esc(t("ui.navPortfolio"))}</h1><p style="max-width:820px">${esc(t("ui.pfIntro"))}</p></div>
    <form class="glass pad pf-add" id="pf-add">
      <input id="pf-t" list="pf-list" placeholder="${esc(t("ui.addCompany"))}" autocomplete="off" value="${esc(prefill)}" aria-label="${esc(t("ui.company"))}">
      <datalist id="pf-list">${idx.companies.filter((c) => isNum(c.px)).map((c) => `<option value="${esc(c.t)}">${esc(c.n)}</option>`).join("")}</datalist>
      <input id="pf-n" type="number" min="0" step="any" inputmode="decimal" placeholder="${esc(t("ui.pfShares"))}" aria-label="${esc(t("ui.pfShares"))}">
      <button class="btn btn-primary" type="submit">${esc(t("ui.pfAdd"))}</button>
      ${getWatch().length ? `<button class="btn" type="button" id="pf-watch">${esc(t("ui.pfFromWatch"))}</button>` : ""}
      <span class="small muted" id="pf-msg"></span>
    </form>
    ${summary}`;

  if (prefill) document.getElementById("pf-n").focus();
  const save = (next) => { setPortfolio(next); renderPortfolio(); };
  document.getElementById("pf-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const tk = document.getElementById("pf-t").value.trim().toUpperCase();
    const n = Number(document.getElementById("pf-n").value);
    if (!rows.has(tk)) { document.getElementById("pf-msg").textContent = t("ui.notFound", { t: tk }); return; }
    if (!(n > 0)) { document.getElementById("pf-msg").textContent = t("ui.pfNeedShares"); return; }
    const cur = getPortfolio();
    const ex = cur.find((h) => h.t === tk);
    if (ex) ex.shares = +(ex.shares + n).toFixed(6); else cur.push({ t: tk, shares: n });
    if (location.hash !== "#/portfolio") history.replaceState(null, "", "#/portfolio");
    save(cur);
  });
  document.getElementById("pf-watch")?.addEventListener("click", () => {
    const cur = getPortfolio();
    for (const tk of getWatch()) if (rows.has(tk) && !cur.some((h) => h.t === tk)) cur.push({ t: tk, shares: 1 });
    save(cur);
  });
  app.querySelectorAll(".pf-shares").forEach((inp) => inp.addEventListener("change", () => {
    const n = Number(inp.value);
    save(getPortfolio().map((h) => (h.t === inp.dataset.t ? { ...h, shares: n > 0 ? n : h.shares } : h)));
  }));
  app.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => save(getPortfolio().filter((h) => h.t !== b.dataset.rm))));
}

const dividendLevelOf = (score) => (score >= 75 ? "safe" : score >= 55 ? "moderate" : score >= 35 ? "risky" : "unsafe");

// ---------- Printable report ----------

const REPORT_ROWS = [["revenue", "money"], ["operatingIncome", "money"], ["netIncome", "money"], ["eps", "eps"], ["freeCashFlow", "money"], ["operatingMargin", "pct"], ["roic", "pct"], ["netDebtToEbitda", "xyears"]];

async function renderReport(ticker) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const [c, idx] = await Promise.all([loadCompany(ticker), loadIndex().catch(() => null)]);
  if (!c) { app.innerHTML = `<div class="glass empty">${esc(t("ui.notFound", { t: ticker }))}</div>`; return; }
  const a = await analyzeWith(c);
  if (!a.ok) { app.innerHTML = `<div class="glass empty">${esc(t("ui.notEnough"))}</div>`; return; }
  document.title = `${c.ticker} – ${t("ui.reportTitle")} | TeraStockX`;
  const cur = c.currency || "USD";
  const d = dividendProfile(c, a);
  const self = idx?.companies.find((x) => x.t === c.ticker);
  const peers = self ? findPeers(idx.companies, self, 5) : [];
  const g = (s, inv) => grade(s, inv);
  const bar = (s, inv) => `<div class="rbar"><span class="tone-${g(s, inv).tone}" style="width:${isNum(s) ? s : 0}%"></span></div>`;
  const years = a.series.slice(-5);
  const flags = [...a.flags].sort((x, y) => ({ critical: 0, warning: 1, positive: 2 }[x.level] - { critical: 0, warning: 1, positive: 2 }[y.level]));
  const tag = { critical: t("ui.critical"), warning: t("ui.warningTag"), positive: t("ui.strength") };
  const cell = (v, kind) => (kind === "money" ? (isNum(v) ? money(v, cur) : "–") : kind === "eps" ? (isNum(v) ? num(v, 2) : "–") : isNum(v) || v === Infinity ? fmt(v, kind) : "–");

  app.innerHTML = `
    <div class="report-bar no-print">
      <a class="back" href="#/c/${encodeURIComponent(c.ticker)}">‹ ${esc(t("ui.back"))}</a>
      <button class="btn btn-primary" id="print" type="button">${esc(t("ui.printPdf"))}</button>
      <span class="small muted">${esc(t("ui.printHint"))}</span>
    </div>
    <article class="report">
      <header class="report-head">
        <div class="report-brand"><img src="assets/img/logo.svg" alt="" width="26" height="26"><span>TeraStock<b>X</b></span></div>
        <div class="small">${esc(t("ui.reportTitle"))} · ${esc(date(new Date().toISOString()))}</div>
      </header>
      <h1>${esc(c.name)} <span class="report-tk">${esc(c.ticker)}</span></h1>
      <p class="report-sub">${[c.exchange, c.country, c.sector ? sectorName(c.sector) : null, c.industry, t("ui.lastFy", { y: a.latestYear })].filter(Boolean).map(esc).join(" · ")}
        ${isNum(c.market?.price) ? `<br>${esc(t("ui.pfPrice"))}: ${fmt(c.market.price, "usd")} · ${esc(t("ui.marketCap"))}: ${money(a.metrics.marketCap)}` : ""}</p>

      <section class="report-summary">
        <div class="report-score"><div class="big">${a.scores.overall ?? "–"}<small>/100</small></div><div>TeraScore · ${esc(g(a.scores.overall).label)}</div></div>
        <table class="report-table compact"><tbody>
          <tr><td>${esc(t("ui.risk"))}</td><td>${a.scores.risk ?? "–"} · ${esc(g(a.scores.risk, true).label)}</td></tr>
          <tr><td>${esc(t("ui.distress"))}</td><td>${esc(t(`distress.${a.distress.level}`))}</td></tr>
          <tr><td>${esc(t("ui.trend"))}</td><td>${esc(t(`outlook.${a.outlook.level}`))}</td></tr>
          <tr><td>${esc(t("ui.dividendSafety"))}</td><td>${d.payer ? `${d.score ?? "–"} · ${esc(t(`dividend.${d.level}`))}` : esc(t("ui.dividendNoneShort"))}</td></tr>
          ${a.styles.length ? `<tr><td>${esc(t("ui.profile"))}</td><td>${a.styles.map((x) => esc(t(`styles.${x}`))).join(", ")}</td></tr>` : ""}
        </tbody></table>
      </section>
      <p>${esc(t(`verdict.${gradeKey(a.scores.overall)}`))}</p>

      <section><h2>${esc(t("ui.sectionScores"))}</h2>
        <table class="report-table"><tbody>${DIMENSIONS.map((k) => `<tr><td>${esc(t(`dims.${k}.name`))}</td><td class="n">${a.scores[k] ?? "–"}</td><td class="w">${bar(a.scores[k], k === "risk")}</td><td>${esc(g(a.scores[k], k === "risk").label)}</td></tr>`).join("")}</tbody></table>
      </section>

      <section><h2>${esc(t("ui.sectionKey"))}</h2>
        <table class="report-table two"><tbody>${KEY_METRICS.filter((k) => a.metrics[k] !== null && a.metrics[k] !== undefined).map((k) => `<tr><td>${esc(metricLabel(k))}</td><td class="n">${fm(a.metrics, k, cur)}</td></tr>`).join("")}</tbody></table>
      </section>

      <section><h2>${esc(t("ui.reportFinancials"))} <span class="small">(${esc(cur)})</span></h2>
        <table class="report-table"><thead><tr><th></th>${years.map((y) => `<th class="n">${y.year}</th>`).join("")}</tr></thead>
          <tbody>${REPORT_ROWS.map(([k, kind]) => `<tr><td>${esc(k === "eps" ? t("raw.epsDiluted") : k in (dict().raw || {}) ? t(`raw.${k}`) : metricLabel(k))}</td>${years.map((y) => `<td class="n">${cell(y[k], kind)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </section>

      ${peers.length ? `<section><h2>${esc(t("ui.peersTitle"))}</h2>
        <table class="report-table"><thead><tr><th>${esc(t("ui.company"))}</th><th class="n">${esc(t("ui.marketCap"))}</th><th class="n">TeraScore</th><th class="n">${esc(t("ui.risk"))}</th><th class="n">${esc(t("ui.pe"))}</th><th class="n">${esc(t("ui.dividendYieldShort"))}</th></tr></thead>
          <tbody>${[self, ...peers].map((r) => `<tr class="${r === self ? "self" : ""}"><td><b>${esc(r.t)}</b> ${esc(r.n)}</td><td class="n">${isNum(r.mc) ? money(r.mc) : "–"}</td><td class="n">${r.sc?.overall ?? "–"}</td><td class="n">${r.sc?.risk ?? "–"}</td><td class="n">${isNum(r.pe) ? `${num(r.pe, 1)}×` : "–"}</td><td class="n">${isNum(r.dy) ? fmt(r.dy, "pct") : "–"}</td></tr>`).join("")}</tbody></table>
      </section>` : ""}

      ${d.payer ? `<section><h2>${esc(t("ui.dividendTitle"))}</h2>
        <table class="report-table two"><tbody>
          <tr><td>${esc(t("ui.dividendSafety"))}</td><td class="n">${d.score ?? "–"} · ${esc(t(`dividend.${d.level}`))}</td></tr>
          <tr><td>${esc(t("ui.dividendYield"))}</td><td class="n">${isNum(d.yield) ? fmt(d.yield, "pct") : "–"}</td></tr>
          <tr><td>${esc(t("ui.dpsCagr"))}</td><td class="n">${isNum(d.dpsCagr) ? fmt(d.dpsCagr, "pct") : "–"}</td></tr>
          <tr><td>${esc(t("ui.yearsRaised"))}</td><td class="n">${esc(t("ui.yearsN", { n: d.growthYears }))}</td></tr>
          <tr><td>${esc(t("ui.earningsPayout"))}${d.basis === "ttm" ? ` (${esc(t("ui.ttm"))})` : ""}</td><td class="n">${payout(d.earningsPayout)}</td></tr>
          <tr><td>${esc(t("ui.fcfPayout"))}${d.basis === "ttm" ? ` (${esc(t("ui.ttm"))})` : ""}</td><td class="n">${payout(d.fcfPayout)}</td></tr>
        </tbody></table></section>` : ""}

      <section><h2>${esc(t("ui.sectionFlags"))}</h2>
        ${flags.length ? `<ul class="report-flags">${flags.map((f) => { const ft = flagText(f, cur); return `<li class="lv-${f.level}"><b>${esc(ft.title)}</b> <span class="small">(${esc(tag[f.level])})</span> – ${esc(ft.text)}</li>`; }).join("")}</ul>` : `<p>${esc(t("ui.noFlags"))}</p>`}
      </section>

      <footer class="report-foot">${esc(t("ui.footer"))}<br>${esc(t("ui.engine", { v: ENGINE_VERSION }))}${c.source?.retrieved ? ` · ${esc(t("ui.retrieved", { d: date(c.source.retrieved) }))}` : ""} · m1ksaaa.github.io/Banana</footer>
    </article>`;
  document.getElementById("print").addEventListener("click", () => window.print());
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
    <h2>TeraScore Trend</h2><p>${esc(t("method.historyText"))}</p>
    <h2>${esc(t("method.relativeTitle"))}</h2><p>${esc(t("method.relativeText"))}</p>
    <h2>${esc(t("method.eventsTitle"))}</h2><p>${esc(t("method.eventsText"))}</p>
    <h2>${esc(t("ui.insiderTitle"))}</h2><p>${esc(t("method.insiderText"))}</p>
    <h2>${esc(t("ui.peersTitle"))}</h2><p>${esc(t("method.peersText"))}</p>
    <h2>${esc(t("ui.dividendSafety"))}</h2><p>${esc(t("method.dividendText"))}</p>
    <div class="glass method-card"><table class="method-table"><tbody>${Object.entries(DIVIDEND_WEIGHTS).map(([k, w]) => `<tr><td><b>${esc(t(`dividend.parts.${k}`))}</b><br><span class="small">${esc(t(`dividend.partsText.${k}`))}</span></td><td class="n">${Math.round(w * 100)}%</td></tr>`).join("")}</tbody></table></div>
    <h2>${esc(t("ui.navPortfolio"))}</h2><p>${esc(t("method.portfolioText", { p: fmt(PORTFOLIO_LIMITS.position, "pct0"), s: fmt(PORTFOLIO_LIMITS.sector, "pct0"), n: PORTFOLIO_LIMITS.minHoldings }))}</p>
    <h2>${esc(t("ui.periodQuarterly"))}</h2><p>${esc(t("method.quarterlyText"))}</p>
    <h2>${esc(t("method.currencyTitle"))}</h2><p>${esc(t("method.currencyText"))}</p>
    <h2>${esc(t("method.sectorTitle"))}</h2><p>${esc(t("method.sectorText"))}</p>
    <h2>${esc(t("method.limitsTitle"))}</h2><p>${esc(t("method.limitsText"))}</p>
  </div>`;
}

renderChrome();
route();
