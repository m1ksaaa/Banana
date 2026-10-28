// Fallback for filings that are missing from the SEC companyfacts API.
// The API sometimes lags behind or skips a filing entirely (for example several 2025 IFRS 20-F reports:
// the filing is on EDGAR with XBRL, but companyfacts only holds its cover-page facts). For the latest
// annual and quarterly report, if companyfacts has no financial fact from it, the filing's own XBRL
// instance is read and its facts are merged into companyfacts in the same shape, so the parser
// treats them like any other fact.

const NAMESPACES = [
  [/^http:\/\/fasb\.org\/us-gaap\//, "us-gaap"],
  [/^https?:\/\/xbrl\.ifrs\.org\/taxonomy\/[^/]+\/ifrs-full$/, "ifrs-full"],
  [/^http:\/\/xbrl\.sec\.gov\/dei\//, "dei"],
];

const ANNUAL = new Set(["10-K", "20-F", "40-F", "10-KT"]);
const QUARTER = new Set(["10-Q"]);
const FINANCIAL = ["us-gaap", "ifrs-full"];

// Accession numbers that contributed financial (not just cover-page) facts.
function factAccessions(cf) {
  const out = new Set();
  for (const ns of FINANCIAL) {
    for (const tag of Object.values(cf?.facts?.[ns] || {})) {
      for (const arr of Object.values(tag.units || {})) for (const v of arr) if (v.accn) out.add(v.accn);
    }
  }
  return out;
}

// The latest annual and latest quarterly XBRL filing, when companyfacts has none of their financial facts.
export function missingFilings(cf, sub) {
  const r = sub?.filings?.recent;
  if (!r?.accessionNumber) return [];
  const have = factAccessions(cf);
  const out = [];
  for (const forms of [ANNUAL, QUARTER]) {
    for (let i = 0; i < r.accessionNumber.length; i++) {
      if (!forms.has(r.form[i])) continue;
      if (r.isXBRL?.[i] && !have.has(r.accessionNumber[i])) {
        out.push({ accn: r.accessionNumber[i], form: r.form[i], filed: r.filingDate[i], primaryDocument: r.primaryDocument?.[i] || "" });
      }
      break; // only the most recent filing of each kind
    }
  }
  return out;
}

const attr = (s, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(s)?.[1] ?? null;
const local = (q) => q.slice(q.indexOf(":") + 1);
const text = (body, el) => new RegExp(`<(?:[\\w-]+:)?${el}>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${el}>`).exec(body)?.[1] ?? null;

function unitName(body) {
  const measures = [...body.matchAll(/<(?:[\w-]+:)?measure>\s*([^<]+?)\s*<\/(?:[\w-]+:)?measure>/g)].map((m) => local(m[1]));
  if (/<(?:[\w-]+:)?divide\b/.test(body) && measures.length === 2) return `${measures[0]}/${measures[1]}`;
  return measures[0] || null;
}

// Parses an XBRL instance document into companyfacts-style entries: [{ ns, tag, unit, start?, end, val }].
// Facts with dimensions (segments, scenarios) are skipped: companyfacts holds only the consolidated totals.
export function parseInstance(xml) {
  const prefixes = new Map();
  for (const m of xml.matchAll(/xmlns:([\w-]+)="([^"]+)"/g)) {
    const hit = NAMESPACES.find(([re]) => re.test(m[2]));
    if (hit) prefixes.set(m[1], hit[1]);
  }
  const contexts = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const body = m[2];
    if (/<(?:[\w-]+:)?(segment|scenario)\b/.test(body)) continue;
    const instant = text(body, "instant");
    contexts.set(attr(m[1], "id"), instant ? { end: instant } : { start: text(body, "startDate"), end: text(body, "endDate") });
  }
  const units = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) units.set(attr(m[1], "id"), unitName(m[2]));

  const out = [], seen = new Set();
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*?)(?:\/>|>([^<]*)<\/\1:\2>)/g)) {
    const ns = prefixes.get(m[1]);
    if (!ns || m[4] === undefined) continue;
    const ctx = contexts.get(attr(m[3], "contextRef"));
    const unit = units.get(attr(m[3], "unitRef"));
    const val = Number(m[4].trim());
    if (!ctx?.end || !unit || m[4].trim() === "" || !Number.isFinite(val)) continue;
    const key = `${ns}|${m[2]}|${unit}|${ctx.start || ""}|${ctx.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ns, tag: m[2], unit, ...(ctx.start ? { start: ctx.start } : {}), end: ctx.end, val });
  }
  return out;
}

// Adds parsed instance facts to a companyfacts object (in place).
export function mergeInstance(cf, facts, { accn, form, filed }) {
  cf.facts ||= {};
  for (const f of facts) {
    const tag = ((cf.facts[f.ns] ||= {})[f.tag] ||= { units: {} });
    (tag.units[f.unit] ||= []).push({ ...(f.start ? { start: f.start } : {}), end: f.end, val: f.val, accn, form, filed });
  }
  return cf;
}

// The instance file of a filing: the extracted inline-XBRL instance (<doc>_htm.xml) or a classic instance.
export function instanceFile(names, primaryDocument = "") {
  const base = primaryDocument.replace(/\.htm$/i, "");
  return (base && names.find((n) => n === `${base}_htm.xml`))
    || names.find((n) => /_htm\.xml$/i.test(n))
    || names.find((n) => /\.xml$/i.test(n) && !/^FilingSummary\.xml$|_(cal|def|lab|pre)\.xml$|^MetaLinks|^R\d+\.xml$/i.test(n))
    || null;
}

// Fills the gaps of `cf` from EDGAR. `get(url, type)` is the caller's rate-limited fetch.
export async function fillMissingFilings(cf, sub, cik, get) {
  const added = [];
  for (const f of missingFilings(cf, sub)) {
    try {
      const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replace(/-/g, "")}`;
      const index = await get(`${dir}/index.json`);
      const file = instanceFile((index?.directory?.item || []).map((x) => x.name), f.primaryDocument);
      if (!file) continue;
      const xml = await get(`${dir}/${file}`, "text");
      const facts = xml ? parseInstance(xml) : [];
      if (facts.length) { mergeInstance(cf, facts, f); added.push(`${f.form} ${f.filed} (${facts.length})`); }
    } catch (e) {
      console.warn(`  ${cik} ${f.accn}: ${e.message}`);
    }
  }
  return added;
}
