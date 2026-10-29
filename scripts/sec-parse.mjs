// SEC EDGAR "companyfacts" (XBRL) JSON -> TeraStockX template.
// Companies use different XBRL tags for the same line item, so every field has a
// priority-ordered tag list; the first tag that has data wins.
//
// Produces:
//   annual[]       – fiscal-year figures from annual reports (10-K / 20-F / 40-F)
//   ttm            – trailing-twelve-month flows from the latest quarterly report (FY + YTD − prior YTD)
//   latestBalance  – balance sheet at the latest reported quarter end
//   quarterly[]    – the last 12 fiscal quarters (three-month flows, balance sheet at quarter end)
//   sharesOutstanding – latest cover-page share count (dei:EntityCommonStockSharesOutstanding)

export const FLOW = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating", "Revenue", "RevenueFromContractsWithCustomers"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices", "CostOfSales"],
  grossProfit: ["GrossProfit"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  operatingIncome: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense", "FinanceCosts", "InterestExpenseOnBorrowings"],
  pretaxIncome: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic", "ProfitLossBeforeTax"],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
  netIncome: ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  depreciationAndAmortization: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation", "DepreciationAndAmortisationExpense", "AdjustmentsForDepreciationAndAmortisationExpense", "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss", "AdjustmentsForDepreciationAndAmortisationExpenseAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss"],
  shareBasedCompensation: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense", "AdjustmentsForSharebasedPayments"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations", "CashFlowsFromUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "DividendsPaidClassifiedAsFinancingActivities", "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity", "PaymentsToAcquireOrRedeemEntitysShares"],
};

const FLOW_PER_SHARE = { epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic", "DilutedEarningsLossPerShare", "BasicEarningsLossPerShare", "DilutedEarningsLossPerShareFromContinuingOperations", "BasicEarningsLossPerShareFromContinuingOperations"] };
const FLOW_SHARES = { sharesDiluted: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic", "AdjustedWeightedAverageShares", "WeightedAverageShares"] };

export const INSTANT = {
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  currentAssets: ["AssetsCurrent", "CurrentAssets"],
  currentLiabilities: ["LiabilitiesCurrent", "CurrentLiabilities"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndDueFromBanks", "Cash", "CashAndCashEquivalents"],
  inventory: ["InventoryNet", "InventoryFinishedGoodsNetOfReserves", "Inventories"],
  accountsReceivable: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "TradeAndOtherCurrentReceivables", "CurrentTradeReceivables"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet", "IntangibleAssetsOtherThanGoodwill"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "EquityAttributableToOwnersOfParent", "Equity"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit", "RetainedEarnings"],
};

// Financial debt = sum of components; if no breakdown is reported, a total tag is used.
const DEBT_PARTS = [
  ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "SeniorLongTermNotes", "NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings"],
  ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "DebtCurrent", "CurrentPortionOfLongtermBorrowings"],
  ["CommercialPaper"],
  ["ShortTermBorrowings", "ShorttermBorrowings"],
];
const DEBT_TOTAL = ["LongTermDebt", "DebtInstrumentCarryingAmount", "DebtLongtermAndShorttermCombinedAmount", "Borrowings"];
const SHARES_INSTANT = ["CommonStockSharesOutstanding"];

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"]);
const QUARTER_FORMS = new Set(["10-Q", "10-Q/A", "6-K"]);

const DAY = 86400000;
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);

// The same tag from every taxonomy (see entries()).
function nodes(facts, tag) {
  return ["us-gaap", "ifrs-full", "dei"].map((ns) => facts?.[ns]?.[tag]).filter(Boolean);
}

function node(facts, tag) {
  return facts?.["us-gaap"]?.[tag] || facts?.["ifrs-full"]?.[tag] || facts?.dei?.[tag] || null;
}

// Values of all tags in the list. Companies switch tags over the years (e.g. SalesRevenueNet
// before 2018), so periods are merged across tags; for the same period the higher-priority tag wins.
// Both taxonomies are read: a company that moved from US GAAP to IFRS (e.g. Toyota, Sony) has the
// older years under us-gaap and the newer ones under ifrs-full, often with the same tag name.
function entries(facts, tags, unit, forms) {
  const out = [];
  tags.forEach((tag, p) => {
    for (const ns of ["us-gaap", "ifrs-full", "dei"]) {
      const arr = facts?.[ns]?.[tag]?.units?.[unit];
      if (arr) for (const v of arr) if (forms.has(v.form)) out.push({ ...v, _p: p });
    }
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
  const annual = new Map(), filed = new Map();
  for (const [, v] of dedupe(all.filter((v) => { const d = days(v.start, v.end); return d >= 340 && d <= 390; }), (v) => v.end)) { annual.set(v.end, v.val); filed.set(v.end, v.filed); }
  const durations = [...dedupe(all, (v) => `${v.start}|${v.end}`).values()];
  return { annual, filed, durations };
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

// Reporting currency: the monetary unit used most by the main income-statement and balance-sheet tags.
// US filers report in USD; foreign private issuers (20-F / 40-F) often in EUR, JPY, TWD, …
// A company that changed its reporting currency (e.g. Nebius: RUB → USD) is read in the currency of
// its latest annual report; the older years in the previous currency are left out rather than mixed.
export function reportingCurrency(facts) {
  const count = {}, latest = {};
  for (const tags of [FLOW.revenue, FLOW.netIncome, INSTANT.totalAssets]) {
    for (const tag of tags) {
      for (const n of nodes(facts, tag)) {
        for (const [unit, arr] of Object.entries(n.units || {})) {
          if (!/^[A-Z]{3}$/.test(unit)) continue;
          for (const v of arr) {
            if (!ANNUAL_FORMS.has(v.form)) continue;
            count[unit] = (count[unit] || 0) + 1;
            if (!latest[unit] || v.end > latest[unit]) latest[unit] = v.end;
          }
        }
      }
    }
  }
  const best = Object.keys(count).sort((a, b) => (latest[b] > latest[a] ? 1 : latest[b] < latest[a] ? -1 : count[b] - count[a]))[0];
  return best || "USD";
}

export function parseCompanyFacts(cf, { maxYears = 10 } = {}) {
  const facts = cf.facts || {};
  const currency = reportingCurrency(facts);
  const flows = {};
  for (const [k, tags] of Object.entries(FLOW)) flows[k] = flowSeries(facts, tags, currency);
  for (const [k, tags] of Object.entries(FLOW_PER_SHARE)) flows[k] = flowSeries(facts, tags, `${currency}/shares`);
  for (const [k, tags] of Object.entries(FLOW_SHARES)) flows[k] = flowSeries(facts, tags, "shares");
  const inst = {};
  for (const [k, tags] of Object.entries(INSTANT)) inst[k] = instantSeries(facts, tags, currency);
  const debtParts = DEBT_PARTS.map((tags) => instantSeries(facts, tags, currency));
  const debtTotal = instantSeries(facts, DEBT_TOTAL, currency);
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
  // Filing date of each year's per-share figures: tells which splits that year's numbers already include.
  const filedDates = annual.map((y) => flows.sharesDiluted.filed.get(y.periodEnd) ?? flows.epsDiluted.filed.get(y.periodEnd) ?? null);
  const splits = normalizeShares(annual, splitEvidence(facts), filedDates);

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
    sharesOutstanding = [...sameDate.values()].reduce((a, v) => a + v.val, 0) || null;
  }
  if (!sharesOutstanding && sharesInst.size) {
    sharesDate = [...sharesInst.keys()].sort().pop();
    sharesOutstanding = sharesInst.get(sharesDate) || null;
  }

  const quarterly = quarterlyPeriods(flows, anchor, balanceAt, splitEvidence(facts));

  return { currency, annual, quarterly, ttm, latestBalance, sharesOutstanding, sharesOutstandingDate: sharesDate, splits };
}

// ---- Quarterly figures ----
// Companies report a quarter either directly (a three-month period) or only as year-to-date figures
// (the fourth quarter is never filed on its own: it is the annual figure minus nine months).
// A three-month value is therefore: the reported three-month period, else YTD(E) − YTD(previous
// quarter end) with the same start date. Per-share figures and share counts cannot be subtracted,
// so only reported three-month values are used for them.
const isQuarter = (v) => { const d = days(v.start, v.end); return d >= 80 && d <= 100; };

function threeMonth(series, end, additive) {
  const near = (a, b, tol = 7) => Math.abs(days(a, b)) <= tol;
  let best = null;
  for (const v of series.durations) if (near(v.end, end) && isQuarter(v) && (!best || (v.filed || "") > (best.filed || ""))) best = v;
  if (best) return { val: best.val, filed: best.filed };
  if (!additive) return null;
  for (const ytd of series.durations) {
    if (!near(ytd.end, end) || days(ytd.start, ytd.end) <= 100 || days(ytd.start, ytd.end) > 390) continue;
    const prior = series.durations.find((p) => near(p.start, ytd.start) && !near(p.end, end) && days(p.end, end) >= 80 && days(p.end, end) <= 100);
    if (prior) return { val: ytd.val - prior.val, filed: ytd.filed };
  }
  return null;
}

export function quarterlyPeriods(flows, anchor, balanceAt, splitEvents = [], maxQuarters = 12) {
  const ends = [];
  for (const e of [...new Set(anchor.durations.map((v) => v.end))].sort().reverse()) {
    if (ends.length >= maxQuarters) break;
    if (ends.some((x) => Math.abs(days(x, e)) <= 20)) continue;
    if (threeMonth(anchor, e, true)) ends.push(e);
  }
  const PER_SHARE = new Set(Object.keys(FLOW_PER_SHARE)), SHARES = new Set(Object.keys(FLOW_SHARES));
  return ends.reverse().map((end) => {
    const q = { periodEnd: end };
    let filed = null;
    for (const k of Object.keys(flows)) {
      const r = threeMonth(flows[k], end, !PER_SHARE.has(k) && !SHARES.has(k));
      q[k] = r ? r.val : null;
      if (r && (PER_SHARE.has(k) || SHARES.has(k))) filed = filed && filed > r.filed ? filed : r.filed;
    }
    // Splits announced after the filing that reported this quarter's per-share figures.
    const factor = filed ? splitEvents.filter((e) => e.date > filed).reduce((f, e) => f * e.factor, 1) : 1;
    if (factor !== 1) {
      if (q.sharesDiluted) q.sharesDiluted *= factor;
      if (q.epsDiluted) q.epsDiluted /= factor;
    }
    Object.assign(q, balanceAt(end));
    return finishPeriod(q);
  });
}

// Stock splits, with dates. When a company splits, every later filing re-reports earlier periods with
// the share count multiplied (and EPS divided) by an exact integer. Each such change between two
// consecutive filings of the same period is one observation; observations of the same factor within
// 400 days are one split, dated by the earliest filing that shows post-split figures.
// Genuine share issuance never changes figures that were already reported, so it is never taken for a split.
export function splitEvidence(facts) {
  const obs = [];
  const scan = (tags, unit, sharesLike) => {
    for (const tag of tags) {
      const groups = new Map();
      for (const v of nodes(facts, tag).flatMap((n) => n.units?.[unit] || [])) {
        if (!v.start || !v.end || !v.filed || !v.val) continue;
        const k = `${v.start}|${v.end}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(v);
      }
      for (const list of groups.values()) {
        list.sort((a, b) => (a.filed < b.filed ? -1 : 1));
        for (let i = 1; i < list.length; i++) {
          const before = list[i - 1].val, after = list[i].val;
          if (Math.sign(before) !== Math.sign(after)) continue;
          const r = sharesLike ? after / before : before / after;
          const n = r >= 1 ? Math.round(r) : Math.round(1 / r);
          const exact = (r >= 1 ? r : 1 / r) / n;
          if (n >= 2 && Math.abs(exact - 1) < 0.03 && (n < 900 || n > 1100)) obs.push({ factor: r >= 1 ? n : 1 / n, date: list[i].filed });
        }
      }
    }
  };
  scan(FLOW_SHARES.sharesDiluted, "shares", true);
  scan(FLOW_PER_SHARE.epsDiluted, "USD/shares", false);
  obs.sort((a, b) => (a.date < b.date ? -1 : 1));
  const events = [];
  for (const o of obs) {
    if (!events.some((e) => e.factor === o.factor && Math.abs(days(e.date, o.date)) < 400)) events.push({ ...o });
  }
  return events;
}

// Share counts across years must be on the same basis. Two problems occur in XBRL data:
// 1) unit errors (a filing reports shares in thousands): detected against the share count implied by
//    net income / EPS and corrected by a factor of 1,000;
// 2) stock splits: each year's figures come from the latest filing that reported that year, so older
//    years can predate a split. Between two consecutive years, the splits dated after the older year's
//    filing and up to the newer year's filing are the ones missing from the older year. These are
//    applied (shares multiplied, EPS divided) when the actual jump in share count is consistent with
//    them (within −40% / +70%, which leaves room for real issuance or buybacks).
//    Without filing dates, a jump close to a confirmed split factor (within 12%) is used instead.
// Returns the applied splits as [{ year, factor }] (factor < 1 = reverse split).
export function normalizeShares(annual, events = [], filed = []) {
  const implied = (y) => (y.netIncome && y.epsDiluted && Math.sign(y.netIncome) === Math.sign(y.epsDiluted) ? y.netIncome / y.epsDiluted : null);
  for (const y of annual) {
    const imp = implied(y);
    if (y.sharesDiluted > 0 && imp > 0) {
      const r = imp / y.sharesDiluted;
      if (Math.abs(r / 1000 - 1) < 0.1) y.sharesDiluted *= 1000;
      else if (Math.abs(r * 1000 - 1) < 0.1) y.sharesDiluted /= 1000;
    }
  }
  const basis = annual.map((y) => (y.sharesDiluted > 0 ? y.sharesDiluted : implied(y) > 0 ? implied(y) : null));
  const splits = [];
  let factor = 1;
  for (let i = annual.length - 2; i >= 0; i--) {
    const a = basis[i], b = basis[i + 1];
    if (a > 0 && b > 0) {
      const r = b / a;
      let f = 1;
      if (filed[i] && filed[i + 1]) {
        if (filed[i] < filed[i + 1]) for (const e of events) if (e.date > filed[i] && e.date <= filed[i + 1]) f *= e.factor;
        if (f !== 1 && !(r / f > 0.6 && r / f < 1.7)) f = 1;
      } else {
        let best = null;
        for (const e of events) {
          const dev = Math.abs(r / e.factor - 1);
          if (dev <= 0.12 && (!best || dev < best.dev)) best = { f: e.factor, dev };
        }
        if (best) f = best.f;
      }
      if (f !== 1) {
        factor *= f;
        splits.push({ year: annual[i + 1].year, factor: f });
      }
    }
    if (factor !== 1) {
      const y = annual[i];
      if (y.sharesDiluted) y.sharesDiluted *= factor;
      if (y.sharesOutstanding) y.sharesOutstanding *= factor;
      if (y.epsDiluted) y.epsDiluted /= factor;
    }
  }
  return splits.reverse();
}
