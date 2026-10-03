import { describe, expect, it } from "vitest";
import { snapshotOf, type SnapshotSource } from "../shared/snapshot";
import type { Bedbugs, Complaint, LegalRecord, ViolationRecord } from "../shared/types";

const v = (over: Partial<ViolationRecord> = {}): ViolationRecord => ({
  source: "housing",
  kind: "hazardous",
  id: "1",
  ref: "",
  what: "Water leak",
  where: "Building",
  date: "2026-09-12",
  status: "open",
  cityStatus: "",
  closedAt: null,
  original: "",
  ...over,
});

const c = (over: Partial<Complaint> = {}): Complaint => ({
  source: "hpd",
  id: "1",
  date: "2026-01-20",
  what: "No heat",
  where: "Apt D5",
  status: "closed",
  closedAt: null,
  outcome: "",
  emergency: true,
  original: "",
  topics: ["heat"],
  ...over,
});

const legal = (kind: LegalRecord["kind"], status: LegalRecord["status"]): LegalRecord => ({ kind, what: "x", where: "Building", date: "2026-08-28", status, closedAt: null, facts: [] });

const BEDBUGS: Bedbugs = { lastFilingDate: "2025-12-03", periodStart: "2024-11-01", periodEnd: "2025-10-31", dwellingUnits: 42, infested: 0, eradicated: 0, reinfested: 0, missingLatest: false, required: true };

const source = (over: Partial<SnapshotSource> = {}, unit: string | null = "D5"): SnapshotSource =>
  ({
    generatedAt: "2026-10-03T12:00:00.000Z",
    address: { unit },
    violations: { items: [] },
    complaints: { items: [] },
    legal: { items: [] },
    bedbugs: BEDBUGS,
    ...over,
  }) as unknown as SnapshotSource;

describe("snapshot", () => {
  it("counts open hazards, what is open in the searched apartment, and how much of the last year is unfixed", () => {
    const s = snapshotOf(
      source({
        violations: {
          items: [
            v({ kind: "immediate", unit: "D5" }),
            v({ kind: "hazardous", unit: "d-5" }),
            v({ kind: "minor", unit: "D5" }),
            v({ kind: "hazardous", status: "closed", unit: "D5" }),
            v({ kind: "summons", unit: "A1" }),
            // Open, but issued before the last twelve months.
            v({ kind: "hazardous", date: "2018-05-12" }),
            v({ kind: "paperwork", date: null }),
            // The first day of the window counts; the day before does not.
            v({ kind: "minor", status: "closed", date: "2025-10-03" }),
            v({ kind: "minor", status: "closed", date: "2025-10-02" }),
          ],
        },
      } as Partial<SnapshotSource>),
    )!;
    expect(s.openViolations).toBe(6);
    expect(s.openHazards).toBe(3);
    expect(s.openInUnit).toBe(3);
    expect([s.unfixed12mo, s.issued12mo]).toEqual([4, 6]);
  });

  it("takes the last year's housing violations from the city's count when the report has it", () => {
    // Past the row cap the list holds every open violation but few closed ones: three open housing
    // rows here, where the city counted 40 issued. Other sources are still counted from their rows.
    const s = snapshotOf(
      source({
        violations: {
          items: [v(), v(), v(), v({ source: "summons", kind: "summons" }), v({ source: "buildings", kind: "buildings", status: "closed" })],
          lastYear: { housing: { issued: 40, open: 3 } },
        },
      } as Partial<SnapshotSource>),
    )!;
    expect([s.unfixed12mo, s.issued12mo]).toEqual([4, 42]);
    // Everything open is still counted from the rows.
    expect(s.openViolations).toBe(4);
  });

  it("counts open housing violations from the city's totals when the row list was capped", () => {
    const s = snapshotOf(
      source({
        counts: { openA: 100, openB: 300, openC: 250, openI: 4 },
        violations: { items: [v(), v({ kind: "immediate" }), v({ source: "summons", kind: "summons" })] },
      } as unknown as Partial<SnapshotSource>),
    )!;
    // 654 open housing violations by class, plus the one open summons among the rows.
    expect(s.openViolations).toBe(655);
    expect(s.openHazards).toBe(550);
  });

  it("has no apartment count when the search named none", () => {
    expect(snapshotOf(source({ violations: { items: [v({ unit: "D5" })] } } as Partial<SnapshotSource>, null))!.openInUnit).toBeNull();
  });

  it("counts each heat complaint in the last twelve months once", () => {
    const s = snapshotOf(
      source({
        complaints: {
          items: [
            c(),
            c({ id: "2", topics: ["heat", "plumbing"] }),
            c({ id: "3", topics: ["plumbing"] }),
            c({ id: "4", topics: undefined }),
            c({ id: "5", date: "2025-10-02" }),
            c({ id: "6", date: null }),
            c({ id: "7", source: "311", topics: ["heat"], date: "2025-10-03" }),
          ],
        },
      } as Partial<SnapshotSource>),
    )!;
    expect(s.heatComplaints12mo).toBe(3);
    // Housing-department complaints of any topic, in the window: the four dated hpd ones.
    expect(s.housingComplaints12mo).toBe(4);
  });

  it("counts the complaints the city hasn't closed, whatever their age", () => {
    const s = snapshotOf(source({ complaints: { items: [c({ status: "open" }), c({ id: "2", status: "open", date: "2021-03-01" }), c({ id: "3" })] } } as Partial<SnapshotSource>))!;
    expect(s.openComplaints).toBe(2);
  });

  it("says bedbugs are on record when the landlord's filing or an open hazardous violation says so", () => {
    expect(snapshotOf(source())!.bedbugsReported).toBe(false);
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, infested: 2 } }))!.bedbugsReported).toBe(true);
    const cited = (over: Partial<ViolationRecord>) => snapshotOf(source({ violations: { items: [v({ original: "ABATE THE NUISANCE CONSISTING OF BEDBUGS IN THE ENTIRE APARTMENT", ...over })] } } as Partial<SnapshotSource>))!.bedbugsReported;
    expect(cited({})).toBe(true);
    expect(cited({ status: "closed" })).toBe(false);
    // The paperwork notice for not filing the yearly bedbug report is not an infestation.
    expect(cited({ kind: "minor", original: "FILE THE ANNUAL BEDBUG REPORT" })).toBe(false);
    // No filing on record is not a yes.
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, missingLatest: true } }))!.bedbugsReported).toBe(false);
  });

  it("counts court cases that aren't closed and vacate orders in effect, not evictions", () => {
    const s = snapshotOf(source({ legal: { items: [legal("case", "open"), legal("case", "closed"), legal("vacate", "open"), legal("eviction", "closed")] } } as Partial<SnapshotSource>))!;
    expect(s.openLegal).toBe(2);
    // A report stored before legal records has no number to give.
    expect(snapshotOf(source({ legal: undefined }))!.openLegal).toBeNull();
  });

  it("reads the landlord's latest bedbug filing, a missing one, and a building that needn't file", () => {
    expect(snapshotOf(source())!.bedbugs).toEqual({ state: "filed", infested: 0, units: 42, periodEnd: "2025-10-31" });
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, infested: 3 } }))!.bedbugs).toMatchObject({ state: "filed", infested: 3 });
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, missingLatest: true } }))!.bedbugs).toEqual({ state: "missing" });
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, lastFilingDate: null } }))!.bedbugs).toEqual({ state: "missing" });
    expect(snapshotOf(source({ bedbugs: { ...BEDBUGS, required: false } }))!.bedbugs).toEqual({ state: "not-required" });
  });

  it("is null for a report stored before violations were their own records", () => {
    expect(snapshotOf(source({ violations: undefined }))).toBeNull();
  });
});
