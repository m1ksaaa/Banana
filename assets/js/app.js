import { analyze, grade, DIMENSIONS, METRIC_INFO, ENGINE_VERSION } from "./scoring.js";

const app = document.getElementById("app");
const PAGE_SIZE = 50;

// ---------- Formázás ----------

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const nf = (d) => new Intl.NumberFormat("hu-HU", { minimumFractionDigits: d, maximumFractionDigits: d });

function money(v) {
  if (!isNum(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e12) return `${nf(2).format(v / 1e12)} ezer Mrd $`;
  if (a >= 1e9) return `${nf(1).format(v / 1e9)} Mrd $`;
  if (a >= 1e6) return `${nf(1).format(v / 1e6)} M $`;
  return `${nf(0).format(v)} $`;
}

function fmt(v, kind) {
  if (v === Infinity) return "∞";
  if (!isNum(v)) return "–";
  switch (kind) {
    case "pct": return `${nf(1).format(v * 100)}%`;
    case "pct0": return `${nf(0).format(v * 100)}%`;
    case "spct": return `${v >= 0 ? "+" : ""}${nf(1).format(v * 100)}%`;
    case "pp": return `${v >= 0 ? "+" : ""}${nf(1).format(v * 100)} pp`;
    case "x": return `${nf(2).format(v)}×`;
    case "years": return `${nf(1).format(v)} év`;
    case "of9": return `${v}/9`;
    case "money": return money(v);
    default: return nf(2).format(v);
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function scorePill(score, inverse = false) {
  const g = grade(score, inverse);
  return `<span class="pill tone-${g.tone}" title="${esc(g.label)}"><span class="dot"></span>${isNum(score) ? score + "%" : "–"}</span>`;
}

// ---------- Adatbetöltés ----------

let indexCache = null;
async function loadIndex() {
  if (!indexCache) {
    const r = await fetch("data/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("Az index nem tölthető be.");
    indexCache = await r.json();
  }
  return indexCache;
}

async function loadCompany(ticker) {
  const r = await fetch(`data/companies/${encodeURIComponent(ticker)}.json`, { cache: "no-cache" });
  if (!r.ok) return null;
  return r.json();
}

// ---------- Téma ----------

const themeBtn = document.querySelector(".theme-toggle");
try { const t = localStorage.getItem("tsx-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("tsx-theme", next); } catch {}
});

// ---------- Útválasztás ----------

const listState = { q: "", sector: "", sort: "overall", dir: -1, page: 0, onlyData: true };

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [page, arg] = hash.split("/");
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active",
    (a.dataset.nav === "list" && (page === "" || page === "c")) || (a.dataset.nav === "method" && page === "modszertan")));
  window.scrollTo(0, 0);
  try {
    if (page === "c" && arg) await renderCompany(decodeURIComponent(arg).toUpperCase());
    else if (page === "modszertan") renderMethod();
    else await renderList();
  } catch (e) {
    app.innerHTML = `<div class="card empty">Hiba történt: ${esc(e.message)}<br><span class="small">Ha a fájlt közvetlenül nyitottad meg, indíts egy helyi szervert (lásd README).</span></div>`;
  }
}
addEventListener("hashchange", route);

// ---------- Lista oldal ----------

const COLS = [
  { key: "overall", label: "TeraScore" },
  { key: "operations", label: "Működés", hide: true },
  { key: "stability", label: "Stabilitás", hide: true },
  { key: "growth1y", label: "Fejlődés 1 év", hide: true },
  { key: "longTerm", label: "Hosszú táv", hide: true },
  { key: "risk", label: "Kockázat", inverse: true },
];

async function renderList() {
  app.innerHTML = `<div class="skeleton"></div>`;
  const idx = await loadIndex();
  const sectors = [...new Set(idx.companies.map((c) => c.s).filter(Boolean))].sort((a, b) => a.localeCompare(b, "hu"));
  const withData = idx.companies.filter((c) => c.sc).length;

  app.innerHTML = `
    <section class="hero">
      <h1>Részvényelemzés, érthetően.</h1>
      <p>Válassz egy NASDAQ-on jegyzett céget, és megmutatjuk százalékokban, hogyan működik, mennyire stabil, mennyit fejlődött, és mekkora a kockázata – a hivatalos pénzügyi jelentései alapján.</p>
    </section>
    <div class="search-row">
      <label class="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg>
        <input id="q" type="search" placeholder="Keresés: ticker vagy cégnév (pl. AAPL, Apple)" autocomplete="off" value="${esc(listState.q)}" aria-label="Keresés">
      </label>
      <select id="sector" aria-label="Iparág">
        <option value="">Minden iparág</option>
        ${sectors.map((s) => `<option ${s === listState.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      <select id="onlyData" aria-label="Szűrés">
        <option value="1" ${listState.onlyData ? "selected" : ""}>Csak elemzett cégek</option>
        <option value="0" ${!listState.onlyData ? "selected" : ""}>Minden cég</option>
      </select>
    </div>
    <div class="list-meta"><span id="count"></span><span>${withData} elemzett / ${idx.count} cég · frissítve: ${new Date(idx.generated).toLocaleDateString("hu-HU")}</span></div>
    <div class="card table-wrap"><table class="list">
      <thead><tr>
        <th data-sort="t">Cég</th>
        ${COLS.map((c) => `<th class="num ${c.hide ? "col-hide-sm" : ""}" data-sort="${c.key}">${c.label}</th>`).join("")}
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="pager" id="pager"></div>
    ${idx.companies.some((c) => c.demo) ? `<p class="small muted" style="margin-top:16px">A <span class="badge-demo" style="margin:0">DEMÓ</span> jelölésű cégeknél közelítő minta adatok láthatók, amíg az adatfrissítő le nem tölti a hivatalos SEC adatokat.</p>` : ""}
  `;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    let rows = idx.companies.filter((c) =>
      (!listState.onlyData || c.sc) &&
      (!listState.sector || c.s === listState.sector) &&
      (!q || c.t.toLowerCase().startsWith(q) || c.n.toLowerCase().includes(q)));
    const k = listState.sort;
    rows.sort((a, b) => {
      if (k === "t") return listState.dir * a.t.localeCompare(b.t);
      const va = a.sc?.[k], vb = b.sc?.[k];
      if (!isNum(va) && !isNum(vb)) return a.t.localeCompare(b.t);
      if (!isNum(va)) return 1;
      if (!isNum(vb)) return -1;
      return listState.dir * (va - vb) || a.t.localeCompare(b.t);
    });
    // Pontos ticker-egyezés mindig elöl.
    const exact = rows.findIndex((c) => c.t.toLowerCase() === q);
    if (exact > 0) rows.unshift(rows.splice(exact, 1)[0]);

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    listState.page = Math.min(listState.page, pages - 1);
    const slice = rows.slice(listState.page * PAGE_SIZE, (listState.page + 1) * PAGE_SIZE);

    document.getElementById("count").textContent = `${rows.length} találat`;
    document.getElementById("rows").innerHTML = slice.length ? slice.map((c) => `
      <tr data-t="${esc(c.t)}" tabindex="0">
        <td><span class="tick">${esc(c.t)}</span>${c.demo ? '<span class="badge-demo">DEMÓ</span>' : ""}<br><span class="cname small">${esc(c.n)}</span></td>
        ${COLS.map((col) => `<td class="num ${col.hide ? "col-hide-sm" : ""}">${c.sc ? scorePill(c.sc[col.key], col.inverse) : '<span class="small muted">nincs adat</span>'}</td>`).join("")}
      </tr>`).join("") : `<tr><td colspan="${COLS.length + 1}" class="empty">Nincs a keresésnek megfelelő cég.</td></tr>`;

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const on = th.dataset.sort === k;
      th.toggleAttribute("aria-sort", on);
      if (on) th.setAttribute("aria-sort", listState.dir > 0 ? "ascending" : "descending");
      th.textContent = th.textContent.replace(/ [▲▼]$/, "") + (on ? (listState.dir > 0 ? " ▲" : " ▼") : "");
    });

    document.getElementById("pager").innerHTML = pages > 1 ? `
      <button class="btn" data-p="-1" ${listState.page === 0 ? "disabled" : ""}>‹ Előző</button>
      <span class="btn" style="cursor:default">${listState.page + 1} / ${pages}</span>
      <button class="btn" data-p="1" ${listState.page >= pages - 1 ? "disabled" : ""}>Következő ›</button>` : "";
  };

  const q = document.getElementById("q");
  q.addEventListener("input", () => { listState.q = q.value; listState.page = 0; draw(); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = document.querySelector("#rows tr[data-t]"); if (first) location.hash = `#/c/${first.dataset.t}`; }
  });
  document.getElementById("sector").addEventListener("change", (e) => { listState.sector = e.target.value; listState.page = 0; draw(); });
  document.getElementById("onlyData").addEventListener("change", (e) => { listState.onlyData = e.target.value === "1"; listState.page = 0; draw(); });
  document.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]"); if (!th) return;
    if (listState.sort === th.dataset.sort) listState.dir *= -1;
    else { listState.sort = th.dataset.sort; listState.dir = th.dataset.sort === "t" || th.dataset.sort === "risk" ? 1 : -1; }
    draw();
  });
  const rowsEl = document.getElementById("rows");
  const open = (e) => { const tr = e.target.closest("tr[data-t]"); if (tr) location.hash = `#/c/${tr.dataset.t}`; };
  rowsEl.addEventListener("click", open);
  rowsEl.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
  document.getElementById("pager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    listState.page += Number(b.dataset.p); draw(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  draw();
  if (!matchMedia("(pointer: coarse)").matches) q.focus();
}

// ---------- Cég oldal ----------

async function renderCompany(ticker) {
  app.innerHTML = `<div class="skeleton"></div>`;
  const c = await loadCompany(ticker);
  if (!c) {
    app.innerHTML = `<a class="back" href="#/">‹ Vissza a listához</a><div class="card empty">Nincs ilyen cég az adatbázisban: <b>${esc(ticker)}</b></div>`;
    return;
  }
  const a = analyze(c);
  document.title = `${c.ticker} – ${c.name} | TeraStockX`;

  app.innerHTML = `
    <a class="back" href="#/">‹ Vissza a listához</a>
    <div class="company-head">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="sub"><span class="ticker-chip">${esc(c.ticker)}</span><span>${esc(c.exchange || "NASDAQ")}</span>${c.sector ? `<span>· ${esc(c.sector)}</span>` : ""}${a.ok ? `<span>· utolsó lezárt pénzügyi év: ${a.latestYear}</span>` : ""}</div>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-tab="analysis">Elemzés</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="raw">Nyers pénzügyi adatok</button>
    </div>
    ${c.demo ? `<div class="notice"><span>ℹ️</span><span><b>Demó adat.</b> Ennél a cégnél közelítő minta számok láthatók; az adatfrissítő a SEC hivatalos adataival felülírja őket.</span></div>` : ""}
    <div id="tab-analysis">${a.ok ? analysisView(c, a) : `<div class="card empty">${esc(a.reason)}${c.note ? `<br><span class="small">${esc(c.note)}</span>` : ""}</div>`}</div>
    <div id="tab-raw" class="hidden">${rawView(c, a)}</div>
  `;

  app.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    app.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === b)));
    document.getElementById("tab-analysis").classList.toggle("hidden", b.dataset.tab !== "analysis");
    document.getElementById("tab-raw").classList.toggle("hidden", b.dataset.tab !== "raw");
  });
  wireTooltips();
  const csvBtn = document.getElementById("csv");
  if (csvBtn) csvBtn.addEventListener("click", () => downloadCsv(c));
}

function ring(score) {
  const g = grade(score);
  const r = 78, C = 2 * Math.PI * r, v = isNum(score) ? score : 0;
  const color = { good: "var(--good)", warning: "var(--warning)", serious: "var(--serious)", critical: "var(--critical)", none: "var(--none)" }[g.tone];
  return `<div class="ring" role="img" aria-label="TeraScore: ${isNum(score) ? score + "%" : "nincs adat"}, ${g.label}">
    <svg viewBox="0 0 180 180" width="180" height="180" aria-hidden="true">
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="14"/>
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(C * v) / 100} ${C}"/>
    </svg>
    <div class="ring-label"><div class="ring-value">${isNum(score) ? score : "–"}<small>%</small></div><div class="ring-caption">TeraScore · ${g.label}</div></div>
  </div>`;
}

const DISTRESS_TONE = { low: "good", medium: "warning", high: "critical" };
const OUTLOOK_TONE = { up: "good", flat: "warning", down: "critical", unknown: "none" };
const OUTLOOK_ICON = { up: "↗", flat: "→", down: "↘", unknown: "?" };

function analysisView(c, a) {
  const riskG = grade(a.scores.risk, true);
  const summary = `
    <div class="card card-pad summary">
      ${ring(a.scores.overall)}
      <div>
        <div class="verdict">${esc(a.verdict.split(".")[0])}.</div>
        <div class="summary-facts">
          <div class="fact"><div class="k">Kockázat</div><div class="v"><span class="pill tone-${riskG.tone}"><span class="dot"></span>${a.scores.risk ?? "–"}%</span> ${riskG.label}</div></div>
          <div class="fact"><div class="k">Csődkockázat</div><div class="v"><span class="pill tone-${DISTRESS_TONE[a.distress.level]}"><span class="dot"></span>${a.distress.label}</span></div></div>
          <div class="fact"><div class="k">Hosszú távú trend</div><div class="v"><span class="pill tone-${OUTLOOK_TONE[a.outlook.level]}">${OUTLOOK_ICON[a.outlook.level]} ${a.outlook.label}</span></div></div>
          <div class="fact"><div class="k">Adatlefedettség</div><div class="v">${a.coverage}% <span class="small muted">(${a.metrics.yearsOfData} év)</span></div></div>
        </div>
        <p class="small muted" style="margin:12px 0 0">${esc(a.distress.text)} ${esc(a.outlook.text)}</p>
      </div>
    </div>`;

  const cards = DIMENSIONS.map((d) => {
    const s = a.scores[d.key];
    const g = grade(s, d.inverse);
    const parts = a.parts[d.key];
    return `
      <div class="card score-card">
        <div class="score-top">
          <div><div class="score-name">${d.label}</div><div class="score-q">${d.short}</div></div>
          <div class="score-val">${isNum(s) ? s : "–"}<small>%</small></div>
        </div>
        <div class="bar tone-${g.tone}" role="img" aria-label="${d.label}: ${isNum(s) ? s + "%" : "nincs adat"}, ${g.label}"><span style="width:${isNum(s) ? s : 0}%"></span></div>
        <span class="pill tone-${g.tone}"><span class="dot"></span>${g.label}</span>
        <p class="score-text">${esc(a.explanations[d.key])}</p>
        ${parts ? `<details class="parts"><summary>Miből számoltuk?</summary>
          <table class="parts-table">${parts.map((p) => `<tr>
            <td title="${esc(METRIC_INFO[p.key]?.desc || "")}">${METRIC_INFO[p.key]?.label || p.key}</td>
            <td>${fmt(a.metrics[p.key], METRIC_INFO[p.key]?.fmt)}</td>
            <td class="pts">${isNum(p.score) ? p.score + " pont" : "nincs adat"} · ${Math.round(p.weight * 100)}%</td>
          </tr>`).join("")}</table></details>`
        : `<details class="parts"><summary>Miből számoltuk?</summary><p class="small muted">100% − (stabilitás 45% + megbízhatóság 30% + működés 25% súlyozott átlaga), majd minden kritikus figyelmeztetés +10, minden egyéb figyelmeztetés +4 pont.</p></details>`}
      </div>`;
  }).join("");

  const order = { critical: 0, warning: 1, positive: 2 };
  const tagText = { critical: "Kritikus", warning: "Figyelmeztetés", positive: "Erősség" };
  const icon = { critical: "!", warning: "!", positive: "✓" };
  const flags = [...a.flags].sort((x, y) => order[x.level] - order[y.level]);
  const flagsHtml = flags.length ? `<div class="flags">${flags.map((f) => `
    <div class="card flag flag-${f.level}">
      <div class="flag-icon" aria-hidden="true">${icon[f.level]}</div>
      <div><div class="flag-title">${esc(f.title)}<span class="flag-tag">${tagText[f.level]}</span></div><div class="flag-text">${esc(f.text)}</div></div>
    </div>`).join("")}</div>` : `<div class="card empty">Nincs kiemelendő jelzés.</div>`;

  const s = a.series;
  const charts = `<div class="charts">
    ${barChart("Bevétel", "évente", s.map((y) => [y.year, y.revenue]), money)}
    ${barChart("Nettó nyereség", "évente (piros = veszteség)", s.map((y) => [y.year, y.netIncome]), money)}
    ${barChart("Szabad cash flow", "működési cash flow − beruházások", s.map((y) => [y.year, y.freeCashFlow]), money)}
    ${barChart("Működési árrés", "működési eredmény / bevétel", s.map((y) => [y.year, y.operatingMargin]), (v) => fmt(v, "pct"))}
  </div>`;

  return `
    ${summary}
    <h2 class="section-title">Értékelés százalékokban</h2>
    <div class="score-grid">${cards}</div>
    <h2 class="section-title">Figyelmeztetések és erősségek</h2>
    ${flagsHtml}
    <h2 class="section-title">Alakulás az évek során</h2>
    ${charts}
    <p class="small muted" style="margin-top:20px">Elemzőmotor v${ENGINE_VERSION}. A pontszámok a múltbeli, nyilvános pénzügyi adatokból számolt mutatók; nem befektetési tanács.</p>`;
}

// Egyszerű, egysoros oszlopdiagram. Negatív értékek a nulla vonal alatt, piros színnel.
function barChart(title, sub, points, f) {
  const pts = points.filter(([, v]) => isNum(v));
  if (pts.length < 2) return `<div class="card chart"><h3>${title}</h3><div class="chart-sub">${sub}</div><div class="empty small">Nincs elég adat.</div></div>`;
  const W = 320, H = 170, padL = 4, padR = 4, padT = 18, padB = 22;
  const max = Math.max(0, ...pts.map(([, v]) => v));
  const min = Math.min(0, ...pts.map(([, v]) => v));
  const range = max - min || 1;
  const y = (v) => padT + ((max - v) / range) * (H - padT - padB);
  const slot = (W - padL - padR) / pts.length;
  const bw = Math.min(36, slot * 0.6);
  const zeroY = y(0);
  const bars = pts.map(([yr, v], i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const top = Math.min(y(v), zeroY), h = Math.max(1, Math.abs(y(v) - zeroY));
    const r = Math.min(4, bw / 2, h);
    // Lekerekítés csak az adat felőli végén, a nulla vonalnál egyenes.
    const path = v >= 0
      ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
      : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + bw - r} Q${x + bw},${top + h} ${x + bw},${top + h - r} V${top} Z`;
    const isLast = i === pts.length - 1;
    return `<rect class="hit" x="${padL + slot * i}" y="0" width="${slot}" height="${H}" data-tip="${yr}: ${esc(f(v))}"/>
      <path class="${v >= 0 ? "bar-pos" : "bar-neg"}" d="${path}"/>
      <text class="axis-label" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${yr}</text>
      ${isLast ? `<text class="axis-label" x="${x + bw / 2}" y="${v >= 0 ? top - 5 : top + h + 12}" text-anchor="middle" style="fill:var(--text-2);font-weight:600">${esc(f(v))}</text>` : ""}`;
  }).join("");
  return `<div class="card chart"><h3>${title}</h3><div class="chart-sub">${sub}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}: ${pts.map(([yr, v]) => `${yr}: ${f(v)}`).join(", ")}">
      <line class="${min < 0 ? "zero" : "gridline"}" x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}"/>
      ${bars}
    </svg></div>`;
}

function wireTooltips() {
  app.querySelectorAll(".chart").forEach((card) => {
    let tip = null;
    card.addEventListener("pointermove", (e) => {
      const hit = e.target.closest(".hit");
      if (!hit) { tip?.remove(); tip = null; return; }
      if (!tip) { tip = document.createElement("div"); tip.className = "tooltip"; card.appendChild(tip); }
      tip.textContent = hit.dataset.tip;
      const cr = card.getBoundingClientRect();
      tip.style.left = `${e.clientX - cr.left}px`;
      tip.style.top = `${e.clientY - cr.top}px`;
    });
    card.addEventListener("pointerleave", () => { tip?.remove(); tip = null; });
  });
}

// ---------- Nyers adatok ----------

const RAW_GROUPS = [
  ["Eredménykimutatás", [
    ["revenue", "Bevétel"], ["costOfRevenue", "Közvetlen költségek"], ["grossProfit", "Bruttó nyereség"],
    ["researchAndDevelopment", "Kutatás-fejlesztés"], ["operatingIncome", "Működési eredmény"], ["interestExpense", "Kamatköltség"],
    ["netIncome", "Nettó nyereség"], ["epsDiluted", "EPS (hígított, $/részvény)", "eps"], ["sharesDiluted", "Részvényszám (hígított, db)", "shares"],
  ]],
  ["Cash flow", [
    ["operatingCashFlow", "Működési cash flow"], ["capex", "Beruházások (CapEx)"], ["freeCashFlow", "Szabad cash flow"], ["dividendsPaid", "Kifizetett osztalék"],
  ]],
  ["Mérleg", [
    ["totalAssets", "Összes eszköz"], ["currentAssets", "Forgóeszközök"], ["cash", "Készpénz"],
    ["totalLiabilities", "Összes kötelezettség"], ["currentLiabilities", "Rövid lejáratú kötelezettségek"], ["totalDebt", "Pénzügyi adósság"],
    ["equity", "Saját tőke"], ["retainedEarnings", "Eredménytartalék"],
  ]],
];

const SERIES_ROWS = [
  ["grossMargin", "pct"], ["operatingMargin", "pct"], ["netMargin", "pct"], ["fcfMargin", "pct"], ["roe", "pct"], ["roa", "pct"],
  ["currentRatio", "x"], ["debtToEquity", "x"], ["interestCoverage", "x"],
];

function rawCell(v, kind) {
  if (!isNum(v)) return `<td class="na">–</td>`;
  if (kind === "eps") return `<td>${nf(2).format(v)}</td>`;
  if (kind === "shares") return `<td>${nf(0).format(v / 1e6)} M</td>`;
  return `<td>${money(v)}</td>`;
}

function rawView(c, a) {
  const years = [...(c.annual || [])].sort((x, y) => x.year - y.year);
  if (!years.length) return `<div class="card empty">Ehhez a céghez nincs letöltött pénzügyi adat.</div>`;
  const head = `<tr><th>Pénzügyi év</th>${years.map((y) => `<th>${y.year}${y.periodEnd ? `<br><span class="small">${esc(y.periodEnd)}</span>` : ""}</th>`).join("")}</tr>`;
  const n = years.length + 1;
  let body = RAW_GROUPS.map(([g, rows]) => `<tr class="group"><td colspan="${n}">${g}</td></tr>` +
    rows.map(([k, label, kind]) => `<tr><td>${label}</td>${years.map((y) => rawCell(y[k] ?? (k === "freeCashFlow" && isNum(y.operatingCashFlow) && isNum(y.capex) ? y.operatingCashFlow - y.capex : null), kind)).join("")}</tr>`).join("")).join("");
  if (a.ok) {
    const byYear = new Map(a.series.map((s) => [s.year, s]));
    body += `<tr class="group"><td colspan="${n}">Számolt mutatók</td></tr>` + SERIES_ROWS.map(([k, kind]) =>
      `<tr><td>${METRIC_INFO[k].label}</td>${years.map((y) => { const v = byYear.get(y.year)?.[k]; return isNum(v) ? `<td>${fmt(v, kind)}</td>` : `<td class="na">–</td>`; }).join("")}</tr>`).join("");
  }
  const src = c.source ? `Forrás: ${c.source.url ? `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)}</a>` : esc(c.source.name)}${c.source.retrieved ? ` · letöltve: ${new Date(c.source.retrieved).toLocaleDateString("hu-HU")}` : ""}` : "";
  return `
    <div class="raw-actions">
      <span class="small muted">Összegek USD-ben. ${src}</span>
      <span style="display:flex;gap:8px">
        <button class="btn" id="csv" type="button">CSV letöltése</button>
        <a class="btn" href="data/companies/${encodeURIComponent(c.ticker)}.json" download>JSON (sablon)</a>
      </span>
    </div>
    <div class="card table-wrap"><table class="raw"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function downloadCsv(c) {
  const years = [...c.annual].sort((x, y) => x.year - y.year);
  const keys = RAW_GROUPS.flatMap(([, rows]) => rows.map((r) => r[0]));
  const lines = [["mezo", ...years.map((y) => y.year)].join(";")];
  for (const k of keys) lines.push([k, ...years.map((y) => (isNum(y[k]) ? y[k] : ""))].join(";"));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: `${c.ticker}_penzugyi_adatok.csv` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Módszertan ----------

function renderMethod() {
  document.title = "Hogyan számolunk? | TeraStockX";
  const dimRows = (key, parts) => parts.map(([k, w]) => `<tr><td>${METRIC_INFO[k].label}</td><td>${esc(METRIC_INFO[k].desc)}</td><td class="w">${w}%</td></tr>`).join("");
  const table = (rows) => `<table class="method-table"><thead><tr><th>Mutató</th><th>Számítás és pontozás</th><th>Súly</th></tr></thead><tbody>${rows}</tbody></table>`;
  app.innerHTML = `<div class="prose">
    <h1 style="font-size:32px">Hogyan számolunk?</h1>
    <p>Minden cég ugyanabba a sablonba kerül: a hivatalos éves jelentésekből (10-K / 20-F) vett nyers számokból mutatókat számolunk, a mutatókat 0–100 pontos skálára váltjuk, majd témánként súlyozott átlagot képzünk. Így minden érték százalékként olvasható: <b>100% a legjobb</b>, kivéve a <b>Kockázatot</b>, ahol az alacsonyabb a jobb.</p>
    <p>A skálázás lineáris: minden mutatónál megadjuk, melyik érték ér 0 és melyik 100 pontot; a kettő között arányosan számolunk, azon kívül 0-ra, illetve 100-ra vágjuk. Ha egy adat hiányzik, az a tétel kimarad, és a többi súlya arányosan nő – az <b>adatlefedettség</b> mutatja, hány tétel volt számolható.</p>
    <p>Színek: <span class="pill tone-good"><span class="dot"></span>65% felett jó</span> <span class="pill tone-warning"><span class="dot"></span>45–65% közepes</span> <span class="pill tone-serious"><span class="dot"></span>25–45% gyenge</span> <span class="pill tone-critical"><span class="dot"></span>25% alatt rossz</span></p>

    <h2>Működés</h2><p>Mennyire nyereséges most a cég az utolsó lezárt évben?</p>
    ${table(dimRows("operations", [["operatingMargin", 30], ["netMargin", 20], ["roe", 20], ["roa", 10], ["fcfMargin", 20]]))}
    <h2>Pénzügyi stabilitás</h2><p>Mennyi az adósság a többi adathoz képest, és kibírná-e a cég a nehezebb időket?</p>
    ${table(dimRows("stability", [["currentRatio", 15], ["debtToEquity", 20], ["interestCoverage", 15], ["netDebtToFcf", 25], ["altmanZ", 25]]))}
    <h2>Fejlődés (utóbbi 1 év)</h2><p>Az utolsó lezárt év az előzőhöz képest. Ha a cég veszteséges, a nyereségnövekedés 0 pontot kap.</p>
    ${table(dimRows("growth1y", [["revenueYoY", 40], ["netIncomeYoY", 30], ["fcfYoY", 30]]))}
    <h2>Hosszú távú fejlődés</h2><p>Legfeljebb az utolsó 6 év (5 évnyi változás) alapján.</p>
    ${table(dimRows("longTerm", [["revenueCagr", 35], ["netIncomeCagr", 25], ["revenueGrowthYearsRatio", 20], ["marginTrend", 20]]))}
    <h2>Megbízhatóság</h2><p>Mennyire kiszámítható és következetes a cég teljesítménye?</p>
    ${table(dimRows("reliability", [["profitableYearsRatio", 30], ["fcfPositiveRatio", 25], ["revenueVolatility", 20], ["shareChangeYearly", 10], ["piotroski", 15]]))}
    <h2>Kockázat</h2>
    <p>Kockázat = 100% − (stabilitás 45% + megbízhatóság 30% + működés 25% súlyozott átlaga), majd minden <b>kritikus</b> figyelmeztetés +10, minden egyéb <b>figyelmeztetés</b> +4 százalékpontot ad hozzá (0–100% közé vágva).</p>
    <h2>TeraScore (összesített)</h2>
    <p>Működés 20% + Pénzügyi stabilitás 25% + Fejlődés 1 év 10% + Hosszú távú fejlődés 20% + Megbízhatóság 25%.</p>
    <h2>Csődkockázat és hosszú távú trend</h2>
    <p><b>Csődkockázat</b> (Alacsony / Közepes / Magas): pontozás az Altman Z'' zóna (veszélyes: +3, szürke: +1), negatív saját tőke pénztermelés nélkül (+2), negatív szabad cash flow (+1), veszteség (+1), 1,5× alatti kamatfedezet (+2) és fedezetlen adósság (+1) alapján. 2 ponttól közepes, 4 ponttól magas.</p>
    <p><b>Hosszú távú trend</b>: 70% hosszú távú fejlődés + 30% egyéves fejlődés. 65% felett emelkedő, 40–65% stagnáló, alatta csökkenő. Ez a múltbeli irányt írja le, nem jóslat.</p>
    <h2>Fontos</h2>
    <p>Az elemzés kizárólag a cég pénzügyi kimutatásain alapul. Nem veszi figyelembe a részvény árát (drága vagy olcsó-e), a piaci hangulatot, a híreket és a jövőbeli terveket. Nem befektetési tanács.</p>
  </div>`;
}

route();
