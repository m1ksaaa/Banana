// SEC SIC code -> broad sector key (GICS-like) and analysis profile.
// Sector names are translated in the UI (assets/js/i18n/*: sectors.<key>).

const RANGES = [
  [100, 999, "consumerStaples"],
  [1000, 1299, "materials"], [1300, 1399, "energy"], [1400, 1499, "materials"],
  [1500, 1799, "industrials"],
  [2000, 2199, "consumerStaples"],
  [2200, 2399, "consumerDiscretionary"],
  [2400, 2499, "materials"], [2500, 2599, "consumerDiscretionary"], [2600, 2699, "materials"],
  [2700, 2799, "communication"],
  [2830, 2836, "healthcare"], [2800, 2899, "materials"],
  [2900, 2999, "energy"],
  [3000, 3399, "materials"], [3400, 3499, "industrials"],
  [3570, 3579, "technology"], [3500, 3599, "industrials"],
  [3630, 3639, "consumerDiscretionary"], [3600, 3699, "technology"],
  [3710, 3716, "consumerDiscretionary"], [3700, 3799, "industrials"],
  [3840, 3851, "healthcare"], [3800, 3899, "technology"],
  [3900, 3999, "consumerDiscretionary"],
  [4000, 4799, "industrials"],
  [4800, 4899, "communication"],
  [4900, 4999, "utilities"],
  [5000, 5199, "industrials"],
  [5400, 5499, "consumerStaples"], [5912, 5912, "consumerStaples"], [5200, 5999, "consumerDiscretionary"],
  [6500, 6599, "realEstate"], [6798, 6798, "realEstate"], [6770, 6770, "shell"], [6000, 6799, "financials"],
  [7370, 7379, "technology"], [7800, 7999, "communication"], [7000, 7099, "consumerDiscretionary"], [7000, 7999, "industrials"],
  [8000, 8099, "healthcare"], [8200, 8299, "consumerDiscretionary"], [8700, 8799, "industrials"], [8000, 8999, "industrials"],
  [9000, 9999, "other"],
];

export function sectorFromSic(sic) {
  const n = Number(sic);
  if (!Number.isFinite(n)) return null;
  for (const [a, b, key] of RANGES) if (n >= a && n <= b) return key;
  return "other";
}

// Nasdaq screener sector names -> our keys (used when no SIC code is available).
const NASDAQ_SECTORS = {
  "Technology": "technology", "Health Care": "healthcare", "Finance": "financials", "Real Estate": "realEstate",
  "Consumer Discretionary": "consumerDiscretionary", "Consumer Staples": "consumerStaples", "Industrials": "industrials",
  "Energy": "energy", "Utilities": "utilities", "Telecommunications": "communication", "Basic Materials": "materials",
};
export const sectorFromNasdaq = (name) => NASDAQ_SECTORS[name] || null;

export function profileFor(sic, sector) {
  const n = Number(sic);
  if (n === 6798 || (n >= 6500 && n <= 6599) || sector === "realEstate") return "realEstate";
  if ((n >= 6000 && n <= 6799 && n !== 6770) || sector === "financials") return "financial";
  return "general";
}
