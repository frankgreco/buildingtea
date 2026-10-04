import { describe, expect, it, vi } from "vitest";
import { rewriteSummary } from "../src/lib/llm";
import { alsoOnFile, templateSummary } from "../src/lib/summary";
import type { Snapshot } from "../shared/snapshot";
import type { Address, Bedbugs, Card, Counts, Cover, LegalRecord, Ownership, Report, ViolationRecord } from "../shared/types";

const address: Address = { label: "x", borough: "Bronx", zip: "10452", bin: "2003068", bbl: "2025050046", houseNumber: "1130", street: "ANDERSON AVENUE", unit: null, lotOnly: false, hpdBuildingId: "45427", lat: 0, lon: 0 };
const cover: Cover = { yearBuilt: 1928, yearAltered: null, unitsRes: 42, unitsTotal: 42, floors: 6, buildingsOnLot: 1, buildingClass: "D1", zoning: "R7-1", plutoOwner: "X", historicDistrict: null, landmark: null, elevators: 1, plutoVersion: "26v2" };
const counts: Counts = {
  openA: 10, openB: 39, openC: 28, openI: 0, rentImpairing: 6, newestOpenHazardous: "2026-09-12", oldestOpenHazardous: "2017-02-01",
  complaints12mo: 33, problems12mo: 71, openComplaints: 3, heat12mo: 14, plumbing12mo: 2, pests12mo: 25,
  dobBisActive: 3, dobNowActive: 2, ecbActive: 4, ecbBalanceDue: 10625, dobComplaintsActive: 0, elevatorsActive: 1, elevatorIssues: 3,
  evictions3y: 5, litigationsPending: 1, harassmentFinding: false, vacateActive: false, noise12mo: 3,
};
const ownership: Ownership = { registrationId: "209634", registrationExpires: "2026-09-01", lastRegistered: "2025-10-08", registrationState: "grace", registeredOwner: "1130 SHEVA REALTY HDFC, INC", headOfficer: "MARK ENGEL", managingAgent: "LANGSAM PROPERTY SERVICES CORP", agentContact: "GREG GADSON", siteManager: null, agentAddress: null };
const bedbugs: Bedbugs = { lastFilingDate: "2025-12-03", periodStart: "2024-11-01", periodEnd: "2025-10-31", dwellingUnits: 42, infested: 0, eradicated: 0, reinfested: 0, missingLatest: false, required: true };
const cards: Card[] = [{ key: "safe", question: "Is it safe?", status: "critical", label: "Critical", answer: "", details: [] }];

describe("templateSummary", () => {
  it("is written for someone about to sign a lease, and uses no agency acronyms", () => {
    const s = templateSummary({ address, cover, counts, ownership, bedbugs, cards });
    // The free preview shows the first sentence alone, so it only says what the building is.
    expect(s).toMatch(/^A 42-unit elevator building from 1928\. /);
    expect(s).toMatch(/The big thing to know before signing: the city has 67 hazardous problems on file here that the landlord hasn't fixed, 28 of them immediately hazardous, the newest from Sep 2026\./);
    expect(s).toMatch(/complained to the city about heat or hot water 14 times/);
    expect(s).toMatch(/1 housing court case against the landlord is pending/);
    expect(s).toMatch(/5 evictions/);
    expect(s).toMatch(/Before you sign, ask the landlord what is being done about the open problems, and look for them when you see the apartment\.$/);
    expect(s).not.toMatch(/\b(HPD|DOB|ECB|OATH)\b/);
    // It lays out what to check; it never tells the reader what to do about the lease.
    expect(s).not.toMatch(/\b(don't|do not|should|shouldn't) sign\b/i);
  });

  it("uses the snapshot's numbers when the report has them: each complaint once, the apartment, and what is unfixed", () => {
    const snapshot: Snapshot = { openViolations: 86, openComplaints: 1, bedbugsReported: false, openHazards: 67, openInUnit: 14, issued12mo: 46, unfixed12mo: 39, heatComplaints12mo: 12, housingComplaints12mo: 33, openLegal: 1, bedbugs: { state: "filed", infested: 0, units: 42, periodEnd: "2025-10-31" } };
    const s = templateSummary({ address: { ...address, unit: "D5" }, cover, counts, ownership, bedbugs, cards, snapshot });
    expect(s).toMatch(/14 open violations are in apartment D5 itself\./);
    expect(s).toMatch(/39 of the 46 violations issued in the last year are still open\./);
    expect(s).toMatch(/heat or hot water 12 times/);
    expect(s).not.toMatch(/14 times/);
  });

  it("says so when the records are clean, and still sends the reader to see the place", () => {
    const clean: Counts = { ...counts, openB: 0, openC: 0, heat12mo: 0, complaints12mo: 0, openComplaints: 0, litigationsPending: 0, ecbActive: 0, evictions3y: 0 };
    const s = templateSummary({ address, cover, counts: clean, ownership: { ...ownership, registrationState: "current" }, bedbugs, cards: [{ ...cards[0]!, status: "good" }] });
    expect(s).toMatch(/The city lists no open hazardous conditions here\./);
    expect(s).toMatch(/Tenants made no complaints to the city in the last 12 months\./);
    expect(s).toMatch(/Nothing in the city's records stands out as a red flag, but see the apartment in person before you sign\.$/);
  });

  it("leads with a vacate order, and treats old never-reinspected violations as probably stale", () => {
    expect(templateSummary({ address, cover, counts: { ...counts, vacateActive: true }, ownership, bedbugs, cards })).toMatch(
      /The big thing to know before signing: part or all of it is under a city vacate order right now.*Before going any further, ask the landlord when that order will be lifted\.$/,
    );
    const stale = templateSummary({ address, cover, counts, ownership, bedbugs, cards: [{ ...cards[0]!, status: "warn" }] });
    expect(stale).toMatch(/probably old paperwork rather than live problems\./);
    expect(stale).toMatch(/Before you sign, ask the landlord whether those were fixed\.$/);
  });
});

describe("the newer records, as facts for the summary", () => {
  const v = (over: Partial<ViolationRecord>): ViolationRecord => ({ source: "housing", kind: "hazardous", id: "1", ref: "", what: "x", where: "Building", date: "2026-09-12", status: "open", cityStatus: "", closedAt: null, original: "", ...over });
  const program = (what: string, date: string, status: LegalRecord["status"]): LegalRecord => ({ kind: "program", what, where: "Building", date, status, closedAt: null, facts: [] });
  const report = {
    cover: { ...cover, floodZone: { firm2007: false, prelim2015: true } },
    violations: {
      items: [
        v({}),
        v({ source: "rats", kind: "rats", date: "2020-02-27", status: "closed" }),
        v({ source: "rats", kind: "rats", date: "2026-04-01" }),
        v({ source: "repairs", kind: "repairs", status: "closed", date: "2022-08-29", amount: 250, done: true }),
        v({ source: "repairs", kind: "repairs", status: "closed", date: "2022-07-05", amount: 76.01, done: true }),
        v({ source: "repairs", kind: "repairs", status: "closed", date: "2022-09-14", amount: 34320, done: false }),
      ],
    },
    legal: {
      items: [
        program("Put in the city's program for its worst-maintained buildings", "2023-01-31", "open"),
        program("Put in the city's program for its worst-maintained buildings", "2013-01-31", "closed"),
        { kind: "case", what: "Court case: Tenant Action", where: "Building", date: "2026-08-28", status: "open", closedAt: null, facts: [] },
      ],
    },
    property: { taxLien: { month: "2025-05-01", stage: "10 Day Notice", waterOnly: false } },
  } as unknown as Report;

  it("counts rat inspections and city repairs, names the programs the building is in, and gives the lien listing and flood zone", () => {
    expect(alsoOnFile(report)).toEqual({
      failedRatInspections: 2,
      failedRatInspectionsNotPassedSince: 1,
      latestFailedRatInspection: "2026-04-01",
      cityEmergencyRepairOrders: 3,
      cityEmergencyRepairsCarriedOut: 2,
      // Only the orders the city carried out, and written out so the model's number guard knows it.
      cityEmergencyRepairsCarriedOutCost: "$326",
      latestCityEmergencyRepairOrder: "2022-09-14",
      activeCityPrograms: ["Put in the city's program for its worst-maintained buildings, since Jan 2023"],
      taxLienSaleList: "May 2025, 10 Day Notice, not for water debt alone",
      inFloodZone: true,
    });
  });

  it("is all zeros and nulls on a report stored before any of these", () => {
    expect(alsoOnFile({ cover } as unknown as Report)).toEqual({
      failedRatInspections: 0,
      failedRatInspectionsNotPassedSince: 0,
      latestFailedRatInspection: null,
      cityEmergencyRepairOrders: 0,
      cityEmergencyRepairsCarriedOut: 0,
      cityEmergencyRepairsCarriedOutCost: null,
      latestCityEmergencyRepairOrder: null,
      activeCityPrograms: [],
      taxLienSaleList: null,
      inFloodZone: null,
    });
  });

  it("reaches the summary model in its facts, so the rewrite may quote them", async () => {
    const reply = "This building failed a rat inspection in April and the city has made repairs here that cost $326. Ask the landlord about both before you sign anything.";
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model: "test", choices: [{ message: { content: reply } }] })));
    const out = await rewriteSummary({ apiKey: "sk-test", fetcher: fetcher as unknown as typeof fetch }, { address, cover, counts, ownership, bedbugs, cards, also: alsoOnFile(report) }, "Draft.");
    const sent = JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).messages[1].content as string;
    expect(JSON.parse(sent.slice(sent.indexOf("{"))).facts.alsoOnFile).toEqual(alsoOnFile(report));
    // 326 is in the facts, so the guard on numbers lets the rewrite through.
    expect(out?.text).toBe(reply);
  });
});
