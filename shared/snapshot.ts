// The report's snapshot: the few numbers a renter deciding on a lease should see before anything
// else. Pure and shared: the page shows them as tiles and the summary is written from the same
// numbers, so the two can't disagree. Everything is counted from the report's own rows, over the
// twelve months before the report was generated (365 days, to match the city queries).

import { normalizeUnit } from "./address";
import type { Bedbugs, Report } from "./types";

export type BedbugFiling =
  /** The landlord filed the yearly report: how many apartments it says had bedbugs. */
  | { state: "filed"; infested: number; units: number | null; periodEnd: string | null }
  /** A report was required and the latest one isn't on file. */
  | { state: "missing" }
  /** The building doesn't have to file. */
  | { state: "not-required" };

export interface Snapshot {
  /** Violations and summonses of every kind that are still open. */
  openViolations: number;
  /** Complaints the city hasn't closed. */
  openComplaints: number;
  /**
   * Bedbugs on record: the landlord's latest yearly filing reports an infested apartment, or the
   * city has an open hazardous violation for them. False also covers a building with no filing.
   */
  bedbugsReported: boolean;
  /** Housing violations still open that the city classes hazardous or immediately hazardous. Not a tile: the summary uses it. */
  openHazards: number;
  /** Violations of any kind still open in the searched apartment; null when the search named none. Not a tile: the summary uses it. */
  openInUnit: number | null;
  /** Violations issued in the last twelve months, and how many of them are still open. */
  issued12mo: number;
  unfixed12mo: number;
  /** Complaints about heat or hot water in the last twelve months, each counted once. */
  heatComplaints12mo: number;
  /** Complaints tenants made to the housing department in the last twelve months, each counted once. Not a tile: the summary uses it. */
  housingComplaints12mo: number;
  /** Housing court cases that aren't closed plus vacate orders in effect; null on a report stored before legal records. */
  openLegal: number | null;
  bedbugs: BedbugFiling;
}

/** What a snapshot is counted from: a report, or the same parts while one is being built. */
export type SnapshotSource = Pick<Report, "generatedAt" | "address" | "counts" | "complaints" | "violations" | "legal" | "bedbugs">;

function bedbugFiling(b: Bedbugs | undefined): BedbugFiling {
  if (!b || !b.required) return { state: "not-required" };
  if (b.missingLatest || !b.lastFilingDate) return { state: "missing" };
  return { state: "filed", infested: b.infested ?? 0, units: b.dwellingUnits ?? null, periodEnd: b.periodEnd ?? null };
}

/** The snapshot, or null for a report stored before it had every violation as its own record. */
export function snapshotOf(r: SnapshotSource): Snapshot | null {
  const violations = r.violations?.items;
  if (!Array.isArray(violations)) return null;
  // The same 365 days the city is asked about (src/lib/datasets.ts).
  const from = new Date(Date.parse(r.generatedAt) - 365 * 86_400_000).toISOString().slice(0, 10);
  // Housing violations come from the city's own count when the report has it: the row list is
  // capped with open ones first, so past the cap it is missing recent closed ones.
  const counted = r.violations?.lastYear?.housing;
  const recent = violations.filter((v) => !!v.date && v.date >= from && !(counted && v.source === "housing"));
  const open = violations.filter((v) => v.status === "open");
  const unit = normalizeUnit(r.address?.unit);
  const everyComplaint = Array.isArray(r.complaints?.items) ? r.complaints.items : [];
  const complaints = everyComplaint.filter((c) => !!c.date && c.date >= from);
  const hazards = open.filter((v) => v.kind === "immediate" || v.kind === "hazardous");
  const filing = bedbugFiling(r.bedbugs);
  // Open housing violations by class, as the city counts them: the row list stops at its cap, so a
  // building with more open violations than that would otherwise be undercounted.
  const c = r.counts;
  const housingOpen = Math.max(open.filter((v) => v.source === "housing").length, c ? c.openA + c.openB + c.openC + c.openI : 0);
  return {
    openViolations: housingOpen + open.filter((v) => v.source !== "housing").length,
    openComplaints: everyComplaint.filter((c) => c.status === "open").length,
    // A hazardous-class violation naming bedbugs is an infestation; the notice for not filing the
    // yearly bedbug report is a lower class and doesn't count.
    bedbugsReported: (filing.state === "filed" && filing.infested > 0) || hazards.some((v) => /BED\s?BUG/i.test(v.original ?? "")),
    openHazards: Math.max(hazards.length, c ? c.openB + c.openC : 0),
    openInUnit: unit ? open.filter((v) => normalizeUnit(v.unit) === unit).length : null,
    issued12mo: recent.length + (counted?.issued ?? 0),
    unfixed12mo: recent.filter((v) => v.status === "open").length + (counted?.open ?? 0),
    heatComplaints12mo: complaints.filter((c) => Array.isArray(c.topics) && c.topics.includes("heat")).length,
    housingComplaints12mo: complaints.filter((c) => c.source === "hpd").length,
    openLegal: Array.isArray(r.legal?.items) ? r.legal.items.filter((x) => x.status === "open").length : null,
    bedbugs: filing,
  };
}
