// Turn raw city rows into the Report the page renders. All status rules live here
// and are documented in docs/RULES.md. Pure function: no I/O, fully unit-testable.

import type {
  Address,
  Bedbugs,
  Card,
  CardTable,
  ChartSeries,
  Complaint,
  ComplaintHistory,
  ComplaintTopic,
  Counts,
  LegalHistory,
  LegalKind,
  LegalRecord,
  LineItem,
  Link,
  Ownership,
  RecordArea,
  Report,
  SourceStamp,
  Status,
  Teaser,
  TeaserPreview,
  ViolationHistory,
  ViolationRecord,
  ViolationSource,
} from "@shared/types";
import { normalizeUnit } from "@shared/address";
import { COMPLAINT_LIMITS, LEGAL_LIMITS, VIOLATION_LIMITS, complaintWindowStart, type RawBuildingData } from "./datasets";
import type { Row } from "./soda";
import {
  buildingClassFamily,
  complaintApartment,
  complaintCategoryName,
  complaintHeadline,
  contactRole,
  dobComplaintCategory,
  dobComplaintTopic,
  housingProgram,
  hpdPlace,
  isRealApartment,
  landUseName,
  noiseTypeName,
  translate311,
  translateDob,
  translateHpd,
} from "./translate";

/** Infestation wording in an HPD order. Paperwork notices ("file annual bedbug report") are excluded by class. */
const PEST_RE = /\b(?:ROACH(?:ES)?|MICE|RATS?|RODENTS?|VERMIN|BED ?BUGS?)\b/i;
const BEDBUG_NOTICE_RE = /FILE ANNUAL BEDBUG REPORT/i;
import { snapshotOf } from "@shared/snapshot";
import { templateSummary } from "./summary";

const LABEL: Record<Status, string> = { good: "Looks good", warn: "Heads up", serious: "Serious", critical: "Critical", neutral: "N/A" };

export const QUESTIONS: { key: Card["key"]; question: string }[] = [
  { key: "safe", question: "Is it safe?" },
  { key: "heat", question: "Heat, water & plumbing?" },
  { key: "pests", question: "Pests & bedbugs?" },
  { key: "elev", question: "Elevators?" },
  { key: "owner", question: "Who's the landlord?" },
  { key: "legal", question: "Any legal trouble?" },
  { key: "noise", question: "Is it noisy?" },
];

/** hpdOpenItems row limit (datasets.ts). A result this long means older open violations were cut off. */
const HPD_OPEN_LIMIT = 300;
const NOISE_RE = /^noise/i;

export interface ComputeInput {
  id: string;
  address: Address;
  raw: RawBuildingData;
  sources: SourceStamp[];
  now: Date;
}

// ---------- small helpers ----------

const num = (v: string | undefined | null): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: string | undefined | null): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: string | undefined | null): string | null => (v ? v.slice(0, 10) : null);
/** DOB BIS/ECB dates are YYYYMMDD text. */
const dayFromCompact = (v: string | undefined | null): string | null => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : day(v));
/** DOB complaint dates are MM/DD/YYYY text. */
const dayFromUs = (v: string | undefined | null): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
};
const daysBetween = (a: string, b: Date): number => Math.floor((b.getTime() - new Date(a).getTime()) / 86400_000);
const fmt = (iso: string | null): string => {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** "NEW LAW  TENEMENT" -> "New law tenement". */
const sentenceCase = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A card table cell: the value with its whitespace tidied, or "–" when the source has none. */
const cell = (v: string | number | null | undefined): string => (v == null ? "" : String(v).replace(/\s+/g, " ").trim()) || "–";
const dateCell = (iso: string | null): string => (iso ? fmt(iso) : "–");

// ---------- counts ----------

export function computeCounts(raw: RawBuildingData, now: Date): Counts {
  const byClass: Record<string, number> = {};
  for (const r of raw.hpdOpenByClass) byClass[r.class ?? "?"] = num(r.n);
  const open = raw.hpdOpenItems;
  const haz = open.filter((r) => r.class === "B" || r.class === "C").map((r) => day(r.inspectiondate)).filter((d): d is string => !!d).sort();

  let complaints12mo = 0,
    problems12mo = 0,
    heat = 0,
    plumbing = 0,
    pests = 0;
  for (const r of raw.hpdComplaints12mo) {
    complaints12mo += num(r.complaints);
    problems12mo += num(r.problems);
    const cat = r.major_category ?? "";
    if (cat === "HEAT/HOT WATER") heat += num(r.complaints);
    if (cat === "PLUMBING" || cat === "WATER LEAK") plumbing += num(r.complaints);
    if (cat === "UNSANITARY CONDITION") pests += num(r.complaints);
  }
  let noise = 0;
  for (const r of raw.n311) if (NOISE_RE.test(r.complaint_type ?? "")) noise += num(r.n);

  const elevatorsActive = raw.elevators.filter((r) => r.device_status === "Active" && r.device_type === "Elevator").length;
  const elevatorIssues =
    raw.dobNowActive.filter((r) => /elevator/i.test(r.device_type ?? "")).length +
    raw.ecbActive.filter((r) => /elevator/i.test(r.violation_type ?? "")).length +
    raw.dobBisActive.filter((r) => /^E-/i.test(r.violation_type ?? "")).length;

  const pending = raw.litigations.filter((r) => (r.casestatus ?? "").toUpperCase() !== "CLOSED");
  const harassment = raw.litigations.some((r) => /^harassment$/i.test((r.findingofharassment ?? "").trim()));
  const vacateActive = raw.vacate.some((r) => !r.actual_rescind_date);

  return {
    openA: byClass.A ?? 0,
    openB: byClass.B ?? 0,
    openC: byClass.C ?? 0,
    openI: byClass.I ?? 0,
    rentImpairing: open.filter((r) => r.rentimpairing === "Y").length,
    newestOpenHazardous: haz.length ? haz[haz.length - 1]! : null,
    oldestOpenHazardous: haz.length ? haz[0]! : null,
    complaints12mo,
    problems12mo,
    openComplaints: raw.hpdComplaintsOpen.length,
    heat12mo: heat,
    plumbing12mo: plumbing,
    pests12mo: pests,
    dobBisActive: raw.dobBisActive.length,
    dobNowActive: raw.dobNowActive.length,
    ecbActive: raw.ecbActive.length,
    ecbBalanceDue: raw.ecbActive.reduce((s, r) => s + num(r.balance_due), 0),
    dobComplaintsActive: raw.dobComplaintsActive.length,
    elevatorsActive,
    elevatorIssues,
    evictions3y: raw.evictions.length,
    litigationsPending: pending.length,
    harassmentFinding: harassment,
    vacateActive,
    noise12mo: noise,
  };
}

// ---------- ownership ----------

export function computeOwnership(raw: RawBuildingData, now: Date): Ownership {
  const reg = raw.registration[0];
  const expires = day(reg?.registrationenddate);
  let state: Ownership["registrationState"] = "none";
  if (reg) {
    if (!expires) state = "current";
    else {
      const age = daysBetween(expires, now);
      state = age <= 0 ? "current" : age <= 60 ? "grace" : "lapsed";
    }
  }
  const find = (t: string) => raw.contacts.find((c) => (c.type ?? "").toLowerCase() === t.toLowerCase());
  const owner = find("CorporateOwner") ?? find("IndividualOwner") ?? find("JointOwner") ?? find("Owner");
  const agent = find("Agent");
  const head = find("HeadOfficer");
  const site = find("SiteManager");
  return {
    registrationId: reg?.registrationid ?? null,
    registrationExpires: expires,
    lastRegistered: day(reg?.lastregistrationdate),
    registrationState: state,
    registeredOwner: owner?.corporationname ?? contactName(owner),
    headOfficer: head ? [head.firstname, head.lastname].filter(Boolean).join(" ") || null : null,
    managingAgent: agent?.corporationname ?? contactName(agent),
    agentContact: agent ? [agent.firstname, agent.lastname].filter(Boolean).join(" ") || null : null,
    siteManager: site ? [site.firstname, site.lastname].filter(Boolean).join(" ") || null : null,
    agentAddress: contactAddress(agent) ?? contactAddress(owner),
  };
}

const personName = (c: Row) => [c.firstname, c.lastname].filter((s) => s && s.trim()).join(" ");
const contactName = (c: Row | undefined): string | null => (c ? [c.corporationname, personName(c)].filter((s) => s && s.trim()).join(" · ") || null : null);
/** Business address of a registration contact, state included. */
const contactAddress = (c: Row | undefined): string | null =>
  c ? [c.businesshousenumber, c.businessstreetname, c.businessapartment, c.businesscity, c.businessstate, c.businesszip].filter((s) => s && s.trim()).join(" ") || null : null;

// ---------- bedbugs ----------

export function computeBedbugs(raw: RawBuildingData, registered: boolean, now: Date): Bedbugs {
  const b = raw.bedbugs[0];
  // Filing period runs Nov 1 - Oct 31; reports are due by Dec 31. The latest period that
  // should already have a report is the one ending on the most recent Oct 31 that is >= 60 days ago.
  const y = now.getUTCFullYear();
  let dueEnd = new Date(Date.UTC(y, 9, 31));
  if (daysBetween(dueEnd.toISOString(), now) < 60) dueEnd = new Date(Date.UTC(y - 1, 9, 31));
  const periodEnd = day(b?.filling_period_end_date);
  const missingLatest = registered && (!periodEnd || new Date(periodEnd).getTime() < dueEnd.getTime() - 86400_000);
  return {
    lastFilingDate: day(b?.filing_date),
    periodStart: day(b?.filing_period_start_date),
    periodEnd,
    dwellingUnits: numOrNull(b?.of_dwelling_units),
    infested: numOrNull(b?.infested_dwelling_unit_count),
    eradicated: numOrNull(b?.eradicated_unit_count),
    reinfested: numOrNull(b?.re_infested_dwelling_unit),
    missingLatest,
    required: registered,
  };
}

// ---------- cards ----------

export function computeCards(c: Counts, own: Ownership, bb: Bedbugs, raw: RawBuildingData, cover: Report["cover"], now: Date): Card[] {
  const cards: Card[] = [];
  // `details` keeps the sentence form for the AI summary and older clients; `tables` and `notes` are what the page shows.
  const card = (key: Card["key"], status: Status, answer: string, details: string[], extra: { tables?: CardTable[]; notes?: string[] } = {}): Card => ({
    key,
    question: QUESTIONS.find((q) => q.key === key)!.question,
    status,
    label: LABEL[status],
    answer,
    details,
    tables: (extra.tables ?? []).filter((t) => t.rows.length > 0),
    notes: (extra.notes ?? []).filter(Boolean),
  });
  const table = (title: string, columns: string[], rows: string[][]): CardTable => ({ title, columns, rows });

  // --- Is it safe? ---
  {
    const newest = c.newestOpenHazardous;
    const newestAge = newest ? daysBetween(newest, now) : Infinity;
    const haz = c.openB + c.openC;
    let status: Status = "good";
    if (c.vacateActive) status = "critical";
    else if (c.openC > 0 && newestAge <= 365) status = "critical";
    else if ((c.openC > 0 || c.openB >= 5) && newestAge <= 730) status = "serious";
    else if (haz > 0) status = "warn";
    const examples = raw.hpdOpenItems
      .filter((r) => r.class === "C" || r.class === "B")
      .slice(0, 3)
      .map((r) => translateHpd(r.novdescription ?? "", r.apartment, r.story).what.toLowerCase());
    let answer: string;
    if (c.vacateActive) answer = "Part or all of this building is under an active vacate order from the city.";
    else if (haz === 0) answer = "No open hazardous conditions on file.";
    else if (status === "warn")
      answer = `${plural(haz, "open hazardous condition")}, but the newest is from ${fmt(newest)} and none was reinspected. Likely stale; ask the landlord whether they were fixed.`;
    else
      answer = `${c.openC > 0 ? `${c.openC} immediately hazardous and ` : ""}${plural(c.openB, "hazardous condition")} open right now${examples.length ? `, including ${examples.join(", ")}` : ""}. Newest added ${fmt(newest)}.`;
    const details = [
      `${c.openC} immediately hazardous, ${c.openB} hazardous, ${c.openA} minor conditions open`,
      c.rentImpairing ? `${plural(c.rentImpairing, "open condition is", "open conditions are")} rent-impairing` : "No rent-impairing conditions open",
      newest ? `Open hazardous items date from ${fmt(c.oldestOpenHazardous)} to ${fmt(newest)}` : "",
      c.dobBisActive + c.dobNowActive ? `${plural(c.dobBisActive + c.dobNowActive, "active buildings-department violation")}` : "",
      c.ecbActive ? `${plural(c.ecbActive, "active city summons", "active city summonses")}${c.ecbBalanceDue ? `, ${money(c.ecbBalanceDue)} unpaid` : ""}` : "",
    ].filter(Boolean);
    // Every severity is listed once anything is open, zeros included, so the counts read as a whole.
    const open = [
      ["Immediately hazardous (class C)", c.openC],
      ["Hazardous (class B)", c.openB],
      ["Minor (class A)", c.openA],
      ["Paperwork notices (class I)", c.openI],
      ["Rent-impairing", c.rentImpairing],
    ] as const;
    const fines = [
      ["Buildings department violations (BIS)", c.dobBisActive, "–"],
      ["Buildings department violations (DOB NOW)", c.dobNowActive, "–"],
      ["City summonses", c.ecbActive, money(c.ecbBalanceDue)],
    ] as const;
    const tables = [
      table("Open conditions", ["Severity", "Open"], open.some(([, n]) => n > 0) ? open.map(([k, n]) => [k, String(n)]) : []),
      table("Buildings department and city fines", ["Type", "Active", "Unpaid"], fines.some(([, n]) => n > 0) ? fines.map(([k, n, due]) => [k, String(n), due]) : []),
    ];
    const notes = [
      newest ? `Open hazardous items date from ${fmt(c.oldestOpenHazardous)} to ${fmt(newest)}` : "",
      status === "warn" ? "Items stay open on the city's records until the landlord certifies the repair or the city reinspects, so old ones may already be fixed" : "",
    ];
    cards.push(card("safe", status, answer, details, { tables, notes }));
  }

  // --- Heat, water & plumbing ---
  {
    let status: Status = "good";
    if (c.heat12mo >= 8) status = "serious";
    else if (c.heat12mo >= 3 || c.plumbing12mo >= 5) status = "warn";
    const bits: string[] = [];
    if (c.heat12mo) bits.push(plural(c.heat12mo, "heat or hot water complaint"));
    if (c.plumbing12mo) bits.push(plural(c.plumbing12mo, "plumbing or leak complaint"));
    const answer = bits.length ? `${bits.join(" and ")} in the last 12 months.${c.openComplaints ? ` ${plural(c.openComplaints, "complaint")} still open.` : " All resolved."}` : "No heat, hot water, or plumbing complaints in the last 12 months.";
    const details = [
      `${plural(c.complaints12mo, "complaint")} to the city in 12 months (${c.problems12mo} separate problems)`,
      c.openComplaints ? `${plural(c.openComplaints, "complaint")} open today` : "No open complaints today",
      c.heat12mo >= 3 ? "Heat complaints cluster in winter; check the monthly chart" : "",
    ].filter(Boolean);
    const byCategory = raw.hpdComplaints12mo.map((r) => [complaintCategoryName(r.major_category), String(num(r.complaints)), String(num(r.problems))]);
    const tables = [table("Complaints in the last 12 months", ["Category", "Complaints", "Problems"], byCategory)];
    const notes = [
      c.openComplaints ? `${plural(c.openComplaints, "complaint")} open today` : "No open complaints today",
      c.heat12mo >= 3 ? "Heat complaints cluster in winter; check the monthly chart" : "",
    ];
    cards.push(card("heat", status, answer, details, { tables, notes }));
  }

  // --- Pests & bedbugs ---
  {
    const pestItems = raw.hpdOpenItems.filter((r) => (r.class === "B" || r.class === "C") && PEST_RE.test(r.novdescription ?? ""));
    const bedbugNotices = raw.hpdOpenItems.filter((r) => BEDBUG_NOTICE_RE.test(r.novdescription ?? ""));
    const recentPest = pestItems.filter((r) => {
      const d = day(r.inspectiondate);
      return d ? daysBetween(d, now) <= 730 : false;
    });
    let status: Status = "good";
    if (recentPest.length) status = "serious";
    else if (pestItems.length || (bb.infested ?? 0) > 0 || bb.missingLatest || bedbugNotices.length > 0 || c.pests12mo >= 5) status = "warn";
    if (!bb.required && !pestItems.length && c.pests12mo === 0) status = "neutral";
    let answer: string;
    if (pestItems.length) {
      const apts = [...new Set(pestItems.map((r) => r.apartment).filter(isRealApartment))].slice(0, 4);
      const newest = pestItems.map((r) => day(r.inspectiondate)).filter((d): d is string => !!d).sort().pop() ?? null;
      answer = `${plural(pestItems.length, "open pest violation")}${apts.length ? ` in apartment${apts.length > 1 ? "s" : ""} ${apts.join(", ")}` : ""}${
        recentPest.length ? "." : `, but the newest is from ${fmt(newest)} and was never reinspected.`
      }`;
    } else if (!bb.required) answer = "Not a registered multiple dwelling, so no bedbug reporting is required. No pest violations on file.";
    else if (bb.lastFilingDate)
      answer = `Landlord's last bedbug report said ${bb.infested ?? 0} of ${bb.dwellingUnits ?? "?"} apartments had bedbugs (year ending ${fmt(bb.periodEnd)}).${bb.missingLatest ? " The newer report required by law is missing." : ""}`;
    else answer = "No bedbug report has ever been filed for this building, which the law requires annually.";
    // The query keeps the three newest filings; the first is `bb`.
    const earlier = raw.bedbugs
      .slice(1)
      .map(
        (r) =>
          `Earlier bedbug report, year ending ${fmt(day(r.filling_period_end_date))}: ${num(r.infested_dwelling_unit_count)} infested, ${num(r.eradicated_unit_count)} treated, ${num(r.re_infested_dwelling_unit)} re-infested (filed ${fmt(day(r.filing_date))})`,
      );
    const details = [
      bb.lastFilingDate ? `Bedbug report filed ${fmt(bb.lastFilingDate)}: ${bb.infested ?? 0} infested, ${bb.eradicated ?? 0} treated, ${bb.reinfested ?? 0} re-infested` : "",
      ...earlier,
      bb.missingLatest ? "Latest required bedbug report not filed" : "",
      bedbugNotices.length ? `The city has cited the landlord ${plural(bedbugNotices.length, "time")} for not filing the bedbug report (latest ${fmt(day(bedbugNotices[0]!.inspectiondate))})` : "",
      c.pests12mo ? `${plural(c.pests12mo, "unsanitary-condition complaint")} in 12 months (pests, mold, garbage)` : "",
      "Bedbug counts are self-reported by the owner",
    ].filter(Boolean);
    const filings = raw.bedbugs.map((r) => [
      dateCell(day(r.filling_period_end_date)),
      dateCell(day(r.filing_date)),
      cell(r.of_dwelling_units),
      cell(r.infested_dwelling_unit_count),
      cell(r.eradicated_unit_count),
      cell(r.re_infested_dwelling_unit),
    ]);
    const pestRows = pestItems.map((r) => {
      const t = translateHpd(r.novdescription ?? "", r.apartment, r.story);
      return [t.what, isRealApartment(r.apartment) ? cell(r.apartment) : t.where, dateCell(day(r.inspectiondate))];
    });
    const tables = [
      table("Bedbug reports filed by the landlord", ["Year ending", "Filed", "Apartments", "Infested", "Treated", "Re-infested"], filings),
      table("Open pest violations", ["What", "Apartment", "Inspected"], pestRows),
    ];
    const notes = [
      "Bedbug counts are self-reported by the owner",
      bb.missingLatest ? "Latest required bedbug report not filed" : "",
      bedbugNotices.length ? `The city has cited the landlord ${plural(bedbugNotices.length, "time")} for not filing the bedbug report (latest ${fmt(day(bedbugNotices[0]!.inspectiondate))})` : "",
      c.pests12mo ? `${plural(c.pests12mo, "unsanitary-condition complaint")} in 12 months (pests, mold, garbage)` : "",
    ];
    cards.push(card("pests", status, answer, details, { tables, notes }));
  }

  // --- Elevators ---
  {
    const isElevator = (r: Row) => r.device_type === "Elevator";
    const active = raw.elevators.filter((r) => r.device_status === "Active" && isElevator(r));
    // Everything else on file: active lifts, dumbwaiters, escalators..., and elevators that are removed, sealed, being installed...
    const others = raw.elevators
      .filter((r) => (isElevator(r) ? r.device_status !== "Active" : r.device_status === "Active"))
      .map((r) => `${sentenceCase(r.device_type ?? "Device")}${r.device_number ? ` ${r.device_number}` : ""}: ${(r.device_status ?? "status unknown").toLowerCase()}`);
    // Every device row, active elevators first, then other active devices, then the rest.
    const rank = (r: Row) => (r.device_status === "Active" ? (isElevator(r) ? 0 : 1) : 2);
    const devices = [...raw.elevators]
      .sort((a, b) => rank(a) - rank(b))
      .map((r) => [
        cell(r.device_number),
        r.device_type?.trim() ? sentenceCase(r.device_type) : "–",
        cell(r.device_status),
        dateCell(day(r.periodic_latest_inspection)),
        dateCell(day(r.cat1_latest_report_filed)),
        dateCell(day(r.cat5_latest_report_filed)),
      ]);
    // The same three sources counts.elevatorIssues counts.
    const issues = [
      ...raw.dobNowActive
        .filter((r) => /elevator/i.test(r.device_type ?? ""))
        .map((r) => [
          "Buildings dept. (DOB NOW)",
          dateCell(day(r.violation_issue_date)),
          `${translateDob("now", { type: r.violation_type, text: r.violation_remarks })}${r.device_number ? ` (device ${r.device_number.trim()})` : ""}`,
        ]),
      ...raw.ecbActive
        .filter((r) => /elevator/i.test(r.violation_type ?? ""))
        .map((r) => {
          const due = num(r.balance_due);
          return ["City summons", dateCell(dayFromCompact(r.issue_date)), `${translateDob("ecb", { type: r.violation_type, text: r.violation_description, device: r.severity })}${due ? `, ${money(due)} unpaid` : ""}`];
        }),
      ...raw.dobBisActive
        .filter((r) => /^E-/i.test(r.violation_type ?? ""))
        .map((r) => ["Buildings dept. (BIS)", dateCell(dayFromCompact(r.issue_date)), translateDob("bis", { type: r.violation_type, text: r.description })]),
    ];
    const tables = [
      table("Devices", ["Device", "Type", "Status", "Last inspected", "Annual test filed", "Five-year test filed"], devices),
      table("Open elevator issues", ["Source", "Date", "What"], issues),
    ];
    if (active.length === 0) {
      cards.push(card("elev", "neutral", `No elevators on file${cover.floors ? ` (${cover.floors}-story${cover.floors <= 6 ? " walk-up" : ""})` : ""}.`, others, { tables }));
    } else {
      const lastInsp = active.map((r) => day(r.periodic_latest_inspection)).filter(Boolean).sort().pop() ?? null;
      const lastYear = now.getUTCFullYear() - 1;
      const missingCat1 = active.filter((r) => num(r.cat1_report_year) < lastYear);
      let status: Status = "good";
      if (c.elevatorIssues > 0) status = "serious";
      else if (missingCat1.length || !lastInsp || daysBetween(lastInsp, now) > 400) status = "warn";
      const issueText = raw.ecbActive.filter((r) => /elevator/i.test(r.violation_type ?? "")).map((r) => `city summons ${fmt(dayFromCompact(r.issue_date))}`);
      const answer = `${plural(active.length, "elevator")}${lastInsp ? `, last inspected ${fmt(lastInsp)}` : ""}. ${
        c.elevatorIssues ? `${plural(c.elevatorIssues, "open elevator issue")}${issueText.length ? ` (${issueText.join(", ")})` : ""}.` : "No open elevator issues."
      }`;
      const details = [
        ...active.map(
          (r) =>
            `Device ${r.device_number}: inspected ${fmt(day(r.periodic_latest_inspection))}, Cat 1 test filed ${fmt(day(r.cat1_latest_report_filed))}${
              r.cat5_latest_report_filed ? `, five-year (Cat 5) test filed ${fmt(day(r.cat5_latest_report_filed))}` : ""
            }`,
        ),
        missingCat1.length ? `${plural(missingCat1.length, "elevator")} missing the ${lastYear} Category 1 test filing` : "",
        ...others,
      ].filter(Boolean);
      const notes = [missingCat1.length ? `${plural(missingCat1.length, "elevator")} missing the ${lastYear} annual (Category 1) test filing` : ""];
      cards.push(card("elev", status, answer, details, { tables, notes }));
    }
  }

  // --- Landlord ---
  {
    const unitsRes = cover.unitsRes ?? 0;
    let status: Status = "good";
    if (own.registrationState === "lapsed") status = "serious";
    else if (own.registrationState === "grace") status = "warn";
    else if (own.registrationState === "none") status = unitsRes >= 3 ? "serious" : "neutral";
    const who = own.registeredOwner ?? cover.plutoOwner;
    const managed = own.managingAgent ? `, managed by ${own.managingAgent}${own.agentContact ? ` (${own.agentContact})` : ""}` : "";
    let regText = "";
    if (own.registrationState === "current") regText = `Registration current${own.registrationExpires ? ` through ${fmt(own.registrationExpires)}` : ""}.`;
    else if (own.registrationState === "grace") regText = `Registration was due ${fmt(own.registrationExpires)}; the renewal is not in the city's data yet.`;
    else if (own.registrationState === "lapsed") regText = `The city registration expired ${fmt(own.registrationExpires)} and has not been renewed.`;
    else regText = unitsRes >= 3 ? "No landlord registration on file, which the city requires for a building this size." : "No landlord registration on file (not required for small owner-occupied buildings).";
    const answer = `${who ?? "Owner not on file"}${managed}. ${regText}`;
    const showsPluto = !!cover.plutoOwner && cover.plutoOwner !== own.registeredOwner;
    // Every other registration contact, skipping names the answer and the bullets above already give.
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const shown = new Set(
      [who, own.managingAgent, own.agentContact, own.headOfficer, own.siteManager, showsPluto ? cover.plutoOwner : null].filter((s): s is string => !!s).map(norm),
    );
    const contacts: string[] = [];
    for (const r of raw.contacts) {
      const parts = [r.corporationname, personName(r)].filter((s): s is string => !!s && !!s.trim());
      if (!parts.length || parts.every((p) => shown.has(norm(p)))) continue;
      parts.forEach((p) => shown.add(norm(p)));
      const address = contactAddress(r);
      contacts.push(`${contactRole(r.type)}: ${parts.join(" · ")}${address && address !== own.agentAddress ? `, ${address}` : ""}`);
    }
    const j = raw.jurisdiction[0];
    const program = housingProgram(j?.managementprogram);
    const rooms = num(j?.legalclassb);
    const recordStatus = (j?.recordstatus ?? "").trim();
    const details = [
      own.registrationState === "lapsed" ? "An unregistered landlord cannot certify repairs and cannot sue a tenant for nonpayment of rent" : "",
      own.headOfficer ? `Head officer: ${own.headOfficer}` : "",
      own.siteManager ? `Site manager: ${own.siteManager}` : "",
      ...contacts,
      own.agentAddress ? `Business address: ${own.agentAddress}` : "",
      own.lastRegistered ? `Last registered ${fmt(own.lastRegistered)}` : "",
      showsPluto ? `Tax records list the owner as ${cover.plutoOwner}` : "",
      program ? `City housing program: ${program}` : "",
      rooms > 0 ? `${plural(rooms, "hotel or single-room unit")} (rooms without their own kitchen and bath) on the city's records` : "",
      recordStatus && recordStatus.toLowerCase() !== "active" ? `The housing department lists this building's record as ${recordStatus.toLowerCase()}` : "",
    ].filter(Boolean);
    const STATE: Record<typeof own.registrationState, string> = { current: "Current", grace: "Due; renewal not in the city's data yet", lapsed: "Lapsed", none: "None on file" };
    const registration =
      raw.registration.length || j
        ? [
            ["Status", STATE[own.registrationState]],
            ["Expires", dateCell(own.registrationExpires)],
            ["Last registered", dateCell(own.lastRegistered)],
            ["Registration ID", cell(own.registrationId)],
            ["City housing program", cell(program)],
            ["Record status", recordStatus ? sentenceCase(recordStatus) : "–"],
            ["Single-room units (no own kitchen and bath)", cell(j?.legalclassb)],
          ]
        : [];
    // Every contact on the registration: owners, head officer, agent and site manager first, then the rest as filed.
    const ROLE_ORDER = ["corporateowner", "individualowner", "jointowner", "owner", "headofficer", "agent", "sitemanager"];
    const roleRank = (t: string | undefined) => {
      const i = ROLE_ORDER.indexOf((t ?? "").trim().toLowerCase());
      return i < 0 ? ROLE_ORDER.length : i;
    };
    const seen = new Set<string>();
    const people = [...raw.contacts]
      .sort((a, b) => roleRank(a.type) - roleRank(b.type))
      .map((r) => [contactRole(r.type), cell([r.corporationname, personName(r)].filter((s) => s && s.trim()).map((s) => s!.trim()).join(" · ")), cell(contactAddress(r))])
      .filter((row) => {
        const k = row.join("|").toUpperCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    const tables = [table("Registration", ["Field", "Value"], registration), table("People and companies on the registration", ["Role", "Name", "Address"], people)];
    const notes = [
      showsPluto ? `Tax records list the owner as ${cover.plutoOwner}` : "",
      own.registrationState === "lapsed" ? "An unregistered landlord cannot certify repairs and cannot sue a tenant for nonpayment of rent" : "",
    ];
    cards.push(card("owner", status, answer, details, { tables, notes }));
  }

  // --- Legal trouble ---
  {
    let status: Status = "good";
    if (c.vacateActive) status = "critical";
    else if (c.litigationsPending || c.harassmentFinding) status = "serious";
    else if (c.evictions3y >= 3 || c.ecbBalanceDue > 0) status = "warn";
    const newestCase = raw.litigations[0];
    const bits: string[] = [];
    if (c.litigationsPending) bits.push(`${plural(c.litigationsPending, "housing court case")} pending${newestCase ? ` (${newestCase.casetype}, opened ${fmt(day(newestCase.caseopendate))})` : ""}`);
    if (c.harassmentFinding) bits.push("a court found the landlord harassed tenants");
    if (c.evictions3y) bits.push(`${plural(c.evictions3y, "eviction")} carried out in the last 3 years`);
    if (c.vacateActive) bits.push("an active vacate order");
    const answer = bits.length ? `${bits.join("; ")}.`.replace(/^./, (s) => s.toUpperCase()) : "No court cases, vacate orders, or evictions on file.";
    // The card (and the summary written from it) takes the newest few; the Legal section lists every case.
    const recentCases = raw.litigations.slice(0, LEGAL_CARD_CASES);
    const details = [
      ...recentCases.map((r) => {
        const respondent = (r.respondent ?? "").trim().replace(/\s*,\s*/g, ", ");
        const penalty = num(r.penalty);
        return `${r.casetype ?? "Case"} opened ${fmt(day(r.caseopendate))}: ${(r.casestatus ?? "").toLowerCase()}${r.findingofharassment ? `, ${r.findingofharassment.toLowerCase()}` : ""}${
          respondent ? `, against ${respondent}` : ""
        }${penalty > 0 ? `, penalty ${money(penalty)}` : ""}`;
      }),
      ...raw.vacate.map((r) => {
        const units = num(r.number_of_vacated_units);
        return `${r.vacate_type ?? ""} vacate order (${r.primary_vacate_reason ?? "reason not given"}) effective ${fmt(day(r.vacate_effective_date))}${units > 0 ? `, ${plural(units, "apartment")} vacated` : ""}${
          r.actual_rescind_date ? `, lifted ${fmt(day(r.actual_rescind_date))}` : ", still in effect"
        }`;
      }),
      ...raw.evictions.map((r) => `Eviction carried out ${fmt(day(r.executed_date))}${r.eviction_apt_num?.trim() ? `, apt ${r.eviction_apt_num.trim()}` : ""}`),
      c.ecbBalanceDue ? `${money(c.ecbBalanceDue)} in unpaid city fines` : "",
    ].filter(Boolean);
    const cases = recentCases.map((r) => [
      cell(r.casetype),
      dateCell(day(r.caseopendate)),
      r.casestatus?.trim() ? sentenceCase(r.casestatus) : "–",
      cell((r.respondent ?? "").replace(/\s*,\s*/g, ", ")),
      cell(r.findingofharassment),
      r.penalty?.trim() ? money(num(r.penalty)) : "–",
    ]);
    const vacates = raw.vacate.map((r) => [
      cell(r.vacate_type),
      cell(r.primary_vacate_reason),
      dateCell(day(r.vacate_effective_date)),
      r.actual_rescind_date ? fmt(day(r.actual_rescind_date)) : "Still in effect",
      cell(r.number_of_vacated_units),
    ]);
    const evictions = raw.evictions.map((r) => [
      dateCell(day(r.executed_date)),
      cell(r.eviction_apt_num),
      cell(evictionType(r)),
      cell(r.court_index_number),
      cell(r.docket_number),
      cell([r.marshal_first_name, r.marshal_last_name].filter((s) => s && s.trim()).join(" ")),
    ]);
    const tables = [
      table("Housing court cases", ["Type", "Opened", "Status", "Against", "Harassment finding", "Penalty"], cases),
      table("Vacate orders", ["Type", "Reason", "Effective", "Lifted", "Apartments vacated"], vacates),
      table("Evictions carried out, last 3 years", ["Date", "Apartment", "Type", "Court index no.", "Docket", "Marshal"], evictions),
    ];
    const notes = [c.ecbBalanceDue ? `${money(c.ecbBalanceDue)} in unpaid city fines` : ""];
    cards.push(card("legal", status, answer, details, { tables, notes }));
  }

  // --- Noise ---
  // From the 12-month 311 aggregate (agency, complaint_type). Noise is reported at an address, often the neighbour's.
  {
    if (raw.failed.includes("n311")) {
      cards.push(card("noise", "neutral", "The city's 311 records didn't load, so noise complaints couldn't be checked.", []));
    } else {
      const byType = new Map<string, number>();
      for (const r of raw.n311) {
        const type = (r.complaint_type ?? "").trim();
        if (NOISE_RE.test(type)) byType.set(type, (byType.get(type) ?? 0) + num(r.n));
      }
      const types = [...byType].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      const status: Status = c.noise12mo >= 10 ? "warn" : "good";
      const answer = c.noise12mo
        ? `${plural(c.noise12mo, "noise complaint")} reported at or near this address in the last 12 months, mostly ${noiseTypeName(types[0]?.[0])}.`
        : "No noise complaints reported at or near this address in the last 12 months.";
      const details = c.noise12mo
        ? [
            ...types.map(([type, n]) => `${capitalize(noiseTypeName(type))}: ${plural(n, "complaint")}`),
            "311 noise reports cover the whole lot and the address the caller gave, so some are about neighbors or the street.",
          ]
        : [];
      const tables = [table("Noise complaints in the last 12 months", ["Type", "Complaints"], types.map(([type, n]) => [capitalize(noiseTypeName(type)), String(n)]))];
      const notes = [c.noise12mo ? "311 noise reports cover the whole lot and the address the caller gave, so some are about neighbors or the street." : ""];
      cards.push(card("noise", status, answer, details, { tables, notes }));
    }
  }

  return cards;
}

// ---------- charts ----------

export function computeCharts(raw: RawBuildingData, now: Date): ChartSeries {
  const thisYear = now.getUTCFullYear();
  const years: number[] = [];
  for (let y = thisYear - 20; y <= thisYear; y++) years.push(y);
  const byYear: [number, number, number][] = years.map(() => [0, 0, 0]);
  for (const r of raw.hpdByYear) {
    const y = Number((r.yr ?? "").slice(0, 4));
    const idx = years.indexOf(y);
    if (idx < 0) continue;
    const k: 0 | 1 | 2 | null = r.class === "A" ? 0 : r.class === "B" ? 1 : r.class === "C" ? 2 : null;
    if (k === null) continue;
    byYear[idx]![k] += num(r.n);
  }
  const months: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1));
  for (let i = 0; i < 24; i++) {
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const byMonth = months.map(() => 0);
  for (const r of raw.hpdComplaintsByMonth) {
    const idx = months.indexOf((r.m ?? "").slice(0, 7));
    if (idx >= 0) byMonth[idx] = num(r.n);
  }
  return { years, violationsByYear: byYear, months, complaintsByMonth: byMonth };
}

// ---------- line items ----------

/**
 * Everything open we fetched, most serious first: hazardous housing violations (B, C), then
 * every active summons and buildings-department violation, then minor (A) and paperwork (I)
 * housing violations. Notices for not filing the annual bedbug report (all class A citywide)
 * are paperwork and listed once, whatever their class.
 */
export function computeItems(raw: RawBuildingData): LineItem[] {
  const hpd = (r: Row, severity: LineItem["severity"], what?: string): LineItem => {
    const t = translateHpd(r.novdescription ?? "", r.apartment, r.story);
    const state = ["open", r.rentimpairing === "Y" ? "rent-impairing" : "", (r.currentstatus ?? "").toLowerCase()].filter(Boolean).join(" · ");
    const notice = day(r.novissueddate);
    return {
      severity,
      what: what ?? t.what,
      where: what ? "Building" : t.where,
      date: day(r.inspectiondate),
      state,
      original: r.novdescription ?? "",
      ...(notice ? { noticeDate: notice } : {}),
      ...(r.violationid ? { ref: `HPD violation ${r.violationid}` } : {}),
    };
  };
  const isBedbugNotice = (r: Row) => BEDBUG_NOTICE_RE.test(r.novdescription ?? "");
  const open = raw.hpdOpenItems;
  const items: LineItem[] = [];

  for (const r of open) if ((r.class === "C" || r.class === "B") && !isBedbugNotice(r)) items.push(hpd(r, r.class === "C" ? "c" : "b"));

  for (const r of raw.ecbActive) {
    const imposed = num(r.penality_imposed); // sic: the dataset's spelling
    const due = num(r.balance_due);
    const state = [
      (r.hearing_status ?? "active").toLowerCase(),
      imposed ? `fine ${money(imposed)}` : "",
      due ? `${money(due)} unpaid` : "",
      r.hearing_date ? `hearing ${fmt(dayFromCompact(r.hearing_date))}` : "",
    ].filter(Boolean);
    items.push({
      severity: "f",
      what: `City fine: ${translateDob("ecb", { type: r.violation_type, text: r.violation_description, device: r.severity })}`,
      where: "Building",
      date: dayFromCompact(r.issue_date),
      state: state.join(" · "),
      original: [r.severity, r.violation_description].filter((s) => s && s.trim()).join(": "),
      ...(r.ecb_violation_number ? { ref: `ECB ${r.ecb_violation_number}` } : {}),
    });
  }
  for (const r of raw.dobNowActive) {
    items.push({
      severity: "f",
      what: translateDob("now", { type: r.violation_type, text: r.violation_remarks }),
      where: r.device_type ? `${r.device_type}${r.device_number ? ` ${r.device_number}` : ""}` : "Building",
      date: day(r.violation_issue_date),
      state: "active",
      original: (r.violation_remarks ?? "").trim(),
      ...(r.violation_number ? { ref: `DOB ${r.violation_number}` } : {}),
    });
  }
  for (const r of raw.dobBisActive) {
    items.push({
      severity: "f",
      what: translateDob("bis", { type: r.violation_type, text: r.description }),
      where: "Building",
      date: dayFromCompact(r.issue_date),
      state: "active",
      original: [r.violation_type, r.description].filter((s) => s && s.trim()).join(" ").replace(/\s+/g, " ").trim(),
      ...(r.number ? { ref: `DOB ${r.number}` } : {}),
    });
  }

  for (const r of open) if (r.class === "A" && !isBedbugNotice(r)) items.push(hpd(r, "a"));
  for (const r of open) {
    if (isBedbugNotice(r)) items.push(hpd(r, "p", "Landlord cited for not filing the annual bedbug report"));
    else if (r.class === "I") items.push(hpd(r, "p"));
  }
  return items;
}

/** When the open-violation query hit its limit: how many HPD rows we list against the city's open total. */
export function itemsTruncation(raw: RawBuildingData): Report["itemsTruncated"] {
  if (raw.hpdOpenItems.length < HPD_OPEN_LIMIT) return null;
  const total = raw.hpdOpenByClass.reduce((s, r) => s + num(r.n), 0);
  return { shown: raw.hpdOpenItems.length, total: Math.max(total, raw.hpdOpenItems.length) };
}

// ---------- complaint history ----------

const HPD_EMERGENCY = new Set(["EMERGENCY", "IMMEDIATE EMERGENCY", "HAZARDOUS"]);
/** HPD space_type values that are rooms inside an apartment (for rows with no unit_type). */
const APT_SPACES = new Set(["ENTIRE APARTMENT", "BATHROOM", "KITCHEN", "BEDROOM", "LIVING ROOM", "ENTRANCE/FOYER", "OTHER ROOM/AREA", "PRIVATE HALL"]);
const ROOM: Record<string, string> = { "ENTIRE APARTMENT": "whole apartment", BATHROOM: "bathroom", KITCHEN: "kitchen", BEDROOM: "bedroom", "LIVING ROOM": "living room", "ENTRANCE/FOYER": "entrance", "PRIVATE HALL": "hallway" };

type Scope = "apt" | "building" | "public";
const upper = (v: string | undefined) => (v ?? "").trim().toUpperCase();
/** Lower-case the first letter mid-sentence, unless the phrase is an acronym or title-cased city wording. */
const lowerFirst = (s: string) => (/[A-Z]/.test(s.slice(1)) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const distinct = <T>(xs: T[]): T[] => [...new Set(xs)];

function hpdScope(r: Row): Scope {
  const unit = upper(r.unit_type);
  const space = upper(r.space_type);
  if (unit === "BUILDING-WIDE" || space === "BUILDING-WIDE" || space === "ENTIRE BUILDING") return "building";
  if (unit === "APARTMENT") return "apt";
  if (unit.startsWith("PUBLIC")) return "public";
  if (space) return APT_SPACES.has(space) ? "apt" : "public";
  return complaintApartment(r.apartment) ? "apt" : "building";
}

/** "Apt 3B · kitchen", "Whole building", "Public area · lobby", or a mix ("Apt D5, public area"). */
function hpdComplaintWhere(rows: Row[]): string {
  const scopes = rows.map(hpdScope);
  const single = new Set(scopes).size === 1;
  const parts: string[] = [];
  if (scopes.includes("apt")) {
    const apt = rows.map((r) => complaintApartment(r.apartment)).find(Boolean);
    const rooms = distinct(rows.filter((_, i) => scopes[i] === "apt").map((r) => ROOM[upper(r.space_type)]).filter((x): x is string => !!x));
    parts.push(`${apt ? `Apt ${apt}` : "Apartment"}${single && rooms.length === 1 ? ` · ${rooms[0]}` : ""}`);
  }
  if (scopes.includes("building")) parts.push("Whole building");
  if (scopes.includes("public")) {
    const spots = distinct(rows.filter((_, i) => scopes[i] === "public").map((r) => upper(r.space_type)).filter((x) => x && x !== "OTHER ROOM/AREA"));
    parts.push(single && spots.length === 1 ? `Public area · ${spots[0]!.toLowerCase()}` : "Public area");
  }
  return parts.map((p, i) => (i === 0 ? p : lowerFirst(p))).join(", ");
}

/**
 * The same reading as data, for grouping: the place `hpdComplaintWhere` names first. A complaint
 * about an apartment and somewhere else belongs to the apartment.
 */
function hpdComplaintPlace(rows: Row[]): { area: RecordArea; unit?: string } {
  const scopes = rows.map(hpdScope);
  if (scopes.includes("apt")) {
    const unit = normalizeUnit(rows.map((r) => complaintApartment(r.apartment)).find(Boolean));
    return unit ? { area: "apartment", unit } : { area: "apartment" };
  }
  return { area: scopes.includes("building") ? "building" : "common" };
}

/** 311 location types that put a request inside a home rather than on the street or the lot. */
const RESIDENTIAL_311_RE = /RESIDENTIAL|APARTMENT|\bAPT\b|FAMILY|DWELLING/i;

/** "A", "A and b", "A, b and c", "A, b, c and 2 more". */
function headlineList(heads: string[]): string {
  const shown = heads.slice(0, 3).map((h, i) => (i === 0 ? h : lowerFirst(h)));
  const more = heads.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown[0] ?? "Housing complaint";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** The fixed topic order: a complaint's topics are listed in it, and the page stacks and colours by it. */
export const TOPIC_ORDER: ComplaintTopic[] = ["heat", "plumbing", "pest", "noise"];
const inTopicOrder = (ts: (ComplaintTopic | null)[]): ComplaintTopic[] => TOPIC_ORDER.filter((t) => ts.includes(t));

/** One HPD complaint problem's topic, from its official categories only. */
function hpdTopic(r: Row): ComplaintTopic | null {
  const major = upper(r.major_category);
  if (major === "HEAT/HOT WATER") return "heat";
  if (major === "PLUMBING" || major === "WATER LEAK") return "plumbing";
  if (major === "UNSANITARY CONDITION" && upper(r.minor_category) === "PESTS") return "pest";
  return null;
}

/** A 311 request's topic: every "Noise..." complaint type, and the Health Dept's "Rodent" type. */
function n311Topic(r: Row): ComplaintTopic | null {
  if (NOISE_RE.test((r.complaint_type ?? "").trim())) return "noise";
  if (upper(r.agency) === "DOHMH" && upper(r.complaint_type) === "RODENT") return "pest";
  return null;
}

function hpdComplaints(rows: Row[]): Complaint[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const id = r.complaint_id ?? r.unique_key ?? r.problem_id;
    if (!id) continue;
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }
  return [...groups].map(([id, g]) => {
    const first = g[0]!;
    const closed = upper(first.complaint_status) !== "OPEN";
    const latest = [...g].filter((r) => r.status_description?.trim()).sort((a, b) => num(b.problem_id) - num(a.problem_id))[0];
    return {
      source: "hpd",
      id,
      date: day(first.received_date),
      what: headlineList(distinct(g.map((r) => complaintHeadline(r.major_category, r.minor_category, r.problem_code)))),
      where: hpdComplaintWhere(g),
      status: closed ? "closed" : "open",
      closedAt: closed ? day(first.complaint_status_date) : null,
      outcome: latest?.status_description?.trim() ?? "",
      emergency: g.some((r) => HPD_EMERGENCY.has(upper(r.type))),
      original: [
        first.apartment ? `Apartment ${first.apartment}` : "",
        ...g.map((r) => `${r.type ?? ""}: ${[r.major_category, r.minor_category, r.problem_code].filter(Boolean).join(" / ")}${r.space_type ? ` (${r.space_type})` : ""}`),
      ]
        .filter(Boolean)
        .join("; "),
      topics: inTopicOrder(g.map(hpdTopic)),
      ...hpdComplaintPlace(g),
    } satisfies Complaint;
  });
}

function dobComplaints(rows: Row[]): Complaint[] {
  return rows.map((r) => {
    const closed = upper(r.status) !== "ACTIVE";
    const code = (r.complaint_category ?? "").trim();
    return {
      source: "dob",
      id: r.complaint_number ?? "",
      date: dayFromUs(r.date_entered),
      what: dobComplaintCategory(code),
      // `unit` is the DOB office that handled the complaint (ELEVR, BKLYN, ERT), not an apartment.
      where: "Building",
      status: closed ? "closed" : "open",
      closedAt: closed ? dayFromUs(r.disposition_date) : null,
      outcome: r.disposition_code?.trim() ? `Disposition: ${r.disposition_code.trim()}` : "",
      emergency: false,
      original: [
        code ? `Category ${code}` : "",
        r.unit ? `DOB unit ${r.unit}` : "",
        r.inspection_date ? `inspected ${r.inspection_date}` : "",
        r.disposition_code ? `disposition ${r.disposition_code}${r.disposition_date ? ` on ${r.disposition_date}` : ""}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      topics: inTopicOrder([dobComplaintTopic(code)]),
      area: "building",
    } satisfies Complaint;
  });
}

function n311Complaints(rows: Row[]): Complaint[] {
  return rows.map((r) => {
    const closed = (r.status ?? "").trim().toLowerCase() === "closed";
    const type = r.complaint_type ?? "";
    const noise = /^noise/i.test(type);
    return {
      source: "311",
      id: r.unique_key ?? "",
      date: day(r.created_date),
      what: translate311(r),
      // Noise is reported at an address, often the neighbour's (docs/RESEARCH.md 2.10).
      where: noise ? "Reported at or near this address" : r.location_type?.trim() || "This lot",
      status: closed ? "closed" : "open",
      closedAt: closed ? day(r.closed_date) : null,
      outcome: r.resolution_description?.trim() ?? "",
      emergency: false,
      original: [r.agency, r.complaint_type, r.descriptor, r.descriptor_2, r.location_type].filter((x) => x && x.trim()).join(" · "),
      topics: inTopicOrder([n311Topic(r)]),
      // 311 is filed against the lot, never an apartment: noise and anything on the street or lot is
      // around the building; a request whose location type is a home is about the building itself.
      area: !noise && RESIDENTIAL_311_RE.test(r.location_type ?? "") ? "building" : "around",
    } satisfies Complaint;
  });
}

/** Every complaint we fetched (HPD and 311 for five years, DOB lifetime), newest first, undated last. */
export function computeComplaints(raw: RawBuildingData, now: Date): ComplaintHistory {
  const items = [...hpdComplaints(raw.hpdComplaintRows), ...dobComplaints(raw.dobComplaintRows), ...n311Complaints(raw.n311Rows)];
  items.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1));
  return {
    items,
    since: complaintWindowStart(now),
    totals: { hpd: num(raw.hpdComplaintsTotal[0]?.n), dob: num(raw.dobComplaintsTotal[0]?.n), n311: num(raw.n311Total[0]?.n) },
    truncated: {
      hpd: raw.hpdComplaintRows.length >= COMPLAINT_LIMITS.hpd,
      dob: raw.dobComplaintRows.length >= COMPLAINT_LIMITS.dob,
      n311: raw.n311Rows.length >= COMPLAINT_LIMITS.n311,
    },
  };
}

// ---------- violation history ----------

/** City status wording, sentence-cased, with the acronyms it uses kept whole: "NOV SENT OUT" -> "NOV sent out". */
function tidyStatus(s: string | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return sentenceCase(t).replace(/\b(nov|dob|ecb|hpd|oath)\b/gi, (m) => m.toUpperCase());
}

/**
 * A summons's hearing in plain words. Only a decided hearing finds a violation; until then the
 * penalty on the city's record is not a fine, and nothing here calls it one.
 */
export function hearingLabel(status: string | undefined): string {
  const s = upper(status);
  if (!s) return "No hearing result on file";
  if (s === "PENDING") return "Hearing pending";
  if (s === "DISMISSED") return "Dismissed";
  if (s === "WRITTEN OFF") return "Written off";
  if (s === "DEFAULT") return "Found in violation by default";
  if (s === "ADMIT/IN-VIO") return "Found in violation (admitted)";
  if (s === "STIPULATION/IN-VIO") return "Found in violation (settled)";
  if (s === "IN VIOLATION" || s.endsWith("/IN-VIO")) return "Found in violation";
  return tidyStatus(status);
}

const isFoundInViolation = (s: string | undefined) => {
  const u = upper(s);
  return u === "DEFAULT" || u === "IN VIOLATION" || u.endsWith("/IN-VIO");
};

/** Label/value pairs, minus the empty ones. */
const facts = (pairs: [string, string | null | undefined | false][]): [string, string][] | undefined => {
  const out = pairs.filter((p): p is [string, string] => typeof p[1] === "string" && p[1].trim() !== "").map(([k, v]) => [k, v.replace(/\s+/g, " ").trim()] as [string, string]);
  return out.length ? out : undefined;
};

function housingRecord(r: Row): ViolationRecord {
  const bedbug = BEDBUG_NOTICE_RE.test(r.novdescription ?? "");
  const t = translateHpd(r.novdescription ?? "", r.apartment, r.story);
  const open = r.violationstatus === "Open";
  const kind: ViolationRecord["kind"] = bedbug ? "paperwork" : r.class === "C" ? "immediate" : r.class === "B" ? "hazardous" : r.class === "A" ? "minor" : "paperwork";
  const notice = day(r.novissueddate);
  return {
    source: "housing",
    kind,
    id: r.violationid ?? "",
    ref: [r.violationid ? `HPD violation ${r.violationid}` : "", r.novid ? `NOV ${r.novid}` : "", r.ordernumber ? `order ${r.ordernumber}` : "", r.class ? `class ${r.class}` : ""].filter(Boolean).join(" · "),
    what: bedbug ? "Landlord cited for not filing the annual bedbug report" : t.what,
    where: bedbug ? "Building" : t.where,
    date: day(r.inspectiondate),
    status: open ? "open" : "closed",
    cityStatus: tidyStatus(r.currentstatus) || (open ? "Open" : "Closed"),
    closedAt: open ? null : day(r.currentstatusdate),
    ...(notice ? { noticeDate: notice } : {}),
    original: (r.novdescription ?? "").trim(),
    ...withFacts([
      ["Rent-impairing", r.rentimpairing === "Y" && "Yes"],
      ["Correct by", day(r.newcorrectbydate ?? r.originalcorrectbydate)],
      ["Certify by", day(r.newcertifybydate ?? r.originalcertifybydate)],
      ["Landlord certified the repair", day(r.certifieddate)],
      ["Inspection approved", day(r.approveddate)],
      ["Notice type", r.novtype && r.novtype.trim().toLowerCase() !== "original" && r.novtype],
      // For an open row the status date is often the notice date already shown; for a closed one it is closedAt.
      ["Status as of", open && day(r.currentstatusdate) !== notice && day(r.currentstatusdate)],
    ]),
    // The bedbug-report notice is about the landlord's paperwork, so it is the building's, wherever the order points.
    ...(bedbug ? { area: "building" as const } : hpdPlace(r.novdescription ?? "", r.apartment, r.story)),
  };
}

function withFacts(pairs: [string, string | null | undefined | false][]): { facts?: [string, string][] } {
  const f = facts(pairs);
  return f ? { facts: f } : {};
}

function dobNowRecord(r: Row, alsoInBis: string | undefined): ViolationRecord {
  const open = r.violation_status === "Active";
  return {
    source: "buildings",
    kind: "buildings",
    id: r.violation_number ?? "",
    ref: r.violation_number ? `DOB ${r.violation_number}` : "",
    what: translateDob("now", { type: r.violation_type, text: r.violation_remarks }),
    where: r.device_type ? `${r.device_type}${r.device_number ? ` ${r.device_number.trim()}` : ""}` : "Building",
    date: day(r.violation_issue_date),
    status: open ? "open" : "closed",
    cityStatus: tidyStatus(r.violation_status) || (open ? "Active" : "Closed"),
    closedAt: null,
    original: (r.violation_remarks ?? r.violation_type ?? "").trim(),
    ...withFacts([
      ["Violation type", r.violation_type],
      ["Filing cycle ended", day(r.cycle_end_date)],
      ["Also on the older DOB system as", alsoInBis],
    ]),
    // DOB violations and summonses are issued against the building (or one of its devices), never an apartment.
    area: "building",
  };
}

function bisRecord(r: Row): ViolationRecord {
  const category = (r.violation_category ?? "").trim();
  const open = !category.includes("*");
  const closedAt = open ? null : dayFromCompact(r.disposition_date);
  return {
    source: "buildings",
    kind: "buildings",
    id: r.number ?? "",
    ref: [r.number ? `DOB ${r.number}` : "", r.ecb_number ? `ECB ${r.ecb_number}` : ""].filter(Boolean).join(" · "),
    what: translateDob("bis", { type: r.violation_type, text: r.description }),
    where: r.device_number?.trim() ? `Device ${r.device_number.trim()}` : "Building",
    date: dayFromCompact(r.issue_date),
    status: open ? "open" : "closed",
    // "V*-DOB VIOLATION - DISMISSED" -> "DOB violation - dismissed"
    cityStatus: tidyStatus(category.replace(/^[A-Z%*]+-/, "")) || (open ? "Active" : "Closed"),
    closedAt,
    original: [r.violation_type, r.description].filter((s) => s && s.trim()).join(" ").replace(/\s+/g, " ").trim(),
    ...withFacts([
      ["Disposition", r.disposition_comments],
      ["Disposition date", open && dayFromCompact(r.disposition_date)],
    ]),
    area: "building",
  };
}

function summonsRecord(r: Row): ViolationRecord {
  const open = upper(r.ecb_violation_status) === "ACTIVE";
  const pending = upper(r.hearing_status) === "PENDING";
  const decided = isFoundInViolation(r.hearing_status);
  const penalty = numOrNull(r.penality_imposed); // sic: the dataset's spelling
  const paid = numOrNull(r.amount_paid);
  const balance = numOrNull(r.balance_due);
  const hearingDate = dayFromCompact(r.hearing_date);
  const time = /^(\d{1,2})(\d{2})$/.exec((r.hearing_time ?? "").trim());
  const status = upper(r.ecb_violation_status);
  return {
    source: "summons",
    kind: "summons",
    id: r.ecb_violation_number ?? "",
    ref: [r.ecb_violation_number ? `ECB ${r.ecb_violation_number}` : "", r.dob_violation_number ? `DOB ${r.dob_violation_number}` : ""].filter(Boolean).join(" · "),
    what: translateDob("ecb", { type: r.violation_type, text: r.violation_description, device: r.severity }),
    where: "Building",
    date: dayFromCompact(r.issue_date),
    status: open ? "open" : "closed",
    cityStatus: status === "RESOLVE" ? "Resolved" : tidyStatus(r.ecb_violation_status) || (open ? "Active" : "Closed"),
    closedAt: null,
    original: [r.severity, r.violation_description].filter((s) => s && s.trim()).join(": "),
    ...(penalty != null ? { penalty } : {}),
    ...(paid != null ? { paid } : {}),
    ...(balance != null ? { balance } : {}),
    hearing: hearingLabel(r.hearing_status),
    ...(r.hearing_status?.trim() ? { hearingStatus: r.hearing_status.trim() } : {}),
    ...(hearingDate ? { hearingDate } : {}),
    ...withFacts([
      // A pending summons has a penalty on the city's record but no decision, so it is not called a fine.
      [pending ? "Penalty listed, hearing pending" : decided ? "Fine imposed" : "Penalty", penalty != null && money(penalty)],
      ["Paid", paid != null && money(paid)],
      [pending ? "Balance listed" : "Balance due", balance != null && money(balance)],
      ["Hearing", hearingDate && `${hearingDate}${time ? ` at ${Number(time[1])}:${time[2]}` : ""}`],
      ["Hearing status as the city writes it", r.hearing_status],
      ["Served", dayFromCompact(r.served_date)],
      ["Severity", r.severity],
      ["Infraction", [r.infraction_code1, r.section_law_description1].filter((s) => s && s.trim()).join(" ")],
      ["Aggravated", r.aggravated_level && upper(r.aggravated_level) !== "NO" && r.aggravated_level],
      ["Certification", r.certification_status],
      ["Respondent", r.respondent_name],
    ]),
    area: "building",
  };
}

/**
 * Every violation and summons we fetched, open and closed, newest first: HPD housing violations,
 * DOB violations from both systems (a BIS row that repeats a DOB NOW violation is listed once, as
 * the DOB NOW one; docs/RESEARCH.md 2.6), and DOB/OATH summonses.
 */
export function computeViolations(raw: RawBuildingData): ViolationHistory {
  const nowNumbers = new Set(raw.dobNowRows.map((r) => (r.violation_number ?? "").trim()).filter(Boolean));
  const bisTwin = new Map<string, string>();
  const bis: ViolationRecord[] = [];
  for (const r of raw.dobBisRows) {
    const key = (r.number ?? "").trim().replace(/^V\*?/, "");
    if (key && nowNumbers.has(key)) bisTwin.set(key, r.number!.trim());
    else bis.push(bisRecord(r));
  }
  const housing = raw.hpdViolationRows.map(housingRecord);
  const buildings = [...raw.dobNowRows.map((r) => dobNowRecord(r, bisTwin.get((r.violation_number ?? "").trim()))), ...bis];
  const summons = raw.ecbRows.map(summonsRecord);
  const items = [...housing, ...buildings, ...summons];
  items.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1));
  const failed = (...keys: string[]) => keys.some((k) => raw.failed.includes(k));
  const unavailable: ViolationSource[] = [];
  if (failed("hpdViolationRows")) unavailable.push("housing");
  if (failed("dobNowRows", "dobBisRows")) unavailable.push("buildings");
  if (failed("ecbRows")) unavailable.push("summons");
  return {
    items,
    truncated: {
      housing: raw.hpdViolationRows.length >= VIOLATION_LIMITS.hpd,
      buildings: raw.dobNowRows.length >= VIOLATION_LIMITS.dobNow || raw.dobBisRows.length >= VIOLATION_LIMITS.bis,
      summons: raw.ecbRows.length >= VIOLATION_LIMITS.ecb,
    },
    totals: { housing: Math.max(num(raw.hpdTotal[0]?.n), housing.length), buildings: buildings.length, summons: summons.length },
    unavailable,
    ...(failed("hpdYear")
      ? {}
      : {
          lastYear: {
            housing: {
              issued: raw.hpdYear.reduce((sum, r) => sum + num(r.n), 0),
              open: raw.hpdYear.filter((r) => (r.violationstatus ?? "").trim().toLowerCase() === "open").reduce((sum, r) => sum + num(r.n), 0),
            },
          },
        }),
  };
}

/** Housing court cases the legal question card and the summary's facts carry: the newest few. */
const LEGAL_CARD_CASES = 10;

// ---------- legal history: housing court cases, vacate orders, evictions ----------

/** eviction_possession is "Possession", "Eviction" or "Unspecified"; ejectment is "Ejectment" or "Not an Ejectment". */
const evictionType = (r: Row) => capitalize([r.eviction_possession?.trim(), r.ejectment?.trim().toLowerCase()].filter(Boolean).join(", "));

const tidy = (v: string | undefined | null) => (v ?? "").replace(/\s+/g, " ").trim();
/** A label and value for a record's details, or nothing when the city has no value. */
const fact = (k: string, v: string | null | undefined): [string, string][] => (v && v.trim() ? [[k, v.trim()]] : []);

function caseRecord(r: Row): LegalRecord {
  const type = tidy(r.casetype);
  const opened = day(r.caseopendate);
  return {
    kind: "case",
    what: `Court case${type ? `: ${type}` : ""}`,
    where: "Building",
    date: opened,
    // The same reading as counts.litigationsPending: anything the city hasn't closed.
    status: tidy(r.casestatus).toUpperCase() === "CLOSED" ? "closed" : "open",
    closedAt: null,
    facts: [
      ...fact("Status", r.casestatus?.trim() ? sentenceCase(r.casestatus) : ""),
      ...fact("Opened", opened),
      ...fact("Type", type),
      ...fact("Against", tidy(r.respondent).replace(/\s*,\s*/g, ", ")),
      ...fact("Harassment finding", tidy(r.findingofharassment)),
      ...fact("Penalty", r.penalty?.trim() ? money(num(r.penalty)) : ""),
      ["From", "Housing court cases (HPD)"],
    ],
    area: "building",
  };
}

function vacateRecord(r: Row): LegalRecord {
  const reason = tidy(r.primary_vacate_reason);
  const effective = day(r.vacate_effective_date);
  const lifted = day(r.actual_rescind_date);
  return {
    kind: "vacate",
    what: `Vacate order${reason ? `: ${sentenceCase(reason)}` : ""}`,
    where: /partial/i.test(r.vacate_type ?? "") ? "Part of the building" : "Building",
    date: effective,
    status: lifted ? "closed" : "open",
    closedAt: lifted,
    facts: [
      ["Status", lifted ? "Lifted" : "Still in effect"],
      ...fact("Effective", effective),
      ...fact("Lifted", lifted),
      ...fact("Type", tidy(r.vacate_type)),
      ...fact("Reason", reason),
      ...fact("Apartments vacated", tidy(r.number_of_vacated_units)),
      ["From", "Vacate orders (HPD)"],
    ],
    area: "building",
  };
}

function evictionRecord(r: Row): LegalRecord {
  const apt = tidy(r.eviction_apt_num);
  const unit = normalizeUnit(apt);
  const done = day(r.executed_date);
  return {
    kind: "eviction",
    what: "Eviction carried out",
    where: apt ? `Apt ${apt}` : "",
    date: done,
    status: "closed",
    closedAt: null,
    facts: [
      ...fact("Carried out", done),
      ...fact("Apartment", apt),
      ...fact("Type", evictionType(r)),
      ...fact("Court index no.", tidy(r.court_index_number)),
      ...fact("Docket", tidy(r.docket_number)),
      ...fact("Marshal", [r.marshal_first_name, r.marshal_last_name].filter((s) => s && s.trim()).map((s) => s!.trim()).join(" ")),
      ["From", "Evictions (city marshals)"],
    ],
    // An eviction is from an apartment, whether or not the city gives its number.
    area: "apartment",
    ...(unit ? { unit } : {}),
  };
}

/**
 * Every housing court case, vacate order and eviction as its own record with every field the city
 * publishes, newest first. Cases are all of them, up to LEGAL_LIMITS.cases; evictions are
 * residential ones from the last three years (the query's window).
 */
export function computeLegal(raw: RawBuildingData): LegalHistory {
  const items = [...raw.litigations.map(caseRecord), ...raw.vacate.map(vacateRecord), ...raw.evictions.map(evictionRecord)];
  items.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? 1 : -1));
  const unavailable: LegalKind[] = [];
  if (raw.failed.includes("litigations")) unavailable.push("case");
  if (raw.failed.includes("vacate")) unavailable.push("vacate");
  if (raw.failed.includes("evictions")) unavailable.push("eviction");
  return {
    items,
    truncated: { cases: raw.litigations.length >= LEGAL_LIMITS.cases, evictions: raw.evictions.length >= LEGAL_LIMITS.evictions },
    unavailable,
  };
}

// ---------- cover, links, teaser, report ----------

export function computeCover(raw: RawBuildingData): Report["cover"] {
  const p = raw.pluto[0];
  const j = raw.jurisdiction[0];
  const floors = numOrNull(p?.numfloors) ?? numOrNull(j?.legalstories);
  const className = buildingClassFamily(p?.bldgclass);
  const dob = (j?.dobbuildingclass ?? "").trim();
  const flat = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const dobClass = dob && !/^NOT AVAILABLE$/i.test(dob) && flat(dob) !== flat(className) ? sentenceCase(dob) : null;
  const programCode = (j?.managementprogram ?? "").trim() || null;
  return {
    yearBuilt: numOrNull(p?.yearbuilt) || null,
    yearAltered: Math.max(num(p?.yearalter1), num(p?.yearalter2)) || null,
    unitsRes: numOrNull(p?.unitsres) ?? numOrNull(j?.legalclassa),
    unitsTotal: numOrNull(p?.unitstotal),
    floors: floors == null ? null : Math.round(floors),
    buildingsOnLot: numOrNull(p?.numbldgs),
    buildingClass: p?.bldgclass ?? null,
    zoning: p?.zonedist1 ?? null,
    plutoOwner: p?.ownername?.trim() ?? null,
    historicDistrict: p?.histdist ?? null,
    landmark: p?.landmark ?? null,
    elevators: raw.elevators.filter((r) => r.device_status === "Active" && r.device_type === "Elevator").length,
    plutoVersion: p?.version ?? null,
    buildingClassName: className,
    dobClass,
    landUse: landUseName(p?.landuse),
    condo: num(p?.condono) > 0,
    housingProgram: housingProgram(programCode),
    housingProgramCode: programCode,
  };
}

export function computeLinks(address: Address, hpdBuildingId: string | null): Link[] {
  const boro = address.bbl[0];
  const block = String(parseInt(address.bbl.slice(1, 6), 10));
  const lot = String(parseInt(address.bbl.slice(6), 10));
  const links: Link[] = [];
  if (hpdBuildingId) links.push({ label: "Housing department page (HPD Online)", url: `https://hpdonline.nyc.gov/hpdonline/building/${hpdBuildingId}/overview` });
  links.push({ label: "Buildings department page (DOB BIS)", url: `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${address.bin}` });
  links.push({ label: "Zoning & lot map (ZoLa)", url: `https://zola.planning.nyc.gov/l/lot/${boro}/${block}/${lot}` });
  links.push({
    label: "Raw open violations (NYC Open Data)",
    url: `https://data.cityofnewyork.us/d/wvxf-dwi5/explore/query/${encodeURIComponent(`SELECT * WHERE bin="${address.bin}" AND violationstatus="Open"`)}/page/filter`,
  });
  links.push({
    label: "Raw 311 complaints (NYC Open Data)",
    url: `https://data.cityofnewyork.us/d/erm2-nwe9/explore/query/${encodeURIComponent(`SELECT * WHERE bbl="${address.bbl}" ORDER BY created_date DESC`)}/page/filter`,
  });
  return links;
}

export function computeReport(input: ComputeInput): Report {
  const { id, raw, now, sources } = input;
  const hpdBuildingId = raw.jurisdiction[0]?.buildingid ?? raw.registration[0]?.buildingid ?? raw.hpdOpenItems[0]?.buildingid ?? null;
  const address: Address = { ...input.address, hpdBuildingId };
  const cover = computeCover(raw);
  const counts = computeCounts(raw, now);
  const ownership = computeOwnership(raw, now);
  const registered = raw.registration.length > 0 || raw.jurisdiction.length > 0;
  const bedbugs = computeBedbugs(raw, registered, now);
  const cards = computeCards(counts, ownership, bedbugs, raw, cover, now);
  const charts = computeCharts(raw, now);
  const items = computeItems(raw);
  const complaints = computeComplaints(raw, now);
  const violations = computeViolations(raw);
  const legal = computeLegal(raw);
  const unitNote = unitNoteFor(address.unit, raw);
  const snapshot = snapshotOf({ generatedAt: raw.fetchedAt, address, counts, complaints, violations, legal, bedbugs });
  const summary = templateSummary({ address, cover, counts, ownership, bedbugs, cards, snapshot });
  return {
    id,
    generatedAt: raw.fetchedAt,
    address,
    cover,
    summary,
    summarySource: "template",
    unitNote,
    cards,
    counts,
    ownership,
    bedbugs,
    charts,
    items,
    itemsTruncated: itemsTruncation(raw),
    complaints,
    violations,
    legal,
    links: computeLinks(address, hpdBuildingId),
    sources,
  };
}

function unitNoteFor(unit: string | null, raw: RawBuildingData): string {
  const hazardousApts = () => [...new Set(raw.hpdOpenItems.filter((r) => (r.class === "B" || r.class === "C") && isRealApartment(r.apartment)).map((r) => r.apartment!))].slice(0, 3);
  if (!unit) {
    const apts = hazardousApts();
    return apts.length ? `No apartment given. Open items are concentrated in apartment${apts.length > 1 ? "s" : ""} ${apts.join(", ")}.` : "No apartment given.";
  }
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mine = raw.hpdOpenItems.filter((r) => isRealApartment(r.apartment) && norm(r.apartment) === norm(unit));
  if (mine.length) {
    const haz = mine.filter((r) => r.class === "B" || r.class === "C").length;
    return `Apartment ${unit} has ${plural(mine.length, "open condition")} on file${haz ? `, ${haz} of them hazardous` : ""}. They're listed below.`;
  }
  const others = hazardousApts();
  return `Nothing on file for apartment ${unit} specifically.${others.length ? ` The open items are in ${others.join(", ")}.` : ""}`;
}

/**
 * What the free preview shows of the paid report: how many violations are open, the newest
 * violation, complaint and legal record as sample rows, and who owns and manages the building.
 */
export function teaserPreview(report: Report): TeaserPreview {
  return {
    openViolations: snapshotOf(report)?.openViolations ?? 0,
    violation: report.violations?.items[0] ?? null,
    complaint: report.complaints?.items[0] ?? null,
    legal: report.legal?.items[0] ?? null,
    owner: report.ownership?.registeredOwner ?? report.cover?.plutoOwner ?? null,
    managedBy: report.ownership?.managingAgent ?? null,
  };
}

export function teaserOf(report: Report, raw: RawBuildingData): Teaser {
  const lead = report.summary.split(/(?<=\.)\s/)[0] ?? "";
  return {
    id: report.id,
    generatedAt: report.generatedAt,
    address: report.address,
    cover: report.cover,
    recordCounts: {
      housingRecords: num(raw.hpdTotal[0]?.n),
      buildingsRecords: num(raw.dobComplaintsTotal[0]?.n),
      complaints311: num(raw.n311Total[0]?.n),
      housingComplaints: num(raw.hpdComplaintsTotal[0]?.n),
    },
    questions: QUESTIONS,
    summaryLead: lead,
    preview: teaserPreview(report),
    sources: report.sources,
  };
}
