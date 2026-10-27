// Lightweight SVG charts: single-series bars (annual figures) and a line chart (share price).
// One series per chart, so the title names it and no legend is needed; hover shows exact values.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function barChart(title, sub, points, f, emptyText) {
  const pts = points.filter(([, v]) => isNum(v));
  if (pts.length < 2) return `<div class="glass chart"><h3>${esc(title)}</h3><div class="chart-sub">${esc(sub)}</div><div class="empty small">${esc(emptyText)}</div></div>`;
  const W = 340, H = 180, padT = 20, padB = 22;
  const max = Math.max(0, ...pts.map(([, v]) => v));
  const min = Math.min(0, ...pts.map(([, v]) => v));
  const range = max - min || 1;
  const y = (v) => padT + ((max - v) / range) * (H - padT - padB);
  const slot = W / pts.length;
  const bw = Math.min(30, slot * 0.58);
  const zeroY = y(0);
  const bars = pts.map(([label, v], i) => {
    const x = slot * i + (slot - bw) / 2;
    const top = Math.min(y(v), zeroY), h = Math.max(1, Math.abs(y(v) - zeroY));
    const r = Math.min(4, bw / 2, h);
    // Rounded only at the data end; flat on the baseline.
    const d = v >= 0
      ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
      : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + bw - r} Q${x + bw},${top + h} ${x + bw},${top + h - r} V${top} Z`;
    const last = i === pts.length - 1;
    const showLabel = pts.length <= 7 || i % 2 === (pts.length - 1) % 2;
    return `<rect class="hit" x="${slot * i}" y="0" width="${slot}" height="${H}" data-tip="${esc(label)}: ${esc(f(v))}"/>
      <path class="${v >= 0 ? "bar-pos" : "bar-neg"}" d="${d}"/>
      ${showLabel ? `<text class="axis-label" x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(label)}</text>` : ""}
      ${last ? `<text class="value-label" x="${Math.min(x + bw / 2, W - 30)}" y="${v >= 0 ? top - 6 : top + h + 13}" text-anchor="middle">${esc(f(v))}</text>` : ""}`;
  }).join("");
  return `<div class="glass chart"><h3>${esc(title)}</h3><div class="chart-sub">${esc(sub)}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${esc(pts.map(([l, v]) => `${l} ${f(v)}`).join(", "))}">
      <line class="${min < 0 ? "zero" : "gridline"}" x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}"/>
      ${bars}
    </svg></div>`;
}

export function lineChart(title, sub, points, f, emptyText) {
  const pts = points.filter(([, v]) => isNum(v));
  if (pts.length < 2) return `<div class="glass chart wide"><h3>${esc(title)}</h3><div class="chart-sub">${esc(sub)}</div><div class="empty small">${esc(emptyText)}</div></div>`;
  const W = 900, H = 220, padT = 14, padB = 22, padR = 54;
  const vals = pts.map(([, v]) => v);
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const x = (i) => (i / (pts.length - 1)) * (W - padR);
  const y = (v) => padT + ((max - v) / range) * (H - padT - padB);
  const path = pts.map(([, v], i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(pts.length - 1)},${H - padB} L0,${H - padB} Z`;
  const ticks = [max, (max + min) / 2, min].map((v) => `<line class="gridline" x1="0" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${W - padR + 6}" y="${y(v) + 4}">${esc(f(v))}</text>`).join("");
  const years = [];
  pts.forEach(([label], i) => { if (label.endsWith("-01") && i > 0) years.push(`<text class="axis-label" x="${x(i)}" y="${H - 5}" text-anchor="middle">${label.slice(0, 4)}</text>`); });
  const data = esc(JSON.stringify(pts.map(([l, v]) => [l, f(v)])));
  return `<div class="glass chart wide" data-line="${data}" data-w="${W - padR}" data-n="${pts.length}"><h3>${esc(title)}</h3><div class="chart-sub">${esc(sub)}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ea2ff" stop-opacity=".35"/><stop offset="1" stop-color="#5ea2ff" stop-opacity="0"/></linearGradient></defs>
      ${ticks}${years.join("")}
      <path class="area" d="${area}"/>
      <path class="line" d="${path}"/>
      <line class="cross hidden" x1="0" x2="0" y1="${padT}" y2="${H - padB}"/>
      <circle class="marker hidden" r="4.5" cx="0" cy="0"/>
      <rect class="hit" x="0" y="0" width="${W - padR}" height="${H}"/>
    </svg></div>`.replace("</svg>", `<g class="ys" data-y='${esc(JSON.stringify(pts.map(([, v]) => +y(v).toFixed(1))))}'></g></svg>`);
}

// Hover tooltips for both chart types (pointer events work for mouse, pen and touch).
export function wireCharts(root) {
  root.querySelectorAll(".chart").forEach((card) => {
    let tip = null;
    const svg = card.querySelector("svg");
    const line = card.dataset.line ? JSON.parse(card.dataset.line) : null;
    const ys = line ? JSON.parse(card.querySelector(".ys").dataset.y) : null;
    const hide = () => { tip?.remove(); tip = null; card.querySelector(".cross")?.classList.add("hidden"); card.querySelector(".marker")?.classList.add("hidden"); };
    const show = (text, cx, cy) => {
      if (!tip) { tip = document.createElement("div"); tip.className = "tooltip"; card.appendChild(tip); }
      tip.textContent = text;
      tip.style.left = `${cx}px`;
      tip.style.top = `${cy}px`;
    };
    card.addEventListener("pointermove", (e) => {
      const cr = card.getBoundingClientRect();
      if (line) {
        const sr = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const k = sr.width / vb.width;
        const w = Number(card.dataset.w), n = Number(card.dataset.n);
        const vx = (e.clientX - sr.left) / k;
        if (vx < 0 || vx > w) return hide();
        const i = Math.round((vx / w) * (n - 1));
        const px = (i / (n - 1)) * w;
        const cross = card.querySelector(".cross"), mk = card.querySelector(".marker");
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.classList.remove("hidden");
        mk.setAttribute("cx", px); mk.setAttribute("cy", ys[i]); mk.classList.remove("hidden");
        show(`${line[i][0]}: ${line[i][1]}`, sr.left - cr.left + px * k, sr.top - cr.top + ys[i] * k);
        return;
      }
      const hit = e.target.closest(".hit");
      if (!hit) return hide();
      show(hit.dataset.tip, e.clientX - cr.left, e.clientY - cr.top);
    });
    card.addEventListener("pointerleave", hide);
  });
}
