// Futtatás: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseCompanyFacts } from "../scripts/sec-parse.mjs";
import { analyze, scale, DIMENSIONS } from "../assets/js/scoring.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

test("scale: lineáris, vágott, fordított skála", () => {
  assert.equal(scale(0.15, 0, 0.30), 50);
  assert.equal(scale(-1, 0, 0.30), 0);
  assert.equal(scale(5, 0, 0.30), 100);
  assert.equal(scale(0.3, 2.5, 0.3), 100);
  assert.equal(scale(null, 0, 1), null);
});

test("SEC parser: csak éves 10-K periódusok, javított bejelentés nyer", () => {
  const a = parseCompanyFacts(load("./fixtures/companyfacts-mini.json"));
  assert.deepEqual(a.map((y) => y.year), [2022, 2023]);
  const [y22, y23] = a;
  assert.equal(y22.revenue, 1000);           // negyedéves 300 kiszűrve
  assert.equal(y23.revenue, 1150);           // 10-K/A felülírja
  assert.equal(y22.grossProfit, 400);        // bevétel − közvetlen költség
  assert.equal(y23.netIncome, -50);
  assert.equal(y23.freeCashFlow, 120);
  assert.equal(y23.epsDiluted, -0.5);
  assert.equal(y23.totalAssets, 5200);       // 1 napos eltérés elfogadva
  assert.equal(y23.totalDebt, 1000);         // hosszú + rövid lejáratú rész
  assert.equal(y22.equity, null);
});

test("Elemzés: veszteséges cégnél figyelmeztetés és 0 pontos nyereségnövekedés", () => {
  const annual = parseCompanyFacts(load("./fixtures/companyfacts-mini.json"));
  const a = analyze({ ticker: "TST", annual });
  assert.ok(a.ok);
  assert.ok(a.flags.some((f) => f.title === "Veszteséges az utolsó évben"));
  assert.equal(a.parts.growth1y.find((p) => p.key === "netIncomeYoY").score, 0);
});

test("Elemzés: üres adatnál nem dob hibát", () => {
  assert.equal(analyze({ annual: [] }).ok, false);
});

test("Minden adatfájl megfelel a sablonnak, és a pontszámok 0–100 közöttiek", () => {
  const dir = new URL("../data/companies/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const c = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    assert.equal(c.schemaVersion, 1, f);
    assert.ok(c.ticker && c.name, f);
    const a = analyze(c);
    if (!a.ok) continue;
    for (const d of [...DIMENSIONS.map((x) => x.key), "overall"]) {
      const s = a.scores[d];
      assert.ok(s === null || (s >= 0 && s <= 100), `${f} ${d}=${s}`);
    }
  }
});
