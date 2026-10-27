// SEC EDGAR "companyfacts" (XBRL) JSON -> TeraStockX template.
// Companies use different XBRL tags for the same line item, so every field has a
// priority-ordered tag list; the first tag that has data wins.
//
// Produces:
//   annual[]       – fiscal-year figures from annual reports (10-K / 20-F / 40-F)
//   ttm            – trailing-twelve-month flows from the latest quarterly report (FY + YTD − prior YTD)
//   latestBalance  – balance sheet at the latest reported quarter end
//   sharesOutstanding – latest cover-page share count (dei:EntityCommonStockSharesOutstanding)

export const FLOW = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"],
  grossProfit: ["GrossProfit"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  operatingIncome: ["OperatingIncomeLoss"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"],
  pretaxIncome: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  depreciationAndAmortization: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"],
  shareBasedCompensation: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"],
};

const FLOW_PER_SHARE = { epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"] };
const FLOW_SHARES = { sharesDiluted: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic"] };

export const INSTANT = {
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndDueFromBanks", "Cash"],
  inventory: ["InventoryNet", "InventoryFinishedGoodsNetOfReserves"],
  accountsReceivable: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
};

// Financial debt = sum of components; if no breakdown is reported, a total tag is used.
const DEBT_PARTS = [
  ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "SeniorLongTermNotes"],
  ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "DebtCurrent"],
  ["CommercialPaper"],
  ["ShortTermBorrowings"],
];
const DEBT_TOTAL = ["LongTermDebt", "DebtInstrumentCarryingAmount", "DebtLongtermAndShorttermCombinedAmount"];
const SHARES_INSTANT = ["CommonStockSharesOutstanding"];

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"]);
const QUARTER_FORMS = new Set(["10-Q", "10-Q/A", "6-K"]);

const DAY = 86400000;
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);

function node(facts, tag) {
  return facts?.["us-gaap"]?.[tag] || facts?.["ifrs-full"]?.[tag] || facts?.dei?.[tag] || null;
}

// Values of all tags in the list. Companies switch tags over the years (e.g. SalesRevenueNet
// before 2018), so periods are merged across tags; for the same period the higher-priority tag wins.
function entries(facts, tags, unit, forms) {
  const out = [];
  tags.forEach((tag, p) => {
    const arr = node(facts, tag)?.units?.[unit];
    if (arr) for (const v of arr) if (forms.has(v.form)) out.push({ ...v, _p: p });
  });
  return out;
}

// One value per key: higher-priority tag first, then the latest filing (restatements).
function dedupe(list, keyFn) {
  const map = new Map();
  for (const v of list) {
    const k = keyFn(v);
    const prev = map.get(k);
    if (!prev || (v._p ?? 0) < (prev._p ?? 0) || ((v._p ?? 0) === (prev._p ?? 0) && (v.filed || "") > (prev.filed || ""))) map.set(k, v);
  }
  return map;
}

const ALL_FORMS = new Set([...ANNUAL_FORMS, ...QUARTER_FORMS]);

function flowSeries(facts, tags, unit) {
  const all = entries(facts, tags, unit, ALL_FORMS).filter((v) => v.start && v.end);
  const annual = new Map();
  for (const [, v] of dedupe(all.filter((v) => { const d = days(v.start, v.end); return d >= 340 && d <= 390; }), (v) => v.end)) annual.set(v.end, v.val);
  const durations = [...dedupe(all, (v) => `${v.start}|${v.end}`).values()];
  return { annual, durations };
}

function instantSeries(facts, tags, unit = "USD") {
  const all = entries(facts, tags, unit, ALL_FORMS).filter((v) => !v.start && v.end);
  return new Map([...dedupe(all, (v) => v.end)].map(([k, v]) => [k, v.val]));
}

// Value at a date, accepting up to 7 days of difference (52/53-week fiscal years).
function atDate(map, end) {
  if (map.has(end)) return map.get(end);
  for (const [k, v] of map) if (Math.abs(days(k, end)) <= 7) return v;
  return null;
}

function findDuration(durations, start, end, tol = 7) {
  let best = null;
  for (const v of durations) {
    if (Math.abs(days(v.end, end)) <= tol && Math.abs(days(v.start, start)) <= tol) {
      if (!best || (v.filed || "") > (best.filed || "")) best = v;
    }
  }
  return best;
}

// Trailing twelve months ending at quarter end E: FY + YTD(E) − YTD(E − 1 year).
function ttmValue(series, fyEnd, qEnd) {
  const fy = atDate(series.annual, fyEnd);
  if (qEnd === fyEnd) return fy;
  const ytdStart = addDays(fyEnd, 1);
  const ytd = findDuration(series.durations, ytdStart, qEnd);
  const prior = findDuration(series.durations, addDays(ytdStart, -365), addDays(qEnd, -365), 10);
  if (fy === null || !ytd || !prior) return null;
  return fy + ytd.val - prior.val;
}

function debtAt(debtParts, debtTotal, end) {
  const parts = debtParts.map((m) => atDate(m, end));
  const total = atDate(debtTotal, end);
  if (parts.some((p) => p !== null)) {
    if (parts[0] === null && total !== null) return total + (parts[2] ?? 0) + (parts[3] ?? 0);
    return parts.reduce((a, b) => a + (b ?? 0), 0);
  }
  return total;
}

function finishPeriod(y) {
  if (y.grossProfit === null && y.revenue !== null && y.costOfRevenue !== null) y.grossProfit = y.revenue - y.costOfRevenue;
  for (const k of ["capex", "dividendsPaid", "buybacks"]) if (y[k] !== null && y[k] !== undefined) y[k] = Math.abs(y[k]);
  y.freeCashFlow = y.operatingCashFlow !== null && y.capex !== null ? y.operatingCashFlow - y.capex : null;
  return y;
}

export function parseCompanyFacts(cf, { maxYears = 10 } = {}) {
  const facts = cf.facts || {};
  const flows = {};
  for (const [k, tags] of Object.entries(FLOW)) flows[k] = flowSeries(facts, tags, "USD");
  for (const [k, tags] of Object.entries(FLOW_PER_SHARE)) flows[k] = flowSeries(facts, tags, "USD/shares");
  for (const [k, tags] of Object.entries(FLOW_SHARES)) flows[k] = flowSeries(facts, tags, "shares");
  const inst = {};
  for (const [k, tags] of Object.entries(INSTANT)) inst[k] = instantSeries(facts, tags);
  const debtParts = DEBT_PARTS.map((tags) => instantSeries(facts, tags));
  const debtTotal = instantSeries(facts, DEBT_TOTAL);
  const sharesInst = instantSeries(facts, SHARES_INSTANT, "shares");

  // Fiscal year ends come from the annual revenue (or net income) periods.
  const anchor = flows.revenue.annual.size ? flows.revenue : flows.netIncome;
  const ends = [...anchor.annual.keys()].sort().slice(-maxYears);

  const balanceAt = (end) => {
    const b = {};
    for (const k of Object.keys(inst)) b[k] = atDate(inst[k], end);
    b.totalDebt = debtAt(debtParts, debtTotal, end);
    b.sharesOutstanding = atDate(sharesInst, end);
    return b;
  };

  const byYear = new Map();
  for (const end of ends) {
    const y = { year: Number(end.slice(0, 4)), periodEnd: end };
    for (const k of Object.keys(flows)) y[k] = flows[k].annual.get(end) ?? null;
    Object.assign(y, balanceAt(end));
    byYear.set(y.year, finishPeriod(y)); // a fiscal-year change keeps the later period
  }
  const annual = [...byYear.values()].sort((a, b) => a.year - b.year);

  // ---- TTM and latest balance sheet ----
  let ttm = null, latestBalance = null;
  const fyEnd = ends[ends.length - 1];
  if (fyEnd) {
    const qEnds = [...anchor.durations].map((v) => v.end).filter((e) => e > fyEnd && days(fyEnd, e) < 370);
    const qEnd = qEnds.sort().pop();
    if (qEnd) {
      const t = { periodEnd: qEnd };
      for (const k of Object.keys(flows)) t[k] = k === "sharesDiluted" ? null : ttmValue(flows[k], fyEnd, qEnd);
      if (t.revenue !== null || t.netIncome !== null) {
        ttm = finishPeriod(t);
        latestBalance = { periodEnd: qEnd, ...balanceAt(qEnd) };
      }
    }
  }

  // Latest cover-page share count (any filing type).
  const dei = node(facts, "EntityCommonStockSharesOutstanding")?.units?.shares || [];
  const latestShares = dei.filter((v) => v.end).sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : (a.filed || "") < (b.filed || "") ? -1 : 1));
  // Multi-class companies report one value per class on the same date: sum them.
  let sharesOutstanding = null, sharesDate = null;
  if (latestShares.length) {
    sharesDate = latestShares[latestShares.length - 1].end;
    const sameDate = dedupe(latestShares.filter((v) => v.end === sharesDate), (v) => `${v.frame || ""}|${v.val}`);
    sharesOutstanding = [...sameDate.values()].reduce((a, v) => a + v.val, 0);
  }

  return { annual, ttm, latestBalance, sharesOutstanding, sharesOutstandingDate: sharesDate };
}
