// Material events from SEC Form 8-K filings (official "current reports").
// Companies must file an 8-K within four business days of a material event; the "items"
// field says what happened. Only the most significant item types are kept – routine items
// (earnings releases 2.02, Reg FD 7.01, other events 8.01, exhibits 9.01, officer/director
// changes 5.02, shareholder votes 5.07 …) are deliberately left out.

// Severity: 5 = critical, 4 = major, 3 = significant. Item names are translated in the UI (i18n: events.<item>).
export const EVENT_SEVERITY = {
  "1.03": 5, // Bankruptcy or receivership
  "4.02": 5, // Non-reliance on previously issued financial statements (restatement)
  "2.04": 4, // Triggering events that accelerate a financial obligation
  "3.01": 4, // Notice of delisting / failure to satisfy listing rules
  "5.01": 4, // Change in control
  "2.01": 3, // Completion of acquisition or disposition of assets
  "2.05": 3, // Exit or disposal activities (restructuring)
  "2.06": 3, // Material impairments
  "4.01": 3, // Change in certifying accountant
  "1.01": 2, // Entry into a material definitive agreement
  "1.02": 2, // Termination of a material definitive agreement
};

const DAY = 86400000;

export function majorEvents(sub, { now = new Date(), days = 365, max = 12 } = {}) {
  const r = sub?.filings?.recent;
  if (!r?.form) return [];
  const cik = String(Number(sub.cik));
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "8-K") continue;
    const date = r.filingDate[i];
    if ((now - new Date(date)) / DAY > days) continue;
    const items = String(r.items?.[i] || "").split(",").map((s) => s.trim()).filter((s) => EVENT_SEVERITY[s]);
    if (!items.length) continue;
    const acc = r.accessionNumber[i];
    out.push({
      date,
      items,
      severity: Math.max(...items.map((s) => EVENT_SEVERITY[s])),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${r.primaryDocument?.[i] || ""}`,
    });
  }
  // Most severe first within the cap, then shown by date.
  return out
    .sort((a, b) => b.severity - a.severity || (a.date < b.date ? 1 : -1))
    .slice(0, max)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
