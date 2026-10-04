import { describe, expect, it } from "vitest";
import type { Address, Card } from "../shared/types";
import { snapshotOf } from "../shared/snapshot";
import { computeComplaints, computeLegal, computeProperty, computeReport, computeViolations, teaserOf } from "../src/lib/compute";
import {
  ACRIS_DOCS,
  ACTIVE_LIMITS,
  deriveDobNowActive,
  deriveEcbActive,
  deriveHpdOpenItems,
  DOB_NOW_ACTIVE_COLUMNS,
  ECB_ACTIVE_COLUMNS,
  fetchBuildingData,
  HPD_OPEN_COLUMNS,
  isCondoBillingLot,
  LEGAL_LIMITS,
  RAT_VISITS,
  VIOLATION_LIMITS,
  type RawBuildingData,
} from "../src/lib/datasets";
import type { Row } from "../src/lib/soda";

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
    hpdYear: [],
    hpdComplaints12mo: [],
    hpdComplaintsOpen: [],
    hpdComplaintsByMonth: [],
    dobBisActive: [],
    dobNowActive: [],
    ecbActive: [],
    dobComplaintsActive: [],
    dobComplaintsTotal: [{ n: "0" }],
    hpdViolationRows: [],
    dobNowRows: [],
    ecbRows: [],
    dobBisRows: [],
    hpdComplaintRows: [],
    hpdComplaintsTotal: [{ n: "0" }],
    dobComplaintRows: [],
    n311Rows: [],
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
    evictions: [],
    ratInspections: [],
    repairOrders: [],
    handymanOrders: [],
    aep: [],
    heatSensors: [],
    harassmentList: [],
    acrisDocs: [],
    taxLiens: [],
    facades: [],
    boilers: [],
    certificates: [],
    permits: [],
    asbestos: [],
    exemptions: [],
    failed: [],
    ...over,
  };
}

const build = (over: Partial<RawBuildingData> = {}) => computeReport({ id: "testid123456", address: ADDRESS, raw: raw(over), now: NOW });
const card = (r: ReturnType<typeof build>, key: string) => r.cards.find((c) => c.key === key)!;
const tableOf = (c: Card, title: string) => c.tables?.find((t) => t.title === title);

/** A live 6z8x-wfk4 row for 1130 Anderson Ave (2026-10-03), every column the evictions query selects. */
const EVICTION = {
  executed_date: "2025-11-13T00:00:00.000",
  eviction_apt_num: "A7",
  court_index_number: "B311005/22",
  docket_number: "119749",
  marshal_first_name: "Ileana",
  marshal_last_name: "Rivera",
  ejectment: "Not an Ejectment",
  eviction_possession: "Possession",
};

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

describe("charts, teaser, unit note", () => {
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
    const t = teaserOf(r, raw({ hpdTotal: [{ n: "238" }], hpdComplaintsTotal: [{ n: "571" }] }));
    expect(t.recordCounts.housingRecords).toBe(238);
    expect(t.recordCounts.housingComplaints).toBe(571);
    expect(JSON.stringify(t)).not.toMatch(/"status"/);
    expect(t.summaryLead.endsWith(".")).toBe(true);
    // The free preview gets the open count, the newest record of each kind, and who owns and manages it.
    expect(t.preview).toEqual({
      // The city's count of open housing violations by class (5 here), not just the rows in hand.
      openViolations: 5,
      violation: r.violations!.items[0] ?? null,
      complaint: r.complaints.items[0] ?? null,
      legal: r.legal!.items[0] ?? null,
      owner: r.ownership.registeredOwner ?? r.cover.plutoOwner ?? null,
      managedBy: r.ownership.managingAgent ?? null,
    });
  });

  it("writes a unit note that matches apartment labels loosely", () => {
    const r = build({ hpdOpenItems: [{ class: "B", inspectiondate: "2026-01-01T00:00:00.000", apartment: "3-FW", novdescription: "NO HOT WATER" }] });
    expect(r.unitNote).toMatch(/Apartment 3FW has 1 open condition/);
  });
});

describe("complaint history", () => {
  const hpd = (complaint_id: string, problem_id: string, over: Record<string, string> = {}) => ({
    complaint_id,
    problem_id,
    received_date: "2026-01-10T09:00:00.000",
    type: "NON EMERGENCY",
    complaint_status: "CLOSE",
    complaint_status_date: "2026-01-20T10:00:00.000",
    apartment: "3B",
    unit_type: "APARTMENT",
    space_type: "KITCHEN",
    ...over,
  });

  it("groups HPD problems into one complaint per complaint_id", () => {
    const h = computeComplaints(
      raw({
        hpdComplaintRows: [
          hpd("100", "1", { major_category: "HEAT/HOT WATER", minor_category: "APARTMENT ONLY", problem_code: "NO HEAT", type: "EMERGENCY", space_type: "ENTIRE APARTMENT", status_description: "First problem outcome." }),
          hpd("100", "2", { major_category: "UNSANITARY CONDITION", minor_category: "PESTS", problem_code: "MICE", space_type: "ENTIRE APARTMENT" }),
          hpd("100", "3", { major_category: "UNSANITARY CONDITION", minor_category: "PESTS", problem_code: "ROACHES", space_type: "ENTIRE APARTMENT" }),
          hpd("100", "4", { major_category: "WATER LEAK", minor_category: "SLOW LEAK", problem_code: "AT WALL OR CEILING", space_type: "ENTIRE APARTMENT", status_description: "Violations were issued." }),
          hpd("100", "5", { major_category: "UNSANITARY CONDITION", minor_category: "MOLD", problem_code: "N/A", space_type: "ENTIRE APARTMENT" }),
          // Same headline twice counts once.
          hpd("100", "6", { major_category: "UNSANITARY CONDITION", minor_category: "PESTS", problem_code: "MICE", space_type: "ENTIRE APARTMENT" }),
          hpd("150", "9", { received_date: "2026-01-05T00:00:00.000", major_category: "GARBAGE", minor_category: "X", unit_type: "", space_type: "" }),
          hpd("150", "10", { received_date: "2026-01-05T00:00:00.000", major_category: "OUTSIDE BUILDING", minor_category: "ROOF DOOR/HATCH", problem_code: "BROKEN", unit_type: "", space_type: "" }),
          hpd("200", "7", {
            received_date: "2025-12-01T08:00:00.000",
            complaint_status: "OPEN",
            major_category: "HEAT/HOT WATER",
            minor_category: "ENTIRE BUILDING",
            problem_code: "NO HEAT AND NO HOT WATER",
            apartment: "BUILDI",
            unit_type: "BUILDING-WIDE",
            space_type: "BUILDING-WIDE",
          }),
          hpd("300", "8", { received_date: "2025-11-01T08:00:00.000", major_category: "GENERAL", minor_category: "MAILBOX", problem_code: "BOX BROKEN OR MISSING", apartment: "2NDFLO", unit_type: "PUBLIC AREA", space_type: "LOBBY" }),
        ],
      }),
      NOW,
    );
    expect(h.items.map((c) => c.id)).toEqual(["100", "150", "200", "300"]);
    const [a, mixed, b, c] = h.items;
    // Title-cased fallbacks keep their capitals mid-list; no unit_type or space_type falls back to the apartment.
    expect(mixed).toMatchObject({ what: "X and Roof Door/Hatch: Broken", where: "Apt 3B" });
    expect(a).toMatchObject({
      source: "hpd",
      date: "2026-01-10",
      what: "No heat, mice, roaches and 2 more",
      where: "Apt 3B · whole apartment",
      status: "closed",
      closedAt: "2026-01-20",
      outcome: "Violations were issued.",
      emergency: true,
    });
    expect(a?.original).toMatch(/EMERGENCY: HEAT\/HOT WATER \/ APARTMENT ONLY \/ NO HEAT/);
    expect(b).toMatchObject({ what: "No heat or hot water", where: "Whole building", status: "open", closedAt: null, emergency: false, outcome: "" });
    expect(c).toMatchObject({ what: "Broken mailbox", where: "Public area · lobby" });
    // The same places as data, for grouping: the apartment normalised, or the kind of space.
    expect([a, mixed, b, c].map((x) => [x?.area, x?.unit])).toEqual([
      ["apartment", "3B"],
      ["apartment", "3B"],
      ["building", undefined],
      ["common", undefined],
    ]);
  });

  it("places a complaint about an apartment and a public area in the apartment, and one with no apartment number in no unit", () => {
    const h = computeComplaints(
      raw({
        hpdComplaintRows: [
          hpd("1", "1", { apartment: "APT3A", unit_type: "APARTMENT", space_type: "BATHROOM", major_category: "PLUMBING" }),
          hpd("1", "2", { apartment: "APT3A", unit_type: "PUBLIC AREA", space_type: "LOBBY", major_category: "GENERAL" }),
          hpd("2", "3", { apartment: "", unit_type: "APARTMENT", space_type: "KITCHEN", major_category: "PLUMBING" }),
        ],
      }),
      NOW,
    );
    expect(h.items.find((x) => x.id === "1")).toMatchObject({ where: "Apt 3A, public area", area: "apartment", unit: "3A" });
    const none = h.items.find((x) => x.id === "2")!;
    expect(none).toMatchObject({ where: "Apartment · kitchen", area: "apartment" });
    expect(none).not.toHaveProperty("unit");
  });

  it("parses DOB MM/DD/YYYY dates and sorts by them, not by complaint number", () => {
    const h = computeComplaints(
      raw({
        dobComplaintRows: [
          { complaint_number: "2449043", status: "CLOSED", date_entered: "08/26/2026", complaint_category: "6S", unit: "ELEVR", disposition_date: "09/22/2026", disposition_code: "A8", inspection_date: "09/22/2026" },
          { complaint_number: "2405980", status: "ACTIVE", date_entered: "12/08/2024", complaint_category: "45", unit: "BRONX" },
          { complaint_number: "2433742", status: "CLOSED", date_entered: "02/05/2027", complaint_category: "7R", unit: "OBM" },
        ],
      }),
      NOW,
    );
    expect(h.items.map((c) => [c.id, c.date])).toEqual([
      ["2433742", "2027-02-05"],
      ["2449043", "2026-08-26"],
      ["2405980", "2024-12-08"],
    ]);
    const elev = h.items.find((c) => c.id === "2449043")!;
    expect(elev).toMatchObject({ what: "Elevator: Single Device on Property/No Alternate Service", where: "Building", area: "building", status: "closed", closedAt: "2026-09-22", outcome: "Disposition: A8", emergency: false });
    expect(elev.original).toMatch(/DOB unit ELEVR/);
    expect(h.items.find((c) => c.id === "2405980")).toMatchObject({ what: "Illegal Conversion", status: "open", closedAt: null, outcome: "" });
    expect(h.items.find((c) => c.id === "2433742")?.what).toBe("Buildings complaint (code 7R)");
  });

  it("says noise is reported at or near the address and names the agency", () => {
    const h = computeComplaints(
      raw({
        n311Rows: [
          { unique_key: "1", created_date: "2026-08-29T01:01:28.000", closed_date: "2026-08-29T03:03:43.000", agency: "NYPD", complaint_type: "Noise - Residential", descriptor: "Loud Music/Party", location_type: "Residential Building/House", status: "Closed", resolution_description: "Police responded." },
          { unique_key: "2", created_date: "2026-07-28T15:50:26.000", agency: "DEP", complaint_type: "Water System", descriptor: "Fire Hydrant Emergency (FHE)", descriptor_2: "FHE", status: "In Progress" },
          { unique_key: "3", created_date: "2026-07-01T10:00:00.000", agency: "DSNY", complaint_type: "Dirty Condition", descriptor: "Trash", descriptor_2: "Littering", location_type: "Sidewalk", status: "Closed" },
        ],
      }),
      NOW,
    );
    const [noise, water, trash] = h.items;
    expect(noise).toMatchObject({ source: "311", what: "Police: Noise - Residential, Loud Music/Party", where: "Reported at or near this address", status: "closed", closedAt: "2026-08-29", outcome: "Police responded." });
    expect(water).toMatchObject({ what: "Environmental Protection: Water System, Fire Hydrant Emergency (FHE)", where: "This lot", status: "open", closedAt: null });
    expect(trash).toMatchObject({ what: "Sanitation: Dirty Condition, Trash, Littering", where: "Sidewalk" });
    // 311 is never an apartment: noise and the street are around the building.
    expect([noise, water, trash].map((x) => x?.area)).toEqual(["around", "around", "around"]);
    const home = computeComplaints(raw({ n311Rows: [{ unique_key: "4", created_date: "2026-07-01T10:00:00.000", agency: "DOHMH", complaint_type: "Rodent", descriptor: "Mouse Sighting", location_type: "3+ Family Apt. Building", status: "Closed" }] }), NOW);
    expect(home.items[0]).toMatchObject({ area: "building" });
    expect(home.items[0]).not.toHaveProperty("unit");
  });

  it("merges all three sources newest first with undated items last", () => {
    const h = computeComplaints(
      raw({
        hpdComplaintRows: [hpd("10", "1", { received_date: "2026-03-01T00:00:00.000", major_category: "UNSANITARY CONDITION", minor_category: "MOLD" })],
        dobComplaintRows: [
          { complaint_number: "1", status: "CLOSED", date_entered: "", complaint_category: "73" },
          { complaint_number: "2", status: "CLOSED", date_entered: "05/01/2026", complaint_category: "73" },
        ],
        n311Rows: [{ unique_key: "9", created_date: "2026-04-01T00:00:00.000", agency: "DOHMH", complaint_type: "Rodent", descriptor: "Rat Sighting", status: "Closed" }],
      }),
      NOW,
    );
    expect(h.items.map((c) => `${c.source}:${c.id}:${c.date}`)).toEqual(["dob:2:2026-05-01", "311:9:2026-04-01", "hpd:10:2026-03-01", "dob:1:null"]);
    expect(h.since).toBe("2021-10-02");
    expect(h.items[1]?.what).toBe("Health Dept: Rodent, Rat Sighting");
  });

  it("flags a source as truncated when its query returned exactly the limit, and carries lifetime totals", () => {
    const many = Array.from({ length: 1000 }, (_, i) => hpd(String(i), String(i)));
    const h = computeComplaints(
      raw({
        hpdComplaintRows: many,
        dobComplaintRows: [{ complaint_number: "1", status: "CLOSED", date_entered: "01/01/2020", complaint_category: "45" }],
        hpdComplaintsTotal: [{ n: "1500" }],
        dobComplaintsTotal: [{ n: "1" }],
        n311Total: [{ n: "684" }],
      }),
      NOW,
    );
    expect(h.truncated).toEqual({ hpd: true, dob: false, n311: false });
    expect(h.totals).toEqual({ hpd: 1500, dob: 1, n311: 684 });
    expect(h.items).toHaveLength(1001);
    const full = build({ n311Rows: Array.from({ length: 500 }, (_, i) => ({ unique_key: String(i), created_date: "2026-01-01T00:00:00.000", agency: "NYPD", complaint_type: "Illegal Parking", status: "Closed" })) });
    expect(full.complaints.truncated).toEqual({ hpd: false, dob: false, n311: true });
  });
});

describe("Is it noisy?", () => {
  const noise = (complaint_type: string, n: string, agency = "NYPD") => ({ agency, complaint_type, n });

  it("is good under 10 noise complaints, a heads-up from 10, and never worse", () => {
    const quiet = card(build({ n311: [noise("Noise - Residential", "3"), { agency: "HPD", complaint_type: "HEAT/HOT WATER", n: "40" }] }), "noise");
    expect(quiet.status).toBe("good");
    expect(quiet.question).toBe("Is it noisy?");
    expect(quiet.answer).toBe("3 noise complaints reported at or near this address in the last 12 months, mostly noise from apartments or houses.");

    const loud = card(build({ n311: [noise("Noise - Residential", "3"), noise("Noise - Street/Sidewalk", "8"), noise("Noise", "3", "DEP"), noise("Noise - Vehicle", "300")] }), "noise");
    expect(loud.status).toBe("warn");
    expect(loud.label).toBe("Heads up");
    expect(loud.answer).toMatch(/^314 noise complaints .* mostly vehicle noise\.$/);
    expect(loud.details).toEqual([
      "Vehicle noise: 300 complaints",
      "Street and sidewalk noise: 8 complaints",
      "Noise from apartments or houses: 3 complaints",
      "Construction, equipment or alarm noise: 3 complaints",
      "311 noise reports cover the whole lot and the address the caller gave, so some are about neighbors or the street.",
    ]);
  });

  it("says so when there are none, and is N/A when 311 failed to load", () => {
    const none = card(build(), "noise");
    expect(none).toMatchObject({ status: "good", answer: "No noise complaints reported at or near this address in the last 12 months.", details: [] });
    expect(card(build({ failed: ["n311"] }), "noise").status).toBe("neutral");
  });

  it("is the seventh question, in the teaser too", () => {
    const r = build();
    expect(r.cards.map((c) => c.key)).toEqual(["safe", "heat", "pests", "elev", "owner", "legal", "noise"]);
    expect(teaserOf(r, raw()).questions.at(-1)).toEqual({ key: "noise", question: "Is it noisy?" });
  });
});

describe("What's on file right now", () => {
  const hpdRow = (i: number, cls: string, over: Record<string, string> = {}) => ({
    violationid: String(1000 + i),
    class: cls,
    inspectiondate: "2026-01-15T00:00:00.000",
    novissueddate: "2026-01-20T00:00:00.000",
    apartment: "2F",
    novdescription: "§ 27-2005 ADM CODE PROPERLY REPAIR THE BROKEN PLASTER IN THE KITCHEN LOCATED AT APT 2F",
    currentstatus: "NOV SENT OUT",
    ...over,
  });

  it("lists every fetched row with no caps, most serious first, bedbug notices once", () => {
    const r = build({
      hpdOpenItems: [
        ...Array.from({ length: 20 }, (_, i) => hpdRow(i, i % 2 ? "B" : "C")),
        ...Array.from({ length: 4 }, (_, i) => hpdRow(100 + i, "A")),
        hpdRow(200, "A", { novdescription: "§ 27-2018.1 ADM CODE FILE ANNUAL BEDBUG REPORT WITH HPD", apartment: "BLDG" }),
        hpdRow(201, "I", { novdescription: "SECTION D26-41.01 ADM CODE FILE A VALID REGISTRATION STATEMENT WITH THE DEPARTMENT", apartment: "BLDG" }),
      ],
      ecbActive: Array.from({ length: 8 }, (_, i) => ({ ecb_violation_number: `3920501${i}P`, issue_date: "20260922", severity: "CLASS - 2", violation_type: "Elevators", violation_description: "CAR TOP NOT MAINTAINED", balance_due: "1250", penality_imposed: "1250", hearing_status: "PENDING" })),
      dobNowActive: Array.from({ length: 7 }, (_, i) => ({ violation_number: `VIO-${i}`, violation_type: "FTC-VT-CAT1-CO", violation_remarks: "Failure to file", violation_issue_date: "2025-12-01T00:00:00.000" })),
      dobBisActive: Array.from({ length: 9 }, (_, i) => ({ number: `V0${i}`, violation_type: "E-ELEVATOR", issue_date: "20240101", description: "ELEVATOR" })),
    });
    expect(r.items).toHaveLength(20 + 8 + 7 + 9 + 4 + 2);
    expect(r.items.map((i) => i.severity).join("")).toBe(`${"cb".repeat(10)}${"f".repeat(24)}aaaapp`);
    expect(r.items.filter((i) => /bedbug/i.test(i.what))).toHaveLength(1);
    expect(r.items.some((i) => /more open|not listed here/i.test(i.what))).toBe(false);
    expect(r.itemsTruncated).toBeNull();

    const hpd = r.items[0]!;
    expect(hpd).toMatchObject({ date: "2026-01-15", noticeDate: "2026-01-20", ref: "HPD violation 1000", state: "open · nov sent out" });
    const ecb = r.items.find((i) => i.ref === "ECB 39205010P")!;
    expect(ecb.state).toBe("pending · fine $1,250 · $1,250 unpaid");
    expect(ecb.original).toBe("CLASS - 2: CAR TOP NOT MAINTAINED");
    expect(r.items.find((i) => i.ref === "DOB VIO-3")?.original).toBe("Failure to file");
    expect(r.items.find((i) => i.ref === "DOB V05")?.original).toBe("E-ELEVATOR ELEVATOR");
    expect(r.items.at(-1)).toMatchObject({ severity: "p", ref: "HPD violation 1201" });
  });

  it("says how many open violations it shows when the query hit its limit", () => {
    const r = build({
      hpdOpenByClass: [{ class: "A", n: "120" }, { class: "B", n: "250" }, { class: "C", n: "64" }],
      hpdOpenItems: Array.from({ length: 300 }, (_, i) => hpdRow(i, "B")),
    });
    expect(r.items).toHaveLength(300);
    expect(r.itemsTruncated).toEqual({ shown: 300, total: 434 });
  });
});

describe("Legal details", () => {
  it("counts eviction rows, lists every case with respondent and penalty, and vacated units", () => {
    const r = build({
      evictions: [EVICTION, { executed_date: "2025-03-03T00:00:00.000", eviction_apt_num: "D5" }, { executed_date: "2024-02-06T00:00:00.000" }],
      litigations: [
        { casetype: "Tenant Action", caseopendate: "2026-08-28T00:00:00.000", casestatus: "PENDING", respondent: "1130 SHEVA REALTY HDFC INCORPORATED,LANGSAM PROPERTY SERVICES CORPORATION" },
        ...Array.from({ length: 4 }, (_, i) => ({ casetype: "Heat and Hot Water", caseopendate: `201${i}-04-03T00:00:00.000`, casestatus: "CLOSED", penalty: i === 0 ? "5000" : "0" })),
      ],
      vacate: [{ vacate_type: "Partial", primary_vacate_reason: "Fire Damage", vacate_effective_date: "2022-01-24T00:00:00.000", actual_rescind_date: "2023-04-13T00:00:00.000", number_of_vacated_units: "5" }],
    });
    expect(r.counts.evictions3y).toBe(3);
    const legal = card(r, "legal");
    expect(legal.answer).toMatch(/3 evictions carried out in the last 3 years/);
    expect(legal.details).toContain("Tenant Action opened Aug 28, 2026: pending, against 1130 SHEVA REALTY HDFC INCORPORATED, LANGSAM PROPERTY SERVICES CORPORATION");
    expect(legal.details).toContain("Heat and Hot Water opened Apr 3, 2010: closed, penalty $5,000");
    expect(legal.details).toContain("Heat and Hot Water opened Apr 3, 2011: closed");
    expect(legal.details.filter((d) => / opened /.test(d))).toHaveLength(5);
    expect(legal.details).toContain("Partial vacate order (Fire Damage) effective Jan 24, 2022, 5 apartments vacated, lifted Apr 13, 2023");
    expect(legal.details.filter((d) => d.startsWith("Eviction carried out"))).toEqual(["Eviction carried out Nov 13, 2025, apt A7", "Eviction carried out Mar 3, 2025, apt D5", "Eviction carried out Feb 6, 2024"]);
  });
});

describe("legal history", () => {
  const CASES: Row[] = [
    { casetype: "Tenant Action", caseopendate: "2026-08-28T00:00:00.000", casestatus: "PENDING", respondent: "1130 SHEVA REALTY HDFC INCORPORATED,LANGSAM PROPERTY SERVICES CORPORATION" },
    { casetype: "Heat and Hot Water", caseopendate: "2015-03-26T00:00:00.000", casestatus: "CLOSED", findingofharassment: "No Harassment", penalty: "5000" },
  ];
  const VACATES: Row[] = [
    { vacate_type: "Partial", primary_vacate_reason: "Fire Damage", vacate_effective_date: "2022-01-24T00:00:00.000", actual_rescind_date: "2023-04-13T00:00:00.000", number_of_vacated_units: "5" },
    { vacate_type: "Entire Building", primary_vacate_reason: "Habitability", vacate_effective_date: "2026-09-01T00:00:00.000" },
  ];

  it("lists every case, order and eviction as its own record, newest first, with every field", () => {
    const h = computeLegal(raw({ litigations: CASES, vacate: VACATES, evictions: [EVICTION, { executed_date: "2024-02-06T00:00:00.000" }] }));
    expect(h.items.map((x) => [x.kind, x.what, x.date, x.status])).toEqual([
      ["vacate", "Vacate order: Habitability", "2026-09-01", "open"],
      ["case", "Court case: Tenant Action", "2026-08-28", "open"],
      ["eviction", "Eviction carried out", "2025-11-13", "closed"],
      ["eviction", "Eviction carried out", "2024-02-06", "closed"],
      ["vacate", "Vacate order: Fire damage", "2022-01-24", "closed"],
      ["case", "Court case: Heat and Hot Water", "2015-03-26", "closed"],
    ]);
    expect(h.items[1]!.facts).toEqual([
      ["Status", "Pending"],
      ["Opened", "2026-08-28"],
      ["Type", "Tenant Action"],
      ["Against", "1130 SHEVA REALTY HDFC INCORPORATED, LANGSAM PROPERTY SERVICES CORPORATION"],
      ["From", "Housing court cases (HPD)"],
    ]);
    expect(h.items[5]!.facts).toContainEqual(["Penalty", "$5,000"]);
    expect(h.items[5]!.facts).toContainEqual(["Harassment finding", "No Harassment"]);
    expect(h.items[0]!.facts).toEqual([
      ["Status", "Still in effect"],
      ["Effective", "2026-09-01"],
      ["Type", "Entire Building"],
      ["Reason", "Habitability"],
      ["From", "Vacate orders (HPD)"],
    ]);
    expect(h.items[4]).toMatchObject({ closedAt: "2023-04-13", where: "Part of the building", area: "building" });
    expect(h.items[4]!.facts).toContainEqual(["Apartments vacated", "5"]);
    expect(h.truncated).toEqual({ cases: false, evictions: false });
    expect(h.unavailable).toEqual([]);
  });

  it("places an eviction in its apartment, and in no numbered one when the city gives none", () => {
    const h = computeLegal(raw({ evictions: [EVICTION, { executed_date: "2024-02-06T00:00:00.000" }] }));
    expect(h.items[0]).toMatchObject({ where: "Apt A7", area: "apartment", unit: "A7" });
    expect(h.items[0]!.facts.map(([k]) => k)).toEqual(["Carried out", "Apartment", "Type", "Court index no.", "Docket", "Marshal", "From"]);
    expect(h.items[1]).toMatchObject({ where: "", area: "apartment" });
    expect(h.items[1]).not.toHaveProperty("unit");
  });

  it("says when a list hit its limit or a source failed, and is on the report", () => {
    const many = Array.from({ length: LEGAL_LIMITS.cases }, (_, i) => ({ casetype: "Tenant Action", caseopendate: `20${10 + i}-01-01T00:00:00.000`, casestatus: "CLOSED" }));
    expect(computeLegal(raw({ litigations: many })).truncated.cases).toBe(true);
    expect(computeLegal(raw({ failed: ["litigations", "evictions"] })).unavailable).toEqual(["case", "eviction"]);
    expect(computeLegal(raw()).items).toEqual([]);
    expect(build({ litigations: CASES }).legal?.items).toHaveLength(2);
  });
});

describe("Pests, elevator and landlord details", () => {
  it("lists the earlier bedbug filings", () => {
    const filing = (filed: string, end: string, infested: string) => ({ filing_date: filed, filling_period_end_date: end, of_dwelling_units: "42", infested_dwelling_unit_count: infested, eradicated_unit_count: infested, re_infested_dwelling_unit: "0" });
    const r = build({
      registration: [{ registrationid: "1", buildingid: "2", registrationenddate: "2027-09-01T00:00:00.000" }],
      bedbugs: [filing("2025-12-03T00:00:00.000", "2025-10-31T00:00:00.000", "0"), filing("2024-12-10T00:00:00.000", "2024-10-31T00:00:00.000", "2"), filing("2023-12-01T00:00:00.000", "2023-10-31T00:00:00.000", "0")],
    });
    expect(card(r, "pests").details).toEqual(
      expect.arrayContaining([
        "Earlier bedbug report, year ending Oct 31, 2024: 2 infested, 2 treated, 0 re-infested (filed Dec 10, 2024)",
        "Earlier bedbug report, year ending Oct 31, 2023: 0 infested, 0 treated, 0 re-infested (filed Dec 1, 2023)",
      ]),
    );
  });

  it("adds the five-year test date and the other devices on file", () => {
    const elevator = { device_number: "2P907", device_type: "Elevator", device_status: "Active", cat1_report_year: "2025", cat1_latest_report_filed: "2025-07-21T00:00:00.000", cat5_latest_report_filed: "2024-02-01T00:00:00.000", periodic_latest_inspection: "2026-03-12T00:00:00.000" };
    const others = [
      { device_number: "2L100", device_type: "Accessibility Lift", device_status: "Active" },
      { device_number: "2P908", device_type: "Elevator", device_status: "Removed" },
      { device_number: "2D001", device_type: "Dumbwaiter", device_status: "Removed" },
    ];
    const r = build({ elevators: [elevator, ...others] });
    expect(card(r, "elev").details).toEqual([
      "Device 2P907: inspected Mar 12, 2026, Cat 1 test filed Jul 21, 2025, five-year (Cat 5) test filed Feb 1, 2024",
      "Accessibility lift 2L100: active",
      "Elevator 2P908: removed",
    ]);
    expect(r.cover.elevators).toBe(1);

    const none = card(build({ elevators: others }), "elev");
    expect(none.status).toBe("neutral");
    expect(none.answer).toMatch(/^No elevators on file/);
    expect(none.details).toEqual(["Accessibility lift 2L100: active", "Elevator 2P908: removed"]);
  });

  it("lists every other registration contact once, with the program and record status", () => {
    const r = build({
      registration: [{ registrationid: "209634", buildingid: "45427", registrationenddate: "2027-09-01T00:00:00.000" }],
      contacts: [
        { type: "CorporateOwner", contactdescription: "INC", corporationname: "1130 SHEVA REALTY HDFC, INC", businesshousenumber: "1601", businessstreetname: "BRONXDALE AVENUE", businesscity: "BRONX", businessstate: "NY", businesszip: "10462" },
        { type: "Agent", contactdescription: "INC", corporationname: "LANGSAM PROPERTY SERVICES CORP", firstname: "GREG", lastname: "GADSON", businesshousenumber: "1601", businessstreetname: "BRONXDALE AVENUE", businesscity: "BRONX", businessstate: "NY", businesszip: "10462" },
        { type: "HeadOfficer", contactdescription: "INC", firstname: "MARK", lastname: "ENGEL" },
        { type: "Officer", contactdescription: "INC", firstname: "Mark", lastname: "Engel" },
        { type: "Shareholder", contactdescription: "INC", firstname: "ANNA", lastname: "ROSE", businesshousenumber: "9", businessstreetname: "MAIN ST", businesscity: "HOBOKEN", businessstate: "NJ", businesszip: "07030" },
        { type: "Lessee", contactdescription: "CORP", corporationname: "BASEMENT LAUNDRY LLC" },
        { type: "Shareholder", firstname: "ANNA", lastname: "ROSE" },
      ],
      jurisdiction: [{ buildingid: "45427", managementprogram: "M-L (STATE)", legalclassb: "12", recordstatus: "Pending" }],
    });
    const d = card(r, "owner").details;
    expect(d).toContain("Business address: 1601 BRONXDALE AVENUE BRONX NY 10462");
    expect(d).toContain("Shareholder: ANNA ROSE, 9 MAIN ST HOBOKEN NJ 07030");
    expect(d).toContain("Lessee: BASEMENT LAUNDRY LLC");
    expect(d.filter((x) => /ANNA ROSE/.test(x))).toHaveLength(1);
    expect(d.some((x) => x.startsWith("Officer:"))).toBe(false); // same person as the head officer
    expect(d).toContain("City housing program: Mitchell-Lama (state-supervised)");
    expect(d).toContain("12 hotel or single-room units (rooms without their own kitchen and bath) on the city's records");
    expect(d).toContain("The housing department lists this building's record as pending");
  });
});

describe("cover extras", () => {
  it("adds class family, DOB class, land use, condo and program", () => {
    const r = build({
      pluto: [{ yearbuilt: "1928", yearalter1: "1985", yearalter2: "0", unitsres: "42", unitstotal: "44", numfloors: "6", bldgclass: "D1", landuse: "3", zonedist1: "R7-1", condono: "1645", histdist: "Grand Concourse Historic District" }],
      jurisdiction: [{ buildingid: "45427", dobbuildingclass: "OLD  LAW TENEMENT", managementprogram: "PVT", recordstatus: "Active" }],
    });
    expect(r.cover).toMatchObject({
      yearAltered: 1985,
      buildingClass: "D1",
      buildingClassName: "Elevator apartments",
      dobClass: "Old law tenement",
      landUse: "Elevator apartments",
      condo: true,
      housingProgram: "Private",
      housingProgramCode: "PVT",
    });
    expect(card(r, "owner").details).toContain("City housing program: Private");
    expect(card(r, "owner").details.some((x) => /record as/.test(x))).toBe(false);
  });

  it("drops a DOB class that says nothing new, maps known programs and title-cases unknown ones", () => {
    const cover = (j: Record<string, string>, p: Record<string, string> = { bldgclass: "C1" }) => build({ pluto: [p], jurisdiction: [j] }).cover;
    expect(cover({ dobbuildingclass: "NOT AVAILABLE" }).dobClass).toBeNull();
    expect(cover({ dobbuildingclass: "WALK-UP APARTMENTS" }).dobClass).toBeNull();
    expect(cover({ managementprogram: "NYCHA" }).housingProgram).toBe("Public housing (NYCHA)");
    expect(cover({ managementprogram: "7A" }).housingProgram).toBe("Court-appointed 7A administrator");
    expect(cover({ managementprogram: "DRES RES PRO" }).housingProgram).toBe("Dres Res Pro");
    expect(cover({ managementprogram: "UNDEFINED" }).housingProgram).toBeNull();
    expect(cover({}, { condono: "0", landuse: "11" })).toMatchObject({ condo: false, landUse: "Vacant land", buildingClassName: null, housingProgram: null });
  });
});

describe("card tables", () => {
  it("is it safe: open conditions by severity, buildings department and city fines, the date range", () => {
    const r = build({
      hpdOpenByClass: [{ class: "C", n: "1" }, { class: "B", n: "2" }, { class: "A", n: "3" }, { class: "I", n: "1" }],
      hpdOpenItems: [
        { class: "C", inspectiondate: "2026-09-12T00:00:00.000", apartment: "D5", novdescription: "NO HEAT", rentimpairing: "Y" },
        { class: "B", inspectiondate: "2024-05-01T00:00:00.000", apartment: "2F", novdescription: "BROKEN PLASTER" },
      ],
      dobBisActive: [{ number: "V01", violation_type: "LL6291-LOCAL LAW 62/91 BOILER", issue_date: "20240101" }],
      ecbActive: [{ ecb_violation_number: "1P", issue_date: "20260922", violation_type: "Elevators", balance_due: "625" }],
    });
    const safe = card(r, "safe");
    expect(safe.tables?.map((t) => t.title)).toEqual(["Open conditions", "Buildings department and city fines"]);
    const open = tableOf(safe, "Open conditions")!;
    expect(open.columns).toEqual(["Severity", "Open"]);
    expect(open.rows).toEqual([
      ["Immediately hazardous (class C)", "1"],
      ["Hazardous (class B)", "2"],
      ["Minor (class A)", "3"],
      ["Paperwork notices (class I)", "1"],
      ["Rent-impairing", "1"],
    ]);
    const fines = tableOf(safe, "Buildings department and city fines")!;
    expect(fines.columns).toEqual(["Type", "Active", "Unpaid"]);
    expect(fines.rows).toContainEqual(["Buildings department violations (BIS)", "1", "–"]);
    expect(fines.rows).toContainEqual(["Buildings department violations (DOB NOW)", "0", "–"]);
    expect(fines.rows).toContainEqual(["City summonses", "1", "$625"]);
    expect(safe.notes).toEqual(["Open hazardous items date from May 1, 2024 to Sep 12, 2026"]);
    // details are unchanged for the AI summary
    expect(safe.details[0]).toBe("1 immediately hazardous, 2 hazardous, 3 minor conditions open");
  });

  it("omits a table with no rows: nothing open, no cases, no filings, no devices, no noise", () => {
    const r = build();
    for (const key of ["safe", "pests", "elev", "legal", "noise", "heat", "owner"]) expect(card(r, key).tables, key).toEqual([]);
    expect(card(r, "noise").notes).toEqual([]);
    expect(card(r, "legal").notes).toEqual([]);
    // Only the open minor items: the severity table shows, the fines table does not.
    const minor = card(build({ hpdOpenByClass: [{ class: "A", n: "2" }] }), "safe");
    expect(minor.tables?.map((t) => t.title)).toEqual(["Open conditions"]);
    // A stale building gets the stale note.
    const stale = card(build({ hpdOpenByClass: [{ class: "B", n: "1" }], hpdOpenItems: [{ class: "B", inspectiondate: "2013-01-15T00:00:00.000", novdescription: "X" }] }), "safe");
    expect(stale.notes?.[1]).toMatch(/until the landlord certifies the repair or the city reinspects/);
  });

  it("heat: one row per complaint category from the 12-month aggregate, in plain words", () => {
    const heat = card(
      build({
        hpdComplaints12mo: [
          { major_category: "HEAT/HOT WATER", complaints: "4", problems: "5" },
          { major_category: "UNSANITARY CONDITION", complaints: "2", problems: "3" },
          { major_category: "LINE OF TRAVEL", complaints: "1", problems: "1" },
        ],
        hpdComplaintsOpen: [{ received_date: "2026-09-01T00:00:00.000" }],
      }),
      "heat",
    );
    const t = tableOf(heat, "Complaints in the last 12 months")!;
    expect(t.columns).toEqual(["Category", "Complaints", "Problems"]);
    expect(t.rows).toEqual([
      ["Heat and hot water", "4", "5"],
      ["Unsanitary conditions (pests, mold, garbage)", "2", "3"],
      ["Line of travel", "1", "1"],
    ]);
    expect(heat.notes).toEqual(["1 complaint open today", "Heat complaints cluster in winter; check the monthly chart"]);
  });

  it("pests: every bedbug filing fetched and the open pest violations", () => {
    const filing = (filed: string, end: string, infested: string) => ({ filing_date: filed, filling_period_end_date: end, of_dwelling_units: "42", infested_dwelling_unit_count: infested, eradicated_unit_count: infested, re_infested_dwelling_unit: "0" });
    const pests = card(
      build({
        registration: [{ registrationid: "1", buildingid: "2", registrationenddate: "2027-09-01T00:00:00.000" }],
        bedbugs: [filing("2025-12-03T00:00:00.000", "2025-10-31T00:00:00.000", "0"), filing("2024-12-10T00:00:00.000", "2024-10-31T00:00:00.000", "2"), { filing_date: "2023-12-01T00:00:00.000" }],
        hpdOpenItems: [
          { class: "C", inspectiondate: "2026-09-12T00:00:00.000", apartment: "D5", novdescription: "HMC ADM CODE: § 27-2017.4 ABATE THE INFESTATION CONSISTING OF ROACHES IN THE ENTIRE APARTMENT LOCATED AT APT D5, 4th STORY" },
          { class: "A", inspectiondate: "2025-01-02T00:00:00.000", apartment: "BLDG", novdescription: "§ 27-2018.1 ADM CODE FILE ANNUAL BEDBUG REPORT WITH HPD" },
        ],
      }),
      "pests",
    );
    const bb = tableOf(pests, "Bedbug reports filed by the landlord")!;
    expect(bb.columns).toEqual(["Year ending", "Filed", "Apartments", "Infested", "Treated", "Re-infested"]);
    expect(bb.rows).toHaveLength(3);
    expect(bb.rows[1]).toEqual(["Oct 31, 2024", "Dec 10, 2024", "42", "2", "2", "0"]);
    expect(bb.rows[2]).toEqual(["–", "Dec 1, 2023", "–", "–", "–", "–"]);
    const open = tableOf(pests, "Open pest violations")!;
    expect(open.columns).toEqual(["What", "Apartment", "Inspected"]);
    expect(open.rows).toEqual([[expect.stringMatching(/roaches/i), "D5", "Sep 12, 2026"]]);
    expect(pests.notes?.[0]).toBe("Bedbug counts are self-reported by the owner");
    expect(pests.notes).toContain("The city has cited the landlord 1 time for not filing the bedbug report (latest Jan 2, 2025)");
  });

  it("elevators: every device row, active or not, and the open elevator issues", () => {
    const elevator = { device_number: "2P907", device_type: "Elevator", device_status: "Active", cat1_report_year: "2025", cat1_latest_report_filed: "2025-07-21T00:00:00.000", cat5_latest_report_filed: "2024-02-01T00:00:00.000", periodic_latest_inspection: "2026-03-12T00:00:00.000" };
    const others = [
      { device_number: "2D001", device_type: "DUMBWAITER", device_status: "Removed" },
      { device_number: "2L100", device_type: "Accessibility Lift", device_status: "Active" },
    ];
    const elev = card(
      build({
        elevators: [...others, elevator],
        ecbActive: [{ ecb_violation_number: "39205015P", issue_date: "20260922", severity: "CLASS - 2", violation_type: "Elevators", violation_description: "CAR TOP IS NOT MAINTAINED", balance_due: "625" }],
      }),
      "elev",
    );
    const devices = tableOf(elev, "Devices")!;
    expect(devices.columns).toEqual(["Device", "Type", "Status", "Last inspected", "Annual test filed", "Five-year test filed"]);
    expect(devices.rows).toEqual([
      ["2P907", "Elevator", "Active", "Mar 12, 2026", "Jul 21, 2025", "Feb 1, 2024"],
      ["2L100", "Accessibility lift", "Active", "–", "–", "–"],
      ["2D001", "Dumbwaiter", "Removed", "–", "–", "–"],
    ]);
    const issues = tableOf(elev, "Open elevator issues")!;
    expect(issues.columns).toEqual(["Source", "Date", "What"]);
    expect(issues.rows).toEqual([["City summons", "Sep 22, 2026", expect.stringMatching(/\$625 unpaid$/)]]);
    // No active elevator: still every device, and no issues table when there are none.
    const none = card(build({ elevators: others }), "elev");
    expect(none.tables?.map((t) => t.title)).toEqual(["Devices"]);
    expect(tableOf(none, "Devices")!.rows).toHaveLength(2);
  });

  it("landlord: the registration fields and every contact with role, name and address", () => {
    const owner = card(
      build({
        registration: [{ registrationid: "209634", buildingid: "45427", lastregistrationdate: "2025-08-10T00:00:00.000", registrationenddate: "2027-09-01T00:00:00.000" }],
        contacts: [
          { type: "Shareholder", firstname: "ANNA", lastname: "ROSE", businesshousenumber: "9", businessstreetname: "MAIN ST", businesscity: "HOBOKEN", businessstate: "NJ", businesszip: "07030" },
          { type: "SiteManager", firstname: "JOE", lastname: "MARTE" },
          { type: "Agent", corporationname: "LANGSAM PROPERTY SERVICES CORP", firstname: "GREG", lastname: "GADSON", businesshousenumber: "1601", businessstreetname: "BRONXDALE AVENUE", businessapartment: "201", businesscity: "BRONX", businessstate: "NY", businesszip: "10462" },
          { type: "HeadOfficer", firstname: "MARK", lastname: "ENGEL" },
          { type: "CorporateOwner", corporationname: "1130 SHEVA REALTY HDFC, INC", businesshousenumber: "1601", businessstreetname: "BRONXDALE AVE", businesscity: "BRONX", businessstate: "NY", businesszip: "10402" },
          { type: "Officer", firstname: "Mark", lastname: "Engel" },
          { type: "Officer", firstname: "Mark", lastname: "Engel" },
        ],
        jurisdiction: [{ buildingid: "45427", managementprogram: "PVT", legalclassb: "0", recordstatus: "Active" }],
      }),
      "owner",
    );
    const reg = tableOf(owner, "Registration")!;
    expect(reg.columns).toEqual(["Field", "Value"]);
    expect(reg.rows).toEqual([
      ["Status", "Current"],
      ["Expires", "Sep 1, 2027"],
      ["Last registered", "Aug 10, 2025"],
      ["Registration ID", "209634"],
      ["City housing program", "Private"],
      ["Record status", "Active"],
      ["Single-room units (no own kitchen and bath)", "0"],
    ]);
    const people = tableOf(owner, "People and companies on the registration")!;
    expect(people.columns).toEqual(["Role", "Name", "Address"]);
    expect(people.rows).toEqual([
      ["Corporate owner", "1130 SHEVA REALTY HDFC, INC", "1601 BRONXDALE AVE BRONX NY 10402"],
      ["Head officer", "MARK ENGEL", "–"],
      ["Agent", "LANGSAM PROPERTY SERVICES CORP · GREG GADSON", "1601 BRONXDALE AVENUE 201 BRONX NY 10462"],
      ["Site manager", "JOE MARTE", "–"],
      ["Shareholder", "ANNA ROSE", "9 MAIN ST HOBOKEN NJ 07030"],
      ["Officer", "Mark Engel", "–"], // an exact repeat is listed once
    ]);
    expect(owner.notes).toEqual(["Tax records list the owner as A PLUS NYC REALTY LLC"]);

    const lapsed = card(build({ registration: [{ registrationid: "1", buildingid: "2", registrationenddate: "2024-09-30T00:00:00.000" }] }), "owner");
    expect(tableOf(lapsed, "Registration")!.rows[0]).toEqual(["Status", "Lapsed"]);
    expect(lapsed.notes).toContain("An unregistered landlord cannot certify repairs and cannot sue a tenant for nonpayment of rent");
  });

  it("legal: every court case, vacate order and eviction with all its public fields", () => {
    const legal = card(
      build({
        evictions: [EVICTION, { executed_date: "2024-02-06T00:00:00.000", eviction_possession: "Eviction", ejectment: "Ejectment" }, { executed_date: "2023-12-01T00:00:00.000" }],
        litigations: [
          { casetype: "Tenant Action", caseopendate: "2026-08-28T00:00:00.000", casestatus: "PENDING", respondent: "1130 SHEVA REALTY HDFC INCORPORATED,LANGSAM PROPERTY SERVICES CORPORATION" },
          { casetype: "Tenant Action/Harrassment", caseopendate: "2025-05-30T00:00:00.000", casestatus: "CLOSED", findingofharassment: "No Harassment", respondent: "1130 SHEVA REALTY HDFC INC", penalty: "5000" },
        ],
        vacate: [{ vacate_type: "Partial", primary_vacate_reason: "Fire Damage", vacate_effective_date: "2022-01-24T00:00:00.000", actual_rescind_date: "2023-04-13T00:00:00.000", number_of_vacated_units: "5" }],
        ecbActive: [{ ecb_violation_number: "1P", issue_date: "20260922", violation_type: "Boilers", balance_due: "1250" }],
      }),
      "legal",
    );
    expect(legal.tables?.map((t) => t.title)).toEqual(["Housing court cases", "Vacate orders", "Evictions carried out, last 3 years"]);
    const cases = tableOf(legal, "Housing court cases")!;
    expect(cases.columns).toEqual(["Type", "Opened", "Status", "Against", "Harassment finding", "Penalty"]);
    expect(cases.rows).toEqual([
      ["Tenant Action", "Aug 28, 2026", "Pending", "1130 SHEVA REALTY HDFC INCORPORATED, LANGSAM PROPERTY SERVICES CORPORATION", "–", "–"],
      ["Tenant Action/Harrassment", "May 30, 2025", "Closed", "1130 SHEVA REALTY HDFC INC", "No Harassment", "$5,000"],
    ]);
    const vacate = tableOf(legal, "Vacate orders")!;
    expect(vacate.columns).toEqual(["Type", "Reason", "Effective", "Lifted", "Apartments vacated"]);
    expect(vacate.rows).toEqual([["Partial", "Fire Damage", "Jan 24, 2022", "Apr 13, 2023", "5"]]);
    const ev = tableOf(legal, "Evictions carried out, last 3 years")!;
    expect(ev.columns).toEqual(["Date", "Apartment", "Type", "Court index no.", "Docket", "Marshal"]);
    expect(ev.rows).toEqual([
      ["Nov 13, 2025", "A7", "Possession, not an ejectment", "B311005/22", "119749", "Ileana Rivera"],
      ["Feb 6, 2024", "–", "Eviction, ejectment", "–", "–", "–"],
      ["Dec 1, 2023", "–", "–", "–", "–", "–"],
    ]);
    expect(legal.details).toContain("Eviction carried out Nov 13, 2025, apt A7");
    expect(legal.notes).toEqual(["$1,250 in unpaid city fines"]);
  });

  it("noise: one row per noise type with the 311 caveat; none when 311 failed", () => {
    const n = (complaint_type: string, count: string) => ({ agency: "NYPD", complaint_type, n: count });
    const noise = card(build({ n311: [n("Noise - Residential", "3"), n("Noise - Vehicle", "12"), { agency: "HPD", complaint_type: "HEAT/HOT WATER", n: "40" }] }), "noise");
    const t = tableOf(noise, "Noise complaints in the last 12 months")!;
    expect(t.columns).toEqual(["Type", "Complaints"]);
    expect(t.rows).toEqual([
      ["Vehicle noise", "12"],
      ["Noise from apartments or houses", "3"],
    ]);
    expect(noise.notes).toEqual(["311 noise reports cover the whole lot and the address the caller gave, so some are about neighbors or the street."]);
    expect(card(build({ failed: ["n311"] }), "noise")).toMatchObject({ tables: [], notes: [] });
  });
});

describe("evictions query", () => {
  it("selects every per-eviction column in one request, with the same filters", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json([]);
    }) as typeof fetch;
    await fetchBuildingData("2003068", "2025050046", NOW, { fetcher });
    const ev = urls.filter((u) => u.includes("/6z8x-wfk4.json"));
    expect(ev).toHaveLength(1);
    const q = new URL(ev[0]!).searchParams;
    expect(q.get("$select")?.split(",")).toEqual(["executed_date", "eviction_apt_num", "court_index_number", "docket_number", "marshal_first_name", "marshal_last_name", "ejectment", "eviction_possession"]);
    expect(q.get("bin")).toBe("2003068");
    expect(q.get("residential_commercial_ind")).toBe("Residential");
    expect(q.get("$where")).toMatch(/^executed_date > '2023-10-0\d'$/);
    expect(q.get("$order")).toBe("executed_date DESC");
    expect(q.get("$limit")).toBe("100");
  });
});

// ---------- violation history: the all-status queries and the lists derived from them ----------

/** A seeded generator, so the equivalence test is the same every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** What Socrata does with `$order=<date> DESC` (ties keep their stored order) and `$limit`. */
const byDateDesc = (date: string) => (a: Row, b: Row) => ((a[date] ?? "") < (b[date] ?? "") ? 1 : (a[date] ?? "") > (b[date] ?? "") ? -1 : 0);
const oldQuery = (rows: Row[], keep: (r: Row) => boolean, date: string, limit: number) => rows.filter(keep).sort(byDateDesc(date)).slice(0, limit);
const newQuery = (rows: Row[], keep: (r: Row) => boolean, date: string, limit: number) =>
  [...rows].sort((a, b) => (keep(a) === keep(b) ? byDateDesc(date)(a, b) : keep(a) ? -1 : 1)).slice(0, limit);
const project = (rows: Row[], cols: readonly string[]) => rows.map((r) => Object.fromEntries(cols.filter((c) => r[c] !== undefined).map((c) => [c, r[c]])));

describe("open and active lists derived from the all-status queries", () => {
  const cases = [
    {
      name: "hpdOpenItems",
      derive: deriveHpdOpenItems,
      cols: HPD_OPEN_COLUMNS,
      date: "inspectiondate",
      limit: VIOLATION_LIMITS.hpd,
      cap: ACTIVE_LIMITS.hpdOpen,
      keep: (r: Row) => r.violationstatus === "Open",
      row: (i: number, open: boolean, d: string) => ({
        violationid: String(i),
        class: "ABCI"[i % 4],
        inspectiondate: `${d}T00:00:00.000`,
        novissueddate: `${d}T00:00:00.000`,
        apartment: `${i % 9}A`,
        story: "3",
        currentstatus: open ? "NOV SENT OUT" : "VIOLATION CLOSED",
        rentimpairing: i % 7 ? "N" : "Y",
        novdescription: `ORDER ${i}`,
        violationstatus: open ? "Open" : "Close",
        ordernumber: "501",
        currentstatusdate: `${d}T00:00:00.000`,
      }),
    },
    {
      name: "dobNowActive",
      derive: deriveDobNowActive,
      cols: DOB_NOW_ACTIVE_COLUMNS,
      date: "violation_issue_date",
      limit: VIOLATION_LIMITS.dobNow,
      cap: ACTIVE_LIMITS.dobNow,
      keep: (r: Row) => r.violation_status === "Active",
      row: (i: number, open: boolean, d: string) => ({
        violation_number: `VIO-${i}`,
        violation_type: "FTF-EN-BENCH",
        violation_remarks: `Remark ${i}`,
        violation_status: open ? "Active" : i % 2 ? "Dismissed" : "Paid  - Pending Dismissal",
        violation_issue_date: `${d}T00:00:00.000`,
        device_type: "Elevators",
        cycle_end_date: `${d}T00:00:00.000`,
      }),
    },
    {
      name: "ecbActive",
      derive: deriveEcbActive,
      cols: ECB_ACTIVE_COLUMNS,
      date: "issue_date",
      limit: VIOLATION_LIMITS.ecb,
      cap: ACTIVE_LIMITS.ecb,
      keep: (r: Row) => r.ecb_violation_status === "ACTIVE",
      row: (i: number, open: boolean, d: string) => ({
        ecb_violation_number: `${i}P`,
        ecb_violation_status: open ? "ACTIVE" : "RESOLVE",
        issue_date: d.replace(/-/g, ""),
        severity: "CLASS - 2",
        violation_type: "Elevators",
        violation_description: `Description ${i}`,
        balance_due: "625",
        penality_imposed: "625",
        amount_paid: "0",
        hearing_status: open ? "PENDING" : "IN VIOLATION",
        certification_status: "NO COMPLIANCE RECORDED",
      }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: same rows, order and cap as the old status-filtered query, with only the old columns`, () => {
      // Three buildings: few open rows, more open rows than the cap, and more rows than the new query's limit.
      for (const [total, openShare] of [
        [40, 0.3],
        [700, 0.6],
        [2000, 0.2],
      ] as const) {
        const rand = rng(total);
        const stored = Array.from({ length: total }, (_, i) => {
          const d = new Date(Date.UTC(2000 + Math.floor(rand() * 26), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))).toISOString().slice(0, 10);
          return c.row(i, rand() < openShare, d) as Row;
        });
        const expected = project(oldQuery(stored, c.keep, c.date, c.cap), c.cols);
        const derived = c.derive(newQuery(stored, c.keep, c.date, c.limit));
        expect(derived).toEqual(expected);
        expect(derived.length).toBe(Math.min(stored.filter(c.keep).length, c.cap));
        for (const r of derived) expect(Object.keys(r).every((k) => (c.cols as readonly string[]).includes(k))).toBe(true);
      }
    });
  }

  it("asks for every status in one query each, open first, and derives the old lists from them (44 requests)", async () => {
    const urls: string[] = [];
    const hpdRows = [
      { violationid: "1", class: "B", inspectiondate: "2026-09-12T00:00:00.000", violationstatus: "Open", currentstatus: "NOV SENT OUT", novdescription: "LOCK", ordernumber: "501" },
      { violationid: "2", class: "C", inspectiondate: "2026-09-01T00:00:00.000", violationstatus: "Close", currentstatus: "VIOLATION CLOSED", novdescription: "HEAT" },
    ];
    const nowRows = [
      { violation_number: "A", violation_status: "Active", violation_issue_date: "2025-10-10T00:00:00.000", violation_type: "FTC-VT-CAT1-CO", cycle_end_date: "2024-12-31T00:00:00.000" },
      { violation_number: "B", violation_status: "Dismissed", violation_issue_date: "2025-01-01T00:00:00.000" },
    ];
    const ecbRows = [
      { ecb_violation_number: "1P", ecb_violation_status: "ACTIVE", issue_date: "20260922", hearing_status: "PENDING", amount_paid: "0" },
      { ecb_violation_number: "2H", ecb_violation_status: "RESOLVE", issue_date: "20200101", hearing_status: "DISMISSED" },
    ];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const q = new URL(url).searchParams;
      if (url.includes("/wvxf-dwi5.json") && q.get("$limit") === String(VIOLATION_LIMITS.hpd)) return Response.json(hpdRows);
      if (url.includes("/855j-jady.json")) return Response.json(nowRows);
      if (url.includes("/6bgk-3dad.json")) return Response.json(ecbRows);
      if (url.includes("/tesw-yqqr.json")) return Response.json([{ registrationid: "209634" }]);
      if (url.includes("/8h5j-fqxa.json")) return Response.json([{ document_id: "2017062700295001" }]);
      return Response.json([]);
    }) as typeof fetch;
    const raw = await fetchBuildingData("2003068", "2025050046", NOW, { fetcher });
    // 42 side by side, then the registration's contacts and the lot's documents: the most a build makes.
    expect(urls).toHaveLength(44);

    const hpd = urls.filter((u) => u.includes("/wvxf-dwi5.json")).map((u) => new URL(u).searchParams);
    const rows = hpd.find((q) => q.get("$limit") === String(VIOLATION_LIMITS.hpd))!;
    expect(rows.get("violationstatus")).toBeNull();
    expect(rows.get("$order")).toBe("case(violationstatus='Open',1,true,0) DESC,inspectiondate DESC");
    expect(rows.get("$select")?.split(",")).toEqual(expect.arrayContaining([...HPD_OPEN_COLUMNS, "ordernumber", "violationstatus", "currentstatusdate", "certifieddate"]));
    // The old open-only row query is gone; only the open count by class still filters on status.
    expect(hpd.filter((q) => q.get("violationstatus") === "Open").map((q) => q.get("$group"))).toEqual(["class"]);

    const now = new URL(urls.find((u) => u.includes("/855j-jady.json"))!).searchParams;
    expect(now.get("violation_status")).toBeNull();
    expect(now.get("$order")).toBe("case(violation_status='Active',1,true,0) DESC,violation_issue_date DESC");
    expect(now.get("$limit")).toBe(String(VIOLATION_LIMITS.dobNow));
    const ecb = new URL(urls.find((u) => u.includes("/6bgk-3dad.json"))!).searchParams;
    expect(ecb.get("ecb_violation_status")).toBeNull();
    expect(ecb.get("$order")).toBe("case(ecb_violation_status='ACTIVE',1,true,0) DESC,issue_date DESC");
    expect(ecb.get("$select")?.split(",")).toEqual(expect.arrayContaining(["hearing_status", "amount_paid", "certification_status"]));
    const bis = urls.filter((u) => u.includes("/3h2n-5cm9.json")).map((u) => new URL(u).searchParams);
    expect(bis.map((q) => [q.get("$where"), q.get("$order"), q.get("$limit")])).toEqual([
      ["not contains(violation_category,'*')", "issue_date DESC", "50"],
      [null, "issue_date DESC", String(VIOLATION_LIMITS.bis)],
    ]);

    expect(raw.hpdOpenItems).toEqual([{ violationid: "1", class: "B", inspectiondate: "2026-09-12T00:00:00.000", currentstatus: "NOV SENT OUT", novdescription: "LOCK" }]);
    expect(raw.dobNowActive).toEqual([{ violation_number: "A", violation_issue_date: "2025-10-10T00:00:00.000", violation_type: "FTC-VT-CAT1-CO" }]);
    expect(raw.ecbActive).toEqual([{ ecb_violation_number: "1P", issue_date: "20260922", hearing_status: "PENDING" }]);
    expect(raw.hpdViolationRows).toEqual(hpdRows);
  });

  it("fails the derived list under its old name when the all-status query fails", async () => {
    const fetcher = (async (input: RequestInfo | URL) =>
      String(input).includes("/6bgk-3dad.json") ? new Response("nope", { status: 500 }) : Response.json([])) as typeof fetch;
    const raw = await fetchBuildingData("2003068", "2025050046", NOW, { fetcher });
    expect(raw.failed).toEqual(expect.arrayContaining(["ecbRows", "ecbActive"]));
    expect(raw.ecbActive).toEqual([]);
    expect(computeViolations(raw).unavailable).toEqual(["summons"]);
  });
});

describe("violation history", () => {
  const hpd = (id: string, over: Row = {}): Row => ({
    violationid: id,
    class: "B",
    inspectiondate: "2026-01-10T00:00:00.000",
    novissueddate: "2026-01-12T00:00:00.000",
    originalcorrectbydate: "2026-02-10T00:00:00.000",
    originalcertifybydate: "2026-02-24T00:00:00.000",
    apartment: "3B",
    story: "3",
    novid: "900",
    ordernumber: "501",
    novdescription: "§ 27-2005 HMC: PROPERLY REPAIR THE BROKEN OR DEFECTIVE LOCK AT ENTRANCE DOOR LOCATED AT APT 3B",
    violationstatus: "Open",
    currentstatus: "NOV SENT OUT",
    currentstatusdate: "2026-01-12T00:00:00.000",
    novtype: "Original",
    ...over,
  });
  const ecb = (id: string, over: Row = {}): Row => ({
    ecb_violation_number: id,
    ecb_violation_status: "ACTIVE",
    issue_date: "20260922",
    severity: "CLASS - 2",
    violation_type: "Elevators",
    violation_description: "CLASS 2 ITEMS: CAR TOP IS NOT MAINTAINED IN A SAFE CONDITION",
    penality_imposed: "625",
    amount_paid: "0",
    balance_due: "625",
    hearing_date: "20261204",
    hearing_time: "830",
    hearing_status: "PENDING",
    ...over,
  });

  it("gives every record a kind, a status and the city's own status wording", () => {
    const h = computeViolations(
      raw({
        hpdViolationRows: [
          hpd("1", { class: "C", inspectiondate: "2026-03-01T00:00:00.000" }),
          hpd("2", { class: "B", violationstatus: "Close", currentstatus: "VIOLATION DISMISSED", currentstatusdate: "2026-05-02T00:00:00.000", certifieddate: "2026-04-01T00:00:00.000" }),
          hpd("3", { class: "A", rentimpairing: "Y" }),
          hpd("4", { class: "I", novdescription: "§ 27-2107 ADM CODE OWNER FAILED TO FILE A VALID REGISTRATION STATEMENT" }),
          hpd("5", { class: "A", novdescription: "§ 27-2018.1 ADM CODE FILE ANNUAL BEDBUG REPORT" }),
        ],
        dobNowRows: [
          { violation_number: "VIO-1", violation_status: "Active", violation_type: "FTF-EN-BENCH", violation_issue_date: "2025-09-25T00:00:00.000", device_type: "Benchmarking - LL84" },
          { violation_number: "VIO-2", violation_status: "Paid  - Pending Dismissal", violation_type: "FTC-VT-PER-CO", violation_issue_date: "2023-01-01T00:00:00.000" },
        ],
        dobBisRows: [
          { number: "V041624CLL0404SB", violation_category: "V-DOB VIOLATION - ACTIVE", violation_type: "C-CONSTRUCTION", issue_date: "20240416", description: "EMERGENCY WORK ORDER" },
          { number: "V*080219BENCH00634", violation_category: "V*-DOB VIOLATION - DISMISSED", violation_type: "BENCH-FAILURE TO BENCHMARK", issue_date: "20190802", disposition_date: "20211012", disposition_comments: "000810 PAID INVOICE" },
        ],
        ecbRows: [ecb("39205015P"), ecb("34000000X", { ecb_violation_status: "RESOLVE", issue_date: "20180101", hearing_status: "DISMISSED", penality_imposed: "0", balance_due: "0" })],
      }),
    );
    const by = (id: string) => h.items.find((v) => v.id === id)!;
    expect(by("1")).toMatchObject({ source: "housing", kind: "immediate", status: "open", cityStatus: "NOV sent out", closedAt: null, noticeDate: "2026-01-12", where: "Apt 3B", what: "Broken lock" });
    expect(by("1").ref).toBe("HPD violation 1 · NOV 900 · order 501 · class C");
    expect(by("2")).toMatchObject({ kind: "hazardous", status: "closed", cityStatus: "Violation dismissed", closedAt: "2026-05-02" });
    expect(by("2").facts).toEqual(expect.arrayContaining([["Landlord certified the repair", "2026-04-01"], ["Correct by", "2026-02-10"]]));
    expect(by("3")).toMatchObject({ kind: "minor" });
    expect(by("3").facts).toEqual(expect.arrayContaining([["Rent-impairing", "Yes"]]));
    expect(by("4").kind).toBe("paperwork");
    expect(by("5")).toMatchObject({ kind: "paperwork", what: "Landlord cited for not filing the annual bedbug report", where: "Building" });
    expect(by("VIO-1")).toMatchObject({ source: "buildings", kind: "buildings", status: "open", cityStatus: "Active", where: "Benchmarking - LL84", closedAt: null });
    expect(by("VIO-2")).toMatchObject({ status: "closed", cityStatus: "Paid - pending dismissal" });
    expect(by("V041624CLL0404SB")).toMatchObject({ kind: "buildings", status: "open", cityStatus: "DOB violation - active", date: "2024-04-16" });
    expect(by("V*080219BENCH00634")).toMatchObject({ status: "closed", cityStatus: "DOB violation - dismissed", closedAt: "2021-10-12" });
    expect(by("34000000X")).toMatchObject({ source: "summons", kind: "summons", status: "closed", cityStatus: "Resolved", hearing: "Dismissed" });
    // Where each one is, as data for grouping by place.
    expect(by("1")).toMatchObject({ area: "apartment", unit: "3B" });
    expect(by("5")).toMatchObject({ area: "building" });
    expect(by("5")).not.toHaveProperty("unit");
    expect(["VIO-1", "V041624CLL0404SB", "39205015P"].map((id) => by(id).area)).toEqual(["building", "building", "building"]);
    // Newest first across all three sources.
    expect(h.items.map((v) => v.date)).toEqual([...h.items.map((v) => v.date)].sort().reverse());
    expect(h.totals).toEqual({ housing: 5, buildings: 4, summons: 2, rats: 0, repairs: 0 });
    expect(h.unavailable).toEqual([]);
  });

  it("never calls a summons with a pending hearing a fine, and labels it by its hearing status", () => {
    const h = computeViolations(raw({ ecbRows: [ecb("1P"), ecb("2H", { hearing_status: "STIPULATION/IN-VIO", penality_imposed: "1250", balance_due: "1250" }), ecb("3X", { hearing_status: "DEFAULT" })] }));
    const [pending, settled, dflt] = ["1P", "2H", "3X"].map((id) => h.items.find((v) => v.id === id)!);
    expect(pending).toMatchObject({ hearing: "Hearing pending", hearingStatus: "PENDING", hearingDate: "2026-12-04", penalty: 625, paid: 0, balance: 625 });
    expect(pending!.what).toBe("Elevators summons (class 2): Car top is not maintained in a safe condition");
    expect(JSON.stringify([pending!.what, pending!.hearing, pending!.facts])).not.toMatch(/fine/i);
    expect(pending!.facts).toEqual(expect.arrayContaining([["Penalty listed, hearing pending", "$625"], ["Balance listed", "$625"], ["Hearing", "2026-12-04 at 8:30"]]));
    expect(settled).toMatchObject({ hearing: "Found in violation (settled)" });
    expect(settled!.facts).toEqual(expect.arrayContaining([["Fine imposed", "$1,250"], ["Balance due", "$1,250"]]));
    expect(dflt!.hearing).toBe("Found in violation by default");
  });

  it("places each housing violation in an apartment, the common areas, or the whole building", () => {
    const h = computeViolations(
      raw({
        hpdViolationRows: [
          hpd("a", { apartment: "d-5" }),
          hpd("b", { apartment: "BLDG", story: "1", novdescription: "§ 27-2046 ADM CODE REPAIR THE SELF-CLOSING DOOR AT PUBLIC HALL 1ST STORY" }),
          hpd("c", { apartment: "", story: "", novdescription: "§ 27-2005 ADM CODE POST A NOTICE" }),
          hpd("d", { apartment: "NA", story: "6", novdescription: "§ 27-2005 ADM CODE REPAIR THE LIGHT FIXTURE" }),
          hpd("e", { apartment: "", story: "", novdescription: "REPAIR THE SINK IN THE KITCHEN LOCATED AT APT 4R, 4th STORY" }),
        ],
      }),
    );
    const by = (id: string) => h.items.find((v) => v.id === id)!;
    expect(by("a")).toMatchObject({ area: "apartment", unit: "D5", where: "Apt d-5" });
    expect(by("b")).toMatchObject({ area: "common", where: "Common area · floor 1" });
    expect(by("c")).toMatchObject({ area: "building", where: "Building" });
    expect(by("d")).toMatchObject({ area: "common", where: "floor 6" });
    expect(by("e")).toMatchObject({ area: "apartment", unit: "4R" });
  });

  it("lists a violation that is on both DOB systems once, as the DOB NOW one", () => {
    const h = computeViolations(
      raw({
        dobNowRows: [{ violation_number: "062624AEUHAZ100065", violation_status: "Active", violation_type: "FTC-AEU-HAZ", violation_issue_date: "2024-06-26T00:00:00.000" }],
        dobBisRows: [{ number: "V062624AEUHAZ100065", violation_category: "V-DOB VIOLATION - ACTIVE", violation_type: "AEUHAZ1-FAIL TO CERTIFY CLASS 1", issue_date: "20240626" }],
      }),
    );
    expect(h.items).toHaveLength(1);
    expect(h.items[0]!.facts).toEqual(expect.arrayContaining([["Also on the older DOB system as", "V062624AEUHAZ100065"]]));
  });

  it("flags each source that returned exactly its row limit", () => {
    const many = (n: number, f: (i: number) => Row) => Array.from({ length: n }, (_, i) => f(i));
    const none = computeViolations(raw({ hpdViolationRows: many(VIOLATION_LIMITS.hpd - 1, (i) => hpd(String(i))), hpdTotal: [{ n: "4849" }] }));
    expect(none.truncated).toEqual({ housing: false, buildings: false, summons: false, rats: false, repairs: false });
    const all = computeViolations(
      raw({
        hpdViolationRows: many(VIOLATION_LIMITS.hpd, (i) => hpd(String(i))),
        hpdTotal: [{ n: "4849" }],
        dobBisRows: many(VIOLATION_LIMITS.bis, (i) => ({ number: `V${i}`, violation_category: "V*-DOB VIOLATION - RESOLVED", issue_date: "20100101" })),
        ecbRows: many(VIOLATION_LIMITS.ecb, (i) => ecb(String(i))),
      }),
    );
    expect(all.truncated).toEqual({ housing: true, buildings: true, summons: true, rats: false, repairs: false });
    expect(all.totals).toEqual({ housing: 4849, buildings: VIOLATION_LIMITS.bis, summons: VIOLATION_LIMITS.ecb, rats: 0, repairs: 0 });
    expect(computeViolations(raw({ dobNowRows: many(VIOLATION_LIMITS.dobNow, (i) => ({ violation_number: String(i), violation_status: "Dismissed" })) })).truncated.buildings).toBe(true);
  });

  it("is on every new report, and leaves the existing sections exactly as the open lists make them", () => {
    const open = [hpd("1", { class: "C", inspectiondate: "2026-09-01T00:00:00.000" })];
    const r = build({ hpdViolationRows: [...open, hpd("2", { violationstatus: "Close" })], hpdOpenItems: deriveHpdOpenItems(open), hpdOpenByClass: [{ class: "C", n: "1" }] });
    expect(r.violations?.items).toHaveLength(2);
    const before = build({ hpdOpenItems: deriveHpdOpenItems(open), hpdOpenByClass: [{ class: "C", n: "1" }] });
    const { violations: _a, ...rest } = r;
    const { violations: _b, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });
});

describe("last year's housing violations, as the city counts them", () => {
  it("adds up the counts by status, whatever the row list holds", () => {
    const h = computeViolations(raw({ hpdYear: [{ violationstatus: "Open", n: "253" }, { violationstatus: "Close", n: "65" }] }));
    expect(h.lastYear).toEqual({ housing: { issued: 318, open: 253 } });
    expect(computeViolations(raw()).lastYear).toEqual({ housing: { issued: 0, open: 0 } });
  });

  it("is left out when the count didn't load, so the page falls back to the rows", () => {
    expect(computeViolations(raw({ failed: ["hpdYear"] }))).not.toHaveProperty("lastYear");
  });
});

describe("complaint topics", () => {
  const hpd = (complaint_id: string, problem_id: string, major_category: string, minor_category = "", over: Record<string, string> = {}) => ({
    complaint_id,
    problem_id,
    received_date: "2026-01-10T09:00:00.000",
    type: "NON EMERGENCY",
    complaint_status: "CLOSE",
    major_category,
    minor_category,
    ...over,
  });

  it("takes topics from the city's categories only, in a fixed order, several per complaint", () => {
    const h = computeComplaints(
      raw({
        hpdComplaintRows: [
          hpd("1", "1", "UNSANITARY CONDITION", "PESTS", { problem_code: "MICE" }),
          hpd("1", "2", "WATER LEAK", "SLOW LEAK"),
          hpd("1", "3", "HEAT/HOT WATER", "ENTIRE BUILDING", { problem_code: "NO HEAT" }),
          hpd("2", "4", "PLUMBING", "TOILET"),
          hpd("3", "5", "UNSANITARY CONDITION", "MOLD"),
          // The words "heat" and "mice" in free text don't make a topic.
          hpd("4", "6", "GENERAL", "VENTILATION SYSTEM", { status_description: "No heat and mice reported by the tenant." }),
        ],
        dobComplaintRows: [
          { complaint_number: "10", status: "CLOSED", date_entered: "01/01/2026", complaint_category: "58" },
          { complaint_number: "11", status: "CLOSED", date_entered: "01/01/2026", complaint_category: "94" },
          { complaint_number: "12", status: "CLOSED", date_entered: "01/01/2026", complaint_category: "1W" },
          { complaint_number: "13", status: "CLOSED", date_entered: "01/01/2026", complaint_category: "96" },
          { complaint_number: "14", status: "CLOSED", date_entered: "01/01/2026", complaint_category: "63" },
        ],
        n311Rows: [
          { unique_key: "20", created_date: "2026-01-01T00:00:00.000", agency: "NYPD", complaint_type: "Noise - Residential", status: "Closed" },
          { unique_key: "21", created_date: "2026-01-01T00:00:00.000", agency: "DEP", complaint_type: "Noise", status: "Closed" },
          { unique_key: "22", created_date: "2026-01-01T00:00:00.000", agency: "DOHMH", complaint_type: "Rodent", descriptor: "Rat Sighting", status: "Closed" },
          { unique_key: "23", created_date: "2026-01-01T00:00:00.000", agency: "NYPD", complaint_type: "Illegal Parking", descriptor: "Noise from cars, rats nearby", status: "Closed" },
        ],
      }),
      NOW,
    );
    const topics = Object.fromEntries(h.items.map((c) => [c.id, c.topics]));
    expect(topics).toEqual({
      "1": ["heat", "plumbing", "pest"],
      "2": ["plumbing"],
      "3": [],
      "4": [],
      "10": ["heat"],
      "11": ["plumbing"],
      "12": ["plumbing"],
      "13": [],
      "14": [],
      "20": ["noise"],
      "21": ["noise"],
      "22": ["pest"],
      "23": [],
    });
  });

  it("doesn't change how the cards count complaints", () => {
    const heat = card(build({ hpdComplaints12mo: [{ major_category: "HEAT/HOT WATER", complaints: "9", problems: "12" }] }), "heat");
    expect(heat.status).toBe("serious");
    expect(heat.answer).toMatch(/^9 heat or hot water complaints/);
  });
});

// ---------- the newer records: rat inspections, city repairs, city programs, property records, building facts ----------

describe("the request budget", () => {
  const run = async (bin: string, bbl: string, answer: (url: string) => unknown = () => []) => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const body = answer(String(input));
      return body instanceof Response ? body : Response.json(body);
    }) as typeof fetch;
    const raw = await fetchBuildingData(bin, bbl, NOW, { fetcher });
    return { urls, raw, q: (id: string) => urls.filter((u) => u.includes(`/${id}.json`)).map((u) => new URL(u).searchParams) };
  };
  const NEW = ["p937-wjvj", "mdbu-nrqn", "sbnd-xujn", "hcir-3275", "h4mf-f24e", "bzxi-2tsw", "8h5j-fqxa", "9rz4-mjek", "xubg-57si", "52dp-yji6", "bs8b-p36w", "rbx6-tga4", "vq35-j9qm", "muvi-b6kx"];

  it("makes 42 requests side by side, and each of the two that follow only when it has an id to ask about", async () => {
    const bare = await run("3037516", "3013950033");
    expect(bare.urls).toHaveLength(42);
    for (const id of NEW) expect(bare.q(id)).toHaveLength(1);
    expect(bare.raw.acrisDocs).toEqual([]);
    expect(bare.raw.failed).toEqual([]);

    const full = await run("3037516", "3013950033", (u) =>
      u.includes("/tesw-yqqr.json") ? [{ registrationid: "1" }] : u.includes("/8h5j-fqxa.json") ? [{ document_id: "2017062700295001" }, { document_id: "FT_2900005131590" }] : u.includes("/bnx9-e6tj.json") ? [{ doc_type: "DEED" }] : [],
    );
    expect(full.urls).toHaveLength(44);
    // Under the 50 subrequests one invocation gets, with the one or two the address lookup makes.
    expect(full.urls.length + 2).toBeLessThanOrEqual(50);
    // The second hop asks only about the lot's own documents, and only for deeds and mortgages.
    const docs = full.q("bnx9-e6tj")[0]!;
    expect(docs.get("$where")).toBe("document_id in ('2017062700295001','FT_2900005131590') AND doc_type in ('DEED','DEEDO','DEEDP','DEED, LE','DEED, RC','IDED','REIT','MTGE','M&CON','CMTG')");
    expect(full.raw.acrisDocs).toEqual([{ doc_type: "DEED" }]);
    expect(full.raw).not.toHaveProperty("acrisLegals");
  });

  it("keys each new query the way its dataset is keyed", async () => {
    const { q } = await run("3037516", "3013950033");
    const lot = (id: string) => [q(id)[0]!.get("borough"), q(id)[0]!.get("block"), q(id)[0]!.get("lot")];
    expect(q("p937-wjvj")[0]!.get("bbl")).toBe("3013950033");
    expect(q("p937-wjvj")[0]!.get("$limit")).toBe(String(RAT_VISITS));
    for (const id of ["mdbu-nrqn", "sbnd-xujn", "hcir-3275", "h4mf-f24e", "bzxi-2tsw", "xubg-57si", "rbx6-tga4", "vq35-j9qm"]) expect(q(id)[0]!.get("bin")).toBe("3037516");
    expect([q("mdbu-nrqn")[0]!.get("$limit"), q("sbnd-xujn")[0]!.get("$limit")]).toEqual([String(VIOLATION_LIMITS.repairs), String(VIOLATION_LIMITS.repairs)]);
    expect([q("52dp-yji6")[0]!.get("bin_number"), q("bs8b-p36w")[0]!.get("bin_number")]).toEqual(["3037516", "3037516"]);
    expect(lot("8h5j-fqxa")).toEqual(["3", "1395", "33"]);
    expect(q("8h5j-fqxa")[0]!.get("$limit")).toBe(String(ACRIS_DOCS));
    expect(lot("9rz4-mjek")).toEqual(["3", "1395", "33"]);
    expect(q("muvi-b6kx")[0]!.get("parid")).toBe("3013950033");
    expect(q("muvi-b6kx")[0]!.get("$where")).toBe("status like 'A%' AND curexmptot > 0 AND exmp_code in ('1920','5110','5113','5114','5116','5117','5118','5119','5120','5121','5122','5123')");
    expect(q("rbx6-tga4")[0]!.get("$where")).toMatch(/^issued_date > '2025-10-0\d'$/);
    // The flood flags ride on the PLUTO request the report already made.
    expect(q("64uk-42ks")).toHaveLength(1);
    expect(q("64uk-42ks")[0]!.get("$select")?.split(",")).toEqual(expect.arrayContaining(["firm07_flag", "pfirm15_flag"]));
  });

  it("asks ACRIS nothing about a condo building's billing lot", async () => {
    expect([isCondoBillingLot("1012237503"), isCondoBillingLot("1012237500"), isCondoBillingLot("3013950033")]).toEqual([true, false, false]);
    const condo = await run("1032526", "1012237503", (u) => (u.includes("/8h5j-fqxa.json") ? [{ document_id: "x" }] : []));
    expect(condo.urls).toHaveLength(41);
    expect(condo.q("8h5j-fqxa")).toHaveLength(0);
    expect(condo.raw.acrisDocs).toEqual([]);
    expect(condo.raw.failed).toEqual([]);
  });

  it("fails the documents when either ACRIS request fails, and nothing else", async () => {
    const first = await run("3037516", "3013950033", (u) => (u.includes("/8h5j-fqxa.json") ? new Response("slow", { status: 500 }) : []));
    expect(first.raw.failed).toEqual(["acrisLegals", "acrisDocs"]);
    const second = await run("3037516", "3013950033", (u) => (u.includes("/8h5j-fqxa.json") ? [{ document_id: "a" }] : u.includes("/bnx9-e6tj.json") ? new Response("slow", { status: 500 }) : []));
    expect(second.raw.failed).toEqual(["acrisDocs"]);
    expect(computeProperty(second.raw, "3013950033")).toEqual({ taxLien: null });
  });
});

describe("failed rat inspections", () => {
  /** p937-wjvj rows as the query selects them; the values are 1018 Eastern Parkway's (2026-10-03). */
  const visit = (date: string, result: string, over: Row = {}): Row => ({
    job_id: `PC${date.replace(/-/g, "")}`,
    inspection_date: `${date}T10:40:10.000`,
    inspection_type: "Initial",
    result,
    house_number: "1018",
    street_name: "EASTERN PARKWAY",
    ...over,
  });
  const VISITS: Row[] = [
    visit("2026-02-27", "Passed"),
    visit("2020-02-27", "Failed for Rat Activity", { job_id: "PC7578066", letter_type: "COTA", observations: "Burrows" }),
    visit("2019-12-26", "Passed"),
    visit("2019-12-19", "Bait applied", { inspection_type: "Treatments" }),
    visit("2019-10-22", "Failed for Rat Activity", { inspection_type: "Compliance", observations: "Burrows" }),
    visit("2019-06-25", "Failed for Other Reason", { letter_type: "COTA", observations: "Harborage" }),
    visit("2018-12-28", "Failed for Rat Activity and Other Reason", { letter_type: "Summons Issued", observations: "Droppings, Burrows, Harborage" }),
    visit("2014-04-25", "Monitoring visit", { inspection_type: "Treatments" }),
    visit("2012-05-01", "Bait applied", { inspection_type: "Treatments" }),
  ];
  const rats = (rows: Row[], over: Partial<RawBuildingData> = {}) => computeViolations(raw({ ratInspections: rows, ...over })).items.filter((v) => v.source === "rats");

  it("makes a row of each failed inspection and of nothing else", () => {
    const rows = rats(VISITS);
    expect(rows.map((v) => [v.date, v.what, v.cityStatus])).toEqual([
      ["2020-02-27", "Rats found by health inspectors", "Failed for Rat Activity"],
      ["2019-10-22", "Rats found by health inspectors", "Failed for Rat Activity"],
      ["2019-06-25", "Failed rat inspection: conditions that attract rats", "Failed for Other Reason"],
      ["2018-12-28", "Rats found by health inspectors, and conditions that attract them", "Failed for Rat Activity and Other Reason"],
    ]);
    expect(rows[0]).toMatchObject({ source: "rats", kind: "rats", id: "PC7578066", ref: "Rat inspection job PC7578066", where: "Building", area: "building", original: "Failed for Rat Activity: Burrows" });
    expect(rows[0]).not.toHaveProperty("unit");
    // "Other reason" is sometimes only mice or another animal, and the headline then says which.
    expect(rats([visit("2026-01-05", "Failed for Other Reason", { observations: "Mice" })])[0]!.what).toBe("Failed rat inspection: mice");
    expect(rats([visit("2026-01-05", "Failed for Other Reason")])[0]!.what).toBe("Failed rat inspection: conditions that attract rats");
  });

  it("is open until the lot passes a later inspection, and closed on the day it first does", () => {
    const rows = rats(VISITS);
    expect(rows.map((v) => [v.date, v.status, v.closedAt])).toEqual([
      ["2020-02-27", "closed", "2026-02-27"],
      ["2019-10-22", "closed", "2019-12-26"],
      ["2019-06-25", "closed", "2019-12-26"],
      ["2018-12-28", "closed", "2019-12-26"],
    ]);
    // An earlier pass, baiting and monitoring don't close a failure; nor does a pass at the same moment.
    const open = rats([visit("2026-05-01", "Bait applied"), visit("2026-04-02", "Monitoring visit"), visit("2026-04-01", "Failed for Rat Activity"), visit("2026-04-01", "Passed"), visit("2025-01-01", "Passed")]);
    expect(open.map((v) => [v.status, v.closedAt])).toEqual([["open", null]]);
    // Whatever order the rows arrive in.
    expect(rats([...VISITS].reverse()).map((v) => v.status)).toEqual(["closed", "closed", "closed", "closed"]);
  });

  it("says what the inspectors saw, what the city sent, and what the newest visit of any kind found", () => {
    const [newest, followUp, , summons] = rats(VISITS);
    expect(newest!.facts).toEqual([
      ["Inspection", "First inspection"],
      ["What inspectors saw", "Burrows"],
      ["Notice or order issued", "Order to fix it sent to the owner (Commissioner's Order to Abate)"],
      ["Address inspected", "1018 EASTERN PARKWAY"],
      ["Newest visit to this lot", "2026-02-27 · Passed"],
      ["City put down rat bait here", "2019-12-19, the latest of 2 times"],
    ]);
    expect(followUp!.facts).toContainEqual(["Inspection", "Follow-up after a failed inspection"]);
    expect(followUp!.facts!.map(([k]) => k)).not.toContain("Notice or order issued");
    expect(summons!.facts).toContainEqual(["Notice or order issued", "Summons Issued"]);
    // The newest visit may be a treatment; when it is the failed inspection itself, there is nothing to add.
    expect(rats([visit("2026-05-01", "Bait applied"), visit("2026-04-01", "Failed for Rat Activity")])[0]!.facts).toContainEqual(["Newest visit to this lot", "2026-05-01 · Bait applied"]);
    expect(rats([visit("2026-04-01", "Failed for Rat Activity"), visit("2025-01-01", "Passed")])[0]!.facts!.map(([k]) => k)).not.toContain("Newest visit to this lot");
  });

  it("says the inspection was of the whole lot when the lot has several buildings", () => {
    const one = rats(VISITS)[0]!;
    expect(one.facts!.map(([k]) => k)).not.toContain("Covers");
    const several = rats(VISITS, { pluto: [{ numbldgs: "39" }] })[0]!;
    expect(several.facts).toContainEqual(["Covers", "The whole tax lot, which has 39 buildings"]);
  });

  it("lists the newest 200 failures, and says when visits or failures were cut off or didn't load", () => {
    const many = Array.from({ length: VIOLATION_LIMITS.rats + 5 }, (_, i) => visit(`20${String(10 + Math.floor(i / 300)).padStart(2, "0")}-01-01`, "Failed for Rat Activity", { inspection_date: new Date(Date.UTC(2010, 0, 1 + i)).toISOString().slice(0, 23) }));
    const cut = computeViolations(raw({ ratInspections: many }));
    expect(cut.items.filter((v) => v.source === "rats")).toHaveLength(VIOLATION_LIMITS.rats);
    expect(cut.items[0]!.date).toBe(new Date(Date.UTC(2010, 0, VIOLATION_LIMITS.rats + 5)).toISOString().slice(0, 10));
    expect(cut.truncated.rats).toBe(true);
    expect(cut.totals.rats).toBe(VIOLATION_LIMITS.rats);
    expect(computeViolations(raw({ ratInspections: VISITS })).truncated.rats).toBe(false);
    expect(computeViolations(raw({ ratInspections: Array.from({ length: RAT_VISITS }, () => visit("2026-01-01", "Passed")) })).truncated.rats).toBe(true);
    expect(computeViolations(raw({ failed: ["ratInspections"] })).unavailable).toEqual(["rats"]);
  });
});

describe("city emergency repairs", () => {
  /** Live mdbu-nrqn and sbnd-xujn rows for 1018 Eastern Parkway (2026-10-03), as the queries select them. */
  const DONE: Row = {
    omonumber: "EN05211",
    apartment: "15L",
    lifecycle: "Standing Building",
    worktypegeneral: "GC",
    omostatusreason: "OMO Completed",
    omoawardamount: "250",
    omocreatedate: "2022-08-29T00:00:00.000",
    netchangeorders: "0",
    omoawarddate: "2022-08-30T00:00:00.000",
    servicechargeflag: "False",
    omodescription: "hpd emergency operations service work'' division install hinges to make door self-closing at the entrance located at apt 15l, 3rd story,",
  };
  const REFUSED: Row = { ...DONE, omonumber: "EN01602", apartment: "12R", omostatusreason: "Tenant Refused Access", omoawardamount: "50", omocreatedate: "2022-07-15T00:00:00.000", omoawarddate: "2022-09-14T00:00:00.000", servicechargeflag: "True" };
  const STAFF_DONE: Row = {
    hwonumber: "EN00405",
    lifecycle: "Standing Building",
    worktypegeneral: "GC",
    hwostatusreason: "OMO Completed",
    hwocreatedate: "2022-07-05T00:00:00.000",
    hwodescription: "nyc hpd emergency operations division \u001a \u001a essential service work \u001a at apt # 16r. replace the installed key operated lock installed at door le",
    hwoapprovedamount: "47.84",
    salestax: "4.25",
    adminfee: "23.92",
    chargeamount: "76.01",
    datetransferdof: "2023-03-02T00:00:00.000",
  };
  const STAFF_OTHERS: Row = {
    hwonumber: "EM23595",
    lifecycle: "Standing Building",
    worktypegeneral: "PLUMB",
    hwostatusreason: "Work Done by Others",
    hwocreatedate: "2022-05-02T00:00:00.000",
    hwodescription: "nyc hpd emerency operations division \u001a\u001a at apt 14l, bedroom: replace defective/broken air valve, with new air valve on radiator in 1st",
    hwoapprovedamount: "20.34",
    salestax: "1.81",
    adminfee: "10.17",
    chargeamount: "32.32",
    datetransferdof: "2022-08-15T00:00:00.000",
  };
  const repairs = (over: Partial<RawBuildingData>) => computeViolations(raw(over)).items.filter((v) => v.source === "repairs");

  it("makes one closed row per order, with the work type in the headline and the apartment as its place", () => {
    const [done, refused] = repairs({ repairOrders: [DONE, REFUSED] });
    expect(done).toMatchObject({
      source: "repairs",
      kind: "repairs",
      id: "EN05211",
      ref: "HPD open market order EN05211",
      what: "City made an emergency repair: general repairs",
      where: "Apt 15L",
      area: "apartment",
      unit: "15L",
      date: "2022-08-29",
      status: "closed",
      closedAt: null,
      cityStatus: "OMO completed",
      original: DONE.omodescription,
      amount: 250,
      done: true,
    });
    expect(done!.facts).toEqual([
      ["Work type", "General repairs (GC)"],
      ["Work given to", "A contractor hired by the city"],
      ["Awarded to the contractor", "2022-08-30"],
      ["Amount awarded", "$250"],
    ]);
    // A cancelled order is still a row, says why, and doesn't claim the city did the work.
    expect(refused).toMatchObject({ what: "City ordered an emergency repair: general repairs", status: "closed", cityStatus: "Tenant refused access", where: "Apt 12R", amount: 50, done: false });
    expect(refused!.facts).toContainEqual(["Service charge for a cancelled visit", "Yes"]);
  });

  it("reads a handyman order's apartment from its description, and carries every amount", () => {
    const [done, others] = repairs({ handymanOrders: [STAFF_DONE, STAFF_OTHERS] });
    expect(done).toMatchObject({ id: "EN00405", ref: "HPD handyman work order EN00405", what: "City made an emergency repair: general repairs", where: "Apt 16R", unit: "16R", amount: 76.01, done: true, date: "2022-07-05" });
    // The control characters the city's text carries are gone from the wording.
    expect(done!.original).toBe("nyc hpd emergency operations division essential service work at apt # 16r. replace the installed key operated lock installed at door le");
    expect(done!.facts).toEqual([
      ["Work type", "General repairs (GC)"],
      ["Work given to", "City staff"],
      ["Cost of the work", "$47.84"],
      ["Sales tax", "$4.25"],
      ["City's administrative fee", "$23.92"],
      ["Charged to the landlord", "$76.01"],
      ["Sent to the finance department to collect", "2023-03-02"],
    ]);
    expect(others).toMatchObject({ what: "City ordered an emergency repair: plumbing", cityStatus: "Work done by others", where: "Apt 14L", done: false, amount: 32.32 });
  });

  it("keeps a work type it has no words for as the city writes it, and names the two that are charges", () => {
    const [move, fee, admin, none] = repairs({
      repairOrders: [
        { ...DONE, omonumber: "1", apartment: undefined, worktypegeneral: "MOVE", omodescription: "keep the belongings in storage", omocreatedate: "2026-04-01T00:00:00.000" },
        { ...DONE, omonumber: "2", apartment: undefined, worktypegeneral: "AEPFEE", omostatusreason: "Work Partially Completed", isaep: "AEP", omodescription: "task fee omo for work omo eb16275", omocreatedate: "2026-03-01T00:00:00.000" },
        { ...DONE, omonumber: "3", apartment: "BLDG", worktypegeneral: "7AFA", omostatusreason: undefined, omoawardamount: "448800", netchangeorders: "-800", omodescription: "building rehab", omocreatedate: "2026-02-01T00:00:00.000", lifecycle: "Under Construction", femaevent: "Hurricane Sandy", iscommercialdemolition: "COMM DEMOL" },
        { ...DONE, omonumber: "4", apartment: undefined, omoawardamount: undefined, omodescription: "at apartment 2nd floor, replace the door", omocreatedate: "2026-01-01T00:00:00.000" },
      ],
    });
    expect(move).toMatchObject({ what: "City made an emergency repair", where: "Building", area: "building" });
    expect(move!.facts).toContainEqual(["Work type", "MOVE"]);
    expect(fee!.what).toBe("City charged a fee for its enforcement program's work");
    expect(fee!.facts).toContainEqual(["Under the Alternative Enforcement Program", "Yes"]);
    expect(admin).toMatchObject({ what: "City paid for repairs under a court-appointed administrator", cityStatus: "No status on file", done: false, amount: 448000, where: "Building" });
    expect(admin!.facts).toEqual(expect.arrayContaining([["Amount awarded", "$448,800"], ["Change orders", "-$800"], ["Commercial demolition", "Yes"], ["Disaster event", "Hurricane Sandy"], ["Building stage", "Under Construction"]]));
    // "2nd floor" is not an apartment, and an order with no award has no amount.
    expect(none).toMatchObject({ where: "Building", area: "building" });
    expect(none).not.toHaveProperty("amount");
    // An order for a shared part of the building is in the common areas, unless it names an apartment.
    const [hall, roof, apt] = repairs({
      repairOrders: [
        { ...DONE, omonumber: "5", apartment: undefined, omodescription: "at public hall 4th story repair roof that wiill not leak at sky light", omocreatedate: "2026-03-03T00:00:00.000" },
        { ...DONE, omonumber: "6", apartment: undefined, omodescription: "at bulkhead: **roof** trace and repair the leak at the skylight", omocreatedate: "2026-03-02T00:00:00.000" },
        { ...DONE, omonumber: "7", apartment: "4R", omodescription: "apt 4r, ceiling under the roof: repair the leak", omocreatedate: "2026-03-01T00:00:00.000" },
      ],
    });
    expect([hall, roof].map((x) => [x!.where, x!.area])).toEqual([["Common area", "common"], ["Common area", "common"]]);
    expect(apt).toMatchObject({ where: "Apt 4R", area: "apartment", unit: "4R" });
  });

  it("sorts into the same newest-first list as the violations, and flags its limit or a failed query", () => {
    const h = computeViolations(
      raw({
        repairOrders: [DONE, REFUSED],
        handymanOrders: [STAFF_DONE],
        ratInspections: [{ job_id: "PC1", inspection_date: "2022-08-01T09:00:00.000", result: "Failed for Rat Activity" }],
        hpdViolationRows: [{ violationid: "9", class: "B", inspectiondate: "2022-07-10T00:00:00.000", violationstatus: "Open", novdescription: "REPAIR THE LEAK" }],
      }),
    );
    expect(h.items.map((v) => [v.source, v.date])).toEqual([
      ["repairs", "2022-08-29"],
      ["rats", "2022-08-01"],
      ["repairs", "2022-07-15"],
      ["housing", "2022-07-10"],
      ["repairs", "2022-07-05"],
    ]);
    expect(h.totals).toMatchObject({ rats: 1, repairs: 3 });
    expect(h.truncated.repairs).toBe(false);
    const full = Array.from({ length: VIOLATION_LIMITS.repairs }, (_, i) => ({ ...DONE, omonumber: String(i) }));
    expect(computeViolations(raw({ repairOrders: full })).truncated.repairs).toBe(true);
    expect(computeViolations(raw({ handymanOrders: full.map((r) => ({ ...STAFF_DONE, hwonumber: r.omonumber })) })).truncated.repairs).toBe(true);
    expect(computeViolations(raw({ failed: ["handymanOrders"] })).unavailable).toEqual(["repairs"]);
    expect(computeViolations(raw({ failed: ["repairOrders", "ratInspections"] })).unavailable).toEqual(["rats", "repairs"]);
  });

  it("leaves the snapshot's violation numbers, and everything else on the report, as they were", () => {
    const housing = {
      hpdViolationRows: [{ violationid: "9", class: "B", inspectiondate: "2026-07-10T00:00:00.000", violationstatus: "Open", novdescription: "REPAIR THE LEAK LOCATED AT APT 3FW", apartment: "3FW" }],
      hpdYear: [{ violationstatus: "Open", n: "1" }],
    };
    const before = build(housing);
    const after = build({
      ...housing,
      // An open rat failure and a repair in the searched apartment, both inside the last twelve months.
      ratInspections: [{ job_id: "PC1", inspection_date: "2026-08-01T09:00:00.000", result: "Failed for Rat Activity" }],
      repairOrders: [{ ...DONE, apartment: "3FW", omocreatedate: "2026-08-29T00:00:00.000" }],
      handymanOrders: [{ ...STAFF_DONE, hwocreatedate: "2026-09-05T00:00:00.000" }],
    });
    expect(after.violations!.items.map((v) => [v.source, v.status])).toEqual([["repairs", "closed"], ["repairs", "closed"], ["rats", "open"], ["housing", "open"]]);
    expect(snapshotOf(after)).toEqual(snapshotOf(before));
    expect(snapshotOf(after)).toMatchObject({ openViolations: 1, openHazards: 1, openInUnit: 1, issued12mo: 1, unfixed12mo: 1 });
    const { violations: _a, ...rest } = after;
    const { violations: _b, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    // The free preview's sample row may be one of the new kinds; its open count is still the snapshot's.
    const teaser = teaserOf(after, raw());
    expect(teaser.preview).toMatchObject({ openViolations: 1, violation: { source: "repairs" } });
  });
});

describe("city programs", () => {
  /** Live hcir-3275 and bzxi-2tsw rows for 1018 Eastern Parkway, and an h4mf-f24e row for 70 West 128 Street (2026-10-03). */
  const AEP: Row[] = [
    { aep_start_date: "2023-01-31T00:00:00.000", of_b_c_violations_at_start: "2725", current_status: "AEP Active", aep_round: "Aep Round 16" },
    { aep_start_date: "2013-01-31T00:00:00.000", of_b_c_violations_at_start: "2725", current_status: "AEP Discharged", discharge_date: "2018-10-31T00:00:00.000", aep_round: "Aep Round 6" },
  ];
  const SENSORS: Row = { program_start_date: "2025-06-11T00:00:00.000", current_status: "Active" };
  const LISTED: Row = { bqi: "Yes", aep_order: "No", discharged_7a: "No", hpd_vacate_order: "No", dob_vacate_order: "No", harassment_finding: "No", date_added: "2022-06-24T00:00:00.000" };
  const ACRONYM = /\b(AEP|HSP|CONH|HPD)\b/;

  it("lists each stint in the enforcement program, open until the city discharges the building", () => {
    const h = computeLegal(raw({ aep: AEP }));
    expect(h.items.map((x) => [x.kind, x.what, x.date, x.status, x.closedAt, x.area, x.where])).toEqual([
      ["program", "Put in the city's program for its worst-maintained buildings", "2023-01-31", "open", null, "building", "Building"],
      ["program", "Put in the city's program for its worst-maintained buildings", "2013-01-31", "closed", "2018-10-31", "building", "Building"],
    ]);
    // The dataset repeats one count of violations on every stint, and the label says so.
    expect(h.items[1]!.facts).toEqual([
      ["Status", "Discharged"],
      ["Started", "2013-01-31"],
      ["Discharged", "2018-10-31"],
      ["Round", "6"],
      ["Hazardous violations open at the start (the city gives one figure for all of this building's stints)", "2,725"],
      ["From", "Alternative Enforcement Program (HPD)"],
    ]);
    expect(h.items[0]!.facts.slice(0, 2)).toEqual([["Status", "Active"], ["Started", "2023-01-31"]]);
    expect(computeLegal(raw({ aep: [AEP[1]!] })).items[0]!.facts).toContainEqual(["Hazardous violations open at the start", "2,725"]);
    // A status that says discharged closes it even without a date.
    expect(computeLegal(raw({ aep: [{ ...AEP[0]!, current_status: "AEP Discharged" }] })).items[0]).toMatchObject({ status: "closed", closedAt: null });
  });

  it("lists the heat sensor program the same way", () => {
    const [active] = computeLegal(raw({ heatSensors: [SENSORS] })).items;
    expect(active).toMatchObject({ kind: "program", what: "Required to install heat sensors after heat violations and complaints", date: "2025-06-11", status: "open", closedAt: null, area: "building" });
    expect(active!.facts).toEqual([["Status", "Active"], ["Started", "2025-06-11"], ["From", "Heat Sensor Program (HPD)"]]);
    const [out] = computeLegal(raw({ heatSensors: [{ ...SENSORS, current_status: "Discharged", discharge_date: "2026-07-01T00:00:00.000" }] })).items;
    expect(out).toMatchObject({ status: "closed", closedAt: "2026-07-01" });
    expect(out!.facts).toContainEqual(["Discharged", "2026-07-01"]);
  });

  it("lists the harassment list as open while the building is on it, with why it is listed", () => {
    const [x] = computeLegal(raw({ harassmentList: [LISTED] })).items;
    expect(x).toMatchObject({ kind: "program", what: "Landlord must show no tenant harassment before major construction permits", date: "2022-06-24", status: "open", closedAt: null, area: "building" });
    expect(x!.facts).toEqual([
      ["Status", "On the list"],
      ["Added", "2022-06-24"],
      ["Distress score over the city's threshold (Building Qualification Index)", "Yes"],
      ["Discharged from the Alternative Enforcement Program", "No"],
      ["Discharged from a court-appointed administrator (7A)", "No"],
      ["Vacate order from the housing department", "No"],
      ["Vacate order from the buildings department", "No"],
      ["Finding of tenant harassment by a court or the state", "No"],
      ["From", "Certification of No Harassment pilot building list (HPD)"],
    ]);
  });

  it("keeps program acronyms out of every headline, sorts programs in with the rest, and says when one didn't load", () => {
    const h = computeLegal(raw({ aep: AEP, heatSensors: [SENSORS], harassmentList: [LISTED], evictions: [EVICTION] }));
    expect(h.items.map((x) => [x.kind, x.date])).toEqual([
      ["eviction", "2025-11-13"],
      ["program", "2025-06-11"],
      ["program", "2023-01-31"],
      ["program", "2022-06-24"],
      ["program", "2013-01-31"],
    ]);
    for (const x of h.items) expect(x.what).not.toMatch(ACRONYM);
    expect(h.unavailable).toEqual([]);
    expect(computeLegal(raw({ failed: ["heatSensors"] })).unavailable).toEqual(["program"]);
    expect(computeLegal(raw({ failed: ["aep", "harassmentList", "vacate"] })).unavailable).toEqual(["vacate", "program"]);
  });

  it("doesn't count as an open legal matter, or change the legal card", () => {
    const before = build({ litigations: [{ casetype: "Tenant Action", caseopendate: "2026-08-28T00:00:00.000", casestatus: "PENDING" }] });
    const after = build({ litigations: [{ casetype: "Tenant Action", caseopendate: "2026-08-28T00:00:00.000", casestatus: "PENDING" }], aep: AEP, heatSensors: [SENSORS], harassmentList: [LISTED] });
    expect(after.legal!.items.filter((x) => x.kind === "program" && x.status === "open")).toHaveLength(3);
    expect(snapshotOf(after)!.openLegal).toBe(1);
    expect(snapshotOf(after)).toEqual(snapshotOf(before));
    expect(card(after, "legal")).toEqual(card(before, "legal"));
    expect(after.counts).toEqual(before.counts);
  });
});

describe("property records", () => {
  const doc = (doc_type: string, date: string, amount: string, over: Row = {}): Row => ({ document_id: `${date}-${doc_type}`, doc_type, document_date: `${date}T00:00:00.000`, recorded_datetime: `${date}T00:00:00.000`, document_amt: amount, percent_trans: "100", ...over });
  const BBL = "2025050046";
  const property = (docs: Row[], over: Partial<RawBuildingData> = {}, bbl = BBL) => computeProperty(raw({ acrisDocs: docs, ...over }), bbl);

  it("takes the newest deed with a price as the last sale, and the newest mortgage", () => {
    const p = property([doc("MTGE", "2013-08-26", "31000000"), doc("DEED", "2013-10-07", "111045119"), doc("MTGE", "2012-07-09", "30000000"), doc("DEED", "1998-03-01", "4000000")]);
    expect(p.sale).toEqual({ date: "2013-10-07", price: 111045119 });
    expect(p.mortgage).toEqual({ date: "2013-08-26", amount: 31000000 });
  });

  it("treats a deed with no price, or a token one, as a transfer", () => {
    // 1130 Anderson Avenue (2026-10-03): its newest deed is for $1 and the older ones name nothing.
    const anderson = property([doc("MTGE", "2018-03-14", "1475000"), doc("DEED", "2017-06-21", "1"), doc("DEED", "1996-04-02", "0"), doc("MTGE", "1992-09-04", "280000")]);
    expect(anderson.sale).toEqual({ date: "2017-06-21", price: null });
    expect(anderson.mortgage).toEqual({ date: "2018-03-14", amount: 1475000 });
    // A real sale, then a transfer with no price: the sale stands, and the transfer is noted.
    expect(property([doc("DEED", "2021-06-01", "0"), doc("DEED", "2015-03-03", "4200000")]).sale).toEqual({ date: "2015-03-03", price: 4200000, transferred: "2021-06-01" });
    expect(property([doc("DEED", "2015-03-03", "2100000", { percent_trans: "50" })]).sale).toEqual({ date: "2015-03-03", price: 2100000, share: 50 });
  });

  it("reads only deeds and mortgages, dates a document by its recording when its own date is missing or impossible, and has nulls when the lot has none", () => {
    const p = property([
      doc("AGMT", "2024-05-30", "300000000"),
      doc("ASST", "2023-01-01", "5000000"),
      doc("MTGE", "", "0", { document_date: undefined, recorded_datetime: "1992-09-04T00:00:00.000" }),
      doc("DEED", "0200-01-01", "900000", { recorded_datetime: "2009-09-09T00:00:00.000" }),
    ]);
    expect(p.sale).toEqual({ date: "2009-09-09", price: 900000 });
    expect(p.mortgage).toEqual({ date: "1992-09-04", amount: null });
    expect(property([])).toEqual({ sale: null, mortgage: null, taxLien: null });
  });

  it("leaves the sale and mortgage out for a condo building, and when ACRIS didn't load", () => {
    expect(property([doc("DEED", "2015-03-03", "4200000")], {}, "1012237503")).toEqual({ taxLien: null });
    expect(property([], { failed: ["acrisDocs"] })).toEqual({ taxLien: null });
  });

  it("takes the latest tax lien sale listing, its stage, and whether it was for water debt alone", () => {
    // 9rz4-mjek rows for 1018 Eastern Parkway (2026-10-03).
    const liens: Row[] = [
      { month: "2025-04-01T00:00:00.000", cycle: "30 Day Notice", water_debt_only: "NO" },
      { month: "2025-05-01T00:00:00.000", cycle: "10 Day Notice", water_debt_only: "NO" },
      { month: "2021-12-03T00:00:00.000", cycle: "10 Day Notice", water_debt_only: "NO" },
    ];
    expect(property([], { taxLiens: liens }).taxLien).toEqual({ month: "2025-05-01", stage: "10 Day Notice", waterOnly: false });
    // The city writes yes as YES in some years and Y in others.
    expect(property([], { taxLiens: [{ month: "2025-06-01T00:00:00.000", cycle: "Final Sale", water_debt_only: "YES" }] }).taxLien).toEqual({ month: "2025-06-01", stage: "Final Sale", waterOnly: true });
    expect(property([], { taxLiens: [{ month: "2019-07-01T00:00:00.000", cycle: "10 Day Notice", water_debt_only: "Y" }] }).taxLien!.waterOnly).toBe(true);
    expect(property([], { failed: ["taxLiens"] })).toEqual({ sale: null, mortgage: null });
  });

  it("is on the report", () => {
    expect(build({ acrisDocs: [doc("DEED", "2015-03-03", "4200000")] }).property).toEqual({ sale: { date: "2015-03-03", price: 4200000 }, mortgage: null, taxLien: null });
    expect(build().sources).toEqual([]);
  });
});

describe("building facts from the other building records", () => {
  const cover = (over: Partial<RawBuildingData> = {}) => build(over).cover;

  it("flood zone: says which of the two maps puts the lot in the floodplain, and no when neither does", () => {
    expect(cover().floodZone).toEqual({ firm2007: false, prelim2015: false });
    expect(cover({ pluto: [{ firm07_flag: "1", pfirm15_flag: "1" }] }).floodZone).toEqual({ firm2007: true, prelim2015: true });
    expect(cover({ pluto: [{ pfirm15_flag: "1" }] }).floodZone).toEqual({ firm2007: false, prelim2015: true });
    // No PLUTO row, or none loaded: nothing to say.
    expect(cover({ pluto: [] }).floodZone).toBeNull();
    expect(cover({ pluto: [], failed: ["pluto"] })).not.toHaveProperty("floodZone");
  });

  it("facade: the newest cycle's status, by cycle number, with the date its newest report was filed", () => {
    // xubg-57si rows for 350 Fifth Avenue (2026-10-03): cycle is text, and the newest cycle's report is still under review.
    const rows: Row[] = [
      { cycle: "9", filing_type: "Auto-Generated", current_status: "SWARMP", filing_status: "No Report Filed" },
      { cycle: "9", filing_type: "Subsequent", submitted_on: "2024-11-27T00:00:00.000", current_status: "SWARMP", filing_date: "2024-11-27T00:00:00.000", filing_status: "SWARMP" },
      { cycle: "9", filing_type: "Initial", submitted_on: "2022-02-21T00:00:00.000", current_status: "SWARMP", filing_date: "2022-02-21T00:00:00.000", filing_status: "SWARMP" },
      { cycle: "6", filing_type: "Initial", submitted_on: "2006-12-12T00:00:00.000", current_status: "SWARMP", filing_date: "2006-12-12T00:00:00.000", filing_status: "UNSAFE" },
    ];
    expect(cover({ facades: rows }).facade).toEqual({ status: "Safe with repairs needed", cycle: 9, filed: "2024-11-27" });
    const ten: Row = { cycle: "10", filing_type: "Initial", submitted_on: "2026-08-31T00:00:00.000", filing_date: "2026-08-31T00:00:00.000", filing_status: "SAFE" };
    expect(cover({ facades: [...rows, ten] }).facade).toEqual({ status: "Safe", cycle: 10, filed: "2026-08-31" });
    expect(cover({ facades: [{ cycle: "9", filing_type: "Initial", current_status: "UNSAFE", filing_date: "2023-05-01T00:00:00.000", filing_status: "UNSAFE" }] }).facade).toMatchObject({ status: "Unsafe" });
    // 1130 Anderson Avenue: the city's own row for a building that filed nothing.
    expect(cover({ facades: [{ cycle: "9", filing_type: "Auto-Generated", current_status: "No Report Filed", filing_status: "No Report Filed" }] }).facade).toEqual({ status: "No report filed", cycle: 9, filed: null });
    expect(cover().facade).toBeNull();
    expect(cover({ failed: ["facades"] })).not.toHaveProperty("facade");
  });

  it("boiler: the newest inspection, and whether each boiler's newest filing reports defects", () => {
    const row = (boiler_id: string, tracking: string, date: string, defects: string, report_type = "Initial"): Row => ({ tracking_number: tracking, boiler_id, report_type, inspection_date: `${date} 00:00:00`, defects_exist: defects });
    // 52dp-yji6 rows for 1018 Eastern Parkway, newest filing first as the query returns them.
    const sample = [row("A", "2026-A-866761", "05/13/2026", "Yes"), row("A", "2024-A-659257", "04/05/2024", "No"), row("A", "2023-A-599280", "08/29/2023", "No")];
    expect(cover({ boilers: sample }).boiler).toEqual({ inspected: "2026-05-13", boilers: 1, withDefects: 1 });
    // 1130 Anderson Avenue, 2024: a later filing corrected the defects of that year's inspection.
    expect(cover({ boilers: [row("B", "2024-B-684055", "07/02/2024", "No", "Subsequent"), row("B", "2024-B-661412", "04/13/2024", "Yes")] }).boiler).toEqual({ inspected: "2024-07-02", boilers: 1, withDefects: 0 });
    // Two boilers in use, and one last inspected years before them, which doesn't count.
    const several = [row("A", "2026-A-2", "03/10/2026", "No"), row("C", "2026-C-1", "02/01/2026", "Yes"), row("OLD", "2019-OLD-1", "01/15/2019", "Yes")];
    expect(cover({ boilers: several }).boiler).toEqual({ inspected: "2026-03-10", boilers: 2, withDefects: 1 });
    expect(cover({ boilers: [{ boiler_id: "A", inspection_date: "not a date" }] }).boiler).toBeNull();
    expect(cover().boiler).toBeNull();
    expect(cover({ failed: ["boilers"] })).not.toHaveProperty("boiler");
  });

  it("legal apartments: the units on the newest certificate of occupancy, skipping one dated in the future", () => {
    // bs8b-p36w rows for BIN 1089806 (2026-10-03); the first is dated 2105 in the city's data.
    const rows: Row[] = [
      { c_o_issue_date: "2105-11-05T00:00:00.000", pr_dwelling_unit: "198", issue_type: "Temporary" },
      { c_o_issue_date: "2022-06-27T00:00:00.000", pr_dwelling_unit: "198", issue_type: "Final" },
      { c_o_issue_date: "2021-03-02T00:00:00.000", pr_dwelling_unit: "190", issue_type: "Temporary" },
    ];
    expect(cover({ certificates: rows }).legalUnits).toEqual({ units: 198, date: "2022-06-27", temporary: false });
    expect(cover({ certificates: rows.slice(2) }).legalUnits).toEqual({ units: 190, date: "2021-03-02", temporary: true });
    expect(cover({ certificates: rows.slice(0, 1) }).legalUnits).toBeNull();
    expect(cover().legalUnits).toBeNull();
    expect(cover({ failed: ["certificates"] })).not.toHaveProperty("legalUnits");
  });

  it("work permits: how many were issued in twelve months, with their work types, or null when none were", () => {
    const rows: Row[] = [
      { work_type: "General Construction", permits: "22", latest: "2026-09-14T00:00:00.000" },
      { work_type: "Plumbing", permits: "12", latest: "2026-06-26T00:00:00.000" },
      { work_type: "Sidewalk Shed", permits: "1", latest: "2026-07-21T00:00:00.000" },
    ];
    expect(cover({ permits: rows }).permits12mo).toEqual({ count: 35, types: ["General Construction", "Plumbing", "Sidewalk Shed"] });
    expect(cover().permits12mo).toBeNull();
    expect(cover({ failed: ["permits"] })).not.toHaveProperty("permits12mo");
  });

  it("asbestos: counts projects, not their rows, and takes the latest that isn't dated centuries away", () => {
    const rows: Row[] = [
      { tru: "TRU9999MN26", start_date: "2423-10-31T23:00:00.000", status_description: "Submitted" },
      { tru: "TRU1064MN26", start_date: "2026-05-04T00:00:00.000", status_description: "Closed" },
      { tru: "TRU2782MN25", start_date: "2026-01-02T00:00:00.000", status_description: "Closed" },
      { tru: "TRU2782MN25", start_date: "2026-01-02T00:00:00.000", status_description: "Postponed" },
    ];
    expect(cover({ asbestos: rows }).asbestos).toEqual({ filings: 3, latestStart: "2026-05-04", latestStatus: "Closed" });
    expect(cover().asbestos).toBeNull();
    expect(cover({ failed: ["asbestos"] })).not.toHaveProperty("asbestos");
  });

  it("rent stabilization hint: a 421-a or J-51 exemption on this tax year's roll, and nothing for an earlier year's", () => {
    // The report is dated October 2026: tax year 2027 (July 2026 to June 2027). muvi-b6kx rows for lot 1000160185.
    const a421: Row[] = [
      { year: "2027", period: "3", exmp_code: "5116", curexmptot: "8812692" },
      { year: "2026", period: "3", exmp_code: "5116", curexmptot: "18124524" },
    ];
    expect(cover({ exemptions: a421 }).taxBreak).toEqual({ program: "421-a", taxYear: 2027 });
    expect(cover({ exemptions: [{ year: "2027", period: "1", exmp_code: "1920", curexmptot: "164602" }] }).taxBreak).toEqual({ program: "J-51", taxYear: 2027 });
    expect(cover({ exemptions: a421.slice(1) }).taxBreak).toBeNull();
    expect(cover().taxBreak).toBeNull();
    expect(cover({ failed: ["exemptions"] })).not.toHaveProperty("taxBreak");
    // Before July the tax year is the calendar year.
    const june = computeReport({ id: "x", address: ADDRESS, raw: { ...raw({ exemptions: a421 }), fetchedAt: "2026-06-30T12:00:00.000Z" }, now: new Date("2026-06-30T12:00:00Z") }).cover;
    expect(june.taxBreak).toEqual({ program: "421-a", taxYear: 2026 });
  });

  it("is on the teaser's cover too, so the free preview shows the same tiles", () => {
    const over = { pluto: [{ firm07_flag: "1" }], permits: [{ work_type: "Plumbing", permits: "2" }] };
    const r = build(over);
    expect(teaserOf(r, raw(over)).cover).toEqual(r.cover);
    expect(r.cover).toMatchObject({ floodZone: { firm2007: true, prelim2015: false }, permits12mo: { count: 2, types: ["Plumbing"] } });
  });
});
