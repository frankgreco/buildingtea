// Every decision the two history charts make, as plain data. No echarts import and no DOM here:
// this module only builds option OBJECTS and the geometry around them (the plot's width, the value
// axis), so all of it is unit tested in Node (test/chartOptions.test.ts). echart.ts is the one place
// the library loads.
//
// Colours arrive as literal strings in `ChartTheme`: echarts paints SVG attributes and measures text
// on a canvas, so CSS variables would neither resolve nor follow the colour scheme. history.ts reads
// the site's custom properties (computed, so light and dark both work) and rebuilds on a scheme change.
//
// Every chart is the last twelve months, one stacked bar per month, all in view. history.ts draws
// the value axis in HTML beside the plot, so the axis here has fixed ticks (`valueAxis`) that it can
// place at the same heights; on paper echarts draws those labels itself.

import type { Complaint, ComplaintTopic, LegalKind, LegalRecord, ViolationRecord } from "@shared/types";

/** One stacked segment's value: a count, null for nothing (not even the segment edge), or a styled count. */
export type BarDatum = number | null | { value: number; itemStyle: { borderRadius?: number[] } };

/** A chart option, typed only as far as this app reads it back (echarts' own type fights formatter callbacks). */
export interface ChartSeries {
  type: "bar";
  name: string;
  data: BarDatum[];
  [key: string]: unknown;
}
export interface ChartOption {
  series: ChartSeries[];
  [key: string]: unknown;
}

export type StatusKey = "open" | "closed";
export type TopicKey = ComplaintTopic | "other";
export type SeriesKey = StatusKey | TopicKey | LegalKind;

/** The page's colours and font, read off the document at render time. */
export interface ChartTheme {
  font: string;
  surface: string;
  text: string;
  textSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  /** The tooltip's hairline ring. */
  border: string;
  series: Record<SeriesKey, string>;
}

/** The violations chart's two segments, open at the baseline. */
export const STATUS_SERIES: { key: StatusKey; name: string }[] = [
  { key: "open", name: "Open" },
  { key: "closed", name: "Closed" },
];

/** The complaints chart's five, in stacking order. */
export const TOPIC_SERIES: { key: TopicKey; name: string }[] = [
  { key: "heat", name: "Heat" },
  { key: "plumbing", name: "Plumbing" },
  { key: "pest", name: "Pest" },
  { key: "noise", name: "Noise" },
  { key: "other", name: "Other" },
];

/** The legal chart's three, in stacking order. */
export const LEGAL_SERIES: { key: LegalKind; name: string }[] = [
  { key: "case", name: "Court cases" },
  { key: "vacate", name: "Vacate orders" },
  { key: "eviction", name: "Evictions" },
];

// ---------- months ----------

/** "2026-09-12" -> "2026-09"; null for anything that isn't an ISO date. */
export function monthOf(iso: string | null | undefined): string | null {
  return iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null;
}

/** "2026-09" -> "Sep 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The `count` months ending with the current one, oldest first. */
export function lastMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    if (--m < 1) {
      m = 12;
      y--;
    }
  }
  return out;
}

/** Count items per month per series key. Items without a month on the axis, or without a key, are skipped. */
export function bucket<T>(items: T[], months: string[], monthOfItem: (x: T) => string | null, keyOf: (x: T) => string | null, keys: string[]): Record<string, number[]> {
  const at = new Map(months.map((m, i) => [m, i]));
  const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, months.map(() => 0)]));
  for (const x of items) {
    const i = at.get(monthOfItem(x) ?? "");
    const k = keyOf(x);
    if (i === undefined || k === null || !out[k]) continue;
    out[k]![i]!++;
  }
  return out;
}

// ---------- complaint topics ----------

export const topicsOf = (c: Complaint): ComplaintTopic[] => (Array.isArray(c.topics) ? c.topics : []);

/**
 * The topic a complaint counts under while the legend shows `shown`: the first of its topics among
 * them, "other" when it has no topic, or null when nothing it is about is showing. So a complaint
 * about heat and plumbing is a heat complaint, until Heat is switched off and it is a plumbing one.
 */
export function topicKeyIn(c: Complaint, shown: readonly TopicKey[]): TopicKey | null {
  const topics = topicsOf(c);
  if (!topics.length) return shown.includes("other") ? "other" : null;
  return topics.find((t) => shown.includes(t)) ?? null;
}

// ---------- the plot ----------

/** The months each chart holds: the current one and the eleven before it. */
export const YEAR = 12;
/** The least a month's slot can be, in px: narrower than this and the bars stop reading as bars. */
export const SLOT = 18;
/** The plot's inset inside the chart, in px. The bottom holds the month labels; the top, half of the top tick's label. */
export const GRID = { top: 12, bottom: 24, left: 4, right: 8 } as const;

export interface PlotLayout {
  /** The chart's width in px: the space available, or the least its months need when that is more. */
  width: number;
  /** A month's share of the plot, in px. */
  slot: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** `count` month slots across `available` px, each at least SLOT wide. */
export function plotLayout(count: number, available: number): PlotLayout {
  const { left, right, top, bottom } = GRID;
  const n = Math.max(1, count);
  const width = Math.max(Math.max(0, Math.floor(available)), left + right + SLOT * n);
  return { width, slot: (width - left - right) / n, left, right, top, bottom };
}

// ---------- the value axis ----------

export interface ValueAxis {
  max: number;
  interval: number;
  ticks: number[];
}

/** At most four whole-number steps of 1, 2 or 5 x 10^k from zero to at least `top`. */
export function valueAxis(top: number): ValueAxis {
  const m = Math.max(1, Math.ceil(top));
  for (let p = 1; ; p *= 10) {
    for (const s of [1, 2, 5]) {
      const step = s * p;
      const k = Math.ceil(m / step);
      if (k <= 4) return { max: k * step, interval: step, ticks: Array.from({ length: k + 1 }, (_, i) => i * step) };
    }
  }
}

const fmtN = (n: number) => n.toLocaleString("en-US");

/** The HTML axis column's width in px: its longest label at 11px plus a 6px gap to the plot. */
export const axisWidth = (axis: ValueAxis): number => Math.max(16, Math.ceil(Math.max(...axis.ticks.map((t) => fmtN(t).length)) * 6.6 + 6));

/** A tick's distance from the top of the chart, as a fraction of the plot height below `GRID.top`. */
export const tickFraction = (value: number, axis: ValueAxis): number => 1 - value / axis.max;

// ---------- the stacked monthly bar chart ----------

export interface StackSeries {
  key: SeriesKey;
  name: string;
  data: number[];
}

export interface StackInput {
  months: string[];
  series: StackSeries[];
  theme: ChartTheme;
  layout: PlotLayout;
  axis: ValueAxis;
  /** Paper: the value axis is drawn in the chart (there's no HTML column) and the plot fits its labels. */
  print?: boolean;
  /** "violation" / "violations": the tooltip's total line. */
  unit: [string, string];
  /** An extra line under a month's tooltip, or "" for none. */
  note?: (monthIndex: number) => string;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/**
 * Stacked bars, one per month, the series in the order given (first at the baseline). Each month's
 * top segment gets the 4px rounded data-end; a 1px surface-coloured edge on every segment leaves a
 * 2px gap between neighbours. The tooltip lists every series for the month (zeros muted) and the
 * total. No legend: history.ts draws it above the chart, as the section's filter.
 */
export function stackedMonthly(input: StackInput): ChartOption {
  const { months, series, theme, layout, axis, unit } = input;
  const edge = layout.slot * 0.7 >= 6 ? 1 : 0;
  const totals = months.map((_, i) => series.reduce((s, x) => s + (x.data[i] ?? 0), 0));
  // Index of the top non-zero segment per month.
  const topOf = months.map((_, i) => {
    for (let k = series.length - 1; k >= 0; k--) if ((series[k]!.data[i] ?? 0) > 0) return k;
    return -1;
  });
  const axisText = { color: theme.muted, fontFamily: theme.font, fontSize: 11 };
  // Every month is named: "Sep" where a slot fits it, "S" where it doesn't. A January carries its year instead.
  const wide = layout.slot >= 30;
  const monthName = (m: string) => monthLabel(m).slice(0, 3);
  const xLabel = (m: string) => (m.endsWith("-01") ? m.slice(0, 4) : wide ? monthName(m) : monthName(m).charAt(0));

  const tooltipRow = (color: string, value: number, name: string) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-top:3px;${value ? "" : `color:${theme.muted};`}">` +
    `<span style="flex:none;width:12px;height:3px;border-radius:2px;background:${escapeHtml(color)}"></span>` +
    `<span style="font-weight:800;min-width:2ch;text-align:right">${fmtN(value)}</span>` +
    `<span style="color:${value ? theme.textSecondary : theme.muted}">${escapeHtml(name)}</span></div>`;

  return {
    animation: false,
    grid: input.print
      ? { left: 4, right: 8, top: layout.top, bottom: 6, outerBoundsMode: "same", outerBoundsContain: "axisLabel" }
      : // Exact: the HTML value axis assumes the plot is precisely here.
        { left: layout.left, right: layout.right, top: layout.top, bottom: layout.bottom, outerBoundsMode: "none" },
    tooltip: {
      trigger: "axis",
      confine: true,
      className: "echart-tip",
      axisPointer: { type: "shadow", shadowStyle: { color: theme.grid, opacity: 0.6 } },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: [8, 12],
      textStyle: { color: theme.text, fontFamily: theme.font, fontSize: 12 },
      extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,0.14);",
      formatter: (params: { dataIndex: number }[] | { dataIndex: number }) => {
        const i = (Array.isArray(params) ? params[0]?.dataIndex : params.dataIndex) ?? 0;
        const total = totals[i] ?? 0;
        const note = input.note?.(i) ?? "";
        return (
          `<div style="font-weight:700;color:${theme.textSecondary}">${escapeHtml(monthLabel(months[i] ?? ""))}</div>` +
          (series.length > 1 ? [...series].reverse().map((s) => tooltipRow(theme.series[s.key], s.data[i] ?? 0, s.name)).join("") : "") +
          `<div style="margin-top:5px;font-weight:800">${fmtN(total)} ${escapeHtml(total === 1 ? unit[0] : unit[1])}</div>` +
          (note ? `<div style="margin-top:3px;max-width:220px;white-space:normal;color:${theme.textSecondary}">${escapeHtml(note)}</div>` : "")
        );
      },
    },
    xAxis: {
      type: "category",
      data: months,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: theme.axis } },
      axisLabel: { ...axisText, interval: 0, hideOverlap: true, formatter: (m: string) => xLabel(m) },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: axis.max,
      interval: axis.interval,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisLabel: { ...axisText, show: !!input.print, formatter: (v: number) => fmtN(v) },
    },
    series: series.map((s, k) => ({
      type: "bar" as const,
      name: s.name,
      stack: "total",
      barMaxWidth: 24,
      barCategoryGap: "30%",
      itemStyle: { color: theme.series[s.key], borderColor: theme.surface, borderWidth: edge },
      emphasis: { disabled: true },
      data: s.data.map((v, i): BarDatum => (!v ? null : topOf[i] === k ? { value: v, itemStyle: { borderRadius: [4, 4, 0, 0] } } : v)),
    })),
  };
}

// ---------- the three charts ----------

export interface ChartView {
  option: ChartOption;
  /** What the chart shows, for the container's aria-label. */
  label: string;
  /** The chart's months, oldest first. */
  months: string[];
  layout: PlotLayout;
  axis: ValueAxis;
}

export interface ViewOpts {
  theme: ChartTheme;
  now: Date;
  /** The plot's width in px (on paper, the printed width). */
  available: number;
  print?: boolean;
}

const span = (months: string[]) => `${monthLabel(months[0]!)} to ${monthLabel(months[months.length - 1]!)}`;
const TAIL = "The list below has every one, older ones too.";

function build(o: ViewOpts, months: string[], series: StackSeries[], unit: [string, string], note?: (i: number) => string) {
  const top = Math.max(0, ...months.map((_, i) => series.reduce((s, x) => s + (x.data[i] ?? 0), 0)));
  const axis = valueAxis(top);
  const layout = o.print ? { ...plotLayout(months.length, o.available), width: Math.floor(o.available) } : plotLayout(months.length, o.available);
  return { option: stackedMonthly({ months, series, theme: o.theme, layout, axis, print: o.print, unit, note }), layout, axis, months };
}

/**
 * Violations issued in each of the last twelve months, stacked by status: open at the baseline,
 * closed above. `shown` is what the legend has switched on. Older and undated records aren't
 * charted; the list has them.
 */
export function violationsChart(items: ViolationRecord[], shown: readonly StatusKey[], o: ViewOpts): ChartView {
  const months = lastMonths(o.now, YEAR);
  const on = STATUS_SERIES.filter((s) => shown.includes(s.key));
  const keys = on.map((s) => s.key);
  const counts = bucket(items, months, (v) => monthOf(v.date), (v) => (v.status === "open" ? "open" : "closed"), keys);
  const filtered = on.length < STATUS_SERIES.length;
  return {
    ...build(o, months, on.map((s) => ({ ...s, data: counts[s.key]! })), ["violation", "violations"]),
    label: `Stacked bar chart of violations and summonses per month, open and closed, ${span(months)}.${filtered ? ` It counts only the ${on.map((s) => s.name.toLowerCase()).join(" and ")} ones.` : ""} ${TAIL}`,
  };
}

/**
 * Complaints received in each of the last twelve months, stacked by topic: Heat, Plumbing, Pest,
 * Noise, Other, whichever of them the legend has switched on (`shown`). A complaint about several
 * topics counts ONCE, under the first of them showing, so a bar's height is the number of
 * complaints that month; the tooltip says when that happened.
 */
export function complaintsChart(items: Complaint[], shown: readonly TopicKey[], o: ViewOpts): ChartView {
  const months = lastMonths(o.now, YEAR);
  const on = TOPIC_SERIES.filter((s) => shown.includes(s.key));
  const keys = on.map((s) => s.key);
  const counts = bucket(items, months, (c) => monthOf(c.date), (c) => topicKeyIn(c, keys), keys);
  const several = (c: Complaint) => topicsOf(c).filter((t) => keys.includes(t)).length > 1;
  const multi = bucket(items, months, (c) => monthOf(c.date), (c) => (several(c) ? "multi" : null), ["multi"]).multi!;
  const note = (i: number) =>
    multi[i] ? `${fmtN(multi[i]!)} ${multi[i] === 1 ? "complaint was" : "complaints were"} about more than one of these topics, counted once under the first (heat, plumbing, pest, noise).` : "";
  const filtered = on.length < TOPIC_SERIES.length;
  return {
    ...build(o, months, on.map((s) => ({ ...s, data: counts[s.key]! })), ["complaint", "complaints"], note),
    label: `Stacked bar chart of complaints per month by topic, ${span(months)}.${filtered ? ` It counts only ${on.map((s) => s.name.toLowerCase()).join(", ")}.` : ""} ${TAIL}`,
  };
}

/**
 * Housing court cases opened, vacate orders that took effect and evictions carried out in each of
 * the last twelve months, stacked by kind, whichever of them the legend has switched on (`shown`).
 */
export function legalChart(items: LegalRecord[], shown: readonly LegalKind[], o: ViewOpts): ChartView {
  const months = lastMonths(o.now, YEAR);
  const on = LEGAL_SERIES.filter((s) => shown.includes(s.key));
  const keys = on.map((s) => s.key);
  const counts = bucket(items, months, (r) => monthOf(r.date), (r) => (keys.includes(r.kind) ? r.kind : null), keys);
  const filtered = on.length < LEGAL_SERIES.length;
  return {
    ...build(o, months, on.map((s) => ({ ...s, data: counts[s.key]! })), ["record", "records"]),
    label: `Stacked bar chart of housing court cases, vacate orders and evictions per month, ${span(months)}.${filtered ? ` It counts only ${on.map((s) => s.name.toLowerCase()).join(", ")}.` : ""} ${TAIL}`,
  };
}
