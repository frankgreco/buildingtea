import { describe, expect, it } from "vitest";
import type { Complaint, LegalRecord, ViolationRecord } from "../shared/types";
import {
  axisWidth,
  bucket,
  complaintsChart,
  GRID,
  lastMonths,
  legalChart,
  LEGAL_SERIES,
  monthLabel,
  monthOf,
  plotLayout,
  SLOT,
  stackedMonthly,
  STATUS_SERIES,
  tickFraction,
  topicKeyIn,
  TOPIC_SERIES,
  valueAxis,
  violationsChart,
  type ChartOption,
  type ChartTheme,
  type TopicKey,
  type ViewOpts,
} from "../web/src/chartOptions";

const NOW = new Date("2026-10-03T12:00:00Z");
const YEAR_MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const SEP = YEAR_MONTHS.indexOf("2026-09");
const AUG = YEAR_MONTHS.indexOf("2026-08");

const THEME: ChartTheme = {
  font: "system-ui, sans-serif",
  surface: "#fcfcfb",
  text: "#0b0b0b",
  textSecondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  border: "rgba(11, 11, 11, 0.1)",
  series: {
    open: "#ff5a3c",
    closed: "#898781",
    heat: "#eb6834",
    plumbing: "#2a78d6",
    pest: "#1baf7a",
    noise: "#4a3aa7",
    other: "#898781",
    case: "#2a78d6",
    vacate: "#eb6834",
    eviction: "#4a3aa7",
    program: "#1baf7a",
  },
};

const values = (o: ChartOption, i: number) => o.series[i]!.data.map((d) => (d === null ? 0 : typeof d === "number" ? d : d.value));
const months = (o: ChartOption) => (o.xAxis as { data: string[] }).data;
const tooltip = (o: ChartOption, i: number) => (o.tooltip as { formatter: (p: { dataIndex: number }[]) => string }).formatter([{ dataIndex: i }]);
const xLabel = (o: ChartOption, i: number) => (o.xAxis as { axisLabel: { formatter: (m: string) => string } }).axisLabel.formatter(months(o)[i]!);
const opts = (over: Partial<ViewOpts> = {}): ViewOpts => ({ theme: THEME, now: NOW, available: 640, ...over });
const ALL_STATUSES = STATUS_SERIES.map((s) => s.key);
const ALL_TOPICS = TOPIC_SERIES.map((s) => s.key);

const v = (date: string | null, status: ViolationRecord["status"] = "open"): ViolationRecord => ({
  source: "housing",
  kind: "hazardous",
  id: `${date}-${status}`,
  ref: "",
  what: "x",
  where: "Building",
  date,
  status,
  cityStatus: "",
  closedAt: null,
  original: "",
});

const c = (date: string | null, topics: Complaint["topics"]): Complaint => ({
  source: "hpd",
  id: `${date}-${topics?.join("+")}`,
  date,
  what: "x",
  where: "Apt 1",
  status: "closed",
  closedAt: null,
  outcome: "",
  emergency: false,
  original: "",
  topics,
});

describe("months and buckets", () => {
  it("counts back twelve months from the current one, across a year end", () => {
    expect(lastMonths(NOW, 12)).toEqual(YEAR_MONTHS);
    expect(lastMonths(new Date("2026-01-15T12:00:00Z"), 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthLabel("2026-09")).toBe("Sep 2026");
    expect(monthOf("2026-09-12")).toBe("2026-09");
    expect(monthOf("bad")).toBeNull();
    expect(monthOf(null)).toBeNull();
  });

  it("counts per month and key, zero-filling empty months and skipping what isn't on the axis", () => {
    const axis = lastMonths(NOW, 4);
    const counts = bucket(
      [{ d: "2026-07-02", k: "a" }, { d: "2026-07-30", k: "a" }, { d: "2026-09-01", k: "b" }, { d: null, k: "a" }, { d: "2026-08-01", k: "zzz" }, { d: "2024-01-01", k: "a" }, { d: "2026-10-01", k: null }],
      axis,
      (x) => x.d?.slice(0, 7) ?? null,
      (x) => x.k,
      ["a", "b"],
    );
    expect(axis).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(counts).toEqual({ a: [2, 0, 0, 0], b: [0, 0, 1, 0] });
  });
});

describe("the plot and its value axis", () => {
  it("spreads the months across the space available, and never squeezes a slot below its least", () => {
    const desk = plotLayout(12, 640);
    expect(desk.width).toBe(640);
    expect(desk.slot).toBeCloseTo((640 - GRID.left - GRID.right) / 12);
    expect(plotLayout(12, 100).width).toBe(GRID.left + GRID.right + SLOT * 12);
    expect(plotLayout(12, 100).slot).toBe(SLOT);
    expect(plotLayout(0, 300).width).toBe(300);
  });

  it("steps in 1, 2 or 5 times a power of ten, at most four steps, from zero", () => {
    expect(valueAxis(0)).toEqual({ max: 1, interval: 1, ticks: [0, 1] });
    expect(valueAxis(3)).toEqual({ max: 3, interval: 1, ticks: [0, 1, 2, 3] });
    expect(valueAxis(5)).toEqual({ max: 6, interval: 2, ticks: [0, 2, 4, 6] });
    expect(valueAxis(23)).toEqual({ max: 30, interval: 10, ticks: [0, 10, 20, 30] });
    expect(valueAxis(1234)).toMatchObject({ max: 1500, interval: 500 });
    expect(tickFraction(0, valueAxis(23))).toBe(1);
    expect(tickFraction(30, valueAxis(23))).toBe(0);
    expect(axisWidth(valueAxis(3))).toBe(16);
    expect(axisWidth(valueAxis(1234))).toBeGreaterThan(axisWidth(valueAxis(23)));
  });
});

describe("stacked monthly bars", () => {
  const last = YEAR_MONTHS.length - 1;
  const opt = (over: Partial<Parameters<typeof stackedMonthly>[0]> = {}) =>
    stackedMonthly({
      months: YEAR_MONTHS,
      series: [
        { key: "heat", name: "Heat", data: YEAR_MONTHS.map((_, i) => (i === last ? 2 : 0)) },
        { key: "plumbing", name: "Plumbing", data: YEAR_MONTHS.map((_, i) => (i === last ? 1 : i === 0 ? 3 : 0)) },
      ],
      theme: THEME,
      layout: plotLayout(12, 640),
      axis: valueAxis(3),
      unit: ["complaint", "complaints"],
      ...over,
    });

  it("stacks every series on one stack, in the given order, coloured from the theme", () => {
    const o = opt();
    expect(o.series.map((s) => [s.name, s.stack, (s.itemStyle as { color: string }).color])).toEqual([
      ["Heat", "total", "#eb6834"],
      ["Plumbing", "total", "#2a78d6"],
    ]);
    expect(o.series.every((s) => s.data.length === 12)).toBe(true);
    // Only the top non-zero segment of a month gets the rounded data-end.
    expect(o.series[0]!.data[last]).toBe(2);
    expect(o.series[1]!.data[last]).toEqual({ value: 1, itemStyle: { borderRadius: [4, 4, 0, 0] } });
    expect(o.series[1]!.data[0]).toEqual({ value: 3, itemStyle: { borderRadius: [4, 4, 0, 0] } });
    // Empty months draw nothing at all.
    expect(o.series[0]!.data[0]).toBeNull();
    expect((o.series[0]!.itemStyle as { borderWidth: number }).borderWidth).toBe(1);
  });

  it("has no zoom and no legend of its own: every month is in view, and the page draws the legend", () => {
    const o = opt();
    expect(o).not.toHaveProperty("dataZoom");
    expect(o).not.toHaveProperty("legend");
  });

  it("puts the plot exactly where the HTML value axis expects it, with fixed ticks and no labels of its own", () => {
    const layout = plotLayout(12, 640);
    const o = opt({ layout });
    expect(o.grid).toEqual({ left: layout.left, right: layout.right, top: layout.top, bottom: layout.bottom, outerBoundsMode: "none" });
    expect(o.yAxis).toMatchObject({ min: 0, max: 3, interval: 1, axisLabel: { show: false } });
  });

  it("on paper, draws its own value labels and fits them", () => {
    const o = opt({ print: true });
    expect(o.yAxis).toMatchObject({ axisLabel: { show: true } });
    expect(o.grid).toMatchObject({ outerBoundsMode: "same", outerBoundsContain: "axisLabel" });
  });

  it("names every month, by its first letter when a slot is narrow, with the year on January", () => {
    const wide = opt();
    expect(xLabel(wide, SEP)).toBe("Sep");
    expect(xLabel(wide, YEAR_MONTHS.indexOf("2026-01"))).toBe("2026");
    const narrow = opt({ layout: plotLayout(12, 300) });
    expect(xLabel(narrow, SEP)).toBe("S");
    expect(xLabel(narrow, YEAR_MONTHS.indexOf("2026-01"))).toBe("2026");
  });

  it("lists every segment and the total in the tooltip, kept inside the chart, escaping text", () => {
    const html = tooltip(opt(), last);
    expect(html).toContain("Oct 2026");
    expect(html).toMatch(/>2<\/span><span[^>]*>Heat</);
    expect(html).toMatch(/>1<\/span><span[^>]*>Plumbing</);
    expect(html).toContain("3 complaints");
    expect(tooltip(opt({ series: [{ key: "heat", name: "<b>", data: YEAR_MONTHS.map(() => 1) }, { key: "pest", name: "Pest", data: YEAR_MONTHS.map(() => 0) }] }), 0)).toContain("&lt;b&gt;");
    // One series: just the total.
    expect(tooltip(opt({ series: [{ key: "heat", name: "Heat", data: YEAR_MONTHS.map(() => 1) }] }), 0)).not.toContain(">Heat<");
    expect(opt().tooltip).toMatchObject({ confine: true });
  });
});

describe("violations chart", () => {
  const items = [v("2026-09-12"), v("2026-09-01", "closed"), v("2026-09-20"), v("2025-11-05", "closed"), v("2025-10-31"), v("2024-01-05", "closed"), v(null)];

  it("is always the last twelve months, open stacked under closed, whatever the records' span", () => {
    const view = violationsChart(items, ALL_STATUSES, opts());
    expect(view.months).toEqual(YEAR_MONTHS);
    expect(view.option.series.map((s) => [s.name, (s.itemStyle as { color: string }).color])).toEqual([
      ["Open", "#ff5a3c"],
      ["Closed", "#898781"],
    ]);
    expect([values(view.option, 0)[SEP], values(view.option, 1)[SEP]]).toEqual([2, 1]);
    expect([values(view.option, 0)[0], values(view.option, 1)[0]]).toEqual([0, 1]);
    // Records before the window, and undated ones, aren't charted: the list has them.
    expect(values(view.option, 0).reduce((a, b) => a + b, 0) + values(view.option, 1).reduce((a, b) => a + b, 0)).toBe(4);
    expect(view.label).toBe(
      "Stacked bar chart of violations, summonses, failed rat inspections and city emergency repairs per month, open and closed, Nov 2025 to Oct 2026. The list below has every one, older ones too.",
    );
    // An empty building still gets its twelve months.
    expect(violationsChart([], ALL_STATUSES, opts()).months).toEqual(YEAR_MONTHS);
  });

  it("counts failed rat inspections and city repairs with the violations, by their status", () => {
    const rat = (date: string, status: ViolationRecord["status"]): ViolationRecord => ({ ...v(date, status), source: "rats", kind: "rats" });
    const repair = (date: string): ViolationRecord => ({ ...v(date, "closed"), source: "repairs", kind: "repairs" });
    const view = violationsChart([...items, rat("2026-09-03", "open"), rat("2026-09-04", "closed"), repair("2026-09-05"), repair("2026-08-05")], ALL_STATUSES, opts());
    // September had two open and one closed violation: one more open, two more closed.
    expect([values(view.option, 0)[SEP], values(view.option, 1)[SEP]]).toEqual([3, 3]);
    expect([values(view.option, 0)[AUG], values(view.option, 1)[AUG]]).toEqual([0, 1]);
    // The month's total is of records, since not all of them are violations.
    expect(tooltip(view.option, SEP)).toContain("6 records");
    expect(tooltip(view.option, AUG)).toContain("1 record<");
  });

  it("draws only the statuses the legend has switched on", () => {
    const open = violationsChart(items, ["open"], opts());
    expect(open.option.series.map((s) => s.name)).toEqual(["Open"]);
    expect(values(open.option, 0)[SEP]).toBe(2);
    expect(open.axis.max).toBe(2);
    expect(open.label).toContain("It counts only the open ones.");
    const closed = violationsChart(items, ["closed"], opts());
    expect(closed.option.series.map((s) => s.name)).toEqual(["Closed"]);
    expect(values(closed.option, 0)[SEP]).toBe(1);
  });

  it("fits the box at every width", () => {
    const phone = violationsChart(items, ALL_STATUSES, opts({ available: 300 }));
    expect(phone.layout.width).toBe(300);
    expect(phone.axis.max).toBe(3);
    expect(xLabel(phone.option, SEP)).toBe("S");
    expect(xLabel(violationsChart(items, ALL_STATUSES, opts()).option, SEP)).toBe("Sep");
    // Never narrower than its twelve slots.
    expect(violationsChart(items, ALL_STATUSES, opts({ available: 100 })).layout.width).toBe(GRID.left + GRID.right + SLOT * 12);
  });

  it("prints at the paper's width, with its own value labels", () => {
    const view = violationsChart(items, ALL_STATUSES, opts({ available: 600.7, print: true }));
    expect(view.layout.width).toBe(600);
    expect(view.option.yAxis).toMatchObject({ axisLabel: { show: true } });
  });
});

describe("complaints chart", () => {
  const items = [
    c("2026-09-02", ["heat", "plumbing"]),
    c("2026-09-10", ["plumbing"]),
    c("2026-09-11", []),
    c("2026-08-01", ["noise"]),
    c("2026-08-02", ["pest"]),
    c("2026-08-03", undefined),
    c("2023-01-01", ["heat"]),
    c(null, ["heat"]),
  ];

  it("picks the topic a complaint counts under from the ones showing", () => {
    const both = c("2026-09-02", ["heat", "plumbing"]);
    expect(topicKeyIn(both, ALL_TOPICS)).toBe("heat");
    expect(topicKeyIn(both, ["plumbing", "noise"])).toBe("plumbing");
    expect(topicKeyIn(both, ["noise", "other"])).toBeNull();
    // No topic is "other", and only when Other is showing.
    expect(topicKeyIn(c("2026-09-02", []), ALL_TOPICS)).toBe("other");
    expect(topicKeyIn(c("2026-09-02", undefined), ["other"])).toBe("other");
    expect(topicKeyIn(c("2026-09-02", []), ["heat"])).toBeNull();
  });

  it("with every topic, counts each complaint once under its first topic, so a bar is the month's complaints", () => {
    const view = complaintsChart(items, ALL_TOPICS, opts());
    const o = view.option;
    expect(view.months).toEqual(YEAR_MONTHS);
    expect(o.series.map((s) => s.name)).toEqual(TOPIC_SERIES.map((s) => s.name));
    expect(TOPIC_SERIES.map((_, k) => values(o, k)[SEP])).toEqual([1, 1, 0, 0, 1]);
    expect(TOPIC_SERIES.map((_, k) => values(o, k)[AUG])).toEqual([0, 0, 1, 1, 1]);
    expect(tooltip(o, SEP)).toContain("3 complaints");
    expect(tooltip(o, SEP)).toContain("1 complaint was about more than one of these topics, counted once under the first");
    expect(tooltip(o, AUG)).not.toContain("more than one");
    expect(view.label).toBe("Stacked bar chart of complaints per month by topic, Nov 2025 to Oct 2026. The list below has every one, older ones too.");
  });

  it("with some topics, draws just those, and a complaint about several counts under the first one showing", () => {
    const plumbing = complaintsChart(items, ["plumbing"], opts());
    expect(plumbing.option.series).toHaveLength(1);
    expect(plumbing.option.series[0]).toMatchObject({ name: "Plumbing", itemStyle: { color: "#2a78d6" } });
    // Both the heat-and-plumbing complaint and the plumbing one.
    expect(values(plumbing.option, 0)[SEP]).toBe(2);
    expect(tooltip(plumbing.option, SEP)).toContain("2 complaints");
    expect(tooltip(plumbing.option, SEP)).not.toContain("more than one");
    expect(plumbing.label).toContain("It counts only plumbing.");

    const some: TopicKey[] = ["other", "noise"];
    const two = complaintsChart(items, some, opts());
    // Legend order, whatever order they were pressed in.
    expect(two.option.series.map((s) => s.name)).toEqual(["Noise", "Other"]);
    expect([values(two.option, 0)[AUG], values(two.option, 1)[AUG], values(two.option, 1)[SEP]]).toEqual([1, 1, 1]);
    expect(two.label).toContain("It counts only noise, other.");
  });
});

describe("legal chart", () => {
  const l = (kind: LegalRecord["kind"], date: string | null, status: LegalRecord["status"] = "closed"): LegalRecord => ({ kind, what: "x", where: "Building", date, status, closedAt: null, facts: [] });
  const items = [
    l("case", "2026-08-28", "open"),
    l("eviction", "2026-08-02"),
    l("eviction", "2025-11-13"),
    l("vacate", "2026-09-01", "open"),
    l("case", "2015-03-26"),
    l("eviction", null),
    l("program", "2026-08-03", "open"),
    l("program", "2013-01-31"),
  ];
  const ALL = LEGAL_SERIES.map((s) => s.key);

  it("stacks court cases, vacate orders, evictions and city programs over the last twelve months", () => {
    const view = legalChart(items, ALL, opts());
    expect(view.months).toEqual(YEAR_MONTHS);
    expect(view.option.series.map((s) => [s.name, (s.itemStyle as { color: string }).color])).toEqual([
      ["Court cases", "#2a78d6"],
      ["Vacate orders", "#eb6834"],
      ["Evictions", "#4a3aa7"],
      ["City programs", "#1baf7a"],
    ]);
    expect(LEGAL_SERIES.map((_, k) => values(view.option, k)[AUG])).toEqual([1, 0, 1, 1]);
    expect(LEGAL_SERIES.map((_, k) => values(view.option, k)[SEP])).toEqual([0, 1, 0, 0]);
    expect(values(view.option, 2)[0]).toBe(1);
    expect(tooltip(view.option, AUG)).toContain("3 records");
    expect(view.label).toBe("Stacked bar chart of housing court cases, vacate orders, evictions and city programs per month, Nov 2025 to Oct 2026. The list below has every one, older ones too.");
  });

  it("draws only the kinds the legend has switched on", () => {
    const view = legalChart(items, ["eviction"], opts());
    expect(view.option.series.map((s) => s.name)).toEqual(["Evictions"]);
    expect(values(view.option, 0)[AUG]).toBe(1);
    expect(view.label).toContain("It counts only evictions.");
    const programs = legalChart(items, ["program"], opts());
    expect(programs.option.series.map((s) => s.name)).toEqual(["City programs"]);
    expect(values(programs.option, 0)[AUG]).toBe(1);
    expect(programs.label).toContain("It counts only city programs.");
  });
});
