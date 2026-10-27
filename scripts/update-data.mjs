#!/usr/bin/env node
// TeraStockX data updater.
// 1) Downloads the list of all Nasdaq-listed stocks (nasdaqtrader.com).
// 2) Maps tickers to SEC CIK numbers.
// 3) For every company downloads the official XBRL financial data from SEC EDGAR,
//    plus price / market cap (Nasdaq screener) and monthly price history (Yahoo / Stooq),
//    and writes it in the template format: data/companies/<TICKER>.json
// 4) Runs the analysis engine and writes the search index: data/index.json
//
// Usage:
//   SEC_USER_AGENT="Name email@example.com" node scripts/update-data.mjs     # all Nasdaq companies
//   node scripts/update-data.mjs --tickers AAPL,MSFT                          # selected tickers only
//   node scripts/update-data.mjs --limit 50                                   # first 50 (testing)
//   node scripts/update-data.mjs --skip-prices                                # no price history
//   node scripts/update-data.mjs --index-only                                 # rebuild data/index.json only

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompanyFacts } from "./sec-parse.mjs";
import { sectorFromSic, sectorFromNasdaq, profileFor } from "./sectors.mjs";
import { nasdaqScreener, priceHistory } from "./market.mjs";
import { majorEvents } from "./events.mjs";
import { analyze, ENGINE_VERSION, DIMENSIONS } from "../assets/js/scoring.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const COMPANIES = join(DATA, "companies");
const UA = process.env.SEC_USER_AGENT || "TeraStockX (github.com/m1ksaaa/Banana)";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const indexOnly = args.includes("--index-only");
const skipPrices = args.includes("--skip-prices");
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const onlyTickers = opt("--tickers") ? new Set(opt("--tickers").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = "json", tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return null;
      if (res.ok) return type === "json" ? res.json() : res.text();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(1000 * 2 ** i);
  }
  return null;
}

// nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
async function nasdaqListed() {
  const txt = await get("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "text");
  const lines = txt.trim().split(/\r?\n/);
  const header = lines[0].split("|");
  const col = (n) => header.indexOf(n);
  return lines.slice(1)
    .filter((l) => !l.startsWith("File Creation Time"))
    .map((l) => l.split("|"))
    .filter((c) => c[col("Test Issue")] === "N" && c[col("ETF")] === "N" && !DERIVATIVE.test(c[col("Security Name")]))
    .map((c) => ({ ticker: c[col("Symbol")], name: cleanName(c[col("Security Name")]) }));
}

// Warrants, units, rights and notes share the issuer's SEC filings; only the shares themselves are analyzed.
const DERIVATIVE = /\b(warrants?|units?|rights?|notes? due|debentures?|subordinated|preferred|depositary shares, each representing a fractional)\b/i;

function cleanName(n) {
  return n.replace(/\s+-\s+(Class [A-Z] )?(Common Stock|Ordinary Shares|American Depositary Shares).*$/i, "").trim();
}

async function secTickers() {
  const j = await get("https://www.sec.gov/files/company_tickers_exchange.json");
  const map = new Map();
  for (const row of j.data) {
    const r = Object.fromEntries(j.fields.map((k, i) => [k, row[i]]));
    map.set(String(r.ticker).toUpperCase(), { cik: String(r.cik).padStart(10, "0"), name: r.name });
  }
  return map;
}

async function updateCompanies() {
  mkdirSync(COMPANIES, { recursive: true });
  console.log("Downloading Nasdaq listing…");
  let list = await nasdaqListed();
  console.log(`  ${list.length} securities (excluding ETFs and test issues)`);
  const ciks = await secTickers();
  const screener = await nasdaqScreener();
  console.log(`  Nasdaq screener: ${screener.size} quotes`);
  if (onlyTickers) list = list.filter((x) => onlyTickers.has(x.ticker));
  list = list.slice(0, limit);

  let ok = 0, noData = 0, failed = 0, withPrices = 0;
  for (const [i, item] of list.entries()) {
    const sec = ciks.get(item.ticker.replace(".", "-")) || ciks.get(item.ticker);
    const q = screener.get(item.ticker) || {};
    const base = { schemaVersion: 2, ticker: item.ticker, name: item.name, exchange: "NASDAQ", currency: "USD", demo: false };
    try {
      if (!sec) {
        noData++;
        writeCompany({ ...base, cik: null, sector: sectorFromNasdaq(q.sector), industry: q.industry || null, profile: "general", source: null, annual: [], note: "noSecFiling" });
        continue;
      }
      const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${sec.cik}.json`);
      await sleep(110); // SEC fair-access limit: max 10 requests / second
      const sub = await get(`https://data.sec.gov/submissions/CIK${sec.cik}.json`);
      await sleep(110);
      const parsed = cf ? parseCompanyFacts(cf) : { annual: [] };
      if (!parsed.annual.length) noData++; else ok++;

      const sector = sectorFromSic(sub?.sic) || sectorFromNasdaq(q.sector);
      const hist = skipPrices || !parsed.annual.length ? null : await priceHistory(item.ticker);
      if (hist) withPrices++;
      const price = q.price ?? hist?.price ?? null;
      const shares = parsed.sharesOutstanding ?? null;

      writeCompany({
        ...base,
        name: sub?.name || cf?.entityName || item.name,
        cik: sec.cik,
        sicCode: sub?.sic ? Number(sub.sic) : null,
        sicDescription: sub?.sicDescription || null,
        sector,
        industry: q.industry || sub?.sicDescription || null,
        profile: profileFor(sub?.sic, sector),
        fiscalYearEndMonth: sub?.fiscalYearEnd ? Number(sub.fiscalYearEnd.slice(0, 2)) : null,
        source: { name: "SEC EDGAR XBRL company facts (10-K, 10-Q, 20-F)", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sec.cik}`, retrieved: new Date().toISOString() },
        market: {
          price,
          priceDate: new Date().toISOString().slice(0, 10),
          marketCap: q.marketCap || (price && shares ? price * shares : null),
          sharesOutstanding: shares,
          sharesOutstandingDate: parsed.sharesOutstandingDate ?? null,
          source: q.price ? "Nasdaq" : hist?.source || null,
        },
        events: majorEvents(sub),
        prices: hist ? { interval: "1mo", adjusted: true, source: hist.source, data: hist.data } : null,
        splits: parsed.splits?.length ? parsed.splits : undefined,
        ttm: parsed.ttm,
        latestBalance: parsed.latestBalance,
        annual: parsed.annual,
      });
    } catch (e) {
      failed++;
      console.warn(`  ERROR ${item.ticker}: ${e.message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${list.length} processed`);
  }
  // A full run removes files of securities that are no longer listed (or are warrants/units).
  if (!onlyTickers && limit === Infinity) {
    const keep = new Set(list.map((x) => `${x.ticker}.json`));
    let removed = 0;
    for (const f of readdirSync(COMPANIES)) if (!keep.has(f)) { unlinkSync(join(COMPANIES, f)); removed++; }
    console.log(`  removed ${removed} delisted or non-share securities`);
  }
  console.log(`Done: ${ok} with financials, ${noData} without data, ${failed} errors, ${withPrices} with price history.`);
}

function writeCompany(c) {
  // An empty result never overwrites existing financial data.
  const file = join(COMPANIES, `${c.ticker}.json`);
  if (!c.annual.length && existsSync(file)) {
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (old.annual?.length) return;
  }
  writeFileSync(file, JSON.stringify(c) + "\n");
}

function buildIndex() {
  const files = readdirSync(COMPANIES).filter((f) => f.endsWith(".json"));
  const news = [];
  const companies = files.map((f) => {
    const c = JSON.parse(readFileSync(join(COMPANIES, f), "utf8"));
    const a = analyze(c);
    const row = { t: c.ticker, n: c.name, s: c.sector || null };
    if (c.industry) row.i = c.industry;
    if (c.demo) row.demo = true;
    if (a.ok) {
      row.y = a.latestYear;
      row.sc = ["overall", ...DIMENSIONS].map((k) => a.scores[k] ?? null);
      row.d = a.distress.level;
      row.o = a.outlook.level;
      if (a.styles.length) row.st = a.styles;
      row.cov = a.coverage;
      if (a.metrics.marketCap) row.mc = Math.round(a.metrics.marketCap);
    }
    for (const e of c.events || []) if (e.severity >= 3) news.push({ t: c.ticker, n: c.name, mc: row.mc ?? null, ...e });
    return row;
  }).sort((a, b) => a.t.localeCompare(b.t));
  const index = { generated: new Date().toISOString(), engineVersion: ENGINE_VERSION, scoreKeys: ["overall", ...DIMENSIONS], count: companies.length, companies };
  writeFileSync(join(DATA, "index.json"), JSON.stringify(index) + "\n");
  // Major-events feed: newest first, capped so that only the significant few are shown.
  news.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.severity - a.severity));
  writeFileSync(join(DATA, "news.json"), JSON.stringify({ generated: index.generated, events: news.slice(0, 150) }) + "\n");
  console.log(`data/index.json: ${companies.length} companies; data/news.json: ${Math.min(news.length, 150)} events.`);
}

if (!indexOnly) await updateCompanies();
buildIndex();
