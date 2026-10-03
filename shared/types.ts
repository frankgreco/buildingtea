// Types shared by the Worker and the frontend. Keep this file dependency-free.

export type Status = "good" | "warn" | "serious" | "critical" | "neutral";

export type CardKey = "safe" | "heat" | "pests" | "elev" | "owner" | "legal" | "noise";

/** A table of supporting facts on a question card. Cells are display strings; "–" marks a missing value. */
export interface CardTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface Card {
  key: CardKey;
  question: string;
  status: Status;
  /** Short status word shown in the pill: "Looks good", "Heads up", "Serious", "Critical", "N/A". */
  label: string;
  answer: string;
  /** The supporting facts as sentences. Read by the AI summary and by clients that predate `tables`. */
  details: string[];
  /** The same facts as tables. Absent on reports stored before tables existed; the page then shows `details`. */
  tables?: CardTable[];
  /** Facts with no home in a table: caveats, explainers. Present whenever `tables` is. */
  notes?: string[];
}

/** c = immediately hazardous, b = hazardous, a = minor, p = paperwork, f = fine / city order */
export type Severity = "c" | "b" | "a" | "p" | "f";

export interface LineItem {
  severity: Severity;
  what: string;
  where: string;
  /** ISO date (YYYY-MM-DD) or null when the source has none. */
  date: string | null;
  state: string;
  original: string;
  /** ISO date HPD issued the notice of violation (HPD rows only). */
  noticeDate?: string | null;
  /** The city's own id for the record: "HPD violation 12345678", "ECB 39205015P", "DOB 012345C02". */
  ref?: string;
}

export interface Address {
  label: string;
  borough: string;
  zip: string;
  bin: string;
  bbl: string;
  houseNumber: string;
  street: string;
  unit: string | null;
  /** True when the BIN is a placeholder ("million BIN"): lot-level data only. */
  lotOnly: boolean;
  hpdBuildingId: string | null;
  lat: number;
  lon: number;
}

export interface Cover {
  yearBuilt: number | null;
  yearAltered: number | null;
  unitsRes: number | null;
  unitsTotal: number | null;
  floors: number | null;
  buildingsOnLot: number | null;
  buildingClass: string | null;
  zoning: string | null;
  plutoOwner: string | null;
  historicDistrict: string | null;
  landmark: string | null;
  elevators: number;
  plutoVersion: string | null;
  // Building facts card. Optional: reports stored before it existed lack them.
  /** Plain family name for `buildingClass` ("Elevator apartments" for D1). */
  buildingClassName?: string | null;
  /** HPD's DOB building class ("New law tenement"), when it says something the family name doesn't. */
  dobClass?: string | null;
  /** PLUTO land use in plain words. */
  landUse?: string | null;
  condo?: boolean;
  /** HPD management program in plain words ("Private", "Public housing (NYCHA)"). */
  housingProgram?: string | null;
  /** The raw program code ("PVT", "NYCHA"), so the page can tell private from the rest. */
  housingProgramCode?: string | null;
}

export interface Counts {
  openA: number;
  openB: number;
  openC: number;
  openI: number;
  rentImpairing: number;
  newestOpenHazardous: string | null; // ISO date of the newest open B or C
  oldestOpenHazardous: string | null;
  complaints12mo: number;
  problems12mo: number;
  openComplaints: number;
  heat12mo: number;
  plumbing12mo: number;
  pests12mo: number;
  dobBisActive: number;
  dobNowActive: number;
  ecbActive: number;
  ecbBalanceDue: number;
  dobComplaintsActive: number;
  elevatorsActive: number;
  elevatorIssues: number;
  evictions3y: number;
  litigationsPending: number;
  harassmentFinding: boolean;
  vacateActive: boolean;
  noise12mo: number;
}

export interface Ownership {
  registrationId: string | null;
  registrationExpires: string | null;
  lastRegistered: string | null;
  /** "current" | "grace" | "lapsed" | "none" */
  registrationState: "current" | "grace" | "lapsed" | "none";
  registeredOwner: string | null;
  headOfficer: string | null;
  managingAgent: string | null;
  agentContact: string | null;
  siteManager: string | null;
  agentAddress: string | null;
}

export interface Bedbugs {
  lastFilingDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dwellingUnits: number | null;
  infested: number | null;
  eradicated: number | null;
  reinfested: number | null;
  /** True when the most recent required filing period has no report. */
  missingLatest: boolean;
  /** False for buildings that are not required to file (not a registered multiple dwelling). */
  required: boolean;
}

export interface ChartSeries {
  years: number[];
  /** Per year: [minor (A), hazardous (B), immediately hazardous (C)]. Class I excluded. */
  violationsByYear: [number, number, number][];
  months: string[]; // YYYY-MM, oldest first, 24 entries
  complaintsByMonth: number[];
}

export type ComplaintSource = "hpd" | "dob" | "311";

/**
 * Where a violation or complaint is, as data, for grouping by place: inside an apartment, in the
 * hallways and other common areas, the building as a whole, or (311 only) at or near the address.
 */
export type RecordArea = "apartment" | "common" | "building" | "around";

/** Complaint topics, set only from the city's own categories (never from free text), in this fixed order. */
export type ComplaintTopic = "heat" | "plumbing" | "pest" | "noise";

/** One complaint to the city, from any of the three feeds, in plain English. */
export interface Complaint {
  source: ComplaintSource;
  /** HPD complaint_id, DOB complaint_number, or 311 unique_key. */
  id: string;
  /** ISO date (YYYY-MM-DD) the complaint was received, entered, or created. */
  date: string | null;
  /** Plain-English headline. */
  what: string;
  /** A shorter name written by the naming model after purchase, shown in place of `what` (src/lib/naming.ts). */
  name?: string;
  /** "Apt 3B", "Whole building", "Reported at or near this address", ... */
  where: string;
  status: "open" | "closed";
  closedAt: string | null;
  /** The city's own status or resolution wording; "" when there is none. */
  outcome: string;
  /** HPD type EMERGENCY, IMMEDIATE EMERGENCY or HAZARDOUS; always false for DOB and 311. */
  emergency: boolean;
  /** Raw city wording (categories, codes, descriptors) for the details toggle. */
  original: string;
  /**
   * What the complaint is about, from the city's categories: HPD heat, plumbing and leak, and pest
   * categories; 311 noise types and the Health Dept rodent type; DOB boiler and plumbing codes.
   * Several when it is about several; empty when none apply. Absent on reports stored before topics existed.
   */
  topics?: ComplaintTopic[];
  /** The apartment, normalised ("3B"), when the complaint names one. Absent otherwise and on older reports. */
  unit?: string;
  /** Where the complaint is, from the city's own fields. Absent on reports stored before it existed. */
  area?: RecordArea;
}

export interface ComplaintHistory {
  /** All sources merged, newest first; undated items last. */
  items: Complaint[];
  /** ISO date the HPD and 311 windows start. DOB complaints are not windowed. */
  since: string;
  /** Lifetime counts the city reports. n311 includes the HPD and DOB rows we skip in the list. */
  totals: { hpd: number; dob: number; n311: number };
  /** True when a query returned exactly its row limit, so older items may be missing. */
  truncated: { hpd: boolean; dob: boolean; n311: boolean };
}

/** Housing = HPD violations; buildings = DOB violations (DOB NOW and BIS); summons = DOB/OATH (ECB) summonses. */
export type ViolationSource = "housing" | "buildings" | "summons";

/**
 * What a violation is, for the chart's segments: the four HPD classes (C immediately hazardous,
 * B hazardous, A minor, I and the bedbug-report notices paperwork), then the two DOB feeds.
 */
export type ViolationKind = "immediate" | "hazardous" | "minor" | "paperwork" | "buildings" | "summons";

/** One violation or summons, open or closed, in plain English. */
export interface ViolationRecord {
  source: ViolationSource;
  kind: ViolationKind;
  /** The city's id: HPD violationid, DOB violation number, or ECB violation number. */
  id: string;
  /** Every reference number the city gives it: "HPD violation 19212118 · NOV 10657096 · order 501". */
  ref: string;
  /** Plain-English headline. A summons is never called a fine here: its hearing may not have happened. */
  what: string;
  /** A shorter name written by the naming model after purchase, shown in place of `what` (src/lib/naming.ts). */
  name?: string;
  /** "Apt 3B · kitchen", "Building", "Elevators 2P907". */
  where: string;
  /** ISO date of the inspection (HPD) or issue (DOB, summons); null when the city has none. */
  date: string | null;
  status: "open" | "closed";
  /** The city's own status wording, tidied: "NOV sent out", "Violation dismissed", "Active". */
  cityStatus: string;
  /** ISO date it closed, when the city publishes one (HPD status date, BIS disposition date). */
  closedAt: string | null;
  /** ISO date HPD issued the notice of violation (housing only). */
  noticeDate?: string | null;
  /** The city's wording, verbatim. */
  original: string;
  /** Summonses: the penalty on the city's record, what was paid and what is still owed, in dollars. */
  penalty?: number;
  paid?: number;
  balance?: number;
  /** Summonses: the hearing outcome in plain words ("Hearing pending", "Found in violation", "Dismissed"). */
  hearing?: string;
  /** Summonses: the hearing status as the city writes it ("PENDING", "STIPULATION/IN-VIO"). */
  hearingStatus?: string;
  /** Summonses: ISO date of the hearing. */
  hearingDate?: string | null;
  /** Every other published field worth a renter's time, as label and value. ISO dates are formatted by the page. */
  facts?: [string, string][];
  /** The apartment, normalised ("3B"), when the violation names one. Absent otherwise and on older reports. */
  unit?: string;
  /** Where it is: an apartment, the common areas, or the building as a whole. Absent on older reports. */
  area?: Exclude<RecordArea, "around">;
}

export interface ViolationHistory {
  /** All three sources, newest first; undated last. */
  items: ViolationRecord[];
  /** True when a query returned exactly its row limit, so some records are not listed. */
  truncated: { housing: boolean; buildings: boolean; summons: boolean };
  /** Housing: HPD violations ever recorded at this BIN. Buildings and summons: records listed (complete unless truncated). */
  totals: { housing: number; buildings: number; summons: number };
  /** Sources whose query failed, so the section can say they are missing rather than empty. */
  unavailable: ViolationSource[];
  /**
   * Housing violations inspected in the 365 days before the report, as the city counts them: how many
   * there were and how many are still open. `items` is capped with open ones first, so on a building
   * past the cap it holds too few of the recent closed ones to count this from. Absent on reports
   * stored before it, and when the count didn't load.
   */
  lastYear?: { housing: { issued: number; open: number } };
}

export type LegalKind = "case" | "vacate" | "eviction";

/** One housing court case, vacate order or eviction, in plain English. */
export interface LegalRecord {
  kind: LegalKind;
  /** Plain-English headline: "Court case: Tenant Action", "Vacate order: Fire damage", "Eviction carried out". */
  what: string;
  /** A plainer name written by the naming model after purchase, shown in place of `what` (src/lib/naming.ts). */
  name?: string;
  /** "Building", "Part of the building", "Apt 3B"; "" for an eviction with no apartment number. */
  where: string;
  /** ISO date the case opened, the order took effect, or the eviction was carried out; null when the city has none. */
  date: string | null;
  /** Open: a case that isn't closed, or an order still in effect. An eviction has happened, so it is closed. */
  status: "open" | "closed";
  /** ISO date a vacate order was lifted. */
  closedAt: string | null;
  /** Every published field, as label and value, the status in words first. ISO dates are formatted by the page. */
  facts: [string, string][];
  /** The apartment, normalised ("3B"), when the record names one. */
  unit?: string;
  area?: RecordArea;
}

export interface LegalHistory {
  /** All three kinds, newest first; undated last. Evictions go back three years. */
  items: LegalRecord[];
  /** True when a query returned exactly its row limit, so some records are not listed. */
  truncated: { cases: boolean; evictions: boolean };
  /** Kinds whose query failed, so the section can say they are missing rather than empty. */
  unavailable: LegalKind[];
}

export interface SourceStamp {
  id: string;
  name: string;
  updatedAt: string | null;
}

export interface Link {
  label: string;
  url: string;
}

export interface Report {
  id: string;
  generatedAt: string;
  address: Address;
  cover: Cover;
  summary: string;
  summarySource: "template" | "ai";
  unitNote: string;
  cards: Card[];
  counts: Counts;
  ownership: Ownership;
  bedbugs: Bedbugs;
  charts: ChartSeries;
  items: LineItem[];
  /** Set when the open housing violation query hit its row limit: HPD rows listed vs open in total. */
  itemsTruncated?: { shown: number; total: number } | null;
  complaints: ComplaintHistory;
  /** Every violation and summons on file, open and closed. Absent on reports stored before it existed. */
  violations?: ViolationHistory;
  /** Every housing court case, vacate order and eviction on file. Absent on reports stored before it existed. */
  legal?: LegalHistory;
  links: Link[];
  sources: SourceStamp[];
}

/**
 * What the free preview shows of the paid report, in the report's own format. Everything else on
 * the preview is a locked stand-in, so this is all of the report that is sent before a purchase.
 */
export interface TeaserPreview {
  /** Violations and summonses of every kind that are still open: the snapshot's first line. */
  openViolations: number;
  /** The newest record of each kind, shown as that section's one sample row; null when there is none. */
  violation: ViolationRecord | null;
  complaint: Complaint | null;
  legal: LegalRecord | null;
  /** The owner on the city's registration (or in the tax records) and the managing agent. */
  owner: string | null;
  managedBy: string | null;
}

export interface Teaser {
  id: string;
  generatedAt: string;
  address: Address;
  cover: Cover;
  recordCounts: {
    housingRecords: number; // HPD violations ever recorded at this BIN
    buildingsRecords: number; // DOB complaints ever recorded at this BIN
    complaints311: number; // 311 requests at this lot since 2020
    housingComplaints: number; // HPD complaints ever recorded at this BIN (distinct complaint_id)
  };
  questions: { key: CardKey; question: string }[];
  /** First sentence of the summary, for the fade-out. */
  summaryLead: string;
  /** Absent on teasers stored before the preview took the report's format. */
  preview?: TeaserPreview;
  sources: SourceStamp[];
}

// ---- API wire shapes ----

export interface SearchRequest {
  address: string;
}

export type SearchResponse =
  | { ok: true; reportId: string; teaser: Teaser }
  | { ok: false; reason: "no_match" | "ambiguous" | "intersection" | "invalid" | "rate_limited" | "upstream"; message: string; candidates?: Candidate[] };

export interface Candidate {
  label: string;
  borough: string;
  zip: string;
  bin: string;
  bbl: string;
}

/** GET /api/sample: the landing page's sample report, in full. */
export interface SampleResponse {
  report: Report;
}

export type ReportResponse =
  | { kind: "teaser"; teaser: Teaser }
  | { kind: "full"; report: Report };

export interface CheckoutRequest {
  reportId: string;
  /** The only plan sold; the server refuses any other value. */
  plan: "report";
}

export interface CheckoutResponse {
  url: string;
}

export type ClaimResponse =
  | { ok: true; token: string }
  | { ok: false; reason: "not_paid" | "unknown_session" | "mismatch" };
