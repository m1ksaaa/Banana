#!/usr/bin/env node
// TeraStockX adatfrissítő.
// 1) Letölti a NASDAQ-on jegyzett összes részvény listáját (nasdaqtrader.com).
// 2) A SEC EDGAR-ból hozzárendeli a CIK azonosítókat.
// 3) Minden céghez letölti a hivatalos éves (10-K / 20-F) XBRL adatokat, és a sablon szerint menti:
//    data/companies/<TICKER>.json
// 4) Lefuttatja az elemzőmotort, és elkészíti a kereső listát: data/index.json
//
// Használat:
//   SEC_USER_AGENT="Név email@cim.hu" node scripts/update-data.mjs            # minden NASDAQ cég
//   node scripts/update-data.mjs --tickers AAPL,MSFT                          # csak megadott cégek
//   node scripts/update-data.mjs --limit 50                                   # első 50 cég (teszteléshez)
//   node scripts/update-data.mjs --index-only                                 # csak data/index.json újraépítése

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompanyFacts } from "./sec-parse.mjs";
import { analyze, ENGINE_VERSION } from "../assets/js/scoring.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const COMPANIES = join(DATA, "companies");
const UA = process.env.SEC_USER_AGENT || "TeraStockX (github.com/m1ksaaa/Banana)";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const indexOnly = args.includes("--index-only");
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const onlyTickers = opt("--tickers") ? new Set(opt("--tickers").split(",").map((s) => s.trim().toUpperCase())) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = "json", tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
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
    .filter((c) => c[col("Test Issue")] === "N" && c[col("ETF")] === "N")
    .map((c) => ({ ticker: c[col("Symbol")], name: cleanName(c[col("Security Name")]), financialStatus: c[col("Financial Status")] }));
}

function cleanName(n) {
  return n.replace(/\s+-\s+(Class [A-Z] )?(Common Stock|Ordinary Shares|American Depositary Shares).*$/i, "").trim();
}

async function secTickers() {
  const j = await get("https://www.sec.gov/files/company_tickers_exchange.json");
  const map = new Map();
  const f = j.fields;
  for (const row of j.data) {
    const r = Object.fromEntries(f.map((k, i) => [k, row[i]]));
    map.set(String(r.ticker).toUpperCase(), { cik: String(r.cik).padStart(10, "0"), name: r.name, exchange: r.exchange });
  }
  return map;
}

async function sicDescription(cik) {
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  return { sector: sub?.sicDescription || null, fiscalYearEnd: sub?.fiscalYearEnd || null };
}

async function updateCompanies() {
  mkdirSync(COMPANIES, { recursive: true });
  console.log("NASDAQ lista letöltése…");
  let list = await nasdaqListed();
  console.log(`  ${list.length} részvény (ETF-ek és teszt-papírok nélkül)`);
  const ciks = await secTickers();
  if (onlyTickers) list = list.filter((x) => onlyTickers.has(x.ticker));
  list = list.slice(0, limit);

  let ok = 0, noData = 0, failed = 0;
  for (const [i, item] of list.entries()) {
    const sec = ciks.get(item.ticker.replace(".", "-")) || ciks.get(item.ticker);
    const base = { schemaVersion: 1, ticker: item.ticker, name: item.name, exchange: "NASDAQ", currency: "USD", demo: false };
    try {
      if (!sec) { noData++; writeCompany({ ...base, cik: null, sector: null, source: null, annual: [], note: "Nincs SEC-azonosító (valószínűleg alap, warrant, unit vagy külföldi papír)." }); continue; }
      const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${sec.cik}.json`);
      await sleep(120); // SEC limit: max. 10 kérés / másodperc
      const meta = await sicDescription(sec.cik);
      await sleep(120);
      const annual = cf ? parseCompanyFacts(cf) : [];
      if (!annual.length) noData++; else ok++;
      writeCompany({
        ...base,
        name: cf?.entityName || item.name,
        cik: sec.cik,
        sector: meta.sector,
        fiscalYearEndMonth: meta.fiscalYearEnd ? Number(meta.fiscalYearEnd.slice(0, 2)) : null,
        source: { name: "SEC EDGAR – XBRL company facts (10-K / 20-F éves jelentések)", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sec.cik}&type=10-K`, retrieved: new Date().toISOString() },
        annual,
      });
    } catch (e) {
      failed++;
      console.warn(`  HIBA ${item.ticker}: ${e.message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${list.length} feldolgozva`);
  }
  console.log(`Kész: ${ok} cég adattal, ${noData} adat nélkül, ${failed} hiba.`);
}

function writeCompany(c) {
  // A demó adatot csak valódi adat írhatja felül; üres eredmény nem törli.
  const file = join(COMPANIES, `${c.ticker}.json`);
  if (!c.annual.length && existsSync(file)) {
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (old.annual?.length) return;
  }
  writeFileSync(file, JSON.stringify(c, null, 1) + "\n");
}

function buildIndex() {
  const files = readdirSync(COMPANIES).filter((f) => f.endsWith(".json"));
  const companies = files.map((f) => {
    const c = JSON.parse(readFileSync(join(COMPANIES, f), "utf8"));
    const a = analyze(c);
    const row = { t: c.ticker, n: c.name, s: c.sector || null };
    if (c.demo) row.demo = true;
    if (a.ok) {
      row.y = a.latestYear;
      row.sc = a.scores;
      row.d = a.distress.level;
      row.cov = a.coverage;
    }
    return row;
  }).sort((a, b) => a.t.localeCompare(b.t));
  const index = { generated: new Date().toISOString(), engineVersion: ENGINE_VERSION, count: companies.length, companies };
  writeFileSync(join(DATA, "index.json"), JSON.stringify(index) + "\n");
  console.log(`data/index.json: ${companies.length} cég.`);
}

if (!indexOnly) await updateCompanies();
buildIndex();
