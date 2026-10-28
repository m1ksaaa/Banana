// Insider transactions (SEC Form 4) from the SEC's quarterly "Insider Transactions Data Sets".
// One ZIP per quarter contains every Form 3/4/5 in structured TSV tables; the last four available
// quarters give a 12-month view per issuer. Only open-market purchases (code P) and sales (code S)
// are counted: grants, option exercises and tax withholdings say little about insiders' views.

import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const URLS = [
  (q) => `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${q}_form345.zip`,
  (q) => `https://www.sec.gov/files/dera/data/insider-transactions-data-sets/${q}_form345.zip`,
];

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

// "15-JAN-2024" or "2024-01-15" -> "2024-01-15"
export function isoDate(s) {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/i.exec(String(s).trim());
  if (m) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
  return String(s).slice(0, 10);
}

export function recentQuarters(now = new Date(), n = 6) {
  const out = [];
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}q${q}`);
    if (--q === 0) { q = 4; y--; }
  }
  return out;
}

async function readTsv(file, onRow) {
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    const cols = line.split("\t");
    if (!header) { header = cols.map((c) => c.trim().toUpperCase()); continue; }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i];
    onRow(row);
  }
}

function findFile(dir, name) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (f.toUpperCase() === name) return p;
  }
  return null;
}

// Aggregates one extracted quarter into `acc` (issuer CIK -> summary).
export async function aggregateQuarter(dir, acc, { since }) {
  const sub = findFile(dir, "SUBMISSION.TSV"), own = findFile(dir, "REPORTINGOWNER.TSV"), tr = findFile(dir, "NONDERIV_TRANS.TSV");
  if (!sub || !own || !tr) throw new Error("data set tables not found");
  const filings = new Map();
  await readTsv(sub, (r) => {
    if (!String(r.DOCUMENT_TYPE || "").startsWith("4")) return;
    filings.set(r.ACCESSION_NUMBER, { cik: String(r.ISSUERCIK || "").padStart(10, "0"), plan: /^(1|true|y)/i.test(r.AFF10B5ONE || "") });
  });
  const owners = new Map();
  await readTsv(own, (r) => {
    if (filings.has(r.ACCESSION_NUMBER) && !owners.has(r.ACCESSION_NUMBER)) {
      owners.set(r.ACCESSION_NUMBER, { name: r.RPTOWNERNAME || "", title: r.RPTOWNER_TITLE || r.RPTOWNER_RELATIONSHIP || "" });
    }
  });
  await readTsv(tr, (r) => {
    const f = filings.get(r.ACCESSION_NUMBER);
    const code = String(r.TRANS_CODE || "").trim().toUpperCase();
    if (!f || (code !== "P" && code !== "S")) return;
    const date = isoDate(r.TRANS_DATE);
    if (date < since) return;
    const shares = Number(r.TRANS_SHARES), price = Number(r.TRANS_PRICEPERSHARE);
    if (!(shares > 0) || !(price > 0)) return;
    const value = shares * price;
    const o = owners.get(r.ACCESSION_NUMBER) || { name: "", title: "" };
    const s = acc.get(f.cik) || { buy: { value: 0, shares: 0, count: 0, insiders: new Set() }, sell: { value: 0, shares: 0, count: 0, insiders: new Set() }, plannedSellValue: 0, recent: [] };
    const side = code === "P" ? s.buy : s.sell;
    side.value += value; side.shares += shares; side.count++; side.insiders.add(o.name);
    if (code === "S" && f.plan) s.plannedSellValue += value;
    s.recent.push({ date, name: o.name, title: o.title, code, shares, price: +price.toFixed(4), value: Math.round(value), plan: f.plan || undefined });
    acc.set(f.cik, s);
  });
}

export function finalize(acc, { from, to }) {
  const out = new Map();
  for (const [cik, s] of acc) {
    s.recent.sort((a, b) => (a.date < b.date ? 1 : -1));
    out.set(cik, {
      from, to,
      buy: { value: Math.round(s.buy.value), shares: Math.round(s.buy.shares), count: s.buy.count, insiders: s.buy.insiders.size },
      sell: { value: Math.round(s.sell.value), shares: Math.round(s.sell.shares), count: s.sell.count, insiders: s.sell.insiders.size },
      plannedSellValue: Math.round(s.plannedSellValue),
      recent: s.recent.slice(0, 12),
    });
  }
  return out;
}

// Downloads and aggregates the last 12 months. Returns Map(cik -> summary), empty on failure.
export async function insiderActivity({ userAgent, now = new Date() } = {}) {
  const since = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const work = join(tmpdir(), "tsx-insider");
  mkdirSync(work, { recursive: true });
  const acc = new Map();
  let used = 0;
  for (const q of recentQuarters(now, 6)) {
    if (used >= 5) break; // five quarters always cover the last 365 days
    let ok = false;
    for (const url of URLS) {
      try {
        const r = await fetch(url(q), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(180000) });
        if (!r.ok) continue;
        const zip = join(work, `${q}.zip`), dir = join(work, q);
        writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
        mkdirSync(dir, { recursive: true });
        execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
        await aggregateQuarter(dir, acc, { since });
        ok = true;
        break;
      } catch (e) {
        console.warn(`  insider data ${q}: ${e.message}`);
      }
    }
    if (ok) { used++; console.log(`  insider data ${q} loaded`); }
  }
  return finalize(acc, { from: since, to: now.toISOString().slice(0, 10) });
}

