// TeraStockX elemzőmotor.
// Bemenet: egy cég sablon szerinti adatai (lásd docs/SABLON.md).
// Kimenet: 0–100 közötti pontszámok, figyelmeztetések és közérthető szöveges összefoglaló.
// Ugyanezt a fájlt használja a böngésző és a Node-os adatfrissítő script is.

export const ENGINE_VERSION = "1.0.0";

// ---------- Segédfüggvények ----------

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

// Lineáris skálázás 0–100 közé. Ha bad > good, a skála fordított (kisebb érték a jobb).
export function scale(x, bad, good) {
  if (!isNum(x)) return null;
  const t = (x - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

// Növekedés előző évhez képest. Negatív vagy nulla bázisnál nem értelmezhető.
function growth(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null;
  return cur / prev - 1;
}

function cagr(first, last, years) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years < 1) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function mean(xs) {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function stdev(xs) {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// Súlyozott átlag; a hiányzó (null) tételeket kihagyja, a súlyokat újranormálja.
function weighted(parts) {
  let sum = 0, w = 0;
  for (const p of parts) {
    if (isNum(p.score)) { sum += p.score * p.weight; w += p.weight; }
  }
  return w > 0 ? Math.round(sum / w) : null;
}

// ---------- Származtatott mutatók egy évre ----------

function totalDebt(y) {
  if (isNum(y.totalDebt)) return y.totalDebt;
  return null;
}

function freeCashFlow(y) {
  if (isNum(y.freeCashFlow)) return y.freeCashFlow;
  if (isNum(y.operatingCashFlow) && isNum(y.capex)) return y.operatingCashFlow - Math.abs(y.capex);
  return null;
}

function grossProfit(y) {
  if (isNum(y.grossProfit)) return y.grossProfit;
  if (isNum(y.revenue) && isNum(y.costOfRevenue)) return y.revenue - y.costOfRevenue;
  return null;
}

function totalLiabilities(y) {
  if (isNum(y.totalLiabilities)) return y.totalLiabilities;
  if (isNum(y.totalAssets) && isNum(y.equity)) return y.totalAssets - y.equity;
  return null;
}

export function yearMetrics(y, prev) {
  const fcf = freeCashFlow(y);
  const debt = totalDebt(y);
  const liab = totalLiabilities(y);
  const gp = grossProfit(y);
  const avgEquity = prev && isNum(prev.equity) && isNum(y.equity) ? (prev.equity + y.equity) / 2 : y.equity;
  const avgAssets = prev && isNum(prev.totalAssets) && isNum(y.totalAssets) ? (prev.totalAssets + y.totalAssets) / 2 : y.totalAssets;
  return {
    year: y.year,
    revenue: y.revenue ?? null,
    netIncome: y.netIncome ?? null,
    freeCashFlow: fcf,
    grossMargin: div(gp, y.revenue),
    operatingMargin: div(y.operatingIncome, y.revenue),
    netMargin: div(y.netIncome, y.revenue),
    fcfMargin: div(fcf, y.revenue),
    roe: isNum(avgEquity) && avgEquity > 0 ? div(y.netIncome, avgEquity) : null,
    roa: div(y.netIncome, avgAssets),
    currentRatio: div(y.currentAssets, y.currentLiabilities),
    debtToEquity: isNum(y.equity) && y.equity > 0 ? div(debt, y.equity) : null,
    liabilitiesToAssets: div(liab, y.totalAssets),
    interestCoverage: isNum(y.interestExpense) && y.interestExpense > 0 ? div(y.operatingIncome, y.interestExpense) : null,
    netDebt: isNum(debt) && isNum(y.cash) ? debt - y.cash : null,
    assetTurnover: div(y.revenue, avgAssets),
    longTermDebtToAssets: div(debt, y.totalAssets),
    shares: y.sharesDiluted ?? null,
  };
}

// Altman Z'' (nem gyártó / általános változat, piaci ár nélkül is számolható).
// Zónák: > 2.6 biztonságos, 1.1–2.6 szürke zóna, < 1.1 csődveszélyes.
export function altmanZ(y) {
  const liab = totalLiabilities(y);
  const ta = y.totalAssets;
  if (![y.currentAssets, y.currentLiabilities, y.retainedEarnings, y.operatingIncome, y.equity, liab, ta].every(isNum) || ta <= 0 || liab <= 0) return null;
  const wc = y.currentAssets - y.currentLiabilities;
  return 6.56 * (wc / ta) + 3.26 * (y.retainedEarnings / ta) + 6.72 * (y.operatingIncome / ta) + 1.05 * (y.equity / liab);
}

// Piotroski F-score (0–9): 9 egyszerű igen/nem teszt a pénzügyi erőre.
export function piotroski(cur, prev) {
  if (!cur || !prev) return null;
  const c = yearMetrics(cur, prev), p = yearMetrics(prev, null);
  const ocf = cur.operatingCashFlow;
  const tests = [
    isNum(c.roa) ? c.roa > 0 : null,
    isNum(ocf) ? ocf > 0 : null,
    isNum(c.roa) && isNum(p.roa) ? c.roa > p.roa : null,
    isNum(ocf) && isNum(cur.netIncome) ? ocf > cur.netIncome : null,
    isNum(c.longTermDebtToAssets) && isNum(p.longTermDebtToAssets) ? c.longTermDebtToAssets <= p.longTermDebtToAssets : null,
    isNum(c.currentRatio) && isNum(p.currentRatio) ? c.currentRatio > p.currentRatio : null,
    isNum(c.shares) && isNum(p.shares) ? c.shares <= p.shares : null,
    isNum(c.grossMargin) && isNum(p.grossMargin) ? c.grossMargin > p.grossMargin : null,
    isNum(c.assetTurnover) && isNum(p.assetTurnover) ? c.assetTurnover > p.assetTurnover : null,
  ];
  const known = tests.filter((t) => t !== null);
  if (known.length < 6) return null;
  // Hiányzó teszteket arányosan becsüljük, hogy 0–9 skálán maradjon.
  return Math.round((known.filter(Boolean).length / known.length) * 9);
}

// ---------- Fő elemzés ----------

export const DIMENSIONS = [
  { key: "operations", label: "Működés", short: "Mennyire nyereséges most a cég?" },
  { key: "stability", label: "Pénzügyi stabilitás", short: "Mennyire bírja az adósságot és a nehéz időket?" },
  { key: "growth1y", label: "Fejlődés (utóbbi 1 év)", short: "Mennyit nőtt az elmúlt évben?" },
  { key: "longTerm", label: "Hosszú távú fejlődés", short: "Hogyan fejlődött az elmúlt 3–5 évben?" },
  { key: "reliability", label: "Megbízhatóság", short: "Mennyire kiszámítható és következetes?" },
  { key: "risk", label: "Kockázat", short: "Mennyire veszélyes most befektetni? (alacsonyabb = jobb)", inverse: true },
];

export function analyze(company) {
  const years = [...(company.annual || [])]
    .filter((y) => isNum(y.year))
    .sort((a, b) => a.year - b.year);

  if (years.length === 0) {
    return { ok: false, reason: "Nincs elérhető éves pénzügyi adat." };
  }

  const L = years[years.length - 1];
  const P = years.length > 1 ? years[years.length - 2] : null;
  const metricsByYear = years.map((y, i) => yearMetrics(y, years[i - 1] || null));
  const m = metricsByYear[metricsByYear.length - 1];
  const mp = metricsByYear.length > 1 ? metricsByYear[metricsByYear.length - 2] : null;

  // --- Hosszú távú ablak: legfeljebb az utolsó 6 év (5 évnyi változás) ---
  const win = years.slice(-6);
  const winM = metricsByYear.slice(-6);
  const span = win.length - 1;

  const revenueYoY = P ? growth(L.revenue, P.revenue) : null;
  const netIncomeYoY = P ? growth(L.netIncome, P.netIncome) : null;
  const fcfYoY = mp ? growth(m.freeCashFlow, mp.freeCashFlow) : null;
  const epsYoY = P ? growth(L.epsDiluted, P.epsDiluted) : null;

  const revenueCagr = span >= 2 ? cagr(win[0].revenue, L.revenue, span) : null;
  const netIncomeCagr = span >= 2 ? cagr(win[0].netIncome, L.netIncome, span) : null;
  const yoys = win.slice(1).map((y, i) => growth(y.revenue, win[i].revenue));
  const revenueGrowthYearsRatio = yoys.filter(isNum).length ? yoys.filter((g) => isNum(g) && g > 0).length / yoys.filter(isNum).length : null;
  const revenueVolatility = stdev(yoys);
  const marginTrend = span >= 2 && isNum(winM[0].operatingMargin) && isNum(m.operatingMargin) ? m.operatingMargin - winM[0].operatingMargin : null;
  const profitableYearsRatio = win.filter((y) => isNum(y.netIncome)).length ? win.filter((y) => y.netIncome > 0).length / win.filter((y) => isNum(y.netIncome)).length : null;
  const fcfPositiveRatio = winM.filter((y) => isNum(y.freeCashFlow)).length ? winM.filter((y) => y.freeCashFlow > 0).length / winM.filter((y) => isNum(y.freeCashFlow)).length : null;
  const shareChangeYearly = span >= 1 && isNum(winM[0].shares) && isNum(m.shares) && winM[0].shares > 0 ? Math.pow(m.shares / winM[0].shares, 1 / span) - 1 : null;
  const z = altmanZ(L);
  const fScore = piotroski(L, P);
  const netDebtToFcf = isNum(m.netDebt) ? (m.netDebt <= 0 ? 0 : (isNum(m.freeCashFlow) && m.freeCashFlow > 0 ? m.netDebt / m.freeCashFlow : Infinity)) : null;

  const metrics = {
    grossMargin: m.grossMargin, operatingMargin: m.operatingMargin, netMargin: m.netMargin, fcfMargin: m.fcfMargin,
    roe: m.roe, roa: m.roa, currentRatio: m.currentRatio, debtToEquity: m.debtToEquity,
    liabilitiesToAssets: m.liabilitiesToAssets, interestCoverage: m.interestCoverage, netDebt: m.netDebt,
    netDebtToFcf, altmanZ: z, piotroski: fScore,
    revenueYoY, netIncomeYoY, fcfYoY, epsYoY, revenueCagr, netIncomeCagr, revenueGrowthYearsRatio,
    revenueVolatility, marginTrend, profitableYearsRatio, fcfPositiveRatio, shareChangeYearly,
    yearsOfData: years.length, windowYears: span,
  };

  // --- Dimenziók részletesen: minden tételnél látszik, miből jön a pontszám ---
  const negEquity = isNum(L.equity) && L.equity <= 0;
  const parts = {
    operations: [
      { key: "operatingMargin", weight: 0.3, score: scale(m.operatingMargin, 0, 0.30) },
      { key: "netMargin", weight: 0.2, score: scale(m.netMargin, -0.05, 0.20) },
      { key: "roe", weight: 0.2, score: negEquity ? null : scale(m.roe, 0, 0.25) },
      { key: "roa", weight: 0.1, score: scale(m.roa, 0, 0.15) },
      { key: "fcfMargin", weight: 0.2, score: scale(m.fcfMargin, -0.05, 0.20) },
    ],
    stability: [
      { key: "currentRatio", weight: 0.15, score: scale(m.currentRatio, 0.6, 2.0) },
      { key: "debtToEquity", weight: 0.2, score: negEquity ? 0 : scale(m.debtToEquity, 2.5, 0.3) },
      { key: "interestCoverage", weight: 0.15, score: isNum(L.interestExpense) && L.interestExpense <= 0 ? 100 : scale(m.interestCoverage, 1.5, 15) },
      { key: "netDebtToFcf", weight: 0.25, score: netDebtToFcf === Infinity ? 0 : scale(netDebtToFcf, 8, 0.5) },
      { key: "altmanZ", weight: 0.25, score: scale(z, 1.1, 4.0) },
    ],
    growth1y: [
      { key: "revenueYoY", weight: 0.4, score: scale(revenueYoY, -0.10, 0.20) },
      { key: "netIncomeYoY", weight: 0.3, score: scale(netIncomeYoY, -0.25, 0.30) },
      { key: "fcfYoY", weight: 0.3, score: scale(fcfYoY, -0.25, 0.30) },
    ],
    longTerm: [
      { key: "revenueCagr", weight: 0.35, score: scale(revenueCagr, -0.05, 0.15) },
      { key: "netIncomeCagr", weight: 0.25, score: scale(netIncomeCagr, -0.10, 0.20) },
      { key: "revenueGrowthYearsRatio", weight: 0.2, score: scale(revenueGrowthYearsRatio, 0, 1) },
      { key: "marginTrend", weight: 0.2, score: scale(marginTrend, -0.10, 0.10) },
    ],
    reliability: [
      { key: "profitableYearsRatio", weight: 0.3, score: scale(profitableYearsRatio, 0, 1) },
      { key: "fcfPositiveRatio", weight: 0.25, score: scale(fcfPositiveRatio, 0, 1) },
      { key: "revenueVolatility", weight: 0.2, score: scale(revenueVolatility, 0.30, 0.03) },
      { key: "shareChangeYearly", weight: 0.1, score: scale(shareChangeYearly, 0.05, -0.02) },
      { key: "piotroski", weight: 0.15, score: scale(fScore, 2, 8) },
    ],
  };

  // Ha a cég nettó veszteséges, a negatív bázis miatt a profitnövekedés nem értelmezhető:
  // ilyenkor a nyereség oldali tételek 0-t kapnak, hogy ne torzítson felfelé.
  if (isNum(L.netIncome) && L.netIncome < 0) {
    parts.growth1y.find((p) => p.key === "netIncomeYoY").score = 0;
    parts.longTerm.find((p) => p.key === "netIncomeCagr").score = 0;
  }

  const scores = {};
  for (const k of Object.keys(parts)) scores[k] = weighted(parts[k]);

  const flags = buildFlags({ L, P, m, metrics, negEquity });

  // Kockázat: a gyenge stabilitás, megbízhatóság és működés növeli, a figyelmeztetések tovább emelik.
  const base = weighted([
    { score: scores.stability, weight: 0.45 },
    { score: scores.reliability, weight: 0.30 },
    { score: scores.operations, weight: 0.25 },
  ]);
  const penalty = flags.filter((f) => f.level === "critical").length * 10 + flags.filter((f) => f.level === "warning").length * 4;
  scores.risk = isNum(base) ? Math.max(0, Math.min(100, 100 - base + penalty)) : null;

  // Összesített TeraScore (a kockázat ebből származik, ezért nem számít bele külön).
  scores.overall = weighted([
    { score: scores.operations, weight: 0.20 },
    { score: scores.stability, weight: 0.25 },
    { score: scores.growth1y, weight: 0.10 },
    { score: scores.longTerm, weight: 0.20 },
    { score: scores.reliability, weight: 0.25 },
  ]);

  const allParts = Object.values(parts).flat();
  const coverage = Math.round((allParts.filter((p) => isNum(p.score)).length / allParts.length) * 100);

  const distress = distressLevel({ z, negEquity, m, L, metrics });
  const outlook = outlookLevel(scores, metrics);

  return {
    ok: true,
    engineVersion: ENGINE_VERSION,
    latestYear: L.year,
    scores,
    parts,
    metrics,
    flags,
    distress,
    outlook,
    coverage,
    verdict: verdictText(scores, distress, outlook),
    explanations: explain(scores, metrics, L),
    series: metricsByYear,
  };
}

// ---------- Figyelmeztetések és erősségek ----------

function buildFlags({ L, P, m, metrics, negEquity }) {
  const f = [];
  const add = (level, title, text) => f.push({ level, title, text });

  if (negEquity) add("critical", "Negatív saját tőke", "A cég kötelezettségei meghaladják az eszközeit. Ez lehet tudatos részvény-visszavásárlás következménye, de gyakran súlyos pénzügyi gondot jelez.");
  if (isNum(L.netIncome) && L.netIncome < 0) {
    if (P && isNum(P.netIncome) && P.netIncome < 0) add("critical", "Tartósan veszteséges", "Legalább két egymást követő évben veszteséget termelt.");
    else add("warning", "Veszteséges az utolsó évben", "Az utolsó lezárt évben a cég nem termelt nyereséget.");
  }
  if (isNum(m.freeCashFlow) && m.freeCashFlow < 0) add("warning", "Negatív szabad cash flow", "A működésből több pénz megy el, mint amennyi bejön – kívülről (hitel, részvénykibocsátás) kell finanszírozni.");
  if (isNum(m.currentRatio) && m.currentRatio < 1) add("warning", "Szűkös rövid távú likviditás", `Az egy éven belül esedékes kötelezettségek nagyobbak, mint a forgóeszközök (likviditási ráta: ${hu(m.currentRatio, 2)}). Erős cash flow mellett ez kezelhető.`);
  if (isNum(m.interestCoverage)) {
    if (m.interestCoverage < 1.5) add("critical", "Nem fedezi a kamatokat", "A működési nyereség alig vagy egyáltalán nem fedezi a kamatköltségeket.");
    else if (m.interestCoverage < 3) add("warning", "Gyenge kamatfedezet", "A működési nyereség csak kevéssel haladja meg a kamatterheket.");
  }
  if (isNum(metrics.altmanZ)) {
    if (metrics.altmanZ < 1.1) add("critical", "Csődveszélyes zóna (Altman Z)", `Az Altman Z-pontszám ${hu(metrics.altmanZ, 2)}, ami a csődveszélyes tartományba esik.`);
    else if (metrics.altmanZ < 2.6) add("warning", "Szürke zóna (Altman Z)", `Az Altman Z-pontszám ${hu(metrics.altmanZ, 2)}: nem kritikus, de nem is biztonságos tartomány.`);
  }
  if (metrics.netDebtToFcf === Infinity) add("warning", "Adósság fedezet nélkül", "A cégnek nettó adóssága van, de nincs pozitív szabad cash flow-ja a törlesztésre.");
  else if (isNum(metrics.netDebtToFcf) && metrics.netDebtToFcf > 5) add("warning", "Magas adósság a termelt pénzhez képest", `A jelenlegi szabad cash flow-ból kb. ${hu(metrics.netDebtToFcf, 1)} év kellene a nettó adósság visszafizetéséhez.`);
  if (isNum(metrics.revenueYoY) && metrics.revenueYoY < -0.10) add("warning", "Jelentősen csökkenő bevétel", `A bevétel ${hu((metrics.revenueYoY * 100), 1)}%-kal esett az előző évhez képest.`);
  if (isNum(metrics.shareChangeYearly) && metrics.shareChangeYearly > 0.05) add("warning", "Erős részvényhígítás", `A részvények száma évente átlagosan ${hu((metrics.shareChangeYearly * 100), 1)}%-kal nő, ami csökkenti a meglévő részvényesek részesedését.`);

  // Erősségek
  if (isNum(m.netDebt) && m.netDebt < 0) add("positive", "Nettó készpénz pozíció", "Több készpénze van, mint adóssága.");
  if (isNum(m.operatingMargin) && m.operatingMargin > 0.25) add("positive", "Kiemelkedő jövedelmezőség", `A működési árrés ${hu((m.operatingMargin * 100), 1)}%, ami kiemelkedően magas.`);
  if (isNum(metrics.profitableYearsRatio) && metrics.profitableYearsRatio === 1 && metrics.windowYears >= 3) add("positive", "Minden vizsgált évben nyereséges", "A vizsgált időszak egyik évében sem volt veszteséges.");
  if (isNum(metrics.revenueCagr) && metrics.revenueCagr > 0.10) add("positive", "Erős hosszú távú növekedés", `A bevétel évente átlagosan ${hu((metrics.revenueCagr * 100), 1)}%-kal nőtt.`);
  if (isNum(metrics.shareChangeYearly) && metrics.shareChangeYearly < -0.01) add("positive", "Részvény-visszavásárlás", "A részvények száma csökken, így minden megmaradó részvény nagyobb részt képvisel a cégből.");
  if (isNum(metrics.altmanZ) && metrics.altmanZ > 2.6) add("positive", "Biztonságos zóna (Altman Z)", `Az Altman Z-pontszám ${hu(metrics.altmanZ, 2)}, ami a biztonságos tartomány.`);

  return f;
}

// Csődkockázat: Altman Z-zóna + egyéb kritikus jelek alapján, szöveges szintként.
function distressLevel({ z, negEquity, m, L, metrics }) {
  let points = 0;
  if (isNum(z)) points += z < 1.1 ? 3 : z < 2.6 ? 1 : 0;
  if (negEquity && !(isNum(m.freeCashFlow) && m.freeCashFlow > 0)) points += 2;
  if (isNum(m.freeCashFlow) && m.freeCashFlow < 0) points += 1;
  if (isNum(L.netIncome) && L.netIncome < 0) points += 1;
  if (isNum(m.interestCoverage) && m.interestCoverage < 1.5) points += 2;
  if (metrics.netDebtToFcf === Infinity) points += 1;
  if (points >= 4) return { level: "high", label: "Magas", text: "Több jel is komoly pénzügyi nehézségre utal." };
  if (points >= 2) return { level: "medium", label: "Közepes", text: "Vannak figyelmeztető jelek, a helyzetet érdemes követni." };
  return { level: "low", label: "Alacsony", text: "A jelenlegi adatok alapján nem látszik csődközeli helyzet." };
}

// Hosszú távú kilátás a múltbeli trendek alapján (nem jóslat!).
function outlookLevel(scores, metrics) {
  const lt = scores.longTerm, g = scores.growth1y;
  if (!isNum(lt)) return { level: "unknown", label: "Nem megállapítható", text: "Nincs elég év a hosszú távú trendhez." };
  const s = 0.7 * lt + 0.3 * (isNum(g) ? g : lt);
  if (s >= 65) return { level: "up", label: "Emelkedő trend", text: "Az elmúlt évek tartós növekedést mutatnak." };
  if (s >= 40) return { level: "flat", label: "Stagnáló trend", text: "A cég nagyjából egy szinten mozog, érdemi növekedés nélkül." };
  return { level: "down", label: "Csökkenő trend", text: "Az elmúlt évek inkább visszaesést mutatnak." };
}

// ---------- Közérthető szövegek ----------

export function grade(score, inverse = false) {
  if (!isNum(score)) return { label: "Nincs adat", tone: "none" };
  const s = inverse ? 100 - score : score;
  if (s >= 80) return { label: inverse ? "Nagyon alacsony" : "Kiváló", tone: "good" };
  if (s >= 65) return { label: inverse ? "Alacsony" : "Jó", tone: "good" };
  if (s >= 45) return { label: inverse ? "Mérsékelt" : "Közepes", tone: "warning" };
  if (s >= 25) return { label: inverse ? "Magas" : "Gyenge", tone: "serious" };
  return { label: inverse ? "Nagyon magas" : "Rossz", tone: "critical" };
}

const hu = (x, d) => x.toFixed(d).replace(".", ",");
const pct = (x, d = 1) => `${hu(x * 100, d)}%`;
const signedPct = (x) => `${x >= 0 ? "+" : ""}${pct(x)}`;

function explain(scores, mt, L) {
  const e = {};
  // Működés
  if (isNum(mt.netMargin)) {
    const per100 = Math.round(mt.netMargin * 100);
    e.operations = mt.netMargin >= 0
      ? `Minden 100 dollár bevételből kb. ${per100} dollár tiszta nyereség marad a cégnél.`
      : `A cég veszteséges: minden 100 dollár bevétel mellett kb. ${Math.abs(per100)} dollárt veszít.`;
  } else e.operations = "Nincs elég adat a jövedelmezőség megítéléséhez.";
  // Stabilitás
  if (isNum(mt.netDebt) && mt.netDebt <= 0) e.stability = "Több készpénze van, mint adóssága – az adósság nem jelent problémát.";
  else if (isNum(mt.netDebtToFcf) && mt.netDebtToFcf !== Infinity) e.stability = `A nettó adósságát a jelenlegi szabad pénzáramából kb. ${mt.netDebtToFcf.toFixed(1).replace(".", ",")} év alatt fizetné vissza.`;
  else if (mt.netDebtToFcf === Infinity) e.stability = "Van adóssága, de jelenleg nem termel szabad pénzt a visszafizetésre.";
  else e.stability = "Az adósságról nincs elég adat.";
  // 1 év
  if (isNum(mt.revenueYoY)) e.growth1y = `A bevétel ${signedPct(mt.revenueYoY)}${isNum(mt.netIncomeYoY) ? `, a nettó nyereség ${signedPct(mt.netIncomeYoY)}` : ""} változást mutat az előző évhez képest.`;
  else e.growth1y = "Az előző évhez való összehasonlításhoz nincs elég adat.";
  // Hosszú táv
  if (isNum(mt.revenueCagr)) e.longTerm = `Az elmúlt ${mt.windowYears} évben a bevétel évente átlagosan ${signedPct(mt.revenueCagr)}-kal változott.`;
  else e.longTerm = "Legalább 3 év adat kell a hosszú távú trendhez.";
  // Megbízhatóság
  if (isNum(mt.profitableYearsRatio)) e.reliability = `A vizsgált ${mt.windowYears + 1} évből ${Math.round(mt.profitableYearsRatio * (mt.windowYears + 1))} évben volt nyereséges${isNum(mt.piotroski) ? `; Piotroski-pontszám: ${mt.piotroski}/9` : ""}.`;
  else e.reliability = "Nincs elég adat a következetesség megítéléséhez.";
  // Kockázat
  const g = grade(scores.risk, true);
  e.risk = isNum(scores.risk) ? `A befektetés kockázata a pénzügyi adatok alapján: ${g.label.toLowerCase()}.` : "Nem számolható.";
  return e;
}

function verdictText(scores, distress, outlook) {
  const o = scores.overall;
  if (!isNum(o)) return "Nincs elég adat az összesített értékeléshez.";
  let head;
  if (o >= 80) head = "Kiemelkedően erős cég pénzügyileg.";
  else if (o >= 65) head = "Pénzügyileg erős, stabil cég.";
  else if (o >= 45) head = "Vegyes kép: vannak erősségei és gyengeségei is.";
  else if (o >= 25) head = "Pénzügyileg gyenge, óvatosság javasolt.";
  else head = "Komoly pénzügyi problémák látszanak.";
  return `${head} Csődkockázat: ${distress.label.toLowerCase()}. Hosszú távon: ${outlook.label.toLowerCase()}.`;
}

// ---------- Mutatók leírása (a Módszertan oldal és a részletek ebből épülnek) ----------

export const METRIC_INFO = {
  grossMargin: { label: "Bruttó árrés", fmt: "pct", desc: "Bruttó nyereség / bevétel. Mennyi marad a bevételből a közvetlen költségek után." },
  operatingMargin: { label: "Működési árrés", fmt: "pct", desc: "Működési eredmény / bevétel. 0% = 0 pont, 30% = 100 pont.", range: [0, 0.30] },
  netMargin: { label: "Nettó árrés", fmt: "pct", desc: "Nettó nyereség / bevétel. −5% = 0 pont, 20% = 100 pont.", range: [-0.05, 0.20] },
  fcfMargin: { label: "Szabad cash flow árrés", fmt: "pct", desc: "(Működési cash flow − beruházások) / bevétel. −5% = 0, 20% = 100 pont.", range: [-0.05, 0.20] },
  roe: { label: "Sajáttőke-arányos megtérülés (ROE)", fmt: "pct", desc: "Nettó nyereség / átlagos saját tőke. 0% = 0, 25% = 100 pont.", range: [0, 0.25] },
  roa: { label: "Eszközarányos megtérülés (ROA)", fmt: "pct", desc: "Nettó nyereség / átlagos összes eszköz. 0% = 0, 15% = 100 pont.", range: [0, 0.15] },
  currentRatio: { label: "Likviditási ráta", fmt: "x", desc: "Forgóeszközök / rövid lejáratú kötelezettségek. 0,6 = 0 pont, 2,0 = 100 pont.", range: [0.6, 2.0] },
  debtToEquity: { label: "Adósság / saját tőke", fmt: "x", desc: "Pénzügyi adósság / saját tőke. 2,5 = 0 pont, 0,3 = 100 pont. Negatív saját tőke = 0 pont.", range: [2.5, 0.3] },
  liabilitiesToAssets: { label: "Kötelezettségek / eszközök", fmt: "pct", desc: "Az eszközök mekkora részét finanszírozzák kötelezettségek." },
  interestCoverage: { label: "Kamatfedezet", fmt: "x", desc: "Működési eredmény / kamatköltség. 1,5× = 0 pont, 15× = 100 pont. Kamatköltség nélkül 100 pont.", range: [1.5, 15] },
  netDebt: { label: "Nettó adósság", fmt: "money", desc: "Pénzügyi adósság − készpénz. Negatív = nettó készpénz." },
  netDebtToFcf: { label: "Nettó adósság / szabad cash flow", fmt: "years", desc: "Hány év szabad pénzáramából fizethető vissza a nettó adósság. 8 év = 0, 0,5 év = 100 pont; nettó készpénz = 100 pont.", range: [8, 0.5] },
  altmanZ: { label: "Altman Z'' pontszám", fmt: "num", desc: "Csődelőrejelző modell: 6,56·(forgótőke/eszközök) + 3,26·(eredménytartalék/eszközök) + 6,72·(működési eredmény/eszközök) + 1,05·(saját tőke/kötelezettségek). <1,1 veszélyes, >2,6 biztonságos.", range: [1.1, 4.0] },
  piotroski: { label: "Piotroski F-pontszám", fmt: "of9", desc: "9 igen/nem teszt a jövedelmezőség, adósság és hatékonyság javulására. 2 = 0 pont, 8 = 100 pont.", range: [2, 8] },
  revenueYoY: { label: "Bevétel változása (1 év)", fmt: "spct", desc: "−10% = 0 pont, +20% = 100 pont.", range: [-0.10, 0.20] },
  netIncomeYoY: { label: "Nettó nyereség változása (1 év)", fmt: "spct", desc: "−25% = 0 pont, +30% = 100 pont. Negatív bázisnál nem értelmezhető.", range: [-0.25, 0.30] },
  fcfYoY: { label: "Szabad cash flow változása (1 év)", fmt: "spct", desc: "−25% = 0 pont, +30% = 100 pont.", range: [-0.25, 0.30] },
  epsYoY: { label: "Egy részvényre jutó nyereség változása", fmt: "spct", desc: "Hígított EPS változása az előző évhez képest." },
  revenueCagr: { label: "Bevétel éves átlagos növekedése (CAGR)", fmt: "spct", desc: "Legfeljebb 5 éves ablakon. −5% = 0, +15% = 100 pont.", range: [-0.05, 0.15] },
  netIncomeCagr: { label: "Nettó nyereség éves átlagos növekedése", fmt: "spct", desc: "Legfeljebb 5 éves ablakon. −10% = 0, +20% = 100 pont.", range: [-0.10, 0.20] },
  revenueGrowthYearsRatio: { label: "Növekvő bevételű évek aránya", fmt: "pct0", desc: "Az évek hány százalékában nőtt a bevétel.", range: [0, 1] },
  marginTrend: { label: "Működési árrés változása", fmt: "pp", desc: "Az ablak eleje és vége közti változás százalékpontban. −10 pp = 0, +10 pp = 100 pont.", range: [-0.10, 0.10] },
  profitableYearsRatio: { label: "Nyereséges évek aránya", fmt: "pct0", desc: "Az ablakban hány év zárult nyereséggel.", range: [0, 1] },
  fcfPositiveRatio: { label: "Pozitív szabad cash flow-s évek aránya", fmt: "pct0", desc: "Hány évben termelt több pénzt, mint amennyit elköltött.", range: [0, 1] },
  revenueVolatility: { label: "Bevétel ingadozása", fmt: "pct", desc: "Az éves bevételnövekedés szórása. 30% = 0, 3% = 100 pont.", range: [0.30, 0.03] },
  shareChangeYearly: { label: "Részvényszám éves változása", fmt: "spct", desc: "Pozitív = hígítás, negatív = visszavásárlás. +5% = 0, −2% = 100 pont.", range: [0.05, -0.02] },
};
