#!/usr/bin/env node
// Generates docs/SABLON.md from the engine definitions, so the documentation always
// matches the code exactly. Run: npm run docs
import { writeFileSync } from "node:fs";
import { MIN_DIMENSIONS, PROFILES, OVERALL_WEIGHTS, RISK_WEIGHTS, FLAG_PENALTY, METRIC_FORMAT, ENGINE_VERSION, FLAG_IDS } from "../assets/js/scoring.js";
import { FLOW, INSTANT } from "./sec-parse.mjs";
import hu from "../assets/js/i18n/hu.js";

const pctf = (v, d = 0) => `${(v * 100).toFixed(d).replace(".", ",")}%`;
function f(v, kind) {
  switch (kind) {
    case "pct": case "pct0": return pctf(v, Number.isInteger(v * 100) ? 0 : 1);
    case "spct": return (v > 0 ? "+" : "") + pctf(v, Number.isInteger(v * 100) ? 0 : 1);
    case "pp": return `${v > 0 ? "+" : ""}${String(v * 100).replace(".", ",")} pp`;
    case "x": case "xyears": case "mult": return `${String(v).replace(".", ",")}×`;
    default: return String(v).replace(".", ",");
  }
}
const label = (k) => hu.metrics[k][0];
const desc = (k) => hu.metrics[k][1];

const table = (parts) => [
  "| Mutató | Képlet | 0 pont | 100 pont | Súly |",
  "|---|---|---|---|---|",
  ...parts.map((p) => `| ${label(p.key)} | ${desc(p.key)} | ${f(p.bad, METRIC_FORMAT[p.key])} | ${f(p.good, METRIC_FORMAT[p.key])} | ${Math.round(p.weight * 100)}% |`),
].join("\n");

const dims = Object.keys(OVERALL_WEIGHTS).concat("marketRisk").map((d) => {
  const gen = PROFILES.general[d];
  let s = `### ${hu.dims[d].name}\n\n${hu.dims[d].q}\n\n${table(gen)}\n`;
  for (const [p, name] of [["financial", "Pénzügyi profil (bankok, biztosítók)"], ["realEstate", "Ingatlanprofil (REIT-ek)"]]) {
    if (PROFILES[p][d] !== gen) s += `\n**${name}:** ${PROFILES[p][d].length ? `\n\n${table(PROFILES[p][d])}\n` : "nem pontozott.\n"}`;
  }
  return s;
}).join("\n");

const fieldRows = (obj, extra = {}) => Object.entries(obj).map(([k, tags]) => `| \`${k}\` | ${hu.raw[k] || extra[k] || ""} | ${tags.join(", ")} |`).join("\n");

const md = `# TeraStockX adatsablon és elemzési módszertan (v${ENGINE_VERSION})

> Ez a fájl automatikusan készül a kódból (\`npm run docs\`), ezért mindig pontosan az elemzőmotor aktuális működését írja le.

\`\`\`
SEC EDGAR (10-K, 10-Q, 20-F)  ─┐
Nasdaq (lista, árfolyam)       ├─▶  sablon JSON  ─▶  elemzőmotor  ─▶  weboldal (5 nyelv)
Yahoo / Stooq (árfolyam-előzm.)┘    data/companies/   assets/js/scoring.js
\`\`\`

## 1. A vállalat adatfájlja – \`data/companies/<TICKER>.json\` (schemaVersion 2)

| Mező | Leírás |
|---|---|
| \`ticker\`, \`name\`, \`exchange\`, \`cik\` | Azonosítók (CIK: SEC-azonosító, 10 jegy). |
| \`sicCode\`, \`sicDescription\` | SEC iparági kód és leírás. |
| \`sector\` | Szektorkulcs (technology, healthcare, financials, realEstate, …) – a SIC-kódból képezve. |
| \`industry\` | Iparág (Nasdaq-besorolás, ennek hiányában SIC-leírás). |
| \`profile\` | Elemzési profil: \`general\`, \`financial\` (SIC 6000–6799), \`realEstate\` (SIC 65xx, 6798). |
| \`fiscalYearEndMonth\` | Az üzleti év zárásának hónapja. |
| \`market\` | \`price\`, \`priceDate\`, \`marketCap\`, \`sharesOutstanding\` (fedőlapi részvényszám), forrás. |
| \`prices\` | Havi, osztalékkal/felosztással korrigált záróárak (legfeljebb 10 év): \`[["ÉÉÉÉ-HH", ár], …]\`. |
| \`annual[]\` | Üzleti évenkénti adatok (legfeljebb 10 év) – lásd lent. |
| \`ttm\` | Utolsó 12 hónap (TTM) eredmény- és cash flow-adatai. |
| \`latestBalance\` | Mérleg a legutóbbi negyedév végén. |
| \`source\`, \`demo\` | Adatforrás és letöltés ideje; \`demo: true\` = közelítő mintaadat. |

Minden összeg **USD-ben, egész dollárban**. A hiányzó adat \`null\`.

### Eredménykimutatás és cash flow (időszaki adatok)

| Mező | Megnevezés | XBRL-címkék prioritási sorrendben |
|---|---|---|
${fieldRows(FLOW)}
| \`epsDiluted\` | ${hu.raw.epsDiluted} | EarningsPerShareDiluted, EarningsPerShareBasicAndDiluted, EarningsPerShareBasic |
| \`sharesDiluted\` | ${hu.raw.sharesDiluted} | WeightedAverageNumberOfDilutedSharesOutstanding, … |
| \`grossProfit\` | (ha hiányzik) | árbevétel − közvetlen költségek |
| \`freeCashFlow\` | ${hu.raw.freeCashFlow} | működési cash flow − beruházások |

### Mérleg (fordulónapi adatok)

| Mező | Megnevezés | XBRL-címkék |
|---|---|---|
${fieldRows(INSTANT)}
| \`totalDebt\` | ${hu.raw.totalDebt} | LongTermDebtNoncurrent + LongTermDebtCurrent + CommercialPaper + ShortTermBorrowings; bontás hiányában LongTermDebt |
| \`sharesOutstanding\` | ${hu.raw.sharesOutstanding} | CommonStockSharesOutstanding |

### Adatkiválasztási szabályok

1. Éves adat csak éves jelentésből (10-K, 10-K/A, 20-F, 40-F) és csak 340–390 napos időszakra számít – a jelentésekben szereplő negyedéves bontás így kiesik.
2. Ha egy időszakra több érték van, a magasabb prioritású címke, azon belül a **legkésőbb benyújtott** (helyesbített) érték nyer.
3. A címkéket évek között összefésüljük (a cégek idővel címkét váltanak, pl. SalesRevenueNet → RevenueFromContractWithCustomer…).
4. Mérlegadatnál legfeljebb 7 nap eltérés megengedett a fordulónaptól (52/53 hetes üzleti év).
5. **TTM** = utolsó üzleti év + tárgyévi halmozott (YTD) negyedéves adat − előző év azonos YTD-időszaka. Ha nincs frissebb negyedéves jelentés, az éves adat érvényes.
6. Többosztályú részvényeknél a fedőlapi részvényszámok összeadódnak.

## 2. Pontozás

Minden mutatót lineárisan váltunk 0–100 pontra a „0 pont” és „100 pont” érték között, azon kívül vágva. Egy szempont pontszáma a mutatók súlyozott átlaga; hiányzó mutató kimarad, a többi súlya arányosan nő. Egy szempont csak akkor kap pontszámot, ha a mutatói legalább felének (súly szerint) van adata. Az értékeltség a TTM-adatokon alapul (ha elérhető), a többi szempont az auditált éves adatokon. A hosszú távú mutatók legfeljebb az utolsó 6 üzleti évet (5 év változást) veszik figyelembe.

${dims}

### Különleges esetek

- Negatív saját tőkénél a ROE nem pontozott, az adósság/saját tőke 0 pont.
- Kamatráfordítás nélkül a kamatfedezet 100 pont; nettó készpénz esetén a nettó adósság/EBITDA 100 pont.
- Veszteséges utolsó év esetén az EPS-növekedés és az EPS CAGR 0 pont (negatív bázisról a növekedés nem értelmezhető).
- Osztalék nélkül a kifizetési arány nem pontozott; az FCF-et meghaladó osztalék 0 pont.
- Veszteség esetén a P/E és a PEG 0 pont.

## 3. Összesítés

**TeraScore** – a kilenc fundamentális szempont súlyozott átlaga. Csak akkor számolódik (a kockázattal együtt), ha legalább ${MIN_DIMENSIONS} szempontra van adat; különben a vállalat „nincs minősítve”.

| Szempont | Súly |
|---|---|
${Object.entries(OVERALL_WEIGHTS).map(([k, w]) => `| ${hu.dims[k].name} | ${Math.round(w * 100)}% |`).join("\n")}

**Kockázat** (alacsonyabb = jobb):

\`\`\`
biztonság   = súlyozott átlag(${Object.entries(RISK_WEIGHTS).map(([k, w]) => `${hu.dims[k].name} ${Math.round(w * 100)}%`).join(", ")})
              árfolyam-előzmény esetén: 75% × biztonság + 25% × piaci kockázati pontszám
Kockázat    = 100 − biztonság + ${FLAG_PENALTY.critical} × kritikus jelzések + ${FLAG_PENALTY.warning} × figyelmeztetések   (0–100 közé vágva)
\`\`\`

**Minősítési sávok:** 80–100 Kiváló · 65–79 Erős · 45–64 Mérsékelt · 25–44 Gyenge · 0–24 Kritikus (kockázatnál fordítva: 0–20 nagyon alacsony … 76–100 nagyon magas). A szín mellett mindig szöveges minősítés is megjelenik.

## 4. Csődkockázat, trend, befektetési profil

${hu.method.distressText}

**Hosszú távú trend:** ${hu.method.trendText}

**Befektetési profil:** ${hu.method.stylesText}

**Szektor-összehasonlítás:** ${hu.method.sectorText}

## 5. Jelzések (${FLAG_IDS.length})

| Azonosító | Jelzés | Leírás |
|---|---|---|
${FLAG_IDS.map((id) => `| \`${id}\` | ${hu.flags[id][0]} | ${hu.flags[id][1].replace(/\{(\w+)\}/g, "‹$1›")} |`).join("\n")}

## 6. Korlátok

${hu.method.limitsText}
`;

writeFileSync(new URL("../docs/SABLON.md", import.meta.url), md);
console.log("docs/SABLON.md generated.");
