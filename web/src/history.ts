// The three history sections of the full report, in page order: "Complaints" (every complaint),
// "Violations" (every violation and summons, open and closed) and "Legal" (every housing court case,
// vacate order and eviction). All are built the same way: a title with two icon buttons that choose the view, a legend
// that is also the filter, a stacked bar chart of the last twelve months, and the records as a list
// or grouped by place. Every record is a row that opens in place to show every field the city
// publishes. The chart library loads with a dynamic import() the first time one of these sections
// mounts, so the search page and the teaser never download it.
//
// They differ in what colour means. Violations are coloured by status, open against closed.
// Complaints are coloured by topic (heat, plumbing, pest, noise, other) and Legal by kind, so there
// status is shape instead: a closed record is filled, an open one is an outline.
//
// Reports stored before these existed have no `violations` (and no complaint `topics`); for those
// historyHtml returns "" and nothing here runs. Ones stored before `legal` existed get the first two
// sections and keep the legal question card (see showsLegal). Records stored before `area` and
// `unit` existed land in a "Place not recorded" group.
//
// The decisions (the legend filter, places, dots, dates) live in historyModel.ts and the charts' in
// chartOptions.ts, both pure and unit tested; this file only renders and wires them.

import type { Complaint, ComplaintSource, LegalHistory, LegalRecord, RecordArea, Report, ViolationHistory, ViolationRecord } from "@shared/types";
import {
  axisWidth,
  complaintsChart,
  legalChart,
  LEGAL_SERIES,
  STATUS_SERIES,
  tickFraction,
  topicKeyIn,
  topicsOf,
  TOPIC_SERIES,
  violationsChart,
  type ChartTheme,
  type ChartView,
  type SeriesKey,
  type TopicKey,
  type ViewOpts,
} from "./chartOptions";
import type { ChartHandle } from "./echart";
import * as M from "./historyModel";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (x: number) => x.toLocaleString("en-US");
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** The widest a chart prints: a card on Letter or A4 paper at the browser's default margins. */
const PRINT_WIDTH = 640;

// Material Symbols Rounded (Apache 2.0), from google/material-design-icons, like render.ts's card
// icons: chevron_right (a row), expand_more (a place), format_list_bulleted and apartment (the views).
const svg = (cls: string, d: string) => `<svg class="${cls}" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const ICON = {
  chevron: svg(
    "chev",
    "M504-480 348-636q-11-11-11-28t11-28q11-11 28-11t28 11l184 184q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L404-268q-11 11-28 11t-28-11q-11-11-11-28t11-28l156-156Z",
  ),
  expand: svg(
    "chev",
    "M480-362q-8 0-15-2.5t-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5Z",
  ),
  list: svg(
    "ic",
    "M400-200q-17 0-28.5-11.5T360-240q0-17 11.5-28.5T400-280h400q17 0 28.5 11.5T840-240q0 17-11.5 28.5T800-200H400Zm0-240q-17 0-28.5-11.5T360-480q0-17 11.5-28.5T400-520h400q17 0 28.5 11.5T840-480q0 17-11.5 28.5T800-440H400Zm0-240q-17 0-28.5-11.5T360-720q0-17 11.5-28.5T400-760h400q17 0 28.5 11.5T840-720q0 17-11.5 28.5T800-680H400ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm0-240q-33 0-56.5-23.5T120-720q0-33 23.5-56.5T200-800q33 0 56.5 23.5T280-720q0 33-23.5 56.5T200-640Z",
  ),
  place: svg(
    "ic",
    "M200-120q-33 0-56.5-23.5T120-200v-400q0-33 23.5-56.5T200-680h80v-80q0-33 23.5-56.5T360-840h240q33 0 56.5 23.5T680-760v240h80q33 0 56.5 23.5T840-440v240q0 33-23.5 56.5T760-120H520v-160h-80v160H200Zm0-80h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 320h80v-80h-80v80Zm0-160h80v-80h-80v80Zm0-160h80v-80h-80v80Zm160 480h80v-80h-80v80Zm0-160h80v-80h-80v80Z",
  ),
};
const VIEW_ICON: Record<M.ViewMode, string> = { list: ICON.list, place: ICON.place };

/** CSS custom property behind each series: the chart reads its computed value; swatches, dots and side bars use it directly (styles.css .k-*). */
const SERIES_VAR: Record<SeriesKey, string> = {
  open: "--accent",
  closed: "--muted",
  heat: "--series-2",
  plumbing: "--series-1",
  pest: "--series-3",
  noise: "--series-7",
  other: "--muted",
  case: "--series-1",
  vacate: "--series-2",
  eviction: "--series-7",
};

/** The light scheme from styles.css. Fallbacks when a property can't be read, and the colours charts print in. */
const LIGHT: Record<string, string> = {
  "--surface-1": "#fcfcfb",
  "--text-primary": "#0b0b0b",
  "--text-secondary": "#52514e",
  "--muted": "#898781",
  "--grid": "#e1e0d9",
  "--axis": "#c3c2b7",
  "--border": "rgba(11, 11, 11, 0.1)",
  "--accent": "#ff5a3c",
  "--series-1": "#2a78d6",
  "--series-2": "#eb6834",
  "--series-3": "#1baf7a",
  "--series-7": "#4a3aa7",
};
const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The page's colours, as literal strings echarts can paint. Paper always gets the light scheme. */
function readTheme(print = false): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => (print ? "" : cs.getPropertyValue(name).trim()) || LIGHT[name]!;
  const series = Object.fromEntries(Object.entries(SERIES_VAR).map(([k, name]) => [k, v(name)])) as ChartTheme["series"];
  return {
    font: getComputedStyle(document.body).fontFamily || FALLBACK_FONT,
    surface: v("--surface-1"),
    text: v("--text-primary"),
    textSecondary: v("--text-secondary"),
    muted: v("--muted"),
    grid: v("--grid"),
    axis: v("--axis"),
    border: v("--border"),
    series,
  };
}

// ---------- a section's pieces ----------

/** The chart's legend, which is also the filter: press an entry to pick it out, more to add them. */
const legendHtml = (label: string, series: { key: SeriesKey; name: string }[]) =>
  `<div class="hist-legend" role="group" aria-label="${esc(label)}">${series
    .map((x) => `<button type="button" class="lg" aria-pressed="true" data-key="${x.key}"><i class="sw" style="--c:var(${SERIES_VAR[x.key]})" aria-hidden="true"></i>${esc(x.name)}</button>`)
    .join("")}</div>`;

/** List or By place, as two small icon buttons for the corner of the title row. */
const switcherHtml = (label: string) =>
  `<div class="viewsw" role="group" aria-label="${esc(label)}">${M.VIEW_MODES.map(
    (v) => `<button type="button" aria-pressed="false" data-view="${v.key}" aria-label="${esc(v.name)}" title="${esc(v.name)}">${VIEW_ICON[v.key]}</button>`,
  ).join("")}</div>`;

/** The plot and, beside it, the value axis the page draws in HTML. */
const chartHtml = (what: string) =>
  `<div class="hchart" data-hchart><div class="hchart-axis" data-axis aria-hidden="true"></div><div class="hchart-plot" data-plot><div class="echart" data-chart role="img" aria-label="${esc(what)} per month."></div></div></div>`;

/** One section: the title and view icons, the legend, the chart, the rows, then any notes. */
function sectionHtml(o: {
  /** What a record's colour says: its status (so open and closed differ by colour), or something else (so they differ by shape). */
  colour: "status" | "kind";
  id: string;
  title: string;
  noun: string;
  /** The legend's name for screen readers: "Show violations that are" Open, Closed. */
  filterLabel: string;
  series: { key: SeriesKey; name: string }[];
  chartOf: string;
  count: number;
  empty: string;
  notes: string;
}): string {
  const open = `<section class="card hist ${o.colour === "status" ? "by-colour" : "by-shape"}" id="${o.id}">`;
  if (!o.count) return `${open}<h2>${esc(o.title)}</h2><p class="chart-sub">${esc(o.empty)}</p>${o.notes}</section>`;
  return `${open}
    <div class="hist-head"><h2>${esc(o.title)}</h2>${switcherHtml(`Show ${o.noun} as`)}</div>
    ${legendHtml(o.filterLabel, o.series)}
    ${chartHtml(o.chartOf)}
    <div class="hist-rows" data-rows></div><p class="sr-only" role="status" data-live></p>
    ${o.notes}
  </section>`;
}

/** Label and value pairs as a definition list, minus the empty ones. Values are text unless `html`. */
function factsDl(pairs: ([string, string] | [string, string, "orig" | "html"] | false)[]): string {
  const rows = pairs.filter((p): p is [string, string] | [string, string, "orig" | "html"] => !!p && !!p[1] && !!String(p[1]).trim());
  if (!rows.length) return "";
  return `<dl>${rows.map(([k, v, how]) => `<div${how === "orig" ? ' class="orig"' : ""}><dt>${esc(k)}</dt><dd>${how === "html" ? v : esc(v)}</dd></div>`).join("")}</dl>`;
}

/** The city's extra fields, with a leading ISO date written out. */
const factPairs = (facts: unknown): [string, string][] =>
  (Array.isArray(facts) ? facts : [])
    .filter((f): f is [string, string] => Array.isArray(f) && f.length === 2)
    .map(([k, v]) => [String(k), String(v).replace(/^(\d{4}-\d{2}-\d{2})/, (d) => M.fullDate(d))]);

/**
 * One record: a side bar, a one-line headline over pills (when, then where), and every field behind
 * a tap. The side bar carries the status, and in Complaints and Legal the topic or kind too (`key`
 * colours it), so the status is in words only for screen readers (`state`, or Open and Closed). An
 * opened row keeps its headline exactly where it was and drops the pills (the fields below repeat
 * them); a headline too long for its line is given in full first (`data-full`, which
 * wireFullHeadlines shows when it was cut).
 */
function recHtml(o: { open: boolean; state?: string; key?: string; what: string; pills: string[]; body: string }): string {
  const pills = o.pills.filter(Boolean).map((p) => `<span class="pill">${esc(p)}</span>`);
  const state = o.state ?? (o.open ? "Open" : "Closed");
  return `<details class="rec ${o.open ? "is-open" : "is-closed"}${o.key ? ` k-${esc(o.key)}` : ""}"><summary><span class="rec-text">${state ? `<span class="sr-only">${esc(state)}: </span>` : ""}<span class="rec-what">${o.what}</span>${
    pills.length ? `<span class="rec-pills">${pills.join("")}</span>` : ""
  }</span>${ICON.chevron}</summary><div class="rec-body"><p class="rec-full" data-full hidden aria-hidden="true">${o.what}</p>${o.body}</div></details>`;
}

/** The pill that only repeats the heading a row sits under in the By place view. */
const HEADING_PILL: Record<RecordArea, RegExp> = {
  apartment: /^(Apt |Apartment$)/,
  common: /^(Common|Public) area$/,
  building: /^(Whole building|Building)$/,
  around: /^Reported at or near this address$/,
};

/**
 * A record's place as pills: "Apt D5 · kitchen" is the unit, then the part of it. "Whole apartment"
 * beside an apartment only repeats it, so it is left to the opened row's Where field.
 */
function placePills(where: string | undefined, split: RegExp, area: RecordArea | undefined, grouped: boolean): string[] {
  const heading = grouped && area ? HEADING_PILL[area] : undefined;
  const parts = String(where ?? "")
    .split(split)
    .map((p) => upperFirst(p.trim()))
    .filter(Boolean);
  const specific = parts.length > 1 ? parts.filter((p) => !/^Whole apartment$/i.test(p)) : parts;
  return specific.filter((p) => !heading?.test(p));
}

// ---------- Violations ----------

const KIND_NAME = Object.fromEntries(M.VIOLATION_KINDS.map((s) => [s.key, s.name])) as Record<ViolationRecord["kind"], string>;
const SOURCE_NAME: Record<ViolationRecord["source"], string> = { housing: "housing violations", buildings: "buildings-department violations", summons: "city summonses" };
const SOURCE_LABEL: Record<ViolationRecord["source"], string> = {
  housing: "Housing department (HPD) violation",
  buildings: "Buildings department (DOB) violation",
  summons: "City summons (DOB, heard at OATH)",
};

function violationRow(v: ViolationRecord, now: Date, view: M.ViewMode): string {
  const open = v.status === "open";
  const body = factsDl([
    ["Status", open ? "Open" : "Closed"],
    ["City's status", v.cityStatus],
    ["Hearing outcome", v.source === "summons" && v.hearing ? v.hearing : ""],
    [v.source === "housing" ? "Inspected" : "Issued", M.fullDate(v.date) || "No date on file"],
    ["Closed", M.fullDate(v.closedAt)],
    ["Notice issued", M.fullDate(v.noticeDate)],
    ["Type", KIND_NAME[M.kindOf(v)]],
    ["From", SOURCE_LABEL[v.source] ?? String(v.source)],
    ["Where", v.where],
    ["Reference", v.ref],
    ...factPairs(v.facts),
    ["The city's wording", v.original, "orig"],
  ]);
  return recHtml({ open, what: esc(v.name || v.what), pills: [M.shortDate(v.date, now) || "No date", ...placePills(v.where, / · /, v.area, view === "place")], body });
}

/** One line naming every source that hit its row limit, and one for any that failed to load. */
function violationNotes(h: ViolationHistory): string {
  const t = h.truncated ?? { housing: false, buildings: false, summons: false };
  const listed = (s: ViolationRecord["source"]) => h.items.filter((v) => v.source === s).length;
  const cut: string[] = [];
  if (t.housing) cut.push(`housing violations show ${n(listed("housing"))} of ${n(h.totals?.housing ?? listed("housing"))} on record, open ones first, then the newest`);
  if (t.buildings) cut.push("only the newest buildings-department violations are listed");
  if (t.summons) cut.push(`city summonses show the newest ${n(listed("summons"))}, active ones first`);
  const lines: string[] = [];
  if (cut.length) lines.push(`Not everything fits: ${cut.join("; ")}.`);
  const missing = (Array.isArray(h.unavailable) ? h.unavailable : []).map((s) => SOURCE_NAME[s]).filter(Boolean);
  if (missing.length) lines.push(`The city's ${missing.join(" and ")} didn't load, so they're missing here.`);
  return lines.map((l) => `<p class="chart-sub hist-note">${esc(l)}</p>`).join("");
}

const violationsHtml = (h: ViolationHistory) =>
  sectionHtml({
    colour: "status",
    id: "violation-history",
    title: "Violations",
    noun: "violations",
    filterLabel: "Show violations that are",
    series: STATUS_SERIES,
    chartOf: "Violations and summonses",
    count: h.items.length,
    empty: "No violations or summonses on file.",
    notes: violationNotes(h),
  });

// ---------- Complaints ----------

const COMPLAINT_SOURCE: Record<ComplaintSource, string> = { hpd: "Housing department (HPD)", dob: "Buildings department (DOB)", "311": "311" };
const COMPLAINT_REF: Record<ComplaintSource, string> = { hpd: "HPD complaint", dob: "DOB complaint", "311": "311 request" };
const TOPIC_NAME = Object.fromEntries(TOPIC_SERIES.map((s) => [s.key, s.name])) as Record<TopicKey, string>;

/** `key` is the topic the complaint is counted under just now: its colour in the chart and beside its row. */
function complaintRow(c: Complaint, now: Date, view: M.ViewMode, key: TopicKey): string {
  const open = c.status === "open";
  const body = factsDl([
    ["Status", open ? "Open" : "Closed"],
    ["Received", M.fullDate(c.date) || "No date on file"],
    ["Closed", M.fullDate(c.closedAt)],
    ["What the city said", c.outcome],
    ["From", COMPLAINT_SOURCE[c.source] ?? String(c.source)],
    ["Topics", topicsOf(c).map((t) => TOPIC_NAME[t] ?? t).join(", ")],
    ["Where", c.where],
    ["Reference", c.id ? `${COMPLAINT_REF[c.source] ?? "Complaint"} ${c.id}` : ""],
    ["The city's wording", c.original && c.original !== c.outcome ? c.original : "", "orig"],
  ]);
  return recHtml({
    open,
    key,
    what: `${c.emergency ? `<b class="emerg">Emergency:</b> ` : ""}${esc(c.name || c.what)}`,
    // A housing complaint about several places lists them with commas: "Apt D5, public area".
    pills: [M.shortDate(c.date, now) || "No date", ...placePills(c.where, c.source === "hpd" ? /, | · / : / · /, c.area, view === "place")],
    body,
  });
}

const complaintsHtml = (items: Complaint[], truncated: boolean) =>
  sectionHtml({
    colour: "kind",
    id: "complaint-history",
    title: "Complaints",
    noun: "complaints",
    filterLabel: "Show complaints about",
    series: TOPIC_SERIES,
    chartOf: "Complaints",
    count: items.length,
    empty: "No complaints on file.",
    notes: truncated ? `<p class="chart-sub hist-note">Not everything fits: only the newest complaints from the busiest sources are listed.</p>` : "",
  });

// ---------- Legal ----------

const LEGAL_NAME: Record<LegalRecord["kind"], string> = { case: "housing court cases", vacate: "vacate orders", eviction: "evictions" };

function legalRow(r: LegalRecord, now: Date, view: M.ViewMode): string {
  const facts = factPairs(r.facts);
  return recHtml({
    open: r.status === "open",
    // "Pending", "Still in effect", "Lifted"; an eviction has no status to say.
    state: facts.find(([k]) => k === "Status")?.[1] ?? "",
    key: r.kind,
    what: esc(r.name || r.what),
    pills: [M.shortDate(r.date, now) || "No date", ...placePills(r.where, / · /, r.area, view === "place")],
    body: factsDl(facts),
  });
}

/** One line when the court cases hit their row limit, and one for any kind that failed to load. */
function legalNotes(h: LegalHistory): string {
  const lines: string[] = [];
  const cut = [h.truncated?.cases ? "court cases" : "", h.truncated?.evictions ? "evictions" : ""].filter(Boolean);
  if (cut.length) lines.push(`Not everything fits: only the newest ${cut.join(" and ")} are listed.`);
  const missing = (Array.isArray(h.unavailable) ? h.unavailable : []).map((k) => LEGAL_NAME[k]).filter(Boolean);
  if (missing.length) lines.push(`The city's ${missing.join(" and ")} didn't load, so they're missing here.`);
  return lines.map((l) => `<p class="chart-sub hist-note">${esc(l)}</p>`).join("");
}

const legalHtml = (h: LegalHistory) =>
  sectionHtml({
    colour: "kind",
    id: "legal-history",
    title: "Legal",
    noun: "legal records",
    filterLabel: "Show",
    series: LEGAL_SERIES,
    chartOf: "Housing court cases, vacate orders and evictions",
    count: h.items.length,
    empty: "No court cases, vacate orders or evictions on file.",
    notes: legalNotes(h),
  });

// ---------- the free preview ----------

/** One record as its section's list shows it: the free preview's sample row for that section. */
export const previewViolationRow = (v: ViolationRecord): string => violationRow(v, new Date(), "list");
export const previewComplaintRow = (c: Complaint): string => complaintRow(c, new Date(), "list", topicKeyIn(c, TOPIC_SERIES.map((s) => s.key)) ?? "other");
export const previewLegalRow = (r: LegalRecord): string => legalRow(r, new Date(), "list");

/** Wire the preview's sample rows the way a report's are: a headline cut to one line is given in full when its row opens. */
export function mountPreviewRows(view: HTMLElement): void {
  view.querySelectorAll<HTMLElement>(".hist").forEach(wireFullHeadlines);
}

// ---------- the page hooks ----------

/** True when the report gets the Legal section, which replaces its legal question card. */
export const showsLegal = (r: Report): boolean => Array.isArray(r.violations?.items) && Array.isArray(r.legal?.items);

/** The sections, or "" for a report stored before they existed. Never throws. */
export function historyHtml(r: Report): string {
  try {
    const h = r.violations;
    if (!h || !Array.isArray(h.items)) return "";
    const complaints = r.complaints && Array.isArray(r.complaints.items) ? r.complaints : null;
    const t = complaints?.truncated;
    return `${complaints ? complaintsHtml(complaints.items, !!(t && (t.hpd || t.dob || t.n311))) : ""}${violationsHtml(h)}${showsLegal(r) ? legalHtml(r.legal!) : ""}`;
  } catch (err) {
    console.warn("history sections skipped", err);
    return "";
  }
}

interface Mounted {
  redraw(): void;
  setPrint(on: boolean): void;
  dispose(): void;
}

// ---------- the legend ----------

interface Legend<K extends string> {
  /** The entries showing, in legend order. All of them until one is pressed. */
  shown(): K[];
  reset(): void;
}

/** Wire a section's legend as its filter; `onChange` runs after every press. */
function mountLegend<K extends string>(section: HTMLElement, keys: K[], onChange: () => void): Legend<K> {
  const buttons = [...section.querySelectorAll<HTMLButtonElement>(".hist-legend [data-key]")];
  let shown = [...keys];
  const set = (next: K[]) => {
    shown = next;
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(shown.includes(b.dataset.key as K))));
    onChange();
  };
  buttons.forEach((b) => {
    b.onclick = () => set(M.toggleShown(shown, b.dataset.key as K, keys));
  });
  return { shown: () => shown, reset: () => set([...keys]) };
}

// ---------- the rows: a list, or groups by place ----------

type Rec = { status: "open" | "closed"; date: string | null; unit?: string; area?: RecordArea };

interface RowsOpts<T extends Rec> {
  section: HTMLElement;
  all: T[];
  noun: [string, string];
  yourUnit: string | null;
  view: M.ViewMode;
  match: (x: T) => boolean;
  row: (x: T, view: M.ViewMode) => string;
  /** A record's colour, for its place's dots. */
  keyOf: (x: T) => string;
  order: readonly string[];
  onClear: () => void;
}

interface RowsCtl {
  render(announce?: boolean): void;
  setView(v: M.ViewMode): void;
}

/**
 * A row about to open: if its one-line headline was cut, the full text leads the fields below it.
 * Measured on the click, before the row opens, so nothing shifts once it has.
 */
function wireFullHeadlines(box: HTMLElement): void {
  box.addEventListener("click", (e) => {
    const rec = (e.target as Element | null)?.closest("summary")?.parentElement;
    if (!(rec instanceof HTMLDetailsElement) || rec.open) return;
    const what = rec.querySelector<HTMLElement>(":scope > summary .rec-what");
    const full = rec.querySelector<HTMLElement>(":scope > .rec-body > [data-full]");
    if (what && full) full.hidden = what.scrollWidth <= what.clientWidth;
  });
}

/** Fill the section's rows box with the filtered records in the current view, and page them on demand. */
function mountRows<T extends Rec>(o: RowsOpts<T>): RowsCtl {
  const box = o.section.querySelector<HTMLElement>("[data-rows]");
  const live = o.section.querySelector<HTMLElement>("[data-live]");
  const switches = [...o.section.querySelectorAll<HTMLButtonElement>(".viewsw [data-view]")];
  let view = o.view;
  let rows: T[] = [];
  let groups: M.PlaceGroup<T>[] = [];
  let listShown = 0;
  let placesShown = 0;

  const rowsHtml = (xs: T[]) => xs.map((x) => o.row(x, view)).join("");
  const moreButton = (attr: string, label: string) => `<button class="btn more" type="button" ${attr}>${esc(label)}</button>`;

  // A place is its name over its dots; the dots are the count, which is said only to screen readers.
  // The searched apartment starts open. An opened place shows every row.
  const groupHtml = (g: M.PlaceGroup<T>) => {
    const strip = M.dotStrip(g.items, o.keyOf, o.order);
    const spoken = g.open ? `${n(g.open)} open${g.items.length > g.open ? ` of ${n(g.items.length)}` : ""}` : `${n(g.items.length)} closed`;
    return `<details class="grp" data-group="${esc(g.key)}"${g.mine ? " open" : ""}><summary>
        <span class="grp-name">${esc(g.label)}<span class="sr-only">, ${spoken}</span></span>
        <span class="dots" aria-hidden="true">${strip.dots.map((d) => `<i class="kd k-${esc(d.key)} ${d.open ? "is-open" : "is-closed"}"></i>`).join("")}${strip.more ? `<span class="dots-more">+${n(strip.more)}</span>` : ""}</span>${ICON.expand}
      </summary><div class="sub-rows"><div class="recs">${rowsHtml(g.items)}</div></div></details>`;
  };

  const focusFirst = (els: Element[]) => {
    const s = els[0]?.querySelector<HTMLElement>("summary") ?? (els[0] as HTMLElement | undefined);
    s?.focus();
  };

  /** Insert `html` at the end of `into` and return the elements it added. */
  const append = (into: Element, html: string): Element[] => {
    const before = into.children.length;
    into.insertAdjacentHTML("beforeend", html);
    return [...into.children].slice(before);
  };

  const render = (announce = false) => {
    if (!box) return;
    rows = o.all.filter(o.match);
    switches.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    if (live && announce) live.textContent = rows.length ? `${n(rows.length)} ${rows.length === 1 ? o.noun[0] : o.noun[1]}` : `No ${o.noun[1]} to show`;
    if (!rows.length) {
      box.innerHTML = `<p class="hist-empty">No ${esc(o.noun[1])} to show. <button type="button" class="text-btn" data-clear>Show everything</button></p>`;
      return;
    }
    if (view === "list") {
      listShown = Math.min(M.PAGE, rows.length);
      const left = rows.length - listShown;
      box.innerHTML = `<div class="recs" data-list>${rowsHtml(rows.slice(0, listShown))}</div>${left > 0 ? moreButton("data-more", `Show ${n(Math.min(M.PAGE, left))} more`) : ""}`;
      return;
    }
    groups = M.groupByPlace(rows, o.yourUnit);
    placesShown = Math.min(M.PLACE_PAGE, groups.length);
    const none = o.yourUnit && !groups.some((g) => g.mine) ? `<p class="chart-sub hist-mine-none">Nothing here for your apartment, Apt ${esc(o.yourUnit)}.</p>` : "";
    const left = groups.length - placesShown;
    box.innerHTML = `${none}<div class="places" data-places>${groups.slice(0, placesShown).map(groupHtml).join("")}</div>${
      left > 0 ? moreButton("data-more-places", `Show ${n(left)} more ${left === 1 ? "place" : "places"}`) : ""
    }`;
  };

  if (box) wireFullHeadlines(box);

  box?.addEventListener("click", (e) => {
    const t = (e.target as Element | null)?.closest<HTMLElement>("[data-more],[data-more-places],[data-clear]");
    if (!t || !box.contains(t)) return;
    if (t.hasAttribute("data-clear")) {
      o.onClear();
      return;
    }
    if (t.hasAttribute("data-more")) {
      const list = box.querySelector("[data-list]");
      if (!list) return;
      const next = rows.slice(listShown, listShown + M.PAGE);
      listShown += next.length;
      const added = append(list, rowsHtml(next));
      const left = rows.length - listShown;
      if (left > 0) t.textContent = `Show ${n(Math.min(M.PAGE, left))} more`;
      else t.remove();
      focusFirst(added);
      return;
    }
    const places = box.querySelector("[data-places]");
    if (!places) return;
    const added = append(places, groups.slice(placesShown).map(groupHtml).join(""));
    placesShown = groups.length;
    t.remove();
    focusFirst(added);
  });

  return {
    render,
    setView: (v) => {
      if (v === view) return;
      view = v;
      render();
    },
  };
}

// ---------- the chart ----------

let loader: Promise<typeof import("./echart")> | null = null;
const loadEcharts = () => (loader ??= import("./echart").catch((err) => {
  loader = null;
  throw err;
}));

/**
 * One chart: loads the library, draws the twelve months across the plot's width with the value axis
 * in HTML beside it, and follows the box as it resizes. On paper it redraws in light colours with
 * its own value labels, at a width that fits the page.
 */
function mountChart(o: { section: HTMLElement; build: (o: Omit<ViewOpts, "now">) => ChartView }): Mounted {
  const s = o.section;
  const host = s.querySelector<HTMLElement>("[data-chart]");
  const plot = s.querySelector<HTMLElement>("[data-plot]");
  const frame = s.querySelector<HTMLElement>("[data-hchart]");
  const axisCol = s.querySelector<HTMLElement>("[data-axis]");
  const paper = matchMedia("print");
  let handle: ChartHandle | null = null;
  let dead = false;
  let print = false;
  /** The plot's width on screen when last drawn, and the chart's own width. */
  let available = 0;
  let drawn = 0;
  let ro: ResizeObserver | null = null;

  const draw = () => {
    if (!handle || !host || !plot) return;
    // The SVG has no viewBox, so print CSS can't scale it: paper gets a fixed width that fits Letter and A4.
    const room = print ? Math.min(frame?.clientWidth || PRINT_WIDTH, PRINT_WIDTH) : plot.clientWidth || available || 320;
    if (!print) available = room;
    const next = o.build({ theme: readTheme(print), available: room, print });
    host.style.width = `${next.layout.width}px`;
    if (next.layout.width !== drawn) handle.resize();
    drawn = next.layout.width;
    handle.setOption(next.option);
    host.setAttribute("aria-label", next.label);
    if (axisCol) {
      const { top, bottom } = next.layout;
      axisCol.style.width = `${axisWidth(next.axis)}px`;
      axisCol.innerHTML = next.axis.ticks.map((t) => `<span style="top:calc(${top}px + (100% - ${top + bottom}px) * ${tickFraction(t, next.axis)})">${n(t)}</span>`).join("");
    }
  };

  if (host && plot)
    loadEcharts()
      .then(({ createChart }) => {
        if (dead || !host.isConnected) return;
        handle = createChart(host, readTheme().font);
        draw();
        ro = new ResizeObserver(() => {
          if (!handle || print || paper.matches || !plot.clientWidth || plot.clientWidth === available) return;
          draw();
        });
        ro.observe(plot);
      })
      .catch((err) => {
        console.warn("chart library failed to load", err);
        axisCol?.classList.add("hidden");
        host.removeAttribute("role");
        host.removeAttribute("aria-label");
        host.className = "chart-sub";
        host.textContent = "The chart didn't load. Every record is in the list below.";
      });

  return {
    redraw: draw,
    setPrint: (on) => {
      if (!handle || print === on) return;
      print = on;
      handle.hideTip();
      draw();
    },
    dispose: () => {
      dead = true;
      ro?.disconnect();
      handle?.dispose();
      handle = null;
    },
  };
}

// ---------- the two sections ----------

interface SectionCtx {
  yourUnit: string | null;
  now: Date;
  view: M.ViewMode;
}

type Section = Mounted & { rows: RowsCtl };

function mountViolations(section: HTMLElement, h: ViolationHistory, ctx: SectionCtx): Section {
  const all = h.items;
  const keys = STATUS_SERIES.map((s) => s.key);
  const legend = mountLegend(section, keys, () => {
    rows.render(true);
    chart.redraw();
  });
  const rows = mountRows<ViolationRecord>({
    section,
    all,
    noun: ["violation", "violations"],
    yourUnit: ctx.yourUnit,
    view: ctx.view,
    match: (v) => legend.shown().includes(v.status),
    row: (v, view) => violationRow(v, ctx.now, view),
    // A place's dots are the chart's two colours: open, then closed.
    keyOf: (v) => v.status,
    order: keys,
    onClear: legend.reset,
  });
  const chart = mountChart({ section, build: (o) => violationsChart(all, legend.shown(), { ...o, now: ctx.now }) });
  rows.render();
  return { ...chart, rows };
}

function mountComplaints(section: HTMLElement, items: Complaint[], ctx: SectionCtx): Section {
  const keys = TOPIC_SERIES.map((s) => s.key);
  const legend = mountLegend(section, keys, () => {
    rows.render(true);
    chart.redraw();
  });
  // The topic a complaint counts under depends on which topics are showing, in the chart and here alike.
  const keyOf = (c: Complaint) => topicKeyIn(c, legend.shown());
  const rows = mountRows<Complaint>({
    section,
    all: items,
    noun: ["complaint", "complaints"],
    yourUnit: ctx.yourUnit,
    view: ctx.view,
    match: (c) => keyOf(c) !== null,
    row: (c, view) => complaintRow(c, ctx.now, view, keyOf(c) ?? "other"),
    keyOf: (c) => keyOf(c) ?? "other",
    order: keys,
    onClear: legend.reset,
  });
  const chart = mountChart({ section, build: (o) => complaintsChart(items, legend.shown(), { ...o, now: ctx.now }) });
  rows.render();
  return { ...chart, rows };
}

function mountLegal(section: HTMLElement, h: LegalHistory, ctx: SectionCtx): Section {
  const keys = LEGAL_SERIES.map((s) => s.key);
  const legend = mountLegend(section, keys, () => {
    rows.render(true);
    chart.redraw();
  });
  const rows = mountRows<LegalRecord>({
    section,
    all: h.items,
    noun: ["legal record", "legal records"],
    yourUnit: ctx.yourUnit,
    view: ctx.view,
    match: (r) => legend.shown().includes(r.kind),
    row: (r, view) => legalRow(r, ctx.now, view),
    keyOf: (r) => r.kind,
    order: keys,
    onClear: legend.reset,
  });
  const chart = mountChart({ section, build: (o) => legalChart(h.items, legend.shown(), { ...o, now: ctx.now }) });
  rows.render();
  return { ...chart, rows };
}

const loadView = (): M.ViewMode => {
  try {
    return M.parseView(localStorage.getItem(M.VIEW_STORAGE_KEY));
  } catch {
    return "list";
  }
};
const saveView = (v: M.ViewMode) => {
  try {
    localStorage.setItem(M.VIEW_STORAGE_KEY, v);
  } catch {
    // Private mode or storage off: the choice lasts until the page closes.
  }
};

/**
 * Wire the sections `historyHtml` rendered into `view`. Charts follow the colour scheme (system or
 * the preview's data-theme), redraw for paper, and are disposed as soon as `root` swaps `view` out
 * for another screen. The List or By place choice is remembered and applies to every section.
 * Never throws: a failure here leaves the rows and the rest of the report.
 */
export function mountHistory(root: HTMLElement, view: HTMLElement, r: Report): void {
  try {
    const ctx: SectionCtx = { yourUnit: M.yourUnitOf(r.address?.unit), now: new Date(), view: loadView() };
    const mounted: (Section & { el: HTMLElement })[] = [];
    const vs = view.querySelector<HTMLElement>("#violation-history");
    if (vs && r.violations && vs.querySelector("[data-rows]")) mounted.push({ ...mountViolations(vs, r.violations, ctx), el: vs });
    const cs = view.querySelector<HTMLElement>("#complaint-history");
    if (cs && r.complaints && cs.querySelector("[data-rows]")) mounted.push({ ...mountComplaints(cs, r.complaints.items, ctx), el: cs });
    const ls = view.querySelector<HTMLElement>("#legal-history");
    if (ls && r.legal && ls.querySelector("[data-rows]")) mounted.push({ ...mountLegal(ls, r.legal, ctx), el: ls });
    if (!mounted.length) return;

    // One choice for every section. Switching re-renders the others too; when one of those is above,
    // the page is scrolled by however much it grew or shrank, so the switch stays under the finger.
    for (const m of mounted) {
      m.el.querySelectorAll<HTMLButtonElement>(".viewsw [data-view]").forEach((b) => {
        b.onclick = () => {
          const v = M.parseView(b.dataset.view);
          saveView(v);
          const before = m.el.getBoundingClientRect().top;
          mounted.forEach((x) => x.rows.setView(v));
          const after = m.el.getBoundingClientRect().top;
          if (Math.abs(after - before) > 0.5) window.scrollBy(0, after - before);
        };
      });
    }

    const redraw = () => mounted.forEach((m) => m.redraw());
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", redraw);
    const themeAttr = new MutationObserver(redraw);
    themeAttr.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const printing = matchMedia("print");
    const onPrintChange = (e: MediaQueryListEvent) => mounted.forEach((m) => m.setPrint(e.matches));
    const before = () => mounted.forEach((m) => m.setPrint(true));
    const after = () => mounted.forEach((m) => m.setPrint(false));
    printing.addEventListener("change", onPrintChange);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    const replaced = new MutationObserver(() => {
      if (view.isConnected) return;
      mounted.forEach((m) => m.dispose());
      dark.removeEventListener("change", redraw);
      printing.removeEventListener("change", onPrintChange);
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      themeAttr.disconnect();
      replaced.disconnect();
    });
    replaced.observe(root, { childList: true });
  } catch (err) {
    console.warn("history sections failed to mount", err);
  }
}
