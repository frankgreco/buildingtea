// All page rendering. Data in, DOM out. No framework: three views and a handful of
// partials are not worth a dependency.

import { attachAutocomplete } from "./autocomplete";
import type { Candidate, Card, CardTable, Cover, LineItem, Report, Status, Teaser } from "@shared/types";
import { checkout, sample } from "./api";
import { complaintsChart, violationsChart } from "./charts";
import { historyHtml, mountHistory, mountPreviewRows, previewComplaintRow, previewLegalRow, previewViolationRow, showsLegal } from "./history";
import { shortDate } from "./historyModel";
import { snapshotOf } from "@shared/snapshot";
import { LEGAL, LEGAL_EFFECTIVE, SUPPORT_EMAIL } from "./legal";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const STATUS_ICON: Record<Status, string> = { good: "✓", warn: "!", serious: "!", critical: "✕", neutral: "–" };
// Material Symbols Rounded (Apache 2.0), from google/material-design-icons:
// warning, mode_heat, pest_control, elevator, manage_accounts, gavel, volume_up, lock.
const CARD_ICON: Record<Card["key"], string> = {
  safe: "<svg viewBox='0 -960 960 960'><path d='M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm371-120q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm0-120q17 0 28.5-11.5T520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360Z'/></svg>",
  heat: "<svg viewBox='0 -960 960 960'><path d='M160-400q0-113 67-217t184-182q22-15 45.5-1.5T480-760v52q0 34 23.5 57t57.5 23q17 0 32.5-7.5T621-657q8-10 20.5-12.5T665-664q63 45 99 115t36 149q0 88-43 160.5T644-125q17-24 26.5-52.5T680-238q0-40-15-75.5T622-377L480-516 339-377q-29 29-44 64t-15 75q0 32 9.5 60.5T316-125q-70-42-113-114.5T160-400Zm320-4 85 83q17 17 26 38t9 45q0 49-35 83.5T480-120q-50 0-85-34.5T360-238q0-23 9-44.5t26-38.5l85-83Z'/></svg>",
  pests: "<svg viewBox='0 -960 960 960'><path d='M480-120q-64 0-114.5-33T283-240l-61 35q-14 8-30 3t-24-19q-8-14-4-30t18-24l69-40q-3-11-5-22.5t-4-22.5h-82q-17 0-28.5-11.5T120-400q0-17 11.5-28.5T160-440h82q2-12 4-23.5t5-22.5l-69-40q-14-8-18-24t4-30q8-14 24.5-18.5T223-595l59 35q8-14 18.5-27.5T322-612q-2-7-2-14v-14q0-24 7-46t19-41l-38-38q-11-11-11.5-28t11.5-29q11-12 27.5-11.5T364-822l42 40q17-9 35.5-13.5T480-800q20 0 39 5t36 14l41-41q12-12 28-11.5t28 12.5q11 12 11.5 28T652-765l-38 38q12 19 18.5 41t6.5 46v13.5q0 6.5-2 13.5 11 11 21.5 25t18.5 28l61-35q14-8 30-3.5t24 18.5q8 14 3.5 30.5T777-525l-69 39q3 11 5.5 22.5T718-440h82q17 0 28.5 11.5T840-400q0 17-11.5 28.5T800-360h-82q-2 12-4 23.5t-5 22.5l69 40q14 8 18 24.5t-4 30.5q-8 14-24 18t-30-4l-61-35q-32 54-82.5 87T480-120Zm-76-546q17-7 36.5-10.5T480-680q20 0 38.5 3t35.5 10q-8-23-28-38t-46-15q-26 0-47 15.5T404-666Zm76 466q73 0 116.5-61T640-400q0-70-40.5-135T480-600q-78 0-119 64.5T320-400q0 78 43.5 139T480-200Zm0-80q-17 0-28.5-11.5T440-320v-160q0-17 11.5-28.5T480-520q17 0 28.5 11.5T520-480v160q0 17-11.5 28.5T480-280Z'/></svg>",
  elev: "<svg viewBox='0 -960 960 960'><path d='M280-400v120q0 17 11.5 28.5T320-240h40q17 0 28.5-11.5T400-280v-120q11-11 25.5-17.5T440-440v-60q0-33-23.5-56.5T360-580h-40q-33 0-56.5 23.5T240-500v60q0 16 14.5 22.5T280-400Zm60-220q21 0 35.5-14.5T390-670q0-21-14.5-35.5T340-720q-21 0-35.5 14.5T290-670q0 21 14.5 35.5T340-620Zm216 100h128q12 0 17.5-10.5T701-551l-64-102q-6-10-17-10t-17 10l-64 102q-6 10-.5 20.5T556-520Zm81 213 64-102q6-10 .5-20.5T684-440H556q-12 0-17.5 10.5t.5 20.5l64 102q6 10 17 10t17-10ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z'/></svg>",
  owner: "<svg viewBox='0 -960 960 960'><path d='M80-240v-32q0-34 17-62.5t47-43.5q57-29 118.5-46T388-441q14 0 22 12.5t3 26.5q-6 21-9 42t-3 43q0 29 6 56t17 53q8 17-1.5 32.5T396-160H160q-33 0-56.5-23.5T80-240Zm600 0q33 0 56.5-23.5T760-320q0-33-23.5-56.5T680-400q-33 0-56.5 23.5T600-320q0 33 23.5 56.5T680-240ZM400-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm234 328-6-28q-12-5-22.5-10.5T584-204l-29 9q-13 4-25.5-1T510-212l-8-14q-7-12-5-26t13-23l22-19q-2-14-2-26t2-26l-22-19q-11-9-13-22.5t5-25.5l9-15q7-11 19-16t25-1l29 9q11-8 21.5-13.5T628-460l6-29q3-14 13.5-22.5T672-520h16q14 0 24.5 9t13.5 23l6 28q12 5 22.5 11t21.5 15l27-9q14-5 27 0t20 17l8 14q7 12 5 26t-13 23l-22 19q2 12 2 25t-2 25l22 19q11 9 13 22.5t-5 25.5l-9 15q-7 11-19 16t-25 1l-29-9q-11 8-21.5 13.5T732-180l-6 29q-3 14-13.5 22.5T688-120h-16q-14 0-24.5-9T634-152Z'/></svg>",
  legal: "<svg viewBox='0 -960 960 960'><path d='M200-200h400q17 0 28.5 11.5T640-160q0 17-11.5 28.5T600-120H200q-17 0-28.5-11.5T160-160q0-17 11.5-28.5T200-200Zm129-171L216-484q-23-23-23.5-56.5T215-597l29-29 228 226-29 29q-23 23-57 23t-57-23Zm311-197L414-796l29-29q23-23 56.5-22.5T556-824l113 113q23 23 23 57t-23 57l-29 29Zm156 380L302-682l56-56 494 494q11 11 11 28t-11 28q-11 11-28 11t-28-11Z'/></svg>",
  noise: "<svg viewBox='0 -960 960 960'><path d='M760-481q0-83-44-151.5T598-735q-15-7-22-21.5t-2-29.5q6-16 21.5-23t31.5 0q97 43 155 131.5T840-481q0 108-58 196.5T627-153q-16 7-31.5 0T574-176q-5-15 2-29.5t22-21.5q74-34 118-102.5T760-481ZM280-360H160q-17 0-28.5-11.5T120-400v-160q0-17 11.5-28.5T160-600h120l132-132q19-19 43.5-8.5T480-703v446q0 27-24.5 37.5T412-228L280-360Zm380-120q0 42-19 79.5T591-339q-10 6-20.5.5T560-356v-250q0-12 10.5-17.5t20.5.5q31 25 50 63t19 80Z'/></svg>",
};
const LOCK_ICON = "<svg viewBox='0 -960 960 960'><path d='M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z'/></svg>";

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

// ---------- partials ----------

// The mark (web/public/favicon.svg) inlined so its ink follows the colour scheme.
function markSvg(): string {
  const windows = ([x0, y0, cols, rowsN, dx]: number[]) => {
    let out = "";
    for (let r = 0; r < rowsN!; r++) for (let c = 0; c < cols!; c++) out += `<rect x="${x0! + c * dx!}" y="${y0! + r * 12}" width="6" height="6"/>`;
    return out;
  };
  const cup = "M44 118H176L164 180a14 14 0 0 1-14 12H70a14 14 0 0 1-14-12Z";
  const handle = "M174 134h12a22 22 0 0 1 0 44h-20";
  return `<svg class="mark" viewBox="0 0 200 200" aria-hidden="true"><g transform="translate(-22 -22)">
    <g class="f-ink"><rect x="64" y="58" width="24" height="60" rx="5"/><rect x="94" y="30" width="30" height="88" rx="5"/><rect x="130" y="72" width="22" height="46" rx="5"/></g>
    <g fill="#ffd84d">${windows([69, 66, 2, 4, 9])}${windows([101, 38, 2, 6, 11])}${windows([135, 80, 2, 3, 9])}</g>
    <path class="f-ink" d="${cup}" transform="translate(6 6)"/>
    <path class="s-ink" d="${handle}" stroke-width="18" stroke-linecap="round"/><path class="s-accent" d="${handle}" stroke-width="7" stroke-linecap="round"/>
    <path class="cup" d="${cup}" stroke-width="6" stroke-linejoin="round"/>
    <rect class="saucer" x="28" y="196" width="164" height="12" rx="6" stroke-width="5"/>
  </g></svg>`;
}

function brandHtml(link = true): string {
  const tag = link ? "a" : "span";
  return `<${tag} class="brand"${link ? ' href="/"' : ""}>${markSvg()}<span class="word">Building<em>Tea</em><i class="nyc">NYC</i></span></${tag}>`;
}

function topbar(onNew: () => void, opts: { newSearch?: boolean } = {}): HTMLElement {
  const div = document.createElement("div");
  div.className = "top";
  div.innerHTML = `${brandHtml()}${opts.newSearch === false ? "" : `<button class="pill-btn" type="button">New search</button>`}`;
  div.querySelector("a")!.onclick = (e) => {
    e.preventDefault();
    onNew();
  };
  const btn = div.querySelector("button");
  if (btn) btn.onclick = onNew;
  return div;
}

/** Footer on every page: the two legal pages and the support address. data-nav links route client-side (main.ts). */
function footerHtml(): string {
  return `<footer class="foot"><a data-nav href="/privacy">Privacy</a><a data-nav href="/terms">Terms</a><a href="mailto:${SUPPORT_EMAIL}">Contact</a></footer>`;
}

/**
 * The address heading. The landing page's sample passes `sampleOf`, the day its report was built:
 * the heading is then an h2 (that page's h1 is its own headline), carries a "Sample" chip, and the
 * line under it says how old the records are.
 */
function hero(t: Teaser | Report, sampleOf?: string): string {
  const a = t.address;
  const street = `${a.houseNumber} ${titleCase(a.street)}`.trim();
  const tag = sampleOf === undefined ? "h1" : "h2";
  return `<header class="hero">
    <${tag} class="addr"><span class="hl">${esc(street || a.label)}</span>${a.unit ? ` <span class="unit-chip">#${esc(a.unit)}</span>` : ""}${
      sampleOf === undefined ? "" : ` <span class="unit-chip sample-chip">Sample</span>`
    }</${tag}>
    <div class="sub">${esc([a.borough, a.zip].filter(Boolean).join(" "))}${a.lotOnly ? " · lot-level data only" : ""}${sampleOf ? `, as of ${esc(sampleOf)}` : ""}</div>
  </header>`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n, suf) => `${n}${suf.toLowerCase()}`);
}

function statusPill(status: Status, label: string): string {
  return `<span class="status ${status}"><i aria-hidden="true">${STATUS_ICON[status]}</i>${esc(label)}</span>`;
}

const MISSING = "–";
/** Whole numbers, decimals and dollar amounts: "12", "1,250", "$5,000". */
const NUMERIC = /^-?\$?\d[\d,]*(?:\.\d+)?$/;
/** Dates as compute.ts writes them: "Sep 12, 2026". */
const DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/**
 * One supporting table on a question card: a small caption, then the table in a wrapper that scrolls
 * sideways when it is wider than the card. A column whose filled cells are all numbers or dollar
 * amounts is right-aligned (.num); a column with long text wraps (.long); dates never wrap (.date).
 */
function cardTableHtml(t: CardTable, id: string): string {
  const columns = Array.isArray(t?.columns) ? t.columns.map(String) : [];
  const rows = (Array.isArray(t?.rows) ? t.rows : []).filter((r): r is string[] => Array.isArray(r));
  if (!columns.length || !rows.length) return "";
  const kind = columns.map((_, i) => {
    const filled = rows.map((r) => String(r[i] ?? "").trim()).filter((v) => v && v !== MISSING);
    if (filled.length && filled.every((v) => NUMERIC.test(v))) return ' class="num"';
    if (filled.length && filled.every((v) => DATE.test(v))) return ' class="date"';
    return filled.some((v) => v.length > 32) ? ' class="long"' : "";
  });
  return `<figure class="ct"><figcaption id="${id}">${esc(t.title)}</figcaption>
      <div class="ct-scroll" role="region" aria-labelledby="${id}" tabindex="0"><table class="tv cells" aria-labelledby="${id}">
        <thead><tr>${columns.map((c, i) => `<th scope="col"${kind[i]}>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${columns.map((_, i) => `<td${kind[i]}>${esc(r[i] ?? MISSING)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div></figure>`;
}

/** Tables and notes; reports stored before tables existed have none and get the old Details toggle. */
function cardBody(c: Card): string {
  if (!Array.isArray(c.tables)) {
    const details = Array.isArray(c.details) ? c.details : [];
    return details.length ? `<details><summary>Details</summary><ul>${details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : "";
  }
  const notes = Array.isArray(c.notes) ? c.notes.filter(Boolean) : [];
  return `${c.tables.map((t, i) => cardTableHtml(t, `ct-${esc(c.key)}-${i}`)).join("")}${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
}

/**
 * The question cards are still computed (the summary is written from them) but no longer shown: the
 * Landlord, Violations, Complaints and Legal sections list their records. A report stored before it
 * had what the Landlord or Legal section needs keeps that card (`keep`).
 */
function cardsHtml(cards: Card[], keep: Card["key"][]): string {
  return cards
    .filter((c) => keep.includes(c.key))
    .map(
      (c) => `<section class="card q">
      <div class="head"><div class="titleRow"><div class="icon" aria-hidden="true">${CARD_ICON[c.key] ?? ""}</div><h3>${esc(c.question)}</h3></div>${statusPill(c.status, c.label)}</div>
      <p class="ans">${esc(c.answer)}</p>
      ${cardBody(c)}
    </section>`,
    )
    .join("");
}

// ---------- paged list: what's on file ----------

const LIST_PAGE = 25;

interface ListFilter<T> {
  key: string;
  label: string;
  match: (x: T) => boolean;
}

/** "All" plus each filter that matches something; no toggle when there would be only one real choice. */
function listToggle<T>(label: string, items: T[], filters: ListFilter<T>[]): string {
  const live = filters.filter((f) => items.some(f.match));
  if (live.length < 2) return "";
  return `<div class="toggle" role="group" aria-label="${esc(label)}"><button type="button" aria-pressed="true" data-filter="all">All</button>${live
    .map((f) => `<button type="button" aria-pressed="false" data-filter="${esc(f.key)}">${esc(f.label)}</button>`)
    .join("")}</div>`;
}

function listCard(id: string, title: string, toggle: string, sub: string): string {
  return `<section class="card paged" id="${id}">
    <div class="chart-head"><h2>${esc(title)}</h2>${toggle}</div>
    ${sub ? `<p class="chart-sub">${esc(sub)}</p>` : ""}
    <div data-list></div>
    <button class="btn more hidden" type="button" data-more></button>
  </section>`;
}

/** Filter and page a list 25 at a time; changing the filter starts again from the top. */
function mountList<T>(card: HTMLElement, items: T[], filters: ListFilter<T>[], row: (x: T) => string, empty: string) {
  const list = card.querySelector<HTMLElement>("[data-list]")!;
  const more = card.querySelector<HTMLButtonElement>("[data-more]")!;
  const buttons = [...card.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  let match: ((x: T) => boolean) | null = null;
  let shown = LIST_PAGE;
  const draw = () => {
    const rows = match ? items.filter(match) : items;
    list.innerHTML = rows.length ? `<ul class="items">${rows.slice(0, shown).map(row).join("")}</ul>` : `<p class="chart-sub">${esc(empty)}</p>`;
    const left = rows.length - shown;
    more.classList.toggle("hidden", left <= 0);
    more.textContent = `Show ${Math.min(LIST_PAGE, Math.max(left, 0))} more`;
  };
  buttons.forEach((b) => {
    b.onclick = () => {
      match = filters.find((f) => f.key === b.dataset.filter)?.match ?? null;
      shown = LIST_PAGE;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
    };
  });
  more.onclick = () => {
    shown += LIST_PAGE;
    draw();
  };
  draw();
}

// ---------- what's on file right now (reports stored before the violation history) ----------

const ITEM_FILTERS: ListFilter<LineItem>[] = [
  { key: "hazardous", label: "Hazardous", match: (i) => i.severity === "c" || i.severity === "b" },
  { key: "fines", label: "Fines & orders", match: (i) => i.severity === "f" },
  { key: "minor", label: "Minor", match: (i) => i.severity === "a" },
  { key: "paperwork", label: "Paperwork", match: (i) => i.severity === "p" },
];

function itemHtml(it: LineItem): string {
  const ids = [it.noticeDate ? `Notice issued ${fmtDay(it.noticeDate)}` : "", it.ref ?? ""].filter(Boolean).join(" · ");
  const body = [it.original ? `<p>${esc(it.original)}</p>` : "", ids ? `<p class="ref">${esc(ids)}</p>` : ""].join("");
  return `<li class="item"><div class="sev ${esc(it.severity)}" aria-hidden="true"></div><div>
      <div class="what">${esc(it.what)}</div>
      <div class="meta">${esc([it.where, fmtDay(it.date), it.state].filter(Boolean).join(" · "))}</div>
      ${body ? `<details><summary>Original wording</summary>${body}</details>` : ""}
    </div></li>`;
}

function itemsCard(r: Report): string {
  const t = r.itemsTruncated;
  const n = (x: number) => x.toLocaleString("en-US");
  const sub = `${t ? `Showing the newest ${n(t.shown)} of ${n(t.total)} open housing violations. ` : ""}Translated from the city's wording. Tap any item to see the original.`;
  return listCard("on-file", "What's on file right now", listToggle("Show items", r.items ?? [], ITEM_FILTERS), sub);
}

// ---------- building facts ----------

/** Reports stored before this card existed lack most of these; show whatever is there. */
function buildingFactsCard(c: Partial<Cover> | undefined): string {
  const facts: [string, string][] = [];
  const add = (k: string, v: string | number | null | undefined) => {
    if (v != null && v !== "") facts.push([k, String(v)]);
  };
  if (c) {
    add("Built", c.yearBuilt);
    add("Last major alteration", c.yearAltered);
    add("Floors", c.floors);
    if (c.elevators) add("Elevators", c.elevators);
    add("Apartments", c.unitsRes);
    const commercial = c.unitsTotal != null && c.unitsRes != null ? c.unitsTotal - c.unitsRes : 0;
    if (commercial > 0) add("Commercial units", commercial);
    add("Buildings on lot", c.buildingsOnLot);
    add("Building class", [c.buildingClass, c.buildingClassName, c.dobClass].filter(Boolean).join(" · "));
    add("Land use", c.landUse);
    add("Zoning", c.zoning);
    add("Historic district", c.historicDistrict);
    add("Landmark", c.landmark);
    if (c.condo) add("Condo", "Yes");
    add("City housing program", c.housingProgram);
  }
  return `<section class="card" id="building-facts"><h2>Building facts</h2>${
    facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small>${esc(v)}</div>`).join("")}</div>` : `<p class="chart-sub">Nothing on file.</p>`
  }</section>`;
}

// ---------- snapshot ----------

/**
 * The Snapshot card: the few numbers to see first, as a plain list with each label on the left, its
 * value on the right and dotted leaders between; a value is coloured when it needs attention. The
 * numbers are shared/snapshot.ts's, the same ones the summary is written from. A report stored
 * before it had every violation as a record gets "".
 */
function snapshotCard(r: Report): string {
  const s = snapshotOf(r);
  if (!s) return "";
  const n = (x: number) => x.toLocaleString("en-US");
  const rows: { label: string; value: string; flag: boolean }[] = [
    { label: "Open violations", value: n(s.openViolations), flag: s.openViolations > 0 },
    { label: "Open complaints", value: n(s.openComplaints), flag: s.openComplaints > 0 },
    { label: "Bed bugs", value: s.bedbugsReported ? "Yes" : "No", flag: s.bedbugsReported },
  ];
  if (s.openLegal !== null) rows.push({ label: "Open legal matters", value: n(s.openLegal), flag: s.openLegal > 0 });
  rows.push({ label: "Heat complaints in 12 months", value: n(s.heatComplaints12mo), flag: s.heatComplaints12mo > 0 });
  rows.push({ label: "Violations unfixed in 12 months", value: s.issued12mo ? `${n(s.unfixed12mo)} of ${n(s.issued12mo)}` : "0", flag: s.unfixed12mo > 0 });
  return `<section class="card" id="snapshot"><h2>Snapshot</h2><dl class="snap">${rows
    .map((x) => `<div${x.flag ? ' class="flag"' : ""}><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`)
    .join("")}</dl></section>`;
}

// ---------- landlord ----------

/**
 * The Landlord card: the owner's name as the headline, who manages the building, and how the city
 * registration stands; then everyone on the registration with their address, the owner in the tax
 * records when that differs, and every registration field. It reads the landlord question card's
 * tables, which hold exactly these, so a report stored before those existed gets "" and keeps the
 * question card.
 */
function landlordCard(r: Report): string {
  const card = r.cards?.find((c) => c.key === "owner");
  if (!card || !Array.isArray(card.tables)) return "";
  const table = (columns: string) => card.tables!.find((t) => t.columns.join("|") === columns)?.rows ?? [];
  const has = (v: string | undefined): v is string => !!v && v !== MISSING;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const own = r.ownership;
  const taxOwner = r.cover?.plutoOwner ?? null;
  const owner = own?.registeredOwner ?? taxOwner;
  const agent = own?.managingAgent ?? null;
  // Names the headline already gives aren't repeated in the list; their rows keep the address.
  const said = new Set([owner, agent].filter((x): x is string => !!x).map(norm));
  const row = (label: string, lines: string[]) => `<div><dt>${esc(label)}</dt><dd>${lines.join("")}</dd></div>`;

  const people: string[] = [];
  for (const [role, name, address] of table("Role|Name|Address")) {
    const names = has(name) ? name.split(" · ").filter((x) => !said.has(norm(x))) : [];
    const lines = [names.length ? `<b>${esc(names.join(", "))}</b>` : "", has(address) ? `<span>${esc(address)}</span>` : ""].filter(Boolean);
    if (lines.length) people.push(row(has(role) ? role : "On the registration", lines));
  }
  if (taxOwner && own?.registeredOwner && norm(taxOwner) !== norm(own.registeredOwner)) people.push(row("Tax records", [`<b>${esc(taxOwner)}</b>`]));

  const now = new Date();
  const when = own?.registrationExpires ? shortDate(own.registrationExpires, now) : "";
  const state = own?.registrationState ?? "none";
  const standing =
    state === "current"
      ? `Registration current${when ? ` through ${when}` : ""}.`
      : state === "grace"
        ? `Registration due.${when ? ` It expired ${when}.` : ""}`
        : state === "lapsed"
          ? `Registration lapsed.${when ? ` It expired ${when}.` : ""}`
          : "No registration on file.";
  const flagged = card.status === "warn" || card.status === "serious" || card.status === "critical";

  const registration = [
    ...table("Field|Value").filter(([k, v]) => has(k) && has(v)).map(([k, v]) => row(k!, [`<b>${esc(v)}</b>`])),
    ...(card.notes ?? []).filter((x) => x && !x.startsWith("Tax records list the owner as")).map((x) => row("What it means", [`<span>${esc(x)}</span>`])),
  ];

  return `<section class="card landlord" id="landlord"><h2>Landlord</h2>
    <p class="ll-owner"><span>${esc(owner ?? "Owner not on file")}</span></p>
    ${agent ? `<p class="ll-by">Managed by <b>${esc(agent)}</b></p>` : ""}
    <p class="ll-reg${flagged ? " flag" : ""}"><i aria-hidden="true"></i>${esc(standing)}</p>
    ${people.length ? `<dl class="ll-list">${people.join("")}</dl>` : ""}
    ${registration.length ? `<dl class="ll-list${people.length ? " ll-more" : ""}">${registration.join("")}</dl>` : ""}
  </section>`;
}

function chartCard(id: string, title: string, sub: string): string {
  return `<section class="card" id="${id}">
    <div class="chart-head"><h2>${esc(title)}</h2>
      <div class="toggle" role="group" aria-label="View"><button type="button" aria-pressed="true" data-view="chart">Chart</button><button type="button" aria-pressed="false" data-view="table">Table</button></div>
    </div>
    <p class="chart-sub">${esc(sub)}</p>
    <div class="chart-wrap" data-chart></div>
    <div class="legend" data-legend></div>
    <div data-table class="hidden"></div>
  </section>`;
}

function lockHtml(): string {
  return `<span class="lock" role="img" aria-label="In the full report">${LOCK_ICON}</span>`;
}


// ---------- views ----------

/** The sample is the same for every visitor and every re-render of the landing page: fetched once. */
let sampleLoad: Promise<Report | null> | null = null;

/**
 * Under the search box, a full report on a real building, exactly as a buyer sees one: the answer to
 * "what do I get". It loads after the page is up (the report and its chart library are the heaviest
 * things the site has), and the landing page is simply shorter when there is none.
 */
function showSample(root: HTMLElement, box: HTMLElement): void {
  const idle = (work: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(work, { timeout: 1500 }) : setTimeout(work, 200));
  idle(() => {
    (sampleLoad ??= sample())
      .then((r) => {
        if (!r || !box.isConnected) return;
        const panels = reportPanels(r, false);
        box.innerHTML = `${hero(r, fmtDay(r.generatedAt))}${panels.html}`;
        box.hidden = false;
        mountReportPanels(root, box, r, panels.older);
      })
      .catch((err) => console.warn("sample report skipped", err));
  });
}

export function renderSearch(root: HTMLElement, opts: { onSubmit: (address: string) => void; busy?: boolean; value?: string; error?: string }) {
  root.innerHTML = "";
  root.appendChild(topbar(() => renderSearch(root, { onSubmit: opts.onSubmit }), { newSearch: false }));
  const div = document.createElement("div");
  div.innerHTML = `<header class="hero home">
      <h1>Know the <span class="hl">building</span> before you sign.</h1>
    </header>
    <form class="card search" id="searchForm">
      <label for="addr" class="kicker">Building address</label>
      <div class="ac"><input id="addr" name="address" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="143 W 4th St #3FW, New York, NY" value="${esc(opts.value ?? "")}" ${opts.busy ? "disabled" : ""} required minlength="5" maxlength="200"></div>
      <button class="btn primary" type="submit" ${opts.busy ? "disabled" : ""}>${opts.busy ? "Checking the city's records…" : "Uncover the tea"}</button>
      ${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ""}
    </form>
    <div id="sample" hidden></div>${footerHtml()}`;
  root.appendChild(div);
  showSample(root, div.querySelector<HTMLElement>("#sample")!);
  const form = div.querySelector<HTMLFormElement>("#searchForm")!;
  const addr = div.querySelector<HTMLInputElement>("#addr")!;
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = addr.value.trim();
    if (v.length >= 5) opts.onSubmit(v);
  };
  if (!opts.busy) {
    attachAutocomplete(addr, opts.onSubmit);
    addr.focus();
  }
}

export function renderCandidates(root: HTMLElement, candidates: Candidate[], onPick: (label: string) => void) {
  root.innerHTML = "";
  root.appendChild(topbar(() => renderSearch(root, { onSubmit: onPick })));
  const div = document.createElement("div");
  div.innerHTML = `<header class="hero"><h1>We found many options. Which one?</h1></header>
    <div class="card"><div class="links">${candidates
      .map((c) => `<a href="#" data-label="${esc(c.label)}"><span>${esc(c.label)}<small class="muted"> · ${esc(c.borough)} ${esc(c.zip)}</small></span><span class="arrow">→</span></a>`)
      .join("")}</div></div>
    <p class="fine center">Not here? <a href="/" id="again">Try a different spelling</a>, and include the borough or zip.</p>`;
  root.appendChild(div);
  div.querySelectorAll<HTMLAnchorElement>("a[data-label]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      onPick(a.dataset.label!);
    };
  });
  div.querySelector<HTMLAnchorElement>("#again")!.onclick = (e) => {
    e.preventDefault();
    renderSearch(root, { onSubmit: onPick });
  };
}

export function renderUnlocking(root: HTMLElement) {
  root.innerHTML = `<div class="top">${brandHtml(false)}</div>
    <div class="card center standalone"><h2>Unlocking your report…</h2><p class="sub">Confirming the payment with Stripe. This takes a second or two.</p><div class="spinner" aria-hidden="true"></div></div>`;
}

export type ErrorScreen = {
  title: string;
  message?: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void } | { label: string; href: string };
  onNew: () => void;
};

export function renderError(root: HTMLElement, s: ErrorScreen) {
  root.innerHTML = "";
  root.appendChild(topbar(s.onNew));
  const div = document.createElement("div");
  const secondary = !s.secondary
    ? ""
    : "href" in s.secondary
      ? `<a class="text-btn" href="${esc(s.secondary.href)}">${esc(s.secondary.label)}</a>`
      : `<button class="text-btn" type="button" data-secondary>${esc(s.secondary.label)}</button>`;
  div.innerHTML = `<div class="card center standalone"><h2>${esc(s.title)}</h2>${s.message ? `<p class="sub">${esc(s.message)}</p>` : ""}
    <div class="actions"><button class="btn primary wide" type="button" data-primary>${esc(s.primary.label)}</button>${secondary}</div></div>`;
  div.querySelector<HTMLButtonElement>("[data-primary]")!.onclick = s.primary.onClick;
  const sec = div.querySelector<HTMLButtonElement>("[data-secondary]");
  if (sec && s.secondary && "onClick" in s.secondary) sec.onclick = s.secondary.onClick;
  root.appendChild(div);
}

/**
 * The free preview: the report's own layout with almost everything locked. What it shows for real is
 * the summary's first sentence, how many violations are open, the building facts, the newest
 * complaint, violation and legal record as one sample row each, and who owns and manages the
 * building (`t.preview`). Everything else is a stand-in drawn here, never the report's data, so
 * there is nothing to un-blur.
 */
export function renderTeaser(root: HTMLElement, t: Teaser, opts: { onNew: () => void }) {
  root.innerHTML = "";
  root.appendChild(topbar(opts.onNew));
  const div = document.createElement("div");
  const p = t.preview ?? null;
  const unlockBtn = `<button class="btn primary wide" type="button" data-unlock>Unlock the full report<small>one-time payment · link emailed to you</small></button>`;
  const ghostChart = `<div class="ghost-chart" aria-hidden="true"></div>`;
  const ghostLines = `<div class="ghost-lines" aria-hidden="true"></div>`;
  const lockedValue = `<span class="lk" role="img" aria-label="In the full report">${LOCK_ICON}</span>`;

  // The snapshot's lines, as on the report; only the first has its value.
  const snapshot = [
    p ? `<div${p.openViolations > 0 ? ' class="flag"' : ""}><dt>Open violations</dt><dd>${p.openViolations.toLocaleString("en-US")}</dd></div>` : `<div><dt>Open violations</dt><dd>${lockedValue}</dd></div>`,
    ...["Open complaints", "Bed bugs", "Open legal matters", "Heat complaints in 12 months", "Violations unfixed in 12 months"].map((label) => `<div><dt>${label}</dt><dd>${lockedValue}</dd></div>`),
  ].join("");

  // A history section: its chart locked, its newest record as a real row, the rest locked.
  const sample = <T>(rec: T | null | undefined, row: (x: T) => string): string => {
    try {
      return rec ? row(rec) : "";
    } catch (err) {
      console.warn("preview row skipped", err);
      return "";
    }
  };
  const section = (title: string, colour: "by-colour" | "by-shape", row: string) =>
    `<section class="card hist ${colour} locked"><div class="chart-head"><h2>${title}</h2>${lockHtml()}</div>${ghostChart}${
      row ? `<div class="hist-rows"><div class="recs">${row}</div></div>` : ""
    }${ghostLines}</section>`;

  // The unlock button sits between every pair of panels, and once more at the end.
  const unlock = `<div class="unlock-inline">${unlockBtn}</div>`;
  const panels = [
    `<section class="card gist"><h2>Summary</h2>
      <p class="fade">${esc(t.summaryLead)} <span class="blur">The rest of this summary, and every count below, is in the full report.</span></p>
    </section>`,
    `<section class="card" id="snapshot"><h2>Snapshot</h2><dl class="snap">${snapshot}</dl></section>`,
    buildingFactsCard(t.cover),
    section("Complaints", "by-shape", sample(p?.complaint, previewComplaintRow)),
    section("Violations", "by-colour", sample(p?.violation, previewViolationRow)),
    section("Legal", "by-shape", sample(p?.legal, previewLegalRow)),
    `<section class="card landlord locked"><div class="chart-head"><h2>Landlord</h2>${lockHtml()}</div>
      ${p?.owner ? `<p class="ll-owner"><span>${esc(p.owner)}</span></p>` : ""}
      ${p?.managedBy ? `<p class="ll-by">Managed by <b>${esc(p.managedBy)}</b></p>` : ""}
      ${ghostLines}
    </section>`,
  ];
  div.innerHTML = `${hero(t)}${panels.map((x) => `${x}${unlock}`).join("")}${footerHtml()}`;
  root.appendChild(div);
  mountPreviewRows(div);
  div.querySelectorAll<HTMLButtonElement>("[data-unlock]").forEach((b) => {
    b.onclick = () => startCheckout(b, t.id);
  });
}

/**
 * A report's panels, top to bottom, under its address; `older` says the pre-history panels are
 * among them. `links` adds the "Check it yourself" links, which the landing page's sample leaves out.
 */
function reportPanels(r: Report, links = true): { html: string; older: boolean } {
  // The Violations and Complaints history sections replaced the two charts and the "on file" list.
  // A report stored before it had that history still gets the three older panels, or it would show
  // no violations at all.
  const history = historyHtml(r);
  const older = history
    ? ""
    : `${chartCard("chart1", "Violations by year", "Conditions the city recorded at this building over 20 years. Darker = more serious. Paperwork notices excluded.")}
    ${chartCard("chart2", "Complaints by month", "Tenant complaints to the city, last 24 months. Winter months shaded.")}
    ${itemsCard(r)}`;
  const landlord = landlordCard(r);
  const cards = cardsHtml(r.cards, [...(landlord ? [] : ["owner" as const]), ...(showsLegal(r) ? [] : ["legal" as const])]);
  const html = `<section class="card gist"><h2>Summary</h2>
      <p>${esc(r.summary)}</p>
    </section>
    ${snapshotCard(r)}
    ${buildingFactsCard(r.cover)}
    ${history}
    ${older}
    ${landlord}
    ${cards ? `<div class="grid">${cards}</div>` : ""}
    ${
      links
        ? `<section class="card"><h2>Check it yourself</h2>
      <div class="links">${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}<span class="arrow">↗</span></a>`).join("")}</div></section>`
        : ""
    }`;
  return { html, older: !!older };
}

/** Wire the panels `reportPanels` drew into `view`: the charts, the paged list on older reports, the rows. */
function mountReportPanels(root: HTMLElement, view: HTMLElement, r: Report, older: boolean): void {
  if (older) {
    violationsChart(view.querySelector("#chart1")!, r.charts);
    complaintsChart(view.querySelector("#chart2")!, r.charts);
    mountList(view.querySelector("#on-file")!, r.items ?? [], ITEM_FILTERS, itemHtml, "Nothing open on file.");
  }
  mountHistory(root, view, r);
}

export function renderReport(root: HTMLElement, r: Report, opts: { onNew: () => void }) {
  root.innerHTML = "";
  root.appendChild(topbar(opts.onNew));
  const div = document.createElement("div");
  const panels = reportPanels(r);
  div.innerHTML = `${hero(r)}${panels.html}
    <button class="btn wide save" type="button" id="pdf">Save as PDF</button>
    ${footerHtml()}`;
  root.appendChild(div);
  mountReportPanels(root, div, r, panels.older);
  div.querySelector<HTMLButtonElement>("#pdf")!.onclick = () => window.print();
  window.scrollTo({ top: 0 });
}

export function renderLegal(root: HTMLElement, page: "privacy" | "terms", opts: { onNew: () => void }) {
  const doc = LEGAL[page];
  root.innerHTML = "";
  root.appendChild(topbar(opts.onNew, { newSearch: false }));
  const div = document.createElement("div");
  div.innerHTML = `<header class="hero"><h1>${doc.title}</h1><p class="chart-sub">Effective ${LEGAL_EFFECTIVE}</p></header>
    <section class="card legal">${doc.html}</section>${footerHtml()}`;
  root.appendChild(div);
  window.scrollTo({ top: 0 });
}

async function startCheckout(btn: HTMLButtonElement, reportId: string) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Opening secure checkout…";
  try {
    const { url } = await checkout(reportId);
    location.assign(url);
  } catch {
    btn.disabled = false;
    btn.innerHTML = original;
    alert("Checkout didn't open. Please try again.");
  }
}
