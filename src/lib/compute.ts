// Turn raw city rows into the Report the page renders. All status rules live here
// and are documented in docs/RULES.md. Pure function: no I/O, fully unit-testable.

import type {
  Address,
  Bedbugs,
  Card,
  ChartSeries,
  Counts,
  LineItem,
  Link,
  Ownership,
  Report,
  SourceStamp,
  Status,
  Teaser,
  WatchSnapshot,
} from "@shared/types";
import type { RawBuildingData } from "./datasets";
import type { Row } from "./soda";
import { isRealApartment, translateDob, translateHpd } from "./translate";

/** Infestation wording in an HPD order. Paperwork notices ("file annual bedbug report") are excluded by class. */
const PEST_RE = /\b(?:ROACH(?:ES)?|MICE|RATS?|RODENTS?|VERMIN|BED ?BUGS?)\b/i;
const BEDBUG_NOTICE_RE = /FILE ANNUAL BEDBUG REPORT/i;
import { templateSummary } from "./summary";

const LABEL: Record<Status, string> = { good: "Looks good", warn: "Heads up", serious: "Serious", critical: "Critical", neutral: "N/A" };

export const QUESTIONS: { key: Card["key"]; question: string }[] = [
  { key: "safe", question: "Is it safe?" },
  { key: "heat", question: "Heat, water & plumbing?" },
  { key: "pests", question: "Pests & bedbugs?" },
  { key: "elev", question: "Elevators?" },
  { key: "owner", question: "Who's the landlord?" },
  { key: "legal", question: "Any legal trouble?" },
];

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
const daysBetween = (a: string, b: Date): number => Math.floor((b.getTime() - new Date(a).getTime()) / 86400_000);
const fmt = (iso: string | null): string => {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

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
  for (const r of raw.n311) if (/^Noise/i.test(r.complaint_type ?? "")) noise += num(r.n);

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
    evictions3y: num(raw.evictions3y[0]?.n),
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
  const nameOf = (c: Row | undefined) =>
    c ? [c.corporationname, [c.firstname, c.lastname].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(" · ") || null : null;
  const owner = find("CorporateOwner") ?? find("IndividualOwner") ?? find("JointOwner") ?? find("Owner");
  const agent = find("Agent");
  const head = find("HeadOfficer");
  const site = find("SiteManager");
  const addr = (c: Row | undefined) =>
    c ? [c.businesshousenumber, c.businessstreetname, c.businessapartment, c.businesscity, c.businesszip].filter((s) => s && s.trim()).join(" ") || null : null;
  return {
    registrationId: reg?.registrationid ?? null,
    registrationExpires: expires,
    lastRegistered: day(reg?.lastregistrationdate),
    registrationState: state,
    registeredOwner: owner?.corporationname ?? nameOf(owner),
    headOfficer: head ? [head.firstname, head.lastname].filter(Boolean).join(" ") || null : null,
    managingAgent: agent?.corporationname ?? nameOf(agent),
    agentContact: agent ? [agent.firstname, agent.lastname].filter(Boolean).join(" ") || null : null,
    siteManager: site ? [site.firstname, site.lastname].filter(Boolean).join(" ") || null : null,
    agentAddress: addr(agent) ?? addr(owner),
  };
}

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
  const card = (key: Card["key"], status: Status, answer: string, details: string[]): Card => ({
    key,
    question: QUESTIONS.find((q) => q.key === key)!.question,
    status,
    label: LABEL[status],
    answer,
    details,
  });

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
    cards.push(card("safe", status, answer, details));
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
    cards.push(card("heat", status, answer, details));
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
    const details = [
      bb.lastFilingDate ? `Bedbug report filed ${fmt(bb.lastFilingDate)}: ${bb.infested ?? 0} infested, ${bb.eradicated ?? 0} treated, ${bb.reinfested ?? 0} re-infested` : "",
      bb.missingLatest ? "Latest required bedbug report not filed" : "",
      bedbugNotices.length ? `The city has cited the landlord ${plural(bedbugNotices.length, "time")} for not filing the bedbug report (latest ${fmt(day(bedbugNotices[0]!.inspectiondate))})` : "",
      c.pests12mo ? `${plural(c.pests12mo, "unsanitary-condition complaint")} in 12 months (pests, mold, garbage)` : "",
      "Bedbug counts are self-reported by the owner",
    ].filter(Boolean);
    cards.push(card("pests", status, answer, details));
  }

  // --- Elevators ---
  {
    const active = raw.elevators.filter((r) => r.device_status === "Active" && r.device_type === "Elevator");
    if (active.length === 0) {
      cards.push(card("elev", "neutral", `No elevators on file${cover.floors ? ` (${cover.floors}-story${cover.floors <= 6 ? " walk-up" : ""})` : ""}.`, []));
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
        ...active.map((r) => `Device ${r.device_number}: inspected ${fmt(day(r.periodic_latest_inspection))}, Cat 1 test filed ${fmt(day(r.cat1_latest_report_filed))}`),
        missingCat1.length ? `${plural(missingCat1.length, "elevator")} missing the ${lastYear} Category 1 test filing` : "",
      ].filter(Boolean);
      cards.push(card("elev", status, answer, details));
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
    const details = [
      own.registrationState === "lapsed" ? "An unregistered landlord cannot certify repairs and cannot sue a tenant for nonpayment of rent" : "",
      own.headOfficer ? `Head officer: ${own.headOfficer}` : "",
      own.siteManager ? `Site manager: ${own.siteManager}` : "",
      own.agentAddress ? `Business address: ${own.agentAddress}` : "",
      own.lastRegistered ? `Last registered ${fmt(own.lastRegistered)}` : "",
      cover.plutoOwner && cover.plutoOwner !== own.registeredOwner ? `Tax records list the owner as ${cover.plutoOwner}` : "",
    ].filter(Boolean);
    cards.push(card("owner", status, answer, details));
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
    const details = [
      ...raw.litigations.slice(0, 3).map((r) => `${r.casetype ?? "Case"} opened ${fmt(day(r.caseopendate))}: ${(r.casestatus ?? "").toLowerCase()}${r.findingofharassment ? `, ${r.findingofharassment.toLowerCase()}` : ""}`),
      ...raw.vacate.map((r) => `${r.vacate_type ?? ""} vacate order (${r.primary_vacate_reason ?? "reason not given"}) effective ${fmt(day(r.vacate_effective_date))}${r.actual_rescind_date ? `, lifted ${fmt(day(r.actual_rescind_date))}` : ", still in effect"}`),
      c.ecbBalanceDue ? `${money(c.ecbBalanceDue)} in unpaid city fines` : "",
    ].filter(Boolean);
    cards.push(card("legal", status, answer, details));
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

export function computeItems(raw: RawBuildingData): LineItem[] {
  const items: LineItem[] = [];
  const hazardous = raw.hpdOpenItems.filter((r) => r.class === "C" || r.class === "B");
  for (const r of hazardous.slice(0, 12)) {
    const t = translateHpd(r.novdescription ?? "", r.apartment, r.story);
    const state = [r.rentimpairing === "Y" ? "rent-impairing" : "", (r.currentstatus ?? "").toLowerCase()].filter(Boolean).join(" · ");
    items.push({ severity: r.class === "C" ? "c" : "b", what: t.what, where: t.where, date: day(r.inspectiondate), state: `open · ${state}`, original: r.novdescription ?? "" });
  }
  if (hazardous.length > 12) {
    items.push({ severity: "b", what: `${hazardous.length - 12} more open hazardous conditions not listed here`, where: "Various", date: null, state: "open", original: "See HPD Online for the full list." });
  }
  for (const r of raw.ecbActive.slice(0, 6)) {
    const fine = num(r.balance_due) ? ` · ${money(num(r.balance_due))} unpaid` : "";
    const hearing = r.hearing_date ? ` · hearing ${fmt(dayFromCompact(r.hearing_date))}` : "";
    items.push({
      severity: "f",
      what: `City fine: ${translateDob("ecb", { type: r.violation_type, text: r.violation_description, device: r.severity })}`,
      where: "Building",
      date: dayFromCompact(r.issue_date),
      state: `${(r.hearing_status ?? "active").toLowerCase()}${fine}${hearing}`,
      original: `${r.ecb_violation_number ?? ""} ${r.severity ?? ""}: ${r.violation_description ?? ""}`.trim(),
    });
  }
  for (const r of raw.dobNowActive.slice(0, 6)) {
    items.push({ severity: "f", what: translateDob("now", { type: r.violation_type, text: r.violation_remarks }), where: r.device_type ? `${r.device_type}${r.device_number ? ` ${r.device_number}` : ""}` : "Building", date: day(r.violation_issue_date), state: "active", original: `${r.violation_number ?? ""}: ${r.violation_remarks ?? ""}`.trim() });
  }
  for (const r of raw.dobBisActive.slice(0, 6)) {
    items.push({ severity: "f", what: translateDob("bis", { type: r.violation_type, text: r.description }), where: "Building", date: dayFromCompact(r.issue_date), state: "active", original: `${r.number ?? ""}: ${r.violation_type ?? ""} ${r.description ?? ""}`.trim() });
  }
  const paperwork = raw.hpdOpenItems.filter((r) => r.class === "I");
  if (paperwork.length) {
    const t = translateHpd(paperwork[0]!.novdescription ?? "");
    items.push({ severity: "p", what: t.what, where: "Building", date: day(paperwork[0]!.inspectiondate), state: `${plural(paperwork.length, "notice")}`, original: paperwork[0]!.novdescription ?? "" });
  }
  const bedbugNotices = raw.hpdOpenItems.filter((r) => BEDBUG_NOTICE_RE.test(r.novdescription ?? ""));
  if (bedbugNotices.length) {
    items.push({ severity: "p", what: "Landlord cited for not filing the annual bedbug report", where: "Building", date: day(bedbugNotices[0]!.inspectiondate), state: `${plural(bedbugNotices.length, "notice")}`, original: bedbugNotices[0]!.novdescription ?? "" });
  }
  const minor = raw.hpdOpenItems.filter((r) => r.class === "A" && !BEDBUG_NOTICE_RE.test(r.novdescription ?? "")).length;
  if (minor) items.push({ severity: "a", what: `${plural(minor, "minor item")} (paint, plaster, similar) not listed here`, where: "Various", date: null, state: "open", original: "Class A violations." });
  return items;
}

// ---------- cover, links, teaser, report ----------

export function computeCover(raw: RawBuildingData): Report["cover"] {
  const p = raw.pluto[0];
  const j = raw.jurisdiction[0];
  const floors = numOrNull(p?.numfloors) ?? numOrNull(j?.legalstories);
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
  const unitNote = unitNoteFor(address.unit, raw);
  const summary = templateSummary({ address, cover, counts, ownership, bedbugs, cards });
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
    },
    questions: QUESTIONS,
    summaryLead: lead,
    sources: report.sources,
  };
}

export function snapshotOf(report: Report): WatchSnapshot {
  const c = report.counts;
  return {
    generatedAt: report.generatedAt,
    openB: c.openB,
    openC: c.openC,
    openComplaints: c.openComplaints,
    dobActive: c.dobBisActive + c.dobNowActive,
    ecbActive: c.ecbActive,
    vacateActive: c.vacateActive,
    litigationsPending: c.litigationsPending,
    bedbugLastFiling: report.bedbugs.lastFilingDate,
    registrationState: report.ownership.registrationState,
    registeredOwner: report.ownership.registeredOwner,
    elevatorIssues: c.elevatorIssues,
  };
}

/** Human-readable list of what changed between two snapshots; empty when nothing worth listing in a digest. */
export function diffSnapshots(prev: WatchSnapshot, next: WatchSnapshot): string[] {
  const out: string[] = [];
  const d = (label: string, a: number, b: number) => {
    if (b > a) out.push(`${label}: ${a} → ${b}`);
  };
  d("Immediately hazardous conditions open", prev.openC, next.openC);
  d("Hazardous conditions open", prev.openB, next.openB);
  d("Open complaints", prev.openComplaints, next.openComplaints);
  d("Active buildings-department violations", prev.dobActive, next.dobActive);
  d("Active city summonses", prev.ecbActive, next.ecbActive);
  d("Open elevator issues", prev.elevatorIssues, next.elevatorIssues);
  d("Pending housing court cases", prev.litigationsPending, next.litigationsPending);
  if (!prev.vacateActive && next.vacateActive) out.push("A vacate order is now in effect");
  if (prev.vacateActive && !next.vacateActive) out.push("The vacate order was lifted");
  if (prev.bedbugLastFiling !== next.bedbugLastFiling && next.bedbugLastFiling) out.push(`New bedbug report filed ${fmt(next.bedbugLastFiling)}`);
  if (prev.registrationState !== next.registrationState) out.push(`Landlord registration is now ${next.registrationState}`);
  if (prev.registeredOwner !== next.registeredOwner && next.registeredOwner) out.push(`Registered owner changed to ${next.registeredOwner}`);
  return out;
}
