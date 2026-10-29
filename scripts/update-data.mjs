#!/usr/bin/env node
// TeraStockX data updater.
// 1) Lists all common stocks on Nasdaq, NYSE, NYSE American and Cboe BZX (nasdaqtrader.com).
// 2) Maps tickers to SEC CIK numbers.
// 3) For every company downloads the official XBRL financial data from SEC EDGAR (10-K, 10-Q, 20-F, 40-F),
//    quotes and market caps (Nasdaq screener), exchange rates (ECB) and material 8-K events,
//    and writes it in the template format: data/companies/<TICKER>.json
// 4) Adds monthly price histories (parallel phase) and 12-month insider transactions (SEC Form 4 data sets).
// 5) Computes sector benchmarks, runs the analysis engine and writes data/index.json, data/news.json
//    and data/benchmarks.json.
//
// Usage:
//   SEC_USER_AGENT="Name email@example.com" node scripts/update-data.mjs     # all companies
//   node scripts/update-data.mjs --tickers AAPL,MSFT                          # selected tickers only
//   node scripts/update-data.mjs --limit 50                                   # first 50 (testing)
//   node scripts/update-data.mjs --skip-prices --skip-insiders                # skip optional phases
//   node scripts/update-data.mjs --index-only                                 # rebuild index files only

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompanyFacts } from "./sec-parse.mjs";
import { sectorFromSic, sectorFromNasdaq, profileFor } from "./sectors.mjs";
import { nasdaqScreener, priceHistory, priceBudgetLeft, fxToUsd } from "./market.mjs";
import { majorEvents } from "./events.mjs";
import { fillMissingFilings } from "./xbrl-instance.mjs";
import { parseNasdaqListed, parseOtherListed } from "./listings.mjs";
import { insiderActivity } from "./insider.mjs";
import { analyze, computeBenchmarks, scoreHistory, ENGINE_VERSION, DIMENSIONS, dividendProfile } from "../assets/js/scoring.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const COMPANIES = join(DATA, "companies");
const UA = process.env.SEC_USER_AGENT || "TeraStockX (github.com/m1ksaaa/Banana)";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const indexOnly = args.includes("--index-only");
const skipPrices = args.includes("--skip-prices");
const skipInsiders = args.includes("--skip-insiders");
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const onlyTickers = opt("--tickers") ? new Set(opt("--tickers").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

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

async function allListings() {
  const nasdaq = parseNasdaqListed(await get("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "text"));
  const other = parseOtherListed(await get("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "text"));
  const seen = new Set();
  return [...nasdaq, ...other].filter((x) => !seen.has(x.ticker) && seen.add(x.ticker));
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
  console.log("Downloading listings…");
  let list = await allListings();
  const byEx = {};
  for (const x of list) byEx[x.exchange] = (byEx[x.exchange] || 0) + 1;
  console.log(`  ${list.length} common stocks`, byEx);
  const ciks = await secTickers();
  const screener = await nasdaqScreener();
  const fx = await fxToUsd();
  console.log(`  screener: ${screener.size} quotes; exchange rates: ${Object.keys(fx).length}`);
  if (onlyTickers) list = list.filter((x) => onlyTickers.has(x.ticker));
  list = list.slice(0, limit);

  let ok = 0, noData = 0, failed = 0, gapFilled = 0;
  for (const [i, item] of list.entries()) {
    const sec = ciks.get(item.ticker.replace(".", "-")) || ciks.get(item.ticker);
    const q = screener.get(item.ticker) || {};
    const base = { schemaVersion: 3, ticker: item.ticker, name: item.name, exchange: item.exchange, currency: "USD", demo: false };
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
      if (cf && sub) {
        const added = await fillMissingFilings(cf, sub, sec.cik, async (url, type) => { const r = await get(url, type); await sleep(110); return r; });
        if (added.length) { gapFilled++; console.log(`  ${item.ticker}: read from the filing, missing in companyfacts: ${added.join(", ")}`); }
      }
      const parsed = cf ? parseCompanyFacts(cf) : { annual: [], currency: "USD" };
      if (!parsed.annual.length) noData++; else ok++;

      const sector = sectorFromSic(sub?.sic) || sectorFromNasdaq(q.sector);
      // Price history and insider data are added in later phases; until then the previous ones are kept.
      const file = join(COMPANIES, `${item.ticker}.json`);
      const old = existsSync(file) ? readJson(file) : null;
      const hist = old?.prices?.data?.length ? old.prices : null;
      const currency = parsed.currency || "USD";
      const price = q.price ?? (hist ? hist.data.at(-1)[1] : null);
      const shares = parsed.sharesOutstanding ?? null;
      // Price × shares is only safe for US-dollar filers: ADRs of foreign companies represent a ratio of shares.
      const marketCap = q.marketCap || (currency === "USD" && price && shares ? price * shares : null);

      writeCompany({
        ...base,
        name: sub?.name || cf?.entityName || item.name,
        cik: sec.cik,
        currency,
        country: q.country || sub?.addresses?.business?.stateOrCountryDescription || null,
        sicCode: sub?.sic ? Number(sub.sic) : null,
        sicDescription: sub?.sicDescription || null,
        sector,
        industry: q.industry || sub?.sicDescription || null,
        profile: profileFor(sub?.sic, sector),
        fiscalYearEndMonth: sub?.fiscalYearEnd ? Number(sub.fiscalYearEnd.slice(0, 2)) : null,
        source: { name: "SEC EDGAR XBRL company facts (10-K, 10-Q, 20-F, 40-F)", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sec.cik}`, retrieved: new Date().toISOString() },
        market: {
          price,
          priceDate: new Date().toISOString().slice(0, 10),
          marketCap,
          sharesOutstanding: shares,
          sharesOutstandingDate: parsed.sharesOutstandingDate ?? null,
          fxToUsd: currency === "USD" ? 1 : fx[currency] ?? null,
          source: q.price ? "Nasdaq" : hist?.source || null,
        },
        foreignPrivateIssuer: (sub?.filings?.recent?.form || []).some((f) => f === "20-F" || f === "40-F"),
        events: majorEvents(sub),
        insiders: old?.insiders ?? null,
        scoreHistory: old?.scoreHistory ?? undefined,
        prices: hist,
        splits: parsed.splits?.length ? parsed.splits : undefined,
        ttm: parsed.ttm,
        latestBalance: parsed.latestBalance,
        annual: parsed.annual,
        quarterly: parsed.quarterly?.length ? parsed.quarterly : undefined,
      });
    } catch (e) {
      failed++;
      console.warn(`  ERROR ${item.ticker}: ${e.message}`);
    }
    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${list.length} processed`);
  }
  // A full run removes files of securities that are no longer listed (or are warrants/units).
  if (!onlyTickers && limit === Infinity) {
    const keep = new Set(list.map((x) => `${x.ticker}.json`));
    let removed = 0;
    for (const f of readdirSync(COMPANIES)) if (!keep.has(f)) { unlinkSync(join(COMPANIES, f)); removed++; }
    console.log(`  removed ${removed} delisted or non-share securities`);
  }
  const tickers = list.map((x) => x.ticker);
  if (!skipInsiders) await updateInsiders(tickers);
  const withPrices = skipPrices ? 0 : await updatePriceHistories(tickers);
  console.log(`Done: ${ok} with financials, ${noData} without data, ${failed} errors, ${gapFilled} filled from filings missing in companyfacts, ${withPrices} price histories updated.`);
}

// Phase 2: insider transactions for every company from the SEC Form 4 data sets.
async function updateInsiders(tickers) {
  const activity = await insiderActivity({ userAgent: UA });
  if (!activity.size) { console.log("  insider data unavailable; previous data kept"); return; }
  let n = 0;
  for (const t of tickers) {
    const f = join(COMPANIES, `${t}.json`);
    if (!existsSync(f)) continue;
    const c = readJson(f);
    if (!c.cik) continue;
    c.insiders = activity.get(c.cik) || { none: true };
    if (!c.insiders.none) n++;
    writeFileSync(f, JSON.stringify(c) + "\n");
  }
  console.log(`  insider transactions: ${n} companies with open-market trades`);
}

// Phase 3: monthly price histories, largest companies first, several requests in parallel.
async function updatePriceHistories(tickers) {
  const files = tickers.map((t) => join(COMPANIES, `${t}.json`)).filter(existsSync);
  const companies = files.map((f) => ({ f, c: readJson(f) })).filter(({ c }) => c.annual?.length);
  companies.sort((a, b) => (b.c.market?.marketCap || 0) - (a.c.market?.marketCap || 0));
  let next = 0, updated = 0;
  const worker = async () => {
    while (next < companies.length && priceBudgetLeft()) {
      const { f, c } = companies[next++];
      const hist = await priceHistory(c.ticker);
      if (!hist) continue;
      c.prices = { interval: "1mo", adjusted: true, source: hist.source, data: hist.data };
      if (c.market && !c.market.price && hist.price) c.market.price = hist.price;
      writeFileSync(f, JSON.stringify(c) + "\n");
      if (++updated % 500 === 0) console.log(`  ${updated} price histories`);
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.PRICE_CONCURRENCY || 6) }, worker));
  console.log(`  price histories: ${updated}/${companies.length} updated${priceBudgetLeft() ? "" : " (time budget reached; the rest keep their previous history)"}`);
  return updated;
}

function writeCompany(c) {
  // An empty result never overwrites existing financial data.
  const file = join(COMPANIES, `${c.ticker}.json`);
  if (!c.annual.length && existsSync(file)) {
    const old = readJson(file);
    if (old.annual?.length) return;
  }
  writeFileSync(file, JSON.stringify(c) + "\n");
}

// Weekly TeraScore snapshots kept per company (about two years).
const MAX_WEEKLY = 110;
const DAY = 86400000;
// Score change against the latest snapshot that is at least `days` old.
function changeSince(weekly, current, days, now) {
  const old = [...weekly].reverse().find(([d]) => (now - new Date(d)) / DAY >= days);
  return old && Number.isFinite(current) ? current - old[1] : null;
}

function buildIndex({ snapshot = false } = {}) {
  const files = readdirSync(COMPANIES).filter((f) => f.endsWith(".json"));
  const all = files.map((f) => readJson(join(COMPANIES, f)));
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Pass 1: absolute metrics -> sector benchmarks (percentiles). Pass 2: scores relative to the sector.
  const benchmarks = computeBenchmarks(all.map((c) => ({ sector: c.sector, a: analyze(c) })));
  writeFileSync(join(DATA, "benchmarks.json"), JSON.stringify({ generated: new Date().toISOString(), engineVersion: ENGINE_VERSION, sectors: benchmarks }) + "\n");

  const news = [];
  const companies = all.map((c) => {
    const a = analyze(c, { benchmarks });
    const row = { t: c.ticker, n: c.name, s: c.sector || null, ex: c.exchange || null };
    if (c.industry) row.i = c.industry;
    if (c.currency && c.currency !== "USD") row.cur = c.currency;
    if (c.demo) row.demo = true;
    if (a.ok) {
      row.y = a.latestYear;
      row.sc = ["overall", ...DIMENSIONS].map((k) => a.scores[k] ?? null);
      row.d = a.distress.level;
      row.o = a.outlook.level;
      if (a.styles.length) row.st = a.styles;
      row.cov = a.coverage;
      if (a.metrics.marketCap) row.mc = Math.round(a.metrics.marketCap);
      if (Number.isFinite(a.metrics.peRatio)) row.pe = +a.metrics.peRatio.toFixed(1);
      if (Number.isFinite(a.metrics.dividendYield)) row.dy = +a.metrics.dividendYield.toFixed(4);
      const crit = a.flags.filter((f) => f.level === "critical").map((f) => f.id);
      if (crit.length) row.cf = crit;
      const dv = dividendProfile(c, a);
      if (dv.payer && Number.isFinite(dv.score)) row.ds = dv.score;
    }
    if (Number.isFinite(c.market?.price)) row.px = c.market.price;
    // TeraScore Trend: change against the previous fiscal year (point-in-time) and against weekly snapshots.
    const hist = a.ok ? scoreHistory(c, { benchmarks }) : [];
    if (hist.length >= 2) {
      row.ch = hist[hist.length - 1].overall - hist[hist.length - 2].overall;
      row.chy = hist[hist.length - 2].year;
    }
    const weekly = c.scoreHistory?.weekly || [];
    const cur = a.ok ? a.scores.overall : null;
    if (snapshot && Number.isFinite(cur) && weekly.at(-1)?.[0] !== today) {
      weekly.push([today, cur, a.scores.risk ?? null]);
      c.scoreHistory = { weekly: weekly.slice(-MAX_WEEKLY) };
      writeFileSync(join(COMPANIES, `${c.ticker}.json`), JSON.stringify(c) + "\n");
    }
    const c4 = changeSince(weekly, cur, 28, now), c13 = changeSince(weekly, cur, 91, now);
    if (c4 !== null) row.c4 = c4;
    if (c13 !== null) row.c13 = c13;
    const major = (c.events || []).filter((e) => e.severity >= 4).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
    if (major) row.le = `${major.date}|${major.items.join(",")}`;
    for (const e of c.events || []) if (e.severity >= 3) news.push({ t: c.ticker, n: c.name, mc: row.mc ?? null, ...e });
    return row;
  }).sort((a, b) => a.t.localeCompare(b.t));
  const index = { generated: new Date().toISOString(), engineVersion: ENGINE_VERSION, scoreKeys: ["overall", ...DIMENSIONS], count: companies.length, companies };
  writeFileSync(join(DATA, "index.json"), JSON.stringify(index) + "\n");
  // Major-events feed: newest first. Critical events and major events of companies above $1 billion
  // are kept for the full 12 months; of the rest only the latest 150.
  news.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.severity - a.severity));
  const top = (e) => e.severity >= 5 || (e.severity >= 4 && (e.mc ?? 0) >= 1e9);
  const rest = news.filter((e) => !top(e)).slice(0, 150);
  const kept = news.filter((e) => top(e) || rest.includes(e));
  writeFileSync(join(DATA, "news.json"), JSON.stringify({ generated: index.generated, events: kept }) + "\n");
  console.log(`data/index.json: ${companies.length} companies; data/news.json: ${kept.length} events; data/benchmarks.json: ${Object.keys(benchmarks).length} sectors.`);
}

if (!indexOnly) await updateCompanies();
// Weekly snapshots are recorded only by full data updates, not by index rebuilds.
buildIndex({ snapshot: !indexOnly && !onlyTickers && limit === Infinity });
