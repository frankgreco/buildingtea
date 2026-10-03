// Every decision the two history sections make about their rows, as plain data: the two views (a
// list, groups by place), the legend that filters, the places and their dots, and the short dates.
// No DOM and no echarts here, so it is unit tested in Node (test/historyModel.test.ts); history.ts
// turns what it returns into HTML.

import { normalizeUnit } from "@shared/address";
import type { RecordArea, ViolationKind, ViolationRecord } from "@shared/types";

// ---------- views ----------

export type ViewMode = "list" | "place";
export const VIEW_MODES: { key: ViewMode; name: string }[] = [
  { key: "list", name: "List" },
  { key: "place", name: "By place" },
];
/** localStorage key for the visitor's last view, shared by both sections. */
export const VIEW_STORAGE_KEY = "bt.history.view";
export const parseView = (v: unknown): ViewMode => (v === "place" ? "place" : "list");

/** List rows per "Show more". */
export const PAGE = 25;
/** Places listed before "Show more places". */
export const PLACE_PAGE = 10;
/** Dots in a place's strip before "+N". */
export const DOT_CAP = 24;

// ---------- violation kinds ----------

/** What a violation is, in words, for its details. */
export const VIOLATION_KINDS: { key: ViolationKind; name: string }[] = [
  { key: "immediate", name: "Immediately hazardous" },
  { key: "hazardous", name: "Hazardous" },
  { key: "minor", name: "Minor" },
  { key: "paperwork", name: "Paperwork" },
  { key: "buildings", name: "Buildings dept." },
  { key: "summons", name: "City summons" },
];

/** A record's kind, with anything unrecognised read as paperwork. */
export const kindOf = (v: ViolationRecord): ViolationKind => (VIOLATION_KINDS.some((k) => k.key === v.kind) ? v.kind : "paperwork");

// ---------- the legend as a filter ----------

/**
 * Press a legend entry. Everything shows until one is pressed: the first press picks that entry
 * out, further presses add or drop entries, and dropping the last one shows everything again.
 * The result is in `keys` order.
 */
export function toggleShown<K extends string>(shown: readonly K[], key: K, keys: readonly K[]): K[] {
  if (!keys.includes(key)) return keys.filter((k) => shown.includes(k));
  if (keys.every((k) => shown.includes(k))) return [key];
  const next = keys.filter((k) => (k === key ? !shown.includes(k) : shown.includes(k)));
  return next.length ? next : [...keys];
}

// ---------- by place ----------

/** The searched apartment, normalised, or null when the report was searched without one. */
export const yourUnitOf = (unit: string | null | undefined): string | null => normalizeUnit(unit);

export interface PlaceGroup<T> {
  /** "apt:D5", "apt:" (an apartment with no number), "common", "building", "around", "unknown". */
  key: string;
  label: string;
  /** The searched apartment's group: first of the apartments, and opened. */
  mine: boolean;
  items: T[];
  open: number;
}

interface Placed {
  status: "open" | "closed";
  area?: RecordArea;
  unit?: string;
}

const AREA_LABEL: Record<RecordArea | "unknown", string> = {
  apartment: "Apartment, number not given",
  common: "Common areas",
  building: "Building",
  around: "Around the building",
  unknown: "Place not recorded",
};

export function placeKeyOf(x: { area?: RecordArea; unit?: string }): string {
  const area = x.area && x.area in AREA_LABEL ? x.area : "unknown";
  return area === "apartment" ? `apt:${normalizeUnit(x.unit) ?? ""}` : area;
}

/** A group's slot: the building, the common areas, the searched apartment, the other apartments, then the rest. */
const placeRank = (g: { key: string; mine: boolean }): number =>
  g.key === "building" ? 0 : g.key === "common" ? 1 : g.mine ? 2 : g.key === "apt:" ? 4 : g.key.startsWith("apt:") ? 3 : g.key === "around" ? 5 : 6;

/**
 * Rows grouped by where they are, from the structured `area` and `unit` (never the display string).
 * The building comes first, then the common areas, then the apartments: the searched one, then the
 * rest by open count, then size, then name (in natural order: 2B before 10A). Rows keep their order
 * inside a group.
 */
export function groupByPlace<T extends Placed>(items: T[], yourUnit: string | null): PlaceGroup<T>[] {
  const groups = new Map<string, PlaceGroup<T>>();
  for (const x of items) {
    const key = placeKeyOf(x);
    let g = groups.get(key);
    if (!g) {
      const unit = key.startsWith("apt:") ? key.slice(4) : "";
      const label = unit ? `Apt ${unit}` : AREA_LABEL[key.startsWith("apt:") ? "apartment" : (key as RecordArea | "unknown")];
      g = { key, label, mine: !!unit && unit === yourUnit, items: [], open: 0 };
      groups.set(key, g);
    }
    g.items.push(x);
    if (x.status === "open") g.open++;
  }
  return [...groups.values()].sort(
    (a, b) => placeRank(a) - placeRank(b) || b.open - a.open || b.items.length - a.items.length || a.label.localeCompare(b.label, "en", { numeric: true }),
  );
}

export interface Dot {
  key: string;
  open: boolean;
}

/** A place's strip: open dots first, each run in `order`, capped at `cap` with the rest as "+N". */
export function dotStrip<T extends { status: string }>(items: T[], keyOf: (x: T) => string, order: readonly string[], cap = DOT_CAP): { dots: Dot[]; more: number } {
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  const all = items.map((x) => ({ key: keyOf(x), open: x.status === "open" })).sort((a, b) => Number(b.open) - Number(a.open) || rank(a.key) - rank(b.key));
  return { dots: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

// ---------- dates ----------

const isDay = (iso: string | null | undefined): iso is string => !!iso && /^\d{4}-\d{2}-\d{2}/.test(iso);
const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

/** "Sep 12" this year, "Sep 12, 2024" otherwise; "" for no date. */
export function shortDate(iso: string | null | undefined, now: Date): string {
  if (!isDay(iso)) return "";
  const year = iso.slice(0, 4) !== String(now.getUTCFullYear());
  return asDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** "Sep 12, 2026"; "" for no date. */
export function fullDate(iso: string | null | undefined): string {
  return isDay(iso) ? asDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}
