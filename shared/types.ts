// Types shared by the Worker and the frontend. Keep this file dependency-free.

export type Status = "good" | "warn" | "serious" | "critical" | "neutral";

export type CardKey = "safe" | "heat" | "pests" | "elev" | "owner" | "legal";

export interface Card {
  key: CardKey;
  question: string;
  status: Status;
  /** Short status word shown in the pill: "Looks good", "Heads up", "Serious", "Critical", "N/A". */
  label: string;
  answer: string;
  details: string[];
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
  links: Link[];
  sources: SourceStamp[];
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
  };
  questions: { key: CardKey; question: string }[];
  /** First sentence of the summary, for the fade-out. */
  summaryLead: string;
  sources: SourceStamp[];
}

/** What the nightly job keeps to detect changes for a watched building. */
export interface WatchSnapshot {
  generatedAt: string;
  openB: number;
  openC: number;
  openComplaints: number;
  dobActive: number;
  ecbActive: number;
  vacateActive: boolean;
  litigationsPending: number;
  bedbugLastFiling: string | null;
  registrationState: Ownership["registrationState"];
  registeredOwner: string | null;
  elevatorIssues: number;
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

export type ReportResponse =
  | { kind: "teaser"; teaser: Teaser }
  | { kind: "full"; report: Report; watch: { active: boolean } };

export interface CheckoutRequest {
  reportId: string;
  plan: "report" | "watch";
}

export interface CheckoutResponse {
  url: string;
}

export type ClaimResponse =
  | { ok: true; token: string; plan: "report" | "watch" }
  | { ok: false; reason: "not_paid" | "unknown_session" | "mismatch" };
