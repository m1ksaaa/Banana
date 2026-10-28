// Market data: current price / market cap for all US-listed stocks (Nasdaq screener, one request per
// exchange), exchange rates, and monthly price history per ticker (Nasdaq.com history; Yahoo Finance and Stooq as fallbacks).
// Everything here is optional: if a source is unavailable, valuation and market-risk metrics are skipped.

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const num = (s) => {
  if (s === null || s === undefined) return null;
  const n = Number(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Current quotes for all stocks of the given exchanges (one request per exchange).
export async function nasdaqScreener(exchanges = ["nasdaq", "nyse", "amex"]) {
  const map = new Map();
  for (const ex of exchanges) {
    try {
      const r = await fetch(`https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange=${ex}`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      for (const row of j?.data?.rows || []) {
        // The screener writes class shares as "BRK/B"; listings use "BRK.B".
        map.set(String(row.symbol).trim().toUpperCase().replace("/", "."), {
          price: num(row.lastsale), marketCap: num(row.marketCap), sector: row.sector || null, industry: row.industry || null, country: row.country || null,
        });
      }
    } catch (e) {
      console.warn(`  Nasdaq screener (${ex}) unavailable: ${e.message}`);
    }
  }
  return map;
}

// Exchange rates: US dollars per one unit of each currency. ECB reference rates first,
// open.er-api.com for currencies the ECB does not publish (e.g. TWD).
export async function fxToUsd() {
  const rates = { USD: 1 };
  try {
    const r = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { signal: AbortSignal.timeout(20000) });
    const xml = await r.text();
    const perEur = { EUR: 1 };
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) perEur[m[1]] = Number(m[2]);
    if (perEur.USD) for (const [c, v] of Object.entries(perEur)) rates[c] = perEur.USD / v;
  } catch (e) {
    console.warn(`  ECB rates unavailable: ${e.message}`);
  }
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    for (const [c, v] of Object.entries(j?.rates || {})) if (!rates[c] && v > 0) rates[c] = 1 / v;
  } catch (e) {
    console.warn(`  open.er-api rates unavailable: ${e.message}`);
  }
  return rates;
}

// Nasdaq.com daily history (split-adjusted closes), reduced to the last close of each month.
async function nasdaqMonthly(ticker) {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 365.25 * 86400000);
  const d = (x) => x.toISOString().slice(0, 10);
  // Class shares ("BRK.B") are written differently across Nasdaq endpoints; try the common forms.
  const variants = ticker.includes(".") ? [ticker.replace(".", "/"), ticker.replace(".", "^"), ticker] : [ticker];
  let rows = [];
  for (const v of variants) {
    const r = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(v)}/historical?assetclass=stocks&fromdate=${d(from)}&todate=${d(to)}&limit=9999`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20000) });
    if (!r.ok) continue;
    const j = await r.json();
    rows = j?.data?.tradesTable?.rows || [];
    if (rows.length) break;
  }
  const months = new Map();
  for (const row of rows) {
    const [mm, dd, yyyy] = String(row.date).split("/");
    const close = num(row.close);
    if (!yyyy || !Number.isFinite(close)) continue;
    const key = `${yyyy}-${mm}`;
    const day = Number(dd);
    const prev = months.get(key);
    if (!prev || day > prev.day) months.set(key, { day, close });
  }
  const data = [...months].map(([k, v]) => [k, v.close]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { data, price: data.length ? data[data.length - 1][1] : null, source: "Nasdaq" };
}

async function yahooMonthly(ticker) {
  const sym = ticker.replace(".", "-");
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo&events=split`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const adj = res?.indicators?.adjclose?.[0]?.adjclose || res?.indicators?.quote?.[0]?.close || [];
  const data = [];
  ts.forEach((t, i) => { if (Number.isFinite(adj[i])) data.push([new Date(t * 1000).toISOString().slice(0, 7), +adj[i].toFixed(4)]); });
  const price = res?.meta?.regularMarketPrice;
  return { data: dedupeMonths(data), price: Number.isFinite(price) ? price : null, source: "Yahoo Finance" };
}

async function stooqMonthly(ticker) {
  const sym = `${ticker.toLowerCase().replace(".", "-")}.us`;
  const r = await fetch(`https://stooq.com/q/d/l/?s=${sym}&i=m`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await r.text();
  if (!txt.startsWith("Date")) throw new Error("no data");
  const data = txt.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((c) => Number.isFinite(+c[4])).map((c) => [c[0].slice(0, 7), +c[4]]);
  return { data: dedupeMonths(data.slice(-121)), price: data.length ? data[data.length - 1][1] : null, source: "Stooq" };
}

function dedupeMonths(data) {
  const m = new Map();
  for (const [k, v] of data) m.set(k, v);
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Tries each source in order; a source that fails 25 times in a row is switched off for the run.
const failures = { nasdaq: 0, yahoo: 0, stooq: 0 };
// Price history is optional: after the time budget it is skipped so the financial data always gets saved.
let started = null;
const BUDGET_MS = Number(process.env.PRICE_BUDGET_MIN || 75) * 60000;
export const priceBudgetLeft = () => started === null || Date.now() - started < BUDGET_MS;
export async function priceHistory(ticker) {
  if (started === null) started = Date.now();
  if (!priceBudgetLeft()) return null;
  for (const [name, fn] of [["nasdaq", nasdaqMonthly], ["yahoo", yahooMonthly], ["stooq", stooqMonthly]]) {
    if (failures[name] >= 25) continue;
    try {
      const h = await fn(ticker);
      if (h.data.length >= 2) { failures[name] = 0; return h; } // recent listings have a short history
    } catch { /* try next source */ }
    failures[name]++;
  }
  return null;
}
