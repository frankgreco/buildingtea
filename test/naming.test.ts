import { describe, expect, it, vi } from "vitest";
import type { Complaint, LegalRecord, Report, ViolationRecord } from "../shared/types";
import { NAMING_CHUNK, NAMING_MODEL, nameRecords, type LlmConfig } from "../src/lib/llm";
import { applyNames, NAMING_MAX, pendingNames, type NamingItem } from "../src/lib/naming";

const v = (over: Partial<ViolationRecord> = {}): ViolationRecord => ({
  source: "housing",
  kind: "hazardous",
  id: "1",
  ref: "",
  what: "Water leak",
  where: "Apt D5 · kitchen",
  date: "2026-09-12",
  status: "open",
  cityStatus: "",
  closedAt: null,
  original: "§ 27-2026 ADM CODE REPAIR THE LEAKY FAUCET AT SINK IN THE KITCHEN LOCATED AT APT D5",
  ...over,
});

const c = (over: Partial<Complaint> = {}): Complaint => ({
  source: "311",
  id: "9",
  date: "2026-08-29",
  what: "Police: Noise - Street/Sidewalk, Loud Music/Party",
  where: "Reported at or near this address",
  status: "closed",
  closedAt: null,
  outcome: "",
  emergency: false,
  original: "NYPD · Noise - Street/Sidewalk · Loud Music/Party · Street/Sidewalk",
  ...over,
});

const report = (violations: ViolationRecord[], complaints: Complaint[] = []): Report =>
  ({ generatedAt: "2026-10-03T12:00:00.000Z", violations: { items: violations }, complaints: { items: complaints } }) as unknown as Report;

describe("which rows get a name", () => {
  it("takes each distinct wording from the last twelve months once, newest first", () => {
    const r = report(
      [
        v({ date: "2026-03-01", what: "Old leak", original: "REPAIR THE LEAK" }),
        v({ date: "2026-09-12" }),
        v({ id: "2", date: "2026-09-12" }),
        // Before the window, undated, and without any city wording: not named.
        v({ date: "2025-10-02", original: "TOO OLD" }),
        v({ date: null, original: "UNDATED" }),
        v({ original: "  " }),
        v({ source: "summons", date: "2026-09-22", what: "Elevators summons (class 2): Car top…", original: "CAR TOP IS NOT MAINTAINED" }),
      ],
      [c(), c({ id: "10", date: "2026-08-01" })],
    );
    expect(pendingNames(r).map((x) => [x.type, x.current, x.text])).toEqual([
      ["city summons", "Elevators summons (class 2): Car top…", "CAR TOP IS NOT MAINTAINED"],
      ["housing violation", "Water leak", "§ 27-2026 ADM CODE REPAIR THE LEAKY FAUCET AT SINK IN THE KITCHEN"],
      ["311 request", "Police: Noise - Street/Sidewalk, Loud Music/Party", "NYPD · Noise - Street/Sidewalk · Loud Music/Party · Street/Sidewalk"],
      ["housing violation", "Old leak", "REPAIR THE LEAK"],
    ]);
  });

  it("keys on type and wording, so the same words from another source are a different record", () => {
    const r = report([v({ original: "SAME WORDS" }), v({ source: "buildings", original: "SAME WORDS" })]);
    expect(pendingNames(r).map((x) => x.type)).toEqual(["housing violation", "buildings violation"]);
  });

  it("drops the part of the wording that only says which apartment, so one condition is one wording", () => {
    const leak = "REPAIR THE LEAKY FAUCET AT SINK IN THE KITCHEN";
    const r = report(
      [v({ original: `${leak} LOCATED AT APT D5, 4th STORY, 1st APARTMENT FROM NORTH AT EAST` }), v({ id: "2", original: `${leak} LOCATED AT APT A2, 1st STORY` })],
      [
        c({ source: "hpd", what: "No heat", original: "Apartment D5; EMERGENCY: HEAT/HOT WATER / ENTIRE BUILDING / NO HEAT" }),
        c({ source: "hpd", what: "No heat", original: "Apartment B1; EMERGENCY: HEAT/HOT WATER / ENTIRE BUILDING / NO HEAT", id: "2" }),
        // A buildings complaint's wording is codes and dates around its category: the category is what gets named.
        c({ source: "dob", what: "Elevator: Single Device on Property/No Alternate Service", original: "Category 6S · inspected 08/27/2026", id: "3" }),
        c({ source: "dob", what: "Elevator: Single Device on Property/No Alternate Service", original: "Category 6S · inspected 02/11/2026", id: "4", date: "2026-02-11" }),
      ],
    );
    expect(pendingNames(r).map((x) => x.text)).toEqual([leak, "EMERGENCY: HEAT/HOT WATER / ENTIRE BUILDING / NO HEAT", "Elevator: Single Device on Property/No Alternate Service"]);
    const named = applyNames(r, new Map(pendingNames(r).map((x) => [x.key, `Named ${x.type}`])));
    expect(named.violations!.items.map((x) => x.name)).toEqual(["Named housing violation", "Named housing violation"]);
    expect(named.complaints.items.map((x) => x.name)).toEqual(["Named housing complaint", "Named housing complaint", "Named buildings complaint", "Named buildings complaint"]);
  });

  it("skips rows that already have a name, caps a pass, and copes with a report that has no history", () => {
    expect(pendingNames(report([v({ name: "Leaking kitchen sink faucet" })]))).toEqual([]);
    const many = Array.from({ length: NAMING_MAX + 40 }, (_, i) => v({ id: String(i), original: `WORDING ${i}` }));
    expect(pendingNames(report(many))).toHaveLength(NAMING_MAX);
    expect(pendingNames({ generatedAt: "2026-10-03T12:00:00.000Z", complaints: { items: [] } } as unknown as Report)).toEqual([]);
  });
});

describe("legal records", () => {
  const l = (over: Partial<LegalRecord> = {}): LegalRecord => ({
    kind: "case",
    what: "Court case: Tenant Action",
    where: "Building",
    date: "2026-08-28",
    status: "open",
    closedAt: null,
    facts: [["Status", "Pending"], ["Opened", "2026-08-28"], ["Type", "Tenant Action"], ["Against", "1130 SHEVA REALTY HDFC INC"], ["From", "Housing court cases (HPD)"]],
    ...over,
  });
  const withLegal = (legal: LegalRecord[], violations: ViolationRecord[] = []): Report => ({ ...report(violations), legal: { items: legal } }) as unknown as Report;

  it("names every legal record, whatever its age, from what it is and how it stands, not who or when", () => {
    const r = withLegal(
      [
        l(),
        // The same kind of case against someone else, years ago: one wording.
        l({ date: "2012-04-03", facts: [["Status", "Pending"], ["Opened", "2012-04-03"], ["Type", "Tenant Action"], ["Against", "SOMEONE ELSE LLC"]] }),
        l({ kind: "vacate", what: "Vacate order: Fire damage", date: "2022-01-24", status: "closed", facts: [["Status", "Lifted"], ["Effective", "2022-01-24"], ["Type", "Partial"], ["Reason", "Fire Damage"], ["Apartments vacated", "5"]] }),
        l({ kind: "eviction", what: "Eviction carried out", date: null, status: "closed", facts: [["Carried out", "2024-02-06"], ["Apartment", "D6"], ["Type", "Possession, not an ejectment"], ["Marshal", "Ileana Rivera"]] }),
      ],
      [v()],
    );
    // Legal records lead the pass, so a busy building's rows can't crowd them out.
    expect(pendingNames(r).map((x) => [x.type, x.text])).toEqual([
      ["housing court case", "Status: Pending; Type: Tenant Action"],
      ["vacate order", "Status: Lifted; Type: Partial; Reason: Fire Damage; Apartments vacated: 5"],
      ["eviction", "Type: Possession, not an ejectment"],
      ["housing violation", "§ 27-2026 ADM CODE REPAIR THE LEAKY FAUCET AT SINK IN THE KITCHEN"],
    ]);
    const named = applyNames(r, new Map(pendingNames(r).map((x) => [x.key, `Named ${x.type}`])));
    expect(named.legal!.items.map((x) => x.name)).toEqual(["Named housing court case", "Named housing court case", "Named vacate order", "Named eviction"]);
    expect(pendingNames(named)).toEqual([]);
  });
});

describe("putting names on rows", () => {
  it("names every row with that wording, whatever its date, and leaves named rows alone", () => {
    const r = report(
      [v(), v({ id: "2", date: "2019-01-01" }), v({ id: "3", name: "Kept", date: "2026-09-01" }), v({ id: "4", original: "SOMETHING ELSE" })],
      [c()],
    );
    const names = new Map(pendingNames(r).map((x) => [x.key, x.type === "311 request" ? "Loud music outside" : "Leaking kitchen sink faucet"]));
    names.delete(pendingNames(r).find((x) => x.text === "SOMETHING ELSE")!.key);
    const out = applyNames(r, names);
    expect(out.violations!.items.map((x) => x.name)).toEqual(["Leaking kitchen sink faucet", "Leaking kitchen sink faucet", "Kept", undefined]);
    expect(out.complaints.items[0]!.name).toBe("Loud music outside");
    // The rule-written headline stays underneath.
    expect(out.violations!.items[0]!.what).toBe("Water leak");
    expect(pendingNames(out).map((x) => x.text)).toEqual(["SOMETHING ELSE"]);
  });

  it("returns the same report when there is nothing to change", () => {
    const r = report([v()]);
    expect(applyNames(r, new Map())).toBe(r);
    expect(applyNames(r, new Map([["housing violation\nNOT IN THIS REPORT", "x"]]))).toBe(r);
  });
});

describe("the naming call", () => {
  const item = (i: number, over: Partial<NamingItem> = {}): NamingItem => ({ key: `k${i}`, type: "housing violation", current: `Current ${i}`, text: `CITY WORDING ${i} AT APT 4B`, ...over });
  /** A fetcher that answers each call with `reply(requestBody)`. */
  const fetcher = (reply: (body: { messages: { content: string }[] }) => unknown, status = 200) =>
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const content = reply(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });
    });
  const cfg = (f: ReturnType<typeof fetcher>): LlmConfig => ({ apiKey: "sk-test", fetcher: f as unknown as typeof fetch });

  it("sends the records to the small model under a schema and returns names by key", async () => {
    const f = fetcher(() => ({ names: [{ id: "1", name: "Leaking kitchen sink faucet." }, { id: "2", name: "  Broken   lock on front door " }] }));
    const names = await nameRecords(cfg(f), [item(1), item(2)]);
    expect([...names]).toEqual([
      ["k1", "Leaking kitchen sink faucet"],
      ["k2", "Broken lock on front door"],
    ]);
    const body = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: NAMING_MODEL, temperature: 0, response_format: { type: "json_schema", json_schema: { name: "row_names", strict: true } } });
    expect(body.messages[1].content).toContain(JSON.stringify({ records: [{ id: "1", type: "housing violation", name: "Current 1", text: "CITY WORDING 1 AT APT 4B" }, { id: "2", type: "housing violation", name: "Current 2", text: "CITY WORDING 2 AT APT 4B" }] }));
  });

  it("drops a name that fails a guard, so that row keeps its rule-written headline", async () => {
    const f = fetcher(() => ({
      names: [
        { id: "1", name: "Three broken windows on floor 9" }, // a number the record doesn't have
        { id: "2", name: "HPD violation for a broken lock" }, // an agency acronym
        { id: "3", name: "Fine for failing to maintain the elevator" }, // a fine the city's wording doesn't mention
        { id: "4", name: "**Leak**" }, // markup
        { id: "5", name: "x" }, // too short
        { id: "6", name: "A name that goes on for far too long to be the headline of a row in a list of rows" },
        { id: "7", name: "Broken lock in apartment 4B" }, // 4B's digit is in the record
        { id: "99", name: "No such record" },
        { id: "8" },
      ],
    }));
    const names = await nameRecords(cfg(f), Array.from({ length: 8 }, (_, i) => item(i + 1)));
    expect([...names]).toEqual([["k7", "Broken lock in apartment 4B"]]);
  });

  it("allows a fine when the city's wording says so", async () => {
    const f = fetcher(() => ({ names: [{ id: "1", name: "Unpaid penalty for an expired permit" }] }));
    expect([...(await nameRecords(cfg(f), [item(1, { text: "CIVIL PENALTY DUE FOR EXPIRED PERMIT" })]))]).toEqual([["k1", "Unpaid penalty for an expired permit"]]);
  });

  it("splits a big pass into calls, and one failed call only loses its own names", async () => {
    let call = 0;
    const f = fetcher((body) => {
      if (++call === 2) return "not json at all";
      const { records } = JSON.parse(body.messages[1]!.content.slice(body.messages[1]!.content.indexOf("{"))) as { records: { id: string }[] };
      return { names: records.map((r) => ({ id: r.id, name: "Leaking faucet" })) };
    });
    const items = Array.from({ length: NAMING_CHUNK * 2 + 5 }, (_, i) => item(i + 1));
    const names = await nameRecords(cfg(f), items);
    expect(f).toHaveBeenCalledTimes(3);
    expect(names.size).toBe(NAMING_CHUNK + 5);
    expect(names.get("k1")).toBe("Leaking faucet");
    // The second call's reply wasn't JSON: its records go unnamed, the third call's are fine.
    expect(names.has(`k${NAMING_CHUNK + 1}`)).toBe(false);
    expect(names.get(`k${NAMING_CHUNK * 2 + 1}`)).toBe("Leaking faucet");
  });

  it("returns nothing, without throwing, when the service errors", async () => {
    const f = fetcher(() => "upstream error", 500);
    expect((await nameRecords(cfg(f), [item(1)])).size).toBe(0);
    expect((await nameRecords(cfg(f), [])).size).toBe(0);
  });
});
