import { describe, expect, it } from "vitest";
import { templateSummary } from "../src/lib/summary";
import type { Address, Bedbugs, Card, Counts, Cover, Ownership } from "../shared/types";

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
  it("reads like the product copy and uses no agency acronyms", () => {
    const s = templateSummary({ address, cover, counts, ownership, bedbugs, cards });
    expect(s).toMatch(/^A 42-unit elevator building from 1928\./);
    expect(s).toMatch(/28 immediately hazardous and 39 hazardous conditions are open right now/);
    expect(s).toMatch(/14 heat or hot water complaints/);
    expect(s).toMatch(/1 housing court case against the landlord is pending/);
    expect(s).toMatch(/5 evictions/);
    expect(s).not.toMatch(/\b(HPD|DOB|ECB|OATH)\b/);
    expect(s.split(/\.\s/).length).toBeGreaterThanOrEqual(4);
  });
});
