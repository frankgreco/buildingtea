// Plain-SVG charts. Severity uses an ordinal blue ramp (darker = worse); the single
// complaint series uses slot-1 blue. Every chart has a table twin and hover/tap tooltips.

import type { ChartSeries } from "@shared/types";

const SEV = [
  { label: "Minor", color: "var(--sev-1)" },
  { label: "Hazardous", color: "var(--sev-2)" },
  { label: "Immediately hazardous", color: "var(--sev-3)" },
];

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string | number): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text != null) e.textContent = String(text);
  return e;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

interface Hit {
  el: SVGElement;
  cx: number;
  cy: number;
  html: string;
}

function attachTooltip(wrap: HTMLElement, svg: SVGSVGElement, hits: Hit[]) {
  let tip = wrap.querySelector<HTMLDivElement>(".tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    wrap.appendChild(tip);
  }
  const t = tip;
  const show = (h: Hit) => {
    t.innerHTML = h.html;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    t.style.left = `${h.cx * (r.width / vb.width)}px`;
    t.style.top = `${h.cy * (r.height / vb.height)}px`;
    t.classList.add("show");
  };
  const hide = () => t.classList.remove("show");
  for (const h of hits) {
    h.el.addEventListener("pointerenter", () => show(h));
    h.el.addEventListener("pointermove", () => show(h));
    h.el.addEventListener("pointerleave", hide);
    h.el.addEventListener("focus", () => show(h));
    h.el.addEventListener("blur", hide);
    h.el.addEventListener("click", (e) => {
      e.stopPropagation();
      show(h);
    });
  }
  document.addEventListener("click", hide);
}

function wireToggle(card: HTMLElement) {
  card.querySelectorAll<HTMLButtonElement>(".toggle button").forEach((btn) => {
    btn.onclick = () => {
      card.querySelectorAll<HTMLButtonElement>(".toggle button").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      const table = btn.dataset.view === "table";
      card.querySelector("[data-chart]")?.classList.toggle("hidden", table);
      card.querySelector("[data-legend]")?.classList.toggle("hidden", table);
      card.querySelector("[data-table]")?.classList.toggle("hidden", !table);
    };
  });
}

export function violationsChart(card: HTMLElement, s: ChartSeries) {
  const wrap = card.querySelector<HTMLElement>("[data-chart]")!;
  wrap.innerHTML = "";
  const years = s.years;
  const rows = s.violationsByYear;
  const W = 340,
    H = 190,
    m = { t: 18, r: 8, b: 26, l: 28 };
  const pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const totals = rows.map((r) => r[0] + r[1] + r[2]);
  const max = Math.max(...totals, 1);
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1]!;
  const y = (v: number) => m.t + ph - (v / yMax) * ph;
  const slot = pw / years.length;
  const bw = Math.min(24, slot * 0.72);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Violations issued per year by severity" });
  for (const t of ticks) {
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(el("text", { x: m.l - 4, y: y(t) + 4, "text-anchor": "end", class: "axis-text" }, t));
  }
  const hits: Hit[] = [];
  const maxIdx = totals.indexOf(Math.max(...totals));
  years.forEach((yr, i) => {
    const x = m.l + i * slot + (slot - bw) / 2;
    const r = rows[i]!;
    const nonzero = r.map((v, k) => [v, k] as const).filter(([v]) => v > 0);
    nonzero.forEach(([v, k], j) => {
      const cum = r.slice(0, k + 1).reduce((a, b) => a + b, 0);
      const y1 = y(cum),
        y0 = y(cum - v);
      const h = y0 - y1;
      const gap = j > 0 ? 2 : 0;
      if (j === nonzero.length - 1) svg.appendChild(el("path", { d: topRounded(x, y1, bw, Math.max(0, h - gap), 4), fill: SEV[k]!.color }));
      else svg.appendChild(el("rect", { x, y: y1 + gap, width: bw, height: Math.max(0, h - gap), fill: SEV[k]!.color }));
    });
    if (i % 5 === 0 || i === years.length - 1) svg.appendChild(el("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "axis-text" }, yr));
    if (i === maxIdx && totals[i]! > 0) svg.appendChild(el("text", { x: x + bw / 2, y: y(totals[i]!) - 5, "text-anchor": "middle", class: "dl-text" }, totals[i]!));
    const hit = el("rect", { x: m.l + i * slot, y: m.t, width: slot, height: ph, fill: "transparent", tabindex: 0, role: "button", "aria-label": `${yr}: ${totals[i]} total` });
    svg.appendChild(hit);
    hits.push({ el: hit, cx: x + bw / 2, cy: y(totals[i]!), html: `${yr} · ${totals[i]} total<small>${r[2]} immediately hazardous · ${r[1]} hazardous · ${r[0]} minor</small>` });
  });
  wrap.appendChild(svg);
  attachTooltip(wrap, svg, hits);
  card.querySelector("[data-legend]")!.innerHTML = SEV.slice()
    .reverse()
    .map((x) => `<span><b style="background:${x.color}"></b>${x.label}</span>`)
    .join("");
  const body = years
    .map((yr, i) => (totals[i] ? `<tr><td>${yr}</td><td>${rows[i]![2]}</td><td>${rows[i]![1]}</td><td>${rows[i]![0]}</td><td>${totals[i]}</td></tr>` : ""))
    .join("");
  card.querySelector("[data-table]")!.innerHTML = `<table class="tv"><thead><tr><th>Year</th><th>Imm. hazardous</th><th>Hazardous</th><th>Minor</th><th>Total</th></tr></thead><tbody>${body || `<tr><td colspan="5">No violations recorded in this window.</td></tr>`}</tbody></table>`;
  wireToggle(card);
}

export function complaintsChart(card: HTMLElement, s: ChartSeries) {
  const wrap = card.querySelector<HTMLElement>("[data-chart]")!;
  wrap.innerHTML = "";
  const months = s.months;
  const vals = s.complaintsByMonth;
  const W = 340,
    H = 170,
    m = { t: 18, r: 8, b: 26, l: 28 };
  const pw = W - m.l - m.r,
    ph = H - m.t - m.b;
  const max = Math.max(...vals, 1);
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1]!;
  const y = (v: number) => m.t + ph - (v / yMax) * ph;
  const slot = pw / months.length;
  const bw = Math.min(24, slot * 0.66);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Complaints per month, last 24 months" });
  let bandStart: number | null = null;
  months.forEach((mo, i) => {
    const mm = Number(mo.slice(5));
    const winter = mm === 12 || mm === 1 || mm === 2;
    if (winter && bandStart === null) bandStart = i;
    if ((!winter || i === months.length - 1) && bandStart !== null) {
      const end = winter ? i + 1 : i;
      svg.appendChild(el("rect", { x: m.l + bandStart * slot, y: m.t, width: (end - bandStart) * slot, height: ph, fill: "var(--grid)", opacity: 0.45 }));
      bandStart = null;
    }
  });
  for (const t of ticks) {
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(el("text", { x: m.l - 4, y: y(t) + 4, "text-anchor": "end", class: "axis-text" }, t));
  }
  const hits: Hit[] = [];
  const maxIdx = vals.indexOf(Math.max(...vals));
  const label = (mo: string) => new Date(`${mo}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  months.forEach((mo, i) => {
    const x = m.l + i * slot + (slot - bw) / 2;
    const v = vals[i]!;
    if (v > 0) svg.appendChild(el("path", { d: topRounded(x, y(v), bw, y(0) - y(v), 4), fill: "var(--series-1)" }));
    if (mo.endsWith("-01") || i === 0) svg.appendChild(el("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "axis-text" }, mo.endsWith("-01") ? mo.slice(0, 4) : label(mo).replace(/ 20/, " ’")));
    if (i === maxIdx && v > 0) svg.appendChild(el("text", { x: x + bw / 2, y: y(v) - 5, "text-anchor": "middle", class: "dl-text" }, v));
    const hit = el("rect", { x: m.l + i * slot, y: m.t, width: slot, height: ph, fill: "transparent", tabindex: 0, role: "button", "aria-label": `${label(mo)}: ${v}` });
    svg.appendChild(hit);
    hits.push({ el: hit, cx: x + bw / 2, cy: y(v), html: `${label(mo)}<small>${v} complaint${v === 1 ? "" : "s"}</small>` });
  });
  wrap.appendChild(svg);
  attachTooltip(wrap, svg, hits);
  card.querySelector("[data-legend]")!.innerHTML = `<span><b style="background:var(--series-1)"></b>Complaints</span><span><b style="background:var(--grid)"></b>Winter (Dec to Feb)</span>`;
  card.querySelector("[data-table]")!.innerHTML = `<table class="tv"><thead><tr><th>Month</th><th>Complaints</th></tr></thead><tbody>${months.map((mo, i) => `<tr><td>${label(mo)}</td><td>${vals[i]}</td></tr>`).join("")}</tbody></table>`;
  wireToggle(card);
}
