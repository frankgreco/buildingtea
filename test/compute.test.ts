import { describe, expect, it } from "vitest";
import type { Address } from "../shared/types";
import { computeReport, diffSnapshots, snapshotOf, teaserOf } from "../src/lib/compute";
import type { RawBuildingData } from "../src/lib/datasets";

const NOW = new Date("2026-10-02T12:00:00Z");

const ADDRESS: Address = {
  label: "143 WEST 4 STREET, New York, NY",
  borough: "Manhattan",
  zip: "10012",
  bin: "1008881",
  bbl: "1005520033",
  houseNumber: "143",
  street: "WEST 4 STREET",
  unit: "3FW",
  lotOnly: false,
  hpdBuildingId: null,
  lat: 40.73,
  lon: -74.0,
};

function raw(over: Partial<RawBuildingData> = {}): RawBuildingData {
  return {
    fetchedAt: NOW.toISOString(),
    hpdOpenByClass: [],
    hpdOpenItems: [],
    hpdByYear: [],
    hpdTotal: [{ n: "0" }],
    hpdComplaints12mo: [],
    hpdComplaintsOpen: [],
    hpdComplaintsByMonth: [],
    dobBisActive: [],
    dobNowActive: [],
    ecbActive: [],
    dobComplaintsActive: [],
    dobComplaintsTotal: [{ n: "0" }],
    elevators: [],
    bedbugs: [],
    registration: [],
    contacts: [],
    jurisdiction: [],
    n311: [],
    n311Total: [{ n: "0" }],
    pluto: [{ address: "143 WEST 4 STREET", yearbuilt: "1890", unitsres: "15", unitstotal: "15", numbldgs: "1", numfloors: "5.0000000", bldgclass: "C1", zonedist1: "R7-2", ownername: "A PLUS NYC REALTY LLC", version: "26v2" }],
    litigations: [],
    vacate: [],
    evictions3y: [{ n: "0" }],
    failed: [],
    ...over,
  };
}

const build = (over: Partial<RawBuildingData> = {}) => computeReport({ id: "testid123456", address: ADDRESS, raw: raw(over), sources: [], now: NOW });
const card = (r: ReturnType<typeof build>, key: string) => r.cards.find((c) => c.key === key)!;

describe("Is it safe?", () => {
  it("is good with nothing open", () => {
    const r = build();
    expect(card(r, "safe").status).toBe("good");
    expect(r.counts.openB).toBe(0);
  });

  it("is only a heads-up when open hazardous items are all stale", () => {
    const r = build({
      hpdOpenByClass: [{ class: "B", n: "7" }, { class: "A", n: "6" }],
      hpdOpenItems: [
        { class: "B", inspectiondate: "2013-01-15T00:00:00.000", apartment: "2F", novdescription: "SECTION 27-2045 ADM CODE REPAIR OR REPLACE THE SMOKE DETECTOR MISSING IN THE ENTIRE APARTMENT LOCATED AT APT 2F", rentimpairing: "N", currentstatus: "NOV CERTIFIED LATE" },
        { class: "B", inspectiondate: "2006-03-21T00:00:00.000", apartment: "4R", novdescription: "§ 27-2018 ADM CODE ABATE THE NUISANCE CONSISTING OF VERMIN MICE IN THE ENTIRE APARTMENT LOCATED AT APT 4R", rentimpairing: "N", currentstatus: "DEFECT LETTER ISSUED" },
      ],
    });
    expect(card(r, "safe").status).toBe("warn");
    expect(card(r, "safe").answer).toMatch(/stale/i);
    expect(r.counts.newestOpenHazardous).toBe("2013-01-15");
  });

  it("is critical with a recent immediately hazardous condition", () => {
    const r = build({
      hpdOpenByClass: [{ class: "C", n: "1" }],
      hpdOpenItems: [{ class: "C", inspectiondate: "2026-09-12T00:00:00.000", apartment: "D5", novdescription: "HMC ADM CODE: § 27-2017.4 ABATE THE INFESTATION CONSISTING OF ROACHES IN THE ENTIRE APARTMENT LOCATED AT APT D5, 4th STORY", rentimpairing: "N", currentstatus: "NOV SENT OUT" }],
    });
    expect(card(r, "safe").status).toBe("critical");
    expect(card(r, "safe").answer).toMatch(/roaches/i);
    expect(card(r, "pests").status).toBe("serious");
    expect(r.items[0]?.what).toMatch(/Roaches throughout the apartment/);
    expect(r.items[0]?.where).toMatch(/Apt D5/);
  });

  it("is critical under an active vacate order", () => {
    const r = build({ vacate: [{ vacate_type: "Partial", primary_vacate_reason: "Fire Damage", vacate_effective_date: "2026-01-24T00:00:00.000", actual_rescind_date: undefined }] });
    expect(card(r, "safe").status).toBe("critical");
    expect(card(r, "legal").status).toBe("critical");
    expect(r.counts.vacateActive).toBe(true);
  });
});

describe("Heat", () => {
  it("escalates with heat complaints", () => {
    expect(card(build({ hpdComplaints12mo: [{ major_category: "HEAT/HOT WATER", complaints: "2", problems: "2" }] }), "heat").status).toBe("good");
    expect(card(build({ hpdComplaints12mo: [{ major_category: "HEAT/HOT WATER", complaints: "4", problems: "4" }] }), "heat").status).toBe("warn");
    expect(card(build({ hpdComplaints12mo: [{ major_category: "HEAT/HOT WATER", complaints: "14", problems: "15" }] }), "heat").status).toBe("serious");
  });
});

describe("Landlord", () => {
  const reg = { registrationid: "100725", buildingid: "29538", lastregistrationdate: "2023-08-10T00:00:00.000", registrationenddate: "2024-09-30T00:00:00.000" };
  const contacts = [
    { type: "CorporateOwner", corporationname: "A PLUS NYC REALTY LLC", businesshousenumber: "90", businessstreetname: "BOWERY", businesscity: "NEW YORK", businesszip: "10013" },
    { type: "Agent", corporationname: "CHILITA PROPERTIES MANAGEMENT", firstname: "ERIC", lastname: "LAM" },
    { type: "HeadOfficer", firstname: "YI", lastname: "LAM" },
  ];

  it("flags a lapsed registration as serious and names the agent", () => {
    const r = build({ registration: [reg], contacts });
    expect(r.ownership.registrationState).toBe("lapsed");
    expect(card(r, "owner").status).toBe("serious");
    expect(card(r, "owner").answer).toMatch(/A PLUS NYC REALTY LLC/);
    expect(card(r, "owner").answer).toMatch(/CHILITA/);
    expect(r.address.hpdBuildingId).toBe("29538");
    expect(r.links[0]?.url).toContain("/building/29538/");
  });

  it("treats a registration due within 60 days as a grace period", () => {
    const r = build({ registration: [{ ...reg, registrationenddate: "2026-09-01T00:00:00.000" }], contacts });
    expect(r.ownership.registrationState).toBe("grace");
    expect(card(r, "owner").status).toBe("warn");
  });

  it("is neutral for a small unregistered building", () => {
    const r = build({ pluto: [{ unitsres: "2", yearbuilt: "1920", numfloors: "2", bldgclass: "B1" }] });
    expect(card(r, "owner").status).toBe("neutral");
  });
});

describe("Bedbugs", () => {
  it("flags a missing latest filing for a registered building", () => {
    const r = build({
      registration: [{ registrationid: "1", buildingid: "2", registrationenddate: "2027-09-01T00:00:00.000" }],
      bedbugs: [{ filing_date: "2024-04-19T00:00:00.000", filing_period_start_date: "2022-11-01T00:00:00.000", filling_period_end_date: "2023-10-31T00:00:00.000", of_dwelling_units: "15", infested_dwelling_unit_count: "0", eradicated_unit_count: "0", re_infested_dwelling_unit: "0" }],
    });
    expect(r.bedbugs.missingLatest).toBe(true);
    expect(card(r, "pests").status).toBe("warn");
    expect(card(r, "pests").answer).toMatch(/missing/);
  });

  it("accepts a current filing", () => {
    const r = build({
      registration: [{ registrationid: "1", buildingid: "2", registrationenddate: "2027-09-01T00:00:00.000" }],
      bedbugs: [{ filing_date: "2025-12-04T00:00:00.000", filing_period_start_date: "2024-11-01T00:00:00.000", filling_period_end_date: "2025-10-31T00:00:00.000", of_dwelling_units: "240", infested_dwelling_unit_count: "1", eradicated_unit_count: "1", re_infested_dwelling_unit: "0" }],
    });
    expect(r.bedbugs.missingLatest).toBe(false);
    expect(card(r, "pests").status).toBe("warn"); // one case reported
  });
});

describe("Elevators", () => {
  it("is N/A with no devices and serious with an active elevator summons", () => {
    expect(card(build(), "elev").status).toBe("neutral");
    const r = build({
      elevators: [{ device_number: "2P907", device_type: "Elevator", device_status: "Active", cat1_report_year: "2025", cat1_latest_report_filed: "2025-07-21T00:00:00.000", periodic_latest_inspection: "2026-03-12T00:00:00.000" }],
      ecbActive: [{ ecb_violation_number: "39205015P", issue_date: "20260922", severity: "CLASS - 2", violation_type: "Elevators", violation_description: "CAR TOP IS NOT MAINTAINED", balance_due: "625", hearing_date: "20261204", hearing_status: "PENDING" }],
    });
    expect(card(r, "elev").status).toBe("serious");
    expect(r.counts.elevatorIssues).toBe(1);
    expect(r.counts.ecbBalanceDue).toBe(625);
    expect(r.items.some((i) => i.severity === "f" && /elevator/i.test(i.what))).toBe(true);
  });
});

describe("charts, teaser, snapshots", () => {
  it("buckets violations by year and complaints by month", () => {
    const r = build({
      hpdByYear: [{ yr: "2021-01-01T00:00:00.000", class: "C", n: "30" }, { yr: "2021-01-01T00:00:00.000", class: "B", n: "20" }, { yr: "1987-01-01T00:00:00.000", class: "B", n: "1" }],
      hpdComplaintsByMonth: [{ m: "2026-05-01T00:00:00.000", n: "8" }],
    });
    expect(r.charts.years).toHaveLength(21);
    expect(r.charts.violationsByYear[r.charts.years.indexOf(2021)]).toEqual([0, 20, 30]);
    expect(r.charts.months).toHaveLength(24);
    expect(r.charts.complaintsByMonth[r.charts.months.indexOf("2026-05")]).toBe(8);
  });

  it("builds a teaser that leaks no status", () => {
    const r = build({ hpdTotal: [{ n: "238" }], hpdOpenByClass: [{ class: "C", n: "5" }] });
    const t = teaserOf(r, raw({ hpdTotal: [{ n: "238" }] }));
    expect(t.recordCounts.housingRecords).toBe(238);
    expect(JSON.stringify(t)).not.toMatch(/"status"/);
    expect(t.summaryLead.endsWith(".")).toBe(true);
  });

  it("diffs snapshots into change lines", () => {
    const a = snapshotOf(build());
    const b = snapshotOf(build({ hpdOpenByClass: [{ class: "C", n: "2" }], hpdOpenItems: [{ class: "C", inspectiondate: "2026-10-01T00:00:00.000", novdescription: "NO HEAT", apartment: "1A" }] }));
    const changes = diffSnapshots(a, b);
    expect(changes).toEqual(["Immediately hazardous conditions open: 0 → 2"]);
    expect(diffSnapshots(a, a)).toEqual([]);
  });

  it("writes a unit note that matches apartment labels loosely", () => {
    const r = build({ hpdOpenItems: [{ class: "B", inspectiondate: "2026-01-01T00:00:00.000", apartment: "3-FW", novdescription: "NO HOT WATER" }] });
    expect(r.unitNote).toMatch(/Apartment 3FW has 1 open condition/);
  });
});
