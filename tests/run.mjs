// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseCompanyFacts, normalizeShares, splitEvidence } from "../scripts/sec-parse.mjs";
import { sectorFromSic, profileFor } from "../scripts/sectors.mjs";
import { analyze, scale, DIMENSIONS, METRIC_FORMAT, PROFILES, FLAG_IDS, marketStats } from "../assets/js/scoring.js";
import { LANGS } from "../assets/js/i18n/index.js";
import { EVENT_SEVERITY, majorEvents } from "../scripts/events.mjs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const fixture = () => parseCompanyFacts(load("./fixtures/companyfacts-mini.json"));

test("scale: linear, clamped, inverted", () => {
  assert.equal(scale(0.15, 0, 0.30), 50);
  assert.equal(scale(-1, 0, 0.30), 0);
  assert.equal(scale(5, 0, 0.30), 100);
  assert.equal(scale(0.3, 2.5, 0.3), 100);
  assert.equal(scale(null, 0, 1), null);
});

test("SEC parser: annual periods only, restatement wins, tags merged", () => {
  const { annual } = fixture();
  assert.deepEqual(annual.map((y) => y.year), [2022, 2023]);
  const [y22, y23] = annual;
  assert.equal(y22.revenue, 1000);      // quarterly 300 ignored
  assert.equal(y23.revenue, 1150);      // 10-K/A overrides
  assert.equal(y22.grossProfit, 400);
  assert.equal(y23.netIncome, -50);
  assert.equal(y23.freeCashFlow, 120);
  assert.equal(y23.epsDiluted, -0.5);
  assert.equal(y23.totalAssets, 5200);  // 1-day offset accepted
  assert.equal(y23.totalDebt, 1000);
  assert.equal(y22.equity, null);
});

test("SEC parser: TTM = FY + YTD − prior YTD, latest balance and shares", () => {
  const p = fixture();
  assert.equal(p.ttm.periodEnd, "2024-06-30");
  assert.equal(p.ttm.revenue, 1150 + 600 - 500);
  assert.equal(p.latestBalance.totalAssets, 5600);
  assert.equal(p.sharesOutstanding, 300);
});

test("Analysis: loss-maker gets flag and zero EPS growth", () => {
  const p = fixture();
  const a = analyze({ ticker: "TST", annual: p.annual, ttm: p.ttm, latestBalance: p.latestBalance });
  assert.ok(a.ok);
  assert.ok(a.flags.some((f) => f.id === "lossLastYear"));
  assert.equal(a.parts.growth1y.find((x) => x.key === "epsYoY").score, 0);
  assert.equal(a.valuationBasis, "ttm");
});

test("Analysis: empty data does not throw", () => {
  assert.equal(analyze({ annual: [] }).ok, false);
});

test("Market stats from monthly prices", () => {
  const data = Array.from({ length: 61 }, (_, i) => [`m${i}`, 100 * 1.01 ** i]);
  const s = marketStats({ data });
  assert.ok(Math.abs(s.priceReturn1y - (1.01 ** 12 - 1)) < 1e-9);
  assert.ok(s.volatility < 1e-9);
  assert.equal(s.maxDrawdown, 0);
});

test("Sectors and profiles from SIC", () => {
  assert.equal(sectorFromSic(3571), "technology");
  assert.equal(sectorFromSic(2834), "healthcare");
  assert.equal(sectorFromSic(6022), "financials");
  assert.equal(profileFor(6022, "financials"), "financial");
  assert.equal(profileFor(6798, "realEstate"), "realEstate");
  assert.equal(profileFor(7372, "technology"), "general");
});

test("Every data file matches the template and scores are within 0–100", () => {
  const dir = new URL("../data/companies/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const c = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    assert.ok(c.ticker && c.name, f);
    const a = analyze(c);
    if (!a.ok) continue;
    for (const d of [...DIMENSIONS, "overall"]) {
      const s = a.scores[d];
      assert.ok(s === null || (s >= 0 && s <= 100), `${f} ${d}=${s}`);
    }
  }
});

test("Every language has every key used by the engine", () => {
  const metricKeys = new Set(Object.values(PROFILES).flatMap((p) => Object.values(p).flat().map((x) => x.key)));
  for (const [code, d] of Object.entries(LANGS)) {
    for (const k of [...metricKeys, ...Object.keys(METRIC_FORMAT)]) assert.ok(d.metrics[k], `${code}: metrics.${k}`);
    for (const k of FLAG_IDS) assert.ok(d.flags[k], `${code}: flags.${k}`);
    for (const k of DIMENSIONS) assert.ok(d.dims[k]?.name && d.dims[k]?.summary, `${code}: dims.${k}`);
    for (const k of Object.keys(LANGS.en.ui)) assert.ok(d.ui[k], `${code}: ui.${k}`);
    for (const k of Object.keys(LANGS.en.raw)) assert.ok(d.raw[k], `${code}: raw.${k}`);
    for (const k of Object.keys(LANGS.en.method)) assert.ok(d.method[k], `${code}: method.${k}`);
    for (const k of Object.keys(LANGS.en.sectors)) assert.ok(d.sectors[k], `${code}: sectors.${k}`);
    for (const k of Object.keys(EVENT_SEVERITY)) assert.ok(d.events[k], `${code}: events.${k}`);
  }
});

test("8-K events: only significant items, last 12 months, flags raised", () => {
  const sub = { cik: "0000000001", filings: { recent: {
    form: ["8-K", "8-K", "8-K", "10-Q", "8-K"],
    filingDate: ["2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01", "2024-01-01"],
    items: ["2.02,9.01", "4.02", "5.02,1.01", "", "1.03"],
    accessionNumber: ["0001-26-1", "0001-26-2", "0001-26-3", "0001-26-4", "0001-24-5"],
    primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm", "e.htm"],
  } } };
  const ev = majorEvents(sub, { now: new Date("2026-10-01") });
  assert.deepEqual(ev.map((e) => e.items), [["4.02"], ["1.01"]]);
  assert.equal(ev[0].url, "https://www.sec.gov/Archives/edgar/data/1/0001262/b.htm");
  const p = fixture();
  const a = analyze({ annual: p.annual, events: ev }, { now: new Date("2026-10-01") });
  assert.ok(a.flags.some((f) => f.id === "restatement" && f.level === "critical"));
});

const sh = (start, end, val, filed) => ({ start, end, val, filed, form: "10-K" });

test("Split dates come from re-reported periods", () => {
  const facts = { "us-gaap": {
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
      sh("2019-01-01", "2019-12-31", 177e6, "2020-02-13"), sh("2019-01-01", "2019-12-31", 887e6, "2021-02-08"),
      sh("2020-01-01", "2020-12-31", 1083e6, "2021-02-08"), sh("2020-01-01", "2020-12-31", 3249e6, "2023-01-31"),
    ] } },
  } };
  assert.deepEqual(splitEvidence(facts), [{ factor: 5, date: "2021-02-08" }, { factor: 3, date: "2023-01-31" }]);
});

test("Tesla-like history: 5:1 then 3:1 with real issuance in between", () => {
  // Each year as last reported: 2018 in the 2020 10-K (pre 5:1), 2019 in the 2021 10-K (post 5:1),
  // 2020–2022 in the 2023 10-K (post 3:1 as well).
  const annual = [
    { year: 2018, sharesDiluted: 171e6, epsDiluted: -5.72, netIncome: -976e6 },
    { year: 2019, sharesDiluted: 887e6, epsDiluted: -0.98, netIncome: -862e6 },
    { year: 2020, sharesDiluted: 3249e6, epsDiluted: 0.21, netIncome: 690e6 },
    { year: 2021, sharesDiluted: 3386e6, epsDiluted: 1.63, netIncome: 5519e6 },
  ];
  const events = [{ factor: 5, date: "2020-10-26" }, { factor: 3, date: "2022-10-24" }];
  const filed = ["2020-02-13", "2021-02-08", "2023-01-31", "2023-01-31"];
  assert.deepEqual(normalizeShares(annual, events, filed), [{ year: 2019, factor: 5 }, { year: 2020, factor: 3 }]);
  assert.equal(annual[0].sharesDiluted, 171e6 * 15);
  assert.equal(annual[1].sharesDiluted, 887e6 * 3);
  assert.ok(Math.abs(annual[1].epsDiluted - -0.98 / 3) < 1e-9);
});

test("Split detected from EPS when share counts are missing", () => {
  const annual = [
    { year: 2019, netIncome: 34.3e9, epsDiluted: 49.16 },
    { year: 2020, netIncome: 40.3e9, epsDiluted: 2.93 },
    { year: 2021, netIncome: 76e9, epsDiluted: 5.61 },
  ];
  const events = [{ factor: 20, date: "2022-07-18" }];
  assert.deepEqual(normalizeShares(annual, events, ["2021-02-03", "2023-02-03", "2023-02-03"]), [{ year: 2020, factor: 20 }]);
  assert.ok(Math.abs(annual[0].epsDiluted - 49.16 / 20) < 1e-9);
});

test("Unit errors fixed; genuine dilution is not mistaken for a split", () => {
  const annual = [
    { year: 2020, sharesDiluted: 100e3, netIncome: 1e8, epsDiluted: 1 },
    { year: 2021, sharesDiluted: 150e6 },
    { year: 2022, sharesDiluted: 300e6 },
  ];
  assert.deepEqual(normalizeShares(annual, [], ["2021-01-01", "2022-01-01", "2023-01-01"]), []);
  assert.equal(annual[0].sharesDiluted, 100e6);
});
