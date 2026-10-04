import { describe, expect, it } from "vitest";
import type { Complaint, ViolationRecord } from "../shared/types";
import { dotStrip, DOT_CAP, fullDate, groupByPlace, kindOf, parseView, placeKeyOf, shortDate, toggleShown, VIEW_MODES, VIOLATION_KINDS, yourUnitOf } from "../web/src/historyModel";

const NOW = new Date("2026-10-03T12:00:00Z");

let seq = 0;
const v = (over: Partial<ViolationRecord> = {}): ViolationRecord => ({
  source: "housing",
  kind: "hazardous",
  id: String(++seq),
  ref: "",
  what: "Water leak",
  where: "Building",
  date: "2026-09-12",
  status: "open",
  cityStatus: "",
  closedAt: null,
  original: "",
  area: "building",
  ...over,
});

const c = (over: Partial<Complaint> = {}): Complaint => ({
  source: "hpd",
  id: String(++seq),
  date: "2026-09-12",
  what: "No heat",
  where: "Whole building",
  status: "closed",
  closedAt: null,
  outcome: "",
  emergency: false,
  original: "",
  topics: ["heat"],
  area: "building",
  ...over,
});

const apt = (unit: string, over: Partial<ViolationRecord> = {}) => v({ area: "apartment", unit, where: `Apt ${unit}`, ...over });

describe("by place", () => {
  it("lists the building, the common areas, then the apartments with the searched one first", () => {
    const items = [
      apt("D1"),
      apt("D1", { status: "closed" }),
      v({ area: "common", status: "closed" }),
      apt("D5", { status: "closed" }),
      v({ area: "building", status: "closed" }),
      apt("10A"),
      apt("2B"),
      v({ area: "apartment", where: "Apartment" }),
      v({ area: undefined }),
    ];
    const groups = groupByPlace(items, "D5");
    expect(groups.map((g) => [g.label, g.open, g.items.length])).toEqual([
      ["Building", 0, 1],
      ["Common areas", 0, 1],
      ["Apt D5", 0, 1],
      // The other apartments: most open first, then the larger, then natural order (2B before 10A).
      ["Apt D1", 1, 2],
      ["Apt 2B", 1, 1],
      ["Apt 10A", 1, 1],
      ["Apartment, number not given", 1, 1],
      ["Place not recorded", 1, 1],
    ]);
    // The searched apartment is labelled like any other, but known, so the page can open it.
    expect(groups.map((g) => g.mine)).toEqual([false, false, true, false, false, false, false, false]);
    // Rows keep their order (newest first) inside a group.
    expect(groups[3]!.items.map((x) => x.status)).toEqual(["open", "closed"]);
  });

  it("without a searched apartment, no group is the searched one", () => {
    const groups = groupByPlace([apt("D5", { status: "closed" }), apt("D1"), v()], null);
    expect(groups.map((g) => g.label)).toEqual(["Building", "Apt D1", "Apt D5"]);
    expect(groups.some((g) => g.mine)).toBe(false);
    expect(yourUnitOf("d-5")).toBe("D5");
    expect(yourUnitOf(null)).toBeNull();
  });

  it("names every kind of place, and copes with records stored before places existed", () => {
    expect(placeKeyOf({ area: "apartment", unit: "d-5" })).toBe("apt:D5");
    const groups = groupByPlace(
      [c({ area: "around", status: "open" }), c({ area: "apartment" }), c({ area: undefined }), c({ area: "common" }), c({ area: "nonsense" as never }), c({ area: "building" })],
      null,
    );
    expect(groups.map((g) => g.label)).toEqual(["Building", "Common areas", "Apartment, number not given", "Around the building", "Place not recorded"]);
    expect(groups.find((g) => g.key === "unknown")!.items).toHaveLength(2);
  });

  it("caps a place's dot strip, open dots first, each run in the given order", () => {
    const items = [
      ...Array.from({ length: 20 }, () => c({ topics: ["noise"] })),
      ...Array.from({ length: 10 }, () => c({ topics: ["plumbing"], status: "open" })),
      c({ topics: ["heat"], status: "open" }),
      c({ topics: ["heat"] }),
    ];
    const order = ["heat", "plumbing", "pest", "noise", "other"];
    const strip = dotStrip(items, (x) => x.topics?.[0] ?? "other", order);
    expect(strip.dots).toHaveLength(DOT_CAP);
    expect(strip.more).toBe(items.length - DOT_CAP);
    expect(strip.dots.slice(0, 12)).toEqual([{ key: "heat", open: true }, ...Array.from({ length: 10 }, () => ({ key: "plumbing", open: true })), { key: "heat", open: false }]);
    expect(strip.dots.at(-1)).toEqual({ key: "noise", open: false });
    expect(dotStrip(items.slice(0, 3), (x) => x.topics?.[0] ?? "other", order).more).toBe(0);
    // Violations: by status.
    expect(dotStrip([v({ status: "closed" }), v()], (x) => x.status, ["open", "closed"]).dots).toEqual([
      { key: "open", open: true },
      { key: "closed", open: false },
    ]);
  });
});

describe("the legend as a filter", () => {
  const TOPICS = ["heat", "plumbing", "pest", "noise", "other"] as const;
  const STATUSES = ["open", "closed"] as const;

  it("picks an entry out on the first press, then adds and drops entries", () => {
    const heat = toggleShown(TOPICS, "heat", TOPICS);
    expect(heat).toEqual(["heat"]);
    // Adding keeps legend order, whatever order they were pressed in.
    const two = toggleShown(toggleShown(TOPICS, "noise", TOPICS), "heat", TOPICS);
    expect(two).toEqual(["heat", "noise"]);
    expect(toggleShown(two, "heat", TOPICS)).toEqual(["noise"]);
  });

  it("shows everything again once the last entry is dropped, or every entry is on", () => {
    expect(toggleShown(["heat"], "heat", TOPICS)).toEqual([...TOPICS]);
    expect(toggleShown(["open"], "closed", STATUSES)).toEqual(["open", "closed"]);
    // Everything on again: the next press picks one out, as from the start.
    expect(toggleShown(["open", "closed"], "closed", STATUSES)).toEqual(["closed"]);
    expect(toggleShown(["closed"], "closed", STATUSES)).toEqual(["open", "closed"]);
  });

  it("ignores a key that isn't in the legend", () => {
    expect(toggleShown(["heat"], "nonsense" as never, TOPICS)).toEqual(["heat"]);
  });
});

describe("dates, kinds and views", () => {
  it("writes short dates, with the year only when it isn't this year", () => {
    expect(shortDate("2026-09-12", NOW)).toBe("Sep 12");
    expect(shortDate("2024-09-12", NOW)).toBe("Sep 12, 2024");
    expect(shortDate(null, NOW)).toBe("");
    expect(shortDate("bad", NOW)).toBe("");
    expect(fullDate("2026-09-12")).toBe("Sep 12, 2026");
    expect(fullDate(undefined)).toBe("");
  });

  it("reads an unknown kind as paperwork", () => {
    expect(kindOf(v({ kind: "immediate" }))).toBe("immediate");
    expect(kindOf(v({ kind: "weird" as never }))).toBe("paperwork");
    // A failed rat inspection and a city repair are kinds of their own, with a name for the row's details.
    expect([kindOf(v({ source: "rats", kind: "rats" })), kindOf(v({ source: "repairs", kind: "repairs" }))]).toEqual(["rats", "repairs"]);
    expect(VIOLATION_KINDS.filter((k) => k.key === "rats" || k.key === "repairs").map((k) => k.name)).toEqual(["Rat inspection", "City emergency repair"]);
  });

  it("offers a list and groups by place, and falls back to the list", () => {
    expect(VIEW_MODES.map((m) => m.key)).toEqual(["list", "place"]);
    expect(parseView("place")).toBe("place");
    expect(parseView("list")).toBe("list");
    // A choice saved when there was a By month view.
    expect(parseView("month")).toBe("list");
    expect(parseView(null)).toBe("list");
  });
});
