// TeraStockX analysis engine (language-agnostic).
// Input: one company in the TeraStockX data template (docs/SABLON.md).
// Output: 0–100 scores per dimension, the metrics behind them, flags and classifications.
// All human-readable text lives in assets/js/i18n/*; this module only returns keys and numbers.
// The same file runs in the browser and in the Node data updater.

export const ENGINE_VERSION = "2.0.0";

// ---------- Helpers ----------

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

// Linear scale to 0–100. If bad > good the scale is inverted (lower is better).
export function scale(x, bad, good) {
  if (!isNum(x)) return null;
  const t = (x - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const avg2 = (a, b) => (isNum(a) && isNum(b) ? (a + b) / 2 : isNum(a) ? a : null);

// Year-over-year growth; undefined for a non-positive base.
function growth(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null;
  return cur / prev - 1;
}

function cagr(first, last, years) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years < 1) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function stdev(xs) {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

const ratio = (xs, pred) => {
  const v = xs.filter(isNum);
  return v.length ? v.filter(pred).length / v.length : null;
};

// Weighted mean of part scores; missing parts are skipped and weights renormalised.
function weighted(parts) {
  let sum = 0, w = 0;
  for (const p of parts) if (isNum(p.score)) { sum += p.score * p.weight; w += p.weight; }
  return w > 0 ? Math.round(sum / w) : null;
}

// ---------- Per-period derived figures ----------

export function freeCashFlow(y) {
  if (isNum(y.freeCashFlow)) return y.freeCashFlow;
  if (isNum(y.operatingCashFlow) && isNum(y.capex)) return y.operatingCashFlow - Math.abs(y.capex);
  return null;
}

const grossProfit = (y) => (isNum(y.grossProfit) ? y.grossProfit : isNum(y.revenue) && isNum(y.costOfRevenue) ? y.revenue - y.costOfRevenue : null);
const totalLiabilities = (y) => (isNum(y.totalLiabilities) ? y.totalLiabilities : isNum(y.totalAssets) && isNum(y.equity) ? y.totalAssets - y.equity : null);
const eps = (y) => (isNum(y.epsDiluted) ? y.epsDiluted : div(y.netIncome, y.sharesDiluted));
const ebitda = (y) => (isNum(y.operatingIncome) && isNum(y.depreciationAndAmortization) ? y.operatingIncome + y.depreciationAndAmortization : null);

function taxRate(y) {
  const r = div(y.incomeTaxExpense, y.pretaxIncome);
  if (isNum(y.pretaxIncome) && y.pretaxIncome > 0 && isNum(r)) return Math.max(0, Math.min(0.5, r));
  return 0.21; // US statutory rate as a fallback
}

export function yearMetrics(y, prev) {
  const fcf = freeCashFlow(y);
  const debt = isNum(y.totalDebt) ? y.totalDebt : null;
  const gp = grossProfit(y);
  const e = ebitda(y);
  const avgEquity = avg2(y.equity, prev?.equity);
  const avgAssets = avg2(y.totalAssets, prev?.totalAssets);
  const netDebt = isNum(debt) && isNum(y.cash) ? debt - y.cash : null;
  const ic = (yy) => (isNum(yy?.equity) && isNum(yy?.cash) ? yy.equity + (isNum(yy.totalDebt) ? yy.totalDebt : 0) - yy.cash : null);
  const investedCapital = avg2(ic(y), ic(prev));
  const nopat = isNum(y.operatingIncome) ? y.operatingIncome * (1 - taxRate(y)) : null;
  // One consistent share basis across years: diluted weighted shares, else net income / diluted EPS.
  // (Balance-sheet share counts are skipped: multi-class companies often report a single class there.)
  const impliedShares = isNum(y.netIncome) && isNum(y.epsDiluted) && y.epsDiluted !== 0 && Math.sign(y.netIncome) === Math.sign(y.epsDiluted) ? y.netIncome / y.epsDiluted : null;
  const shares = isNum(y.sharesDiluted) && y.sharesDiluted > 0 ? y.sharesDiluted : impliedShares;
  return {
    year: y.year,
    revenue: y.revenue ?? null,
    operatingIncome: y.operatingIncome ?? null,
    netIncome: y.netIncome ?? null,
    eps: eps(y),
    freeCashFlow: fcf,
    ebitda: e,
    grossMargin: div(gp, y.revenue),
    operatingMargin: div(y.operatingIncome, y.revenue),
    netMargin: div(y.netIncome, y.revenue),
    fcfMargin: div(fcf, y.revenue),
    roe: isNum(avgEquity) && avgEquity > 0 ? div(y.netIncome, avgEquity) : null,
    roa: div(y.netIncome, avgAssets),
    roic: isNum(investedCapital) && investedCapital > 0 ? div(nopat, investedCapital) : null,
    fcfConversion: isNum(y.netIncome) && y.netIncome > 0 ? div(fcf, y.netIncome) : null,
    accrualRatio: isNum(y.netIncome) && isNum(y.operatingCashFlow) ? div(y.netIncome - y.operatingCashFlow, avgAssets) : null,
    sbcToRevenue: div(y.shareBasedCompensation, y.revenue),
    capexToRevenue: isNum(y.capex) ? div(Math.abs(y.capex), y.revenue) : null,
    currentRatio: div(y.currentAssets, y.currentLiabilities),
    quickRatio: isNum(y.currentAssets) ? div(y.currentAssets - (isNum(y.inventory) ? y.inventory : 0), y.currentLiabilities) : null,
    cashRatio: div(y.cash, y.currentLiabilities),
    debtToEquity: isNum(y.equity) && y.equity > 0 ? div(debt, y.equity) : null,
    equityRatio: div(y.equity, y.totalAssets),
    liabilitiesToAssets: div(totalLiabilities(y), y.totalAssets),
    netDebt,
    netDebtToEbitda: isNum(netDebt) ? (netDebt <= 0 ? 0 : isNum(e) && e > 0 ? netDebt / e : isNum(e) ? Infinity : null) : null,
    interestCoverage: isNum(y.interestExpense) && y.interestExpense > 0 ? div(y.operatingIncome, y.interestExpense) : null,
    goodwillToAssets: isNum(y.goodwill) || isNum(y.intangibleAssets) ? div((y.goodwill ?? 0) + (y.intangibleAssets ?? 0), y.totalAssets) : null,
    assetTurnover: div(y.revenue, avgAssets),
    debtToAssets: div(debt, y.totalAssets),
    payoutRatio: isNum(y.dividendsPaid) && y.dividendsPaid !== 0 ? (isNum(fcf) && fcf > 0 ? Math.abs(y.dividendsPaid) / fcf : Infinity) : isNum(y.dividendsPaid) ? 0 : null,
    bookValuePerShare: isNum(y.equity) && isNum(shares) && shares > 0 ? y.equity / shares : null,
    shares,
  };
}

// Altman Z'' (non-manufacturer / emerging-market variant; needs no market price).
// Zones: > 2.6 safe, 1.1–2.6 grey, < 1.1 distress.
export function altmanZ(y) {
  const liab = totalLiabilities(y);
  const ta = y.totalAssets;
  if (![y.currentAssets, y.currentLiabilities, y.retainedEarnings, y.operatingIncome, y.equity, liab, ta].every(isNum) || ta <= 0 || liab <= 0) return null;
  return 6.56 * ((y.currentAssets - y.currentLiabilities) / ta) + 3.26 * (y.retainedEarnings / ta) + 6.72 * (y.operatingIncome / ta) + 1.05 * (y.equity / liab);
}

// Piotroski F-score (0–9).
export function piotroski(cur, prev) {
  if (!cur || !prev) return null;
  const c = yearMetrics(cur, prev), p = yearMetrics(prev, null);
  const ocf = cur.operatingCashFlow;
  const tests = [
    isNum(c.roa) ? c.roa > 0 : null,
    isNum(ocf) ? ocf > 0 : null,
    isNum(c.roa) && isNum(p.roa) ? c.roa > p.roa : null,
    isNum(ocf) && isNum(cur.netIncome) ? ocf > cur.netIncome : null,
    isNum(c.debtToAssets) && isNum(p.debtToAssets) ? c.debtToAssets <= p.debtToAssets : null,
    isNum(c.currentRatio) && isNum(p.currentRatio) ? c.currentRatio > p.currentRatio : null,
    isNum(c.shares) && isNum(p.shares) ? c.shares <= p.shares * 1.005 : null,
    isNum(c.grossMargin) && isNum(p.grossMargin) ? c.grossMargin > p.grossMargin : null,
    isNum(c.assetTurnover) && isNum(p.assetTurnover) ? c.assetTurnover > p.assetTurnover : null,
  ];
  const known = tests.filter((t) => t !== null);
  if (known.length < 6) return null;
  return Math.round((known.filter(Boolean).length / known.length) * 9);
}

// ---------- Market data (monthly closes) ----------

export function marketStats(prices) {
  const data = prices?.data;
  if (!Array.isArray(data) || data.length < 13) return {};
  const closes = data.map((d) => d[1]).filter(isNum);
  const n = closes.length;
  const last = closes[n - 1];
  const rets = [];
  for (let i = Math.max(1, n - 36); i < n; i++) if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  let peak = -Infinity, mdd = 0;
  for (const c of closes.slice(-61)) { peak = Math.max(peak, c); if (peak > 0) mdd = Math.min(mdd, c / peak - 1); }
  return {
    priceReturn1y: closes[n - 13] > 0 ? last / closes[n - 13] - 1 : null,
    priceCagr5y: n >= 61 ? cagr(closes[n - 61], last, 5) : null,
    volatility: rets.length >= 12 ? stdev(rets) * Math.sqrt(12) : null,
    maxDrawdown: mdd,
  };
}

// ---------- Dimension definitions (single source of truth for scoring and the methodology page) ----------

// Each part: metric key, weight, value scoring 0 points (bad) and 100 points (good).
const GENERAL = {
  profitability: [
    { key: "grossMargin", weight: 0.15, bad: 0.10, good: 0.60 },
    { key: "operatingMargin", weight: 0.25, bad: 0, good: 0.30 },
    { key: "netMargin", weight: 0.15, bad: -0.05, good: 0.20 },
    { key: "roic", weight: 0.20, bad: 0, good: 0.20 },
    { key: "roe", weight: 0.15, bad: 0, good: 0.25 },
    { key: "roa", weight: 0.10, bad: 0, good: 0.15 },
  ],
  cashFlow: [
    { key: "fcfMargin", weight: 0.35, bad: -0.05, good: 0.20 },
    { key: "fcfConversion", weight: 0.25, bad: 0.3, good: 1.1 },
    { key: "accrualRatio", weight: 0.20, bad: 0.10, good: -0.05 },
    { key: "sbcToRevenue", weight: 0.20, bad: 0.15, good: 0.01 },
  ],
  balanceSheet: [
    { key: "debtToEquity", weight: 0.20, bad: 2.5, good: 0.3 },
    { key: "netDebtToEbitda", weight: 0.25, bad: 4, good: 0 },
    { key: "interestCoverage", weight: 0.20, bad: 1.5, good: 15 },
    { key: "altmanZ", weight: 0.20, bad: 1.1, good: 4.0 },
    { key: "equityRatio", weight: 0.15, bad: 0.10, good: 0.60 },
  ],
  liquidity: [
    { key: "currentRatio", weight: 0.40, bad: 0.6, good: 2.0 },
    { key: "quickRatio", weight: 0.35, bad: 0.4, good: 1.5 },
    { key: "cashRatio", weight: 0.25, bad: 0.05, good: 0.8 },
  ],
  growth1y: [
    { key: "revenueYoY", weight: 0.35, bad: -0.10, good: 0.20 },
    { key: "operatingIncomeYoY", weight: 0.20, bad: -0.25, good: 0.30 },
    { key: "epsYoY", weight: 0.25, bad: -0.25, good: 0.30 },
    { key: "fcfYoY", weight: 0.20, bad: -0.25, good: 0.30 },
  ],
  growthLong: [
    { key: "revenueCagr", weight: 0.30, bad: -0.05, good: 0.15 },
    { key: "epsCagr", weight: 0.25, bad: -0.10, good: 0.20 },
    { key: "fcfCagr", weight: 0.15, bad: -0.10, good: 0.20 },
    { key: "bookValuePerShareCagr", weight: 0.15, bad: -0.05, good: 0.15 },
    { key: "revenueGrowthYearsRatio", weight: 0.15, bad: 0, good: 1 },
  ],
  consistency: [
    { key: "profitableYearsRatio", weight: 0.25, bad: 0, good: 1 },
    { key: "fcfPositiveRatio", weight: 0.20, bad: 0, good: 1 },
    { key: "revenueVolatility", weight: 0.20, bad: 0.30, good: 0.03 },
    { key: "marginVolatility", weight: 0.15, bad: 0.10, good: 0.01 },
    { key: "piotroski", weight: 0.20, bad: 2, good: 8 },
  ],
  capitalAllocation: [
    { key: "shareChangeYearly", weight: 0.35, bad: 0.05, good: -0.03 },
    { key: "payoutRatio", weight: 0.20, bad: 1.2, good: 0.6 },
    { key: "shareholderYield", weight: 0.20, bad: 0, good: 0.06 },
    { key: "roicChange", weight: 0.25, bad: -0.10, good: 0.10 },
  ],
  valuation: [
    { key: "peRatio", weight: 0.25, bad: 45, good: 10 },
    { key: "evToEbit", weight: 0.20, bad: 40, good: 8 },
    { key: "fcfYield", weight: 0.25, bad: 0, good: 0.08 },
    { key: "psRatio", weight: 0.10, bad: 15, good: 1 },
    { key: "pegRatio", weight: 0.20, bad: 3, good: 0.8 },
  ],
  marketRisk: [
    { key: "volatility", weight: 0.6, bad: 0.70, good: 0.15 },
    { key: "maxDrawdown", weight: 0.4, bad: -0.80, good: -0.20 },
  ],
};

// Banks, insurers, brokers: liquidity ratios, EBITDA and free cash flow are not meaningful.
const FINANCIAL = {
  ...GENERAL,
  profitability: [
    { key: "netMargin", weight: 0.25, bad: 0, good: 0.30 },
    { key: "roe", weight: 0.45, bad: 0.02, good: 0.16 },
    { key: "roa", weight: 0.30, bad: 0.002, good: 0.015 },
  ],
  cashFlow: [],
  balanceSheet: [
    { key: "equityRatio", weight: 0.6, bad: 0.04, good: 0.14 },
    { key: "debtToEquity", weight: 0.4, bad: 4, good: 0.5 },
  ],
  liquidity: [],
  growth1y: [
    { key: "revenueYoY", weight: 0.45, bad: -0.10, good: 0.15 },
    { key: "epsYoY", weight: 0.55, bad: -0.25, good: 0.25 },
  ],
  growthLong: [
    { key: "revenueCagr", weight: 0.30, bad: -0.05, good: 0.12 },
    { key: "epsCagr", weight: 0.30, bad: -0.10, good: 0.15 },
    { key: "bookValuePerShareCagr", weight: 0.25, bad: -0.05, good: 0.12 },
    { key: "revenueGrowthYearsRatio", weight: 0.15, bad: 0, good: 1 },
  ],
  consistency: [
    { key: "profitableYearsRatio", weight: 0.45, bad: 0, good: 1 },
    { key: "revenueVolatility", weight: 0.30, bad: 0.30, good: 0.03 },
    { key: "marginVolatility", weight: 0.25, bad: 0.15, good: 0.02 },
  ],
  capitalAllocation: [
    { key: "shareChangeYearly", weight: 0.5, bad: 0.05, good: -0.03 },
    { key: "shareholderYield", weight: 0.5, bad: 0, good: 0.07 },
  ],
  valuation: [
    { key: "peRatio", weight: 0.5, bad: 25, good: 8 },
    { key: "pbRatio", weight: 0.3, bad: 3, good: 0.8 },
    { key: "pegRatio", weight: 0.2, bad: 3, good: 0.8 },
  ],
};

// REITs and real-estate operators run structurally higher leverage.
const REAL_ESTATE = {
  ...GENERAL,
  balanceSheet: [
    { key: "debtToEquity", weight: 0.25, bad: 4, good: 0.8 },
    { key: "netDebtToEbitda", weight: 0.35, bad: 10, good: 4 },
    { key: "interestCoverage", weight: 0.25, bad: 1.2, good: 6 },
    { key: "equityRatio", weight: 0.15, bad: 0.15, good: 0.55 },
  ],
  liquidity: [],
  valuation: [
    { key: "pfcfRatio", weight: 0.4, bad: 35, good: 10 },
    { key: "pbRatio", weight: 0.3, bad: 3, good: 0.8 },
    { key: "evToEbitda", weight: 0.3, bad: 30, good: 10 },
  ],
};

export const PROFILES = { general: GENERAL, financial: FINANCIAL, realEstate: REAL_ESTATE };

// Display order. "inverse": lower is better.
export const DIMENSIONS = [
  "profitability", "cashFlow", "balanceSheet", "liquidity", "growth1y",
  "growthLong", "consistency", "capitalAllocation", "valuation", "risk",
];

export const OVERALL_WEIGHTS = {
  profitability: 0.15, cashFlow: 0.12, balanceSheet: 0.13, liquidity: 0.05, growth1y: 0.08,
  growthLong: 0.14, consistency: 0.13, capitalAllocation: 0.07, valuation: 0.13,
};

export const RISK_WEIGHTS = { balanceSheet: 0.30, liquidity: 0.10, consistency: 0.25, profitability: 0.15, cashFlow: 0.20 };
export const FLAG_PENALTY = { critical: 10, warning: 4 };
export const MIN_DIMENSIONS = 5;
export const MIN_DIMENSION_COVERAGE = 0.5;

// ---------- Sector benchmarks ----------

// Metrics whose typical level depends strongly on the industry (margins, returns, capital structure,
// liquidity, valuation multiples). Growth, consistency and risk metrics stay on absolute scales.
export const RELATIVE_METRICS = new Set([
  "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roic", "roe", "roa", "sbcToRevenue",
  "currentRatio", "quickRatio", "cashRatio", "debtToEquity", "netDebtToEbitda", "equityRatio", "interestCoverage",
  "peRatio", "evToEbit", "evToEbitda", "psRatio", "pbRatio", "pfcfRatio", "fcfYield",
]);
export const MIN_SECTOR_PEERS = 20;
export const PEER_MIN_MARKET_CAP = 3e8;
export const PEER_MIN_REVENUE = 5e7;

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// list: [{ sector, a }] where a = analyze(company) without benchmarks. (Revenue is compared in the reporting
// currency; for the rare non-USD filers this threshold is approximate.)
// Returns { sector: { metric: { p10, p25, p50, p75, p90, n } } } for sectors with enough peers.
export function computeBenchmarks(list) {
  const bySector = {};
  for (const { sector, a } of list) {
    if (!sector || !a?.ok) continue;
    // Peers are established companies only (market cap ≥ $300M, revenue ≥ $50M); otherwise the many
    // pre-revenue small caps would drag every sector's typical margins and multiples far below normal.
    const rev = a.series[a.series.length - 1]?.revenue;
    if (!(a.metrics.marketCap >= PEER_MIN_MARKET_CAP) || !(rev >= PEER_MIN_REVENUE)) continue;
    const s = (bySector[sector] ||= {});
    for (const k of RELATIVE_METRICS) {
      const v = a.metrics[k];
      if (isNum(v)) (s[k] ||= []).push(v);
    }
  }
  const out = {};
  for (const [sector, metrics] of Object.entries(bySector)) {
    for (const [k, vals] of Object.entries(metrics)) {
      if (vals.length < MIN_SECTOR_PEERS) continue;
      vals.sort((x, y) => x - y);
      const r = (q) => +quantile(vals, q).toPrecision(5);
      (out[sector] ||= {})[k] = { p10: r(0.1), p25: r(0.25), p50: r(0.5), p75: r(0.75), p90: r(0.9), n: vals.length };
    }
  }
  return out;
}

// ---------- Main analysis ----------

export function analyze(company, { now = new Date(), benchmarks = null } = {}) {
  const years = [...(company.annual || [])].filter((y) => isNum(y.year)).sort((a, b) => a.year - b.year);
  if (!years.length) return { ok: false, reason: "noData" };

  const profile = PROFILES[company.profile] ? company.profile : "general";
  const defs = PROFILES[profile];
  const L = years[years.length - 1];
  const P = years.length > 1 ? years[years.length - 2] : null;
  const series = years.map((y, i) => yearMetrics(y, years[i - 1] || null));
  const m = series[series.length - 1];
  const mp = series.length > 1 ? series[series.length - 2] : null;

  // Long-term window: up to the last 6 fiscal years (5 years of change).
  const win = years.slice(-6);
  const winM = series.slice(-6);
  const span = win.length - 1;
  const first = winM[0];

  const yoys = win.slice(1).map((y, i) => growth(y.revenue, win[i].revenue));
  const shareStart = first.shares, shareEnd = m.shares;

  // TTM figures (from the latest quarterly filings) are preferred for valuation.
  const ttm = company.ttm && isNum(company.ttm.revenue) ? company.ttm : null;
  const lb = company.latestBalance || null;
  const basis = ttm || L;
  const bal = lb && isNum(lb.totalAssets) ? { ...L, ...Object.fromEntries(Object.entries(lb).filter(([, v]) => v !== null)) } : L;

  const mk = company.market || {};
  let marketCapUsd = isNum(mk.marketCap) && mk.marketCap > 0 ? mk.marketCap : null;
  if (!marketCapUsd && isNum(mk.price) && isNum(mk.sharesOutstanding) && (company.currency || "USD") === "USD") marketCapUsd = mk.price * mk.sharesOutstanding;
  // Valuation ratios compare the market cap (USD) with statements in the reporting currency,
  // so the market cap is converted into that currency first; without a rate, valuation is skipped.
  const fx = (company.currency || "USD") === "USD" ? 1 : isNum(mk.fxToUsd) && mk.fxToUsd > 0 ? mk.fxToUsd : null;
  const marketCap = marketCapUsd && fx ? marketCapUsd / fx : null;
  const bFcf = freeCashFlow(basis);
  const bEbitda = ebitda(basis);
  const ev = marketCap && isNum(bal.totalDebt) && isNum(bal.cash) ? marketCap + bal.totalDebt - bal.cash : marketCap;
  const epsCagr = span >= 2 ? cagr(first.eps, m.eps, span) : null;
  const pe = marketCap && isNum(basis.netIncome) ? (basis.netIncome > 0 ? marketCap / basis.netIncome : Infinity) : null;
  const dividends = isNum(basis.dividendsPaid) ? Math.abs(basis.dividendsPaid) : null;
  const buybacks = isNum(basis.buybacks) ? Math.abs(basis.buybacks) : null;

  const ms = marketStats(company.prices);

  const metrics = {
    ...pick(m, ["grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roe", "roa", "roic", "fcfConversion", "accrualRatio",
      "sbcToRevenue", "capexToRevenue", "currentRatio", "quickRatio", "cashRatio", "debtToEquity", "equityRatio", "liabilitiesToAssets",
      "netDebt", "netDebtToEbitda", "interestCoverage", "goodwillToAssets", "payoutRatio", "bookValuePerShare"]),
    altmanZ: profile === "general" ? altmanZ(L) : null,
    piotroski: profile === "financial" ? null : piotroski(L, P),
    revenueYoY: P ? growth(L.revenue, P.revenue) : null,
    operatingIncomeYoY: mp ? growth(m.operatingIncome, mp.operatingIncome) : null,
    netIncomeYoY: P ? growth(L.netIncome, P.netIncome) : null,
    epsYoY: mp ? growth(m.eps, mp.eps) : null,
    fcfYoY: mp ? growth(m.freeCashFlow, mp.freeCashFlow) : null,
    revenueCagr: span >= 2 ? cagr(win[0].revenue, L.revenue, span) : null,
    epsCagr,
    fcfCagr: span >= 2 ? cagr(first.freeCashFlow, m.freeCashFlow, span) : null,
    bookValuePerShareCagr: span >= 2 ? cagr(first.bookValuePerShare, m.bookValuePerShare, span) : null,
    revenueGrowthYearsRatio: ratio(yoys, (g) => g > 0),
    marginTrend: span >= 2 && isNum(first.operatingMargin) && isNum(m.operatingMargin) ? m.operatingMargin - first.operatingMargin : null,
    roicChange: span >= 2 && isNum(first.roic) && isNum(m.roic) ? m.roic - first.roic : null,
    profitableYearsRatio: ratio(win.map((y) => y.netIncome), (x) => x > 0),
    fcfPositiveRatio: ratio(winM.map((y) => y.freeCashFlow), (x) => x > 0),
    revenueVolatility: stdev(yoys),
    marginVolatility: stdev(winM.map((y) => (profile === "financial" ? y.netMargin : y.operatingMargin))),
    shareChangeYearly: span >= 1 && isNum(shareStart) && isNum(shareEnd) && shareStart > 0 ? Math.pow(shareEnd / shareStart, 1 / span) - 1 : null,
    marketCap: marketCapUsd,
    enterpriseValue: ev,
    peRatio: pe,
    psRatio: marketCap ? div(marketCap, basis.revenue) : null,
    pbRatio: marketCap && isNum(bal.equity) && bal.equity > 0 ? marketCap / bal.equity : null,
    evToEbit: ev && isNum(basis.operatingIncome) ? (basis.operatingIncome > 0 ? ev / basis.operatingIncome : Infinity) : null,
    evToEbitda: ev && isNum(bEbitda) ? (bEbitda > 0 ? ev / bEbitda : Infinity) : null,
    fcfYield: marketCap ? div(bFcf, marketCap) : null,
    pfcfRatio: marketCap && isNum(bFcf) ? (bFcf > 0 ? marketCap / bFcf : Infinity) : null,
    pegRatio: isNum(pe) && pe !== Infinity && isNum(epsCagr) && epsCagr > 0 ? pe / (epsCagr * 100) : pe === Infinity || (isNum(epsCagr) && epsCagr <= 0) ? Infinity : null,
    dividendYield: marketCap && isNum(dividends) ? dividends / marketCap : null,
    shareholderYield: marketCap && (isNum(dividends) || isNum(buybacks)) ? ((dividends ?? 0) + (buybacks ?? 0)) / marketCap : null,
    ...ms,
    yearsOfData: years.length,
    windowYears: span,
  };

  // ---- Part scores ----
  const negEquity = isNum(bal.equity) && bal.equity <= 0;
  const parts = {};
  for (const dim of Object.keys(OVERALL_WEIGHTS).concat("marketRisk")) {
    parts[dim] = (defs[dim] || []).map((d) => {
      const part = { ...d, value: metrics[d.key], score: partScore(d, metrics[d.key], { negEquity, L, metrics }) };
      // Sector-relative scoring: half absolute thresholds, half position among sector peers (10th–90th percentile).
      const b = benchmarks?.[company.sector]?.[d.key];
      if (b && isNum(part.score) && RELATIVE_METRICS.has(d.key)) {
        const v = metrics[d.key];
        const higherBetter = d.good > d.bad;
        const rel = v === Infinity ? (higherBetter ? 100 : 0) : scale(v, higherBetter ? b.p10 : b.p90, higherBetter ? b.p90 : b.p10);
        if (isNum(rel) && b.p90 !== b.p10) {
          part.absScore = part.score;
          part.relScore = rel;
          part.score = Math.round(0.5 * part.score + 0.5 * rel);
        }
        part.median = b.p50;
      }
      return part;
    });
  }

  // A loss-making company cannot score on earnings growth from a negative base.
  if (isNum(L.netIncome) && L.netIncome < 0) {
    for (const [dim, key] of [["growth1y", "epsYoY"], ["growthLong", "epsCagr"]]) {
      const p = parts[dim].find((x) => x.key === key);
      if (p) p.score = 0;
    }
  }

  const scores = {};
  // A dimension is scored only when metrics carrying at least half of its weight are available.
  for (const dim of Object.keys(parts)) {
    const covered = parts[dim].reduce((sum, p) => sum + (isNum(p.score) ? p.weight : 0), 0);
    scores[dim] = covered >= MIN_DIMENSION_COVERAGE ? weighted(parts[dim]) : null;
  }

  const flags = buildFlags({ L, P, m, metrics, negEquity, profile, company, now });

  // ---- Risk: fundamental (75%) + market (25%), raised by warning flags ----
  const fundamental = weighted(Object.entries(RISK_WEIGHTS).map(([k, w]) => ({ score: scores[k], weight: w })));
  const safety = isNum(scores.marketRisk) && isNum(fundamental) ? 0.75 * fundamental + 0.25 * scores.marketRisk : fundamental;
  const penalty = flags.reduce((s, f) => s + (FLAG_PENALTY[f.level] || 0), 0);
  scores.risk = isNum(safety) ? Math.round(Math.max(0, Math.min(100, 100 - safety + penalty))) : null;

  // An overall score needs a broad basis: at least MIN_DIMENSIONS fundamental dimensions with data.
  const scoredDims = Object.keys(OVERALL_WEIGHTS).filter((k) => isNum(scores[k])).length;
  scores.overall = scoredDims >= MIN_DIMENSIONS ? weighted(Object.entries(OVERALL_WEIGHTS).map(([k, w]) => ({ score: scores[k], weight: w }))) : null;
  if (scoredDims < MIN_DIMENSIONS) scores.risk = null;

  const allParts = Object.values(parts).flat();
  const coverage = allParts.length ? Math.round((allParts.filter((p) => isNum(p.score)).length / allParts.length) * 100) : 0;

  return {
    ok: true,
    engineVersion: ENGINE_VERSION,
    profile,
    latestYear: L.year,
    latestPeriodEnd: L.periodEnd || null,
    valuationBasis: ttm ? "ttm" : "annual",
    scores,
    parts,
    metrics,
    flags,
    distress: distressLevel({ metrics, negEquity, m, L, profile, flags }),
    outlook: outlookLevel(scores, metrics),
    styles: styleTags(scores, metrics, flags),
    coverage,
    series,
  };
}

// ---------- TeraScore Trend: point-in-time history ----------

// Scores the company as of the end of each fiscal year, using only what was known then: the annual
// reports up to that year, 8-K events of the preceding 12 months and the share price at that date.
// Valuation needs a historical price; earlier years without one are scored on the other dimensions.
// TTM figures, insider data and today's market data are not used. Current sector benchmarks are
// applied to every year (an approximation: historical sector distributions are not stored).
export function scoreHistory(company, { benchmarks = null, minYears = 3 } = {}) {
  const years = [...(company.annual || [])].filter((y) => isNum(y.year)).sort((a, b) => a.year - b.year);
  const prices = company.prices?.data || [];
  const lastPrice = prices.length ? prices[prices.length - 1][1] : null;
  const mcNow = company.market?.marketCap;
  const sharesNow = years.length ? years[years.length - 1].sharesDiluted : null;
  const out = [];
  for (let i = minYears - 1; i < years.length; i++) {
    const y = years[i];
    const end = y.periodEnd || `${y.year}-12-31`;
    const month = end.slice(0, 7);
    const px = prices.filter((p) => p[0] <= month);
    const priceThen = px.length && px[px.length - 1][0] >= addMonths(month, -1) ? px[px.length - 1][1] : null;
    // Market cap then ≈ market cap now × price change × share-count change (handles ADR ratios too).
    let mc = null;
    if (isNum(mcNow) && isNum(priceThen) && isNum(lastPrice) && lastPrice > 0) {
      mc = mcNow * (priceThen / lastPrice);
      if (isNum(y.sharesDiluted) && isNum(sharesNow) && sharesNow > 0) mc *= y.sharesDiluted / sharesNow;
    }
    const asOf = {
      ...company,
      annual: years.slice(0, i + 1),
      ttm: null,
      latestBalance: null,
      insiders: null,
      prices: px.length ? { ...company.prices, data: px } : null,
      market: { ...company.market, marketCap: mc, price: priceThen, sharesOutstanding: null },
    };
    const a = analyze(asOf, { now: new Date(end), benchmarks });
    if (a.ok && isNum(a.scores.overall)) out.push({ date: end, year: y.year, overall: a.scores.overall, risk: a.scores.risk });
  }
  return out;
}

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
}

function partScore(d, v, { negEquity, L, metrics }) {
  switch (d.key) {
    case "roe": return negEquity ? null : scale(v, d.bad, d.good);
    case "debtToEquity": return negEquity ? 0 : scale(v, d.bad, d.good);
    case "interestCoverage": return isNum(L.interestExpense) && L.interestExpense <= 0 ? 100 : scale(v, d.bad, d.good);
    case "fcfConversion":
      // Negative earnings: positive FCF still counts as moderately good cash generation.
      if (v === null && isNum(L.netIncome) && L.netIncome <= 0) { const f = freeCashFlow(L); return isNum(f) ? (f > 0 ? 60 : 0) : null; }
      return scale(v, d.bad, d.good);
    case "payoutRatio":
      return v === 0 ? null : v === Infinity ? 0 : scale(v, d.bad, d.good); // no dividend: neutral (not scored)
    default:
      if (v === Infinity) return 0;
      if (v === -Infinity) return 100;
      return scale(v, d.bad, d.good);
  }
}

// ---------- Flags ----------

export const FLAG_IDS = [
  "negativeEquity", "persistentLosses", "lossLastYear", "negativeFcf", "lowCurrentRatio", "interestCoverageCritical",
  "interestCoverageWeak", "altmanDistress", "altmanGrey", "debtWithoutEbitda", "highLeverage", "revenueDecline",
  "heavyDilution", "highSbc", "lowEarningsQuality", "dividendUncovered", "goodwillHeavy", "staleData", "deepDrawdown",
  "bankruptcyFiling", "restatement", "debtAcceleration", "delistingNotice", "auditorChange", "insiderBuying", "insiderSelling",
  "netCash", "highMargin", "highRoic", "alwaysProfitable", "strongGrowth", "buybacks", "altmanSafe", "strongCashConversion",
];

function buildFlags({ L, P, m, metrics: mt, negEquity, profile, company, now }) {
  const f = [];
  const add = (level, id, params = {}) => f.push({ level, id, params });
  const general = profile !== "financial";

  if (negEquity) add("critical", "negativeEquity");
  if (isNum(L.netIncome) && L.netIncome < 0) {
    if (P && isNum(P.netIncome) && P.netIncome < 0) add("critical", "persistentLosses");
    else add("warning", "lossLastYear");
  }
  if (general && isNum(m.freeCashFlow) && m.freeCashFlow < 0) add("warning", "negativeFcf");
  if (profile === "general" && isNum(m.currentRatio) && m.currentRatio < 1) add("warning", "lowCurrentRatio", { value: m.currentRatio });
  if (general && isNum(m.interestCoverage)) {
    if (m.interestCoverage < 1.5) add("critical", "interestCoverageCritical", { value: m.interestCoverage });
    else if (m.interestCoverage < 3) add("warning", "interestCoverageWeak", { value: m.interestCoverage });
  }
  if (isNum(mt.altmanZ)) {
    if (mt.altmanZ < 1.1) add("critical", "altmanDistress", { value: mt.altmanZ });
    else if (mt.altmanZ < 2.6) add("warning", "altmanGrey", { value: mt.altmanZ });
  }
  if (general) {
    const limit = profile === "realEstate" ? 8 : 4;
    if (m.netDebtToEbitda === Infinity) add("warning", "debtWithoutEbitda");
    else if (isNum(m.netDebtToEbitda) && m.netDebtToEbitda > limit) add("warning", "highLeverage", { value: m.netDebtToEbitda });
  }
  if (isNum(mt.revenueYoY) && mt.revenueYoY < -0.10) add("warning", "revenueDecline", { value: mt.revenueYoY });
  if (isNum(mt.shareChangeYearly) && mt.shareChangeYearly > 0.05) add("warning", "heavyDilution", { value: mt.shareChangeYearly });
  if (isNum(m.sbcToRevenue) && m.sbcToRevenue > 0.15) add("warning", "highSbc", { value: m.sbcToRevenue });
  if (general && isNum(m.accrualRatio) && m.accrualRatio > 0.10) add("warning", "lowEarningsQuality", { value: m.accrualRatio });
  if (m.payoutRatio === Infinity || (isNum(m.payoutRatio) && m.payoutRatio > 1.2)) add("warning", "dividendUncovered", { value: m.payoutRatio });
  if (isNum(m.goodwillToAssets) && m.goodwillToAssets > 0.4) add("warning", "goodwillHeavy", { value: m.goodwillToAssets });
  if (L.periodEnd) {
    const ageMonths = (now - new Date(L.periodEnd)) / (30.44 * 86400000);
    if (ageMonths > 18) add("warning", "staleData", { value: L.periodEnd });
  }
  if (isNum(mt.maxDrawdown) && mt.maxDrawdown < -0.6) add("warning", "deepDrawdown", { value: mt.maxDrawdown });

  // Material events reported on Form 8-K within the last 12 months.
  const recent = (company.events || []).filter((e) => { const age = (now - new Date(e.date)) / 86400000; return age >= 0 && age <= 365; });
  const lastWith = (item) => recent.filter((e) => e.items.includes(item)).map((e) => e.date).sort().pop();
  for (const [item, level, id] of [["1.03", "critical", "bankruptcyFiling"], ["4.02", "critical", "restatement"], ["2.04", "warning", "debtAcceleration"], ["3.01", "warning", "delistingNotice"], ["4.01", "warning", "auditorChange"]]) {
    const d = lastWith(item);
    if (d) add(level, id, { value: d });
  }

  // Insider open-market trades over the last 12 months (SEC Form 4).
  const ins = company.insiders;
  if (ins?.buy && ins.buy.insiders >= 2 && ins.buy.value >= 100000) add("positive", "insiderBuying", { value: ins.buy.value, count: ins.buy.insiders });
  const mcUsd = mt.marketCap;
  const discretionary = ins?.sell ? ins.sell.value - (ins.plannedSellValue || 0) : 0;
  if (isNum(mcUsd) && mcUsd > 0 && discretionary / mcUsd > 0.01) add("warning", "insiderSelling", { value: discretionary, share: discretionary / mcUsd });

  // Strengths
  if (general && isNum(m.netDebt) && m.netDebt < 0) add("positive", "netCash", { value: -m.netDebt });
  if (general && isNum(m.operatingMargin) && m.operatingMargin > 0.25) add("positive", "highMargin", { value: m.operatingMargin });
  if (general && isNum(m.roic) && m.roic > 0.15) add("positive", "highRoic", { value: m.roic });
  if (mt.profitableYearsRatio === 1 && mt.windowYears >= 3) add("positive", "alwaysProfitable", { years: mt.windowYears + 1 });
  if (isNum(mt.revenueCagr) && mt.revenueCagr > 0.10) add("positive", "strongGrowth", { value: mt.revenueCagr });
  if (isNum(mt.shareChangeYearly) && mt.shareChangeYearly < -0.01) add("positive", "buybacks", { value: mt.shareChangeYearly });
  if (isNum(mt.altmanZ) && mt.altmanZ > 2.6) add("positive", "altmanSafe", { value: mt.altmanZ });
  if (general && isNum(m.fcfConversion) && m.fcfConversion > 1 && isNum(m.netIncome) && m.netIncome > 0) add("positive", "strongCashConversion", { value: m.fcfConversion });

  return f;
}

// ---------- Classifications ----------

// Financial distress: points from Altman zone and critical signals. low / medium / high.
function distressLevel({ metrics: mt, negEquity, m, L, profile, flags }) {
  let pts = 0;
  const z = mt.altmanZ;
  if (isNum(z)) pts += z < 1.1 ? 3 : z < 2.6 ? 1 : 0;
  if (negEquity && !(isNum(m.freeCashFlow) && m.freeCashFlow > 0)) pts += 2;
  if (profile !== "financial" && isNum(m.freeCashFlow) && m.freeCashFlow < 0) pts += 1;
  if (isNum(L.netIncome) && L.netIncome < 0) pts += 1;
  if (isNum(m.interestCoverage) && m.interestCoverage < 1.5) pts += 2;
  if (m.netDebtToEbitda === Infinity) pts += 1;
  if (profile === "financial" && isNum(m.equityRatio) && m.equityRatio < 0.05) pts += 2;
  if (flags.some((f) => f.id === "bankruptcyFiling")) pts += 4;
  if (flags.some((f) => f.id === "debtAcceleration" || f.id === "delistingNotice")) pts += 1;
  return { level: pts >= 4 ? "high" : pts >= 2 ? "medium" : "low", points: pts };
}

// Long-term trend from historical data (descriptive, not a forecast).
function outlookLevel(scores, mt) {
  const lt = scores.growthLong, g = scores.growth1y;
  if (!isNum(lt)) return { level: "unknown" };
  let s = 0.7 * lt + 0.3 * (isNum(g) ? g : lt);
  if (isNum(mt.marginTrend)) s += Math.max(-5, Math.min(5, mt.marginTrend * 50));
  return { level: s >= 65 ? "up" : s >= 40 ? "flat" : "down", score: Math.round(s) };
}

// Investment-style tags.
function styleTags(s, mt, flags) {
  const t = [];
  const crit = flags.some((f) => f.level === "critical");
  if (s.profitability >= 70 && s.consistency >= 70 && (s.balanceSheet ?? 70) >= 60 && !crit) t.push("quality");
  if (s.growthLong >= 70) t.push("growth");
  if (s.valuation >= 65) t.push("value");
  if (isNum(mt.dividendYield) && mt.dividendYield >= 0.02 && !flags.some((f) => f.id === "dividendUncovered")) t.push("income");
  if (crit || (isNum(mt.profitableYearsRatio) && mt.profitableYearsRatio < 0.5)) t.push("speculative");
  return t;
}

// Grade bands shared by the UI and documentation.
export function gradeKey(score, inverse = false) {
  if (!isNum(score)) return "na";
  const s = inverse ? 100 - score : score;
  if (s >= 80) return "excellent";
  if (s >= 65) return "strong";
  if (s >= 45) return "moderate";
  if (s >= 25) return "weak";
  return "poor";
}

export const GRADE_TONE = { excellent: "good", strong: "good", moderate: "warning", weak: "serious", poor: "critical", na: "none" };

// Number format kind for every metric (used by UI and docs).
export const METRIC_FORMAT = {
  grossMargin: "pct", operatingMargin: "pct", netMargin: "pct", fcfMargin: "pct", roe: "pct", roa: "pct", roic: "pct",
  fcfConversion: "pct0", accrualRatio: "pct", sbcToRevenue: "pct", capexToRevenue: "pct",
  currentRatio: "x", quickRatio: "x", cashRatio: "x", debtToEquity: "x", equityRatio: "pct", liabilitiesToAssets: "pct",
  netDebt: "money", netDebtToEbitda: "xyears", interestCoverage: "x", goodwillToAssets: "pct", payoutRatio: "pct0",
  bookValuePerShare: "usd", altmanZ: "num", piotroski: "of9",
  revenueYoY: "spct", operatingIncomeYoY: "spct", netIncomeYoY: "spct", epsYoY: "spct", fcfYoY: "spct",
  revenueCagr: "spct", epsCagr: "spct", fcfCagr: "spct", bookValuePerShareCagr: "spct", revenueGrowthYearsRatio: "pct0",
  marginTrend: "pp", roicChange: "pp", profitableYearsRatio: "pct0", fcfPositiveRatio: "pct0",
  revenueVolatility: "pct", marginVolatility: "pp", shareChangeYearly: "spct",
  marketCap: "money", enterpriseValue: "money", peRatio: "mult", psRatio: "mult", pbRatio: "mult", evToEbit: "mult",
  evToEbitda: "mult", fcfYield: "pct", pfcfRatio: "mult", pegRatio: "num", dividendYield: "pct", shareholderYield: "pct",
  priceReturn1y: "spct", priceCagr5y: "spct", volatility: "pct", maxDrawdown: "pct",
};
