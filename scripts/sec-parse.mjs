// SEC EDGAR "companyfacts" (XBRL) JSON -> TeraStockX sablon éves adatai.
// A cégek eltérő XBRL-címkéket használnak ugyanarra a tételre, ezért minden
// mezőhöz egy prioritási sorrendű címkelista tartozik; az első találat nyer.

const FLOW = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"],
};

const FLOW_PER_SHARE = {
  epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
};

const FLOW_SHARES = {
  sharesDiluted: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic"],
};

const INSTANT = {
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
};

// Az adósság több tétel összege; ha a részletes bontás hiányzik, az összesített címkét használjuk.
const DEBT_PARTS = [
  ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable"],
  ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  ["CommercialPaper"],
  ["ShortTermBorrowings"],
];
const DEBT_TOTAL = ["LongTermDebt", "DebtInstrumentCarryingAmount"];

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"]);

const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;

function unitValues(facts, tag, unitPred) {
  const node = facts?.["us-gaap"]?.[tag] || facts?.["ifrs-full"]?.[tag];
  if (!node) return [];
  const out = [];
  for (const [unit, arr] of Object.entries(node.units || {})) {
    if (!unitPred(unit)) continue;
    for (const v of arr) if (ANNUAL_FORMS.has(v.form)) out.push(v);
  }
  return out;
}

const isUsd = (u) => u === "USD";
const isUsdPerShare = (u) => u === "USD/shares";
const isShares = (u) => u === "shares";

// Éves (kb. 365 napos) időszakok értékei, a periódus vége szerint. Ha ugyanarra
// a periódusra több bejelentés is van, a legkésőbb beadott (javított) érték nyer.
function annualFlow(facts, tags, unitPred) {
  for (const tag of tags) {
    const map = new Map();
    for (const v of unitValues(facts, tag, unitPred)) {
      if (!v.start || !v.end) continue;
      const d = days(v.start, v.end);
      if (d < 340 || d > 390) continue;
      const prev = map.get(v.end);
      if (!prev || (v.filed || "") > (prev.filed || "")) map.set(v.end, v);
    }
    if (map.size) return new Map([...map].map(([k, v]) => [k, v.val]));
  }
  return new Map();
}

function instantValues(facts, tags) {
  for (const tag of tags) {
    const map = new Map();
    for (const v of unitValues(facts, tag, isUsd)) {
      if (v.start) continue;
      const prev = map.get(v.end);
      if (!prev || (v.filed || "") > (prev.filed || "")) map.set(v.end, v);
    }
    if (map.size) return new Map([...map].map(([k, v]) => [k, v.val]));
  }
  return new Map();
}

// Mérleg-adat a pénzügyi év végén; néhány napos eltérést is elfogadunk.
function atDate(map, end) {
  if (map.has(end)) return map.get(end);
  for (const [k, v] of map) if (Math.abs(days(k, end)) <= 7) return v;
  return null;
}

export function parseCompanyFacts(cf, { maxYears = 10 } = {}) {
  const facts = cf.facts || {};
  const flows = {};
  for (const [k, tags] of Object.entries(FLOW)) flows[k] = annualFlow(facts, tags, isUsd);
  for (const [k, tags] of Object.entries(FLOW_PER_SHARE)) flows[k] = annualFlow(facts, tags, isUsdPerShare);
  for (const [k, tags] of Object.entries(FLOW_SHARES)) flows[k] = annualFlow(facts, tags, isShares);
  const inst = {};
  for (const [k, tags] of Object.entries(INSTANT)) inst[k] = instantValues(facts, tags);
  const debtParts = DEBT_PARTS.map((tags) => instantValues(facts, tags));
  const debtTotal = instantValues(facts, DEBT_TOTAL);

  // A pénzügyi évek végét a bevétel (vagy nettó eredmény) éves periódusai adják.
  const anchor = flows.revenue.size ? flows.revenue : flows.netIncome;
  const ends = [...anchor.keys()].sort().slice(-maxYears);

  const annual = ends.map((end) => {
    const y = { year: Number(end.slice(0, 4)), periodEnd: end };
    for (const k of Object.keys(flows)) y[k] = flows[k].get(end) ?? null;
    for (const k of Object.keys(inst)) y[k] = atDate(inst[k], end);
    const parts = debtParts.map((m) => atDate(m, end));
    const total = atDate(debtTotal, end);
    if (parts.some((p) => p !== null)) {
      y.totalDebt = parts.reduce((a, b) => a + (b ?? 0), 0);
      // Ha csak a rövid lejáratú részek ismertek, de van összesített hosszú lejáratú adat, azt használjuk alapnak.
      if (parts[0] === null && total !== null) y.totalDebt = total + (parts[2] ?? 0) + (parts[3] ?? 0);
    } else y.totalDebt = total;
    if (y.grossProfit === null && y.revenue !== null && y.costOfRevenue !== null) y.grossProfit = y.revenue - y.costOfRevenue;
    if (y.capex !== null) y.capex = Math.abs(y.capex);
    if (y.operatingCashFlow !== null && y.capex !== null) y.freeCashFlow = y.operatingCashFlow - y.capex;
    else y.freeCashFlow = null;
    return y;
  });

  // Ha két periódus ugyanarra a naptári évre esik (pl. pénzügyi év váltás), az utóbbit tartjuk meg.
  const byYear = new Map();
  for (const y of annual) byYear.set(y.year, y);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}
