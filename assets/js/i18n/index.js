// Language handling: English is the default; the choice is remembered per browser.
import en from "./en.js";
import hu from "./hu.js";
import de from "./de.js";
import fr from "./fr.js";
import es from "./es.js";

export const LANGS = { en, hu, de, fr, es };
const KEY = "tsx-lang";

let current = "en";
try {
  const saved = localStorage.getItem(KEY);
  if (saved && LANGS[saved]) current = saved;
} catch {}

export const lang = () => current;
export const dict = () => LANGS[current];
export const locale = () => LANGS[current].meta.locale;

export function setLang(code) {
  if (!LANGS[code]) return;
  current = code;
  try { localStorage.setItem(KEY, code); } catch {}
  document.documentElement.lang = code;
}
if (typeof document !== "undefined") document.documentElement.lang = current;

// t("ui.results", { n: 5 }) – falls back to English if a key is missing.
export function t(path, params) {
  const get = (d) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
  let s = get(LANGS[current]);
  if (s == null) s = get(en);
  if (s == null) return path;
  return params ? fill(s, params) : s;
}

export function fill(s, params) {
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? "–"));
}

// ---------- Number formatting ----------

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const cache = new Map();
function nf(opts) {
  const k = current + JSON.stringify(opts);
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale(), opts));
  return cache.get(k);
}

export function money(v) {
  if (!isNum(v)) return "–";
  return nf({ style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: Math.abs(v) >= 1e9 ? 1 : 0 }).format(v);
}

export function num(v, d = 1) {
  return isNum(v) ? nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "–";
}

export function fmt(v, kind) {
  if (v === Infinity) return kind === "mult" || kind === "xyears" ? "n/m" : "∞";
  if (v === -Infinity) return "−∞";
  if (!isNum(v)) return "–";
  const pct = (d) => nf({ style: "percent", minimumFractionDigits: d, maximumFractionDigits: d });
  switch (kind) {
    case "pct": return pct(1).format(v);
    case "pct0": return pct(0).format(v);
    case "spct": return (v > 0 ? "+" : "") + pct(1).format(v);
    case "pp": return `${v > 0 ? "+" : ""}${num(v * 100, 1)} pp`;
    case "x": return `${num(v, 2)}×`;
    case "xyears": return `${num(v, 1)}×`;
    case "mult": return `${num(v, 1)}×`;
    case "of9": return `${v}/9`;
    case "money": return money(v);
    case "usd": return nf({ style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
    case "int": return nf({ maximumFractionDigits: 0 }).format(v);
    default: return num(v, 2);
  }
}

export const date = (d) => (d ? new Date(d).toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" }) : "–");
