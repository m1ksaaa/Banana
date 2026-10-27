// Market data: current price / market cap for all Nasdaq stocks (one request to the Nasdaq
// screener) and monthly price history per ticker (Yahoo Finance chart API, Stooq as fallback).
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

export async function nasdaqScreener() {
  try {
    const r = await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange=nasdaq", { headers: BROWSER_HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const map = new Map();
    for (const row of j?.data?.rows || []) {
      map.set(String(row.symbol).trim().toUpperCase(), {
        price: num(row.lastsale), marketCap: num(row.marketCap), sector: row.sector || null, industry: row.industry || null, country: row.country || null,
      });
    }
    return map;
  } catch (e) {
    console.warn(`  Nasdaq screener unavailable: ${e.message}`);
    return new Map();
  }
}

async function yahooMonthly(ticker) {
  const sym = ticker.replace(".", "-");
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo&events=split`, { headers: BROWSER_HEADERS });
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
  const r = await fetch(`https://stooq.com/q/d/l/?s=${sym}&i=m`, { headers: BROWSER_HEADERS });
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
const failures = { yahoo: 0, stooq: 0 };
export async function priceHistory(ticker) {
  for (const [name, fn] of [["yahoo", yahooMonthly], ["stooq", stooqMonthly]]) {
    if (failures[name] >= 25) continue;
    try {
      const h = await fn(ticker);
      if (h.data.length >= 13) { failures[name] = 0; return h; }
    } catch { /* try next source */ }
    failures[name]++;
  }
  return null;
}
