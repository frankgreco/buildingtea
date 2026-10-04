// The city datasets we read and the exact queries we run per building.
// Every id, column and join key here was verified live on 2026-10-02 (the complaint-history
// lists, the all-status violation queries and everything from rat inspections down on 2026-10-03);
// see docs/RESEARCH.md.
// 44 city requests per report at most: 42 here in parallel, then the registration contacts and the
// lot's deeds and mortgages, each of which needs an id from the first 42. A Worker on the free plan
// gets 50 subrequests, and the address lookup takes one or two of them.

import { soda, lit, type Row, type SodaOptions } from "./soda";

export const DATASETS = {
  hpdViolations: { id: "wvxf-dwi5", name: "Housing violations (HPD)" },
  hpdComplaints: { id: "ygpa-z7cr", name: "Housing complaints (HPD)" },
  hpdRegistrations: { id: "tesw-yqqr", name: "Landlord registration (HPD)" },
  hpdContacts: { id: "feu5-w2e2", name: "Registration contacts (HPD)" },
  hpdJurisdiction: { id: "kj4p-ruqc", name: "Buildings subject to HPD jurisdiction" },
  bedbugs: { id: "wz6d-d3jb", name: "Bedbug reports (HPD, owner-filed)" },
  litigations: { id: "59kj-x8nc", name: "Housing court cases (HPD)" },
  vacateOrders: { id: "tb8q-a3ar", name: "Vacate orders (HPD)" },
  dobViolations: { id: "3h2n-5cm9", name: "Building violations (DOB, BIS)" },
  dobSafetyViolations: { id: "855j-jady", name: "Building violations (DOB NOW)" },
  ecbViolations: { id: "6bgk-3dad", name: "City summonses (DOB/OATH)" },
  dobComplaints: { id: "eabe-havv", name: "Building complaints (DOB)" },
  elevators: { id: "e5aq-a4j2", name: "Elevator compliance (DOB NOW)" },
  evictions: { id: "6z8x-wfk4", name: "Evictions (DOI marshals)" },
  n311: { id: "erm2-nwe9", name: "311 service requests" },
  pluto: { id: "64uk-42ks", name: "Building facts (DCP PLUTO)" },
  ratInspections: { id: "p937-wjvj", name: "Rat inspections (Health Dept)" },
  repairOrders: { id: "mdbu-nrqn", name: "Emergency repairs by contractors (HPD open market orders)" },
  handymanOrders: { id: "sbnd-xujn", name: "Emergency repairs by city staff (HPD handyman work orders)" },
  aep: { id: "hcir-3275", name: "Alternative Enforcement Program (HPD)" },
  heatSensors: { id: "h4mf-f24e", name: "Heat Sensor Program (HPD)" },
  harassmentList: { id: "bzxi-2tsw", name: "Certification of No Harassment pilot building list (HPD)" },
  acrisLegals: { id: "8h5j-fqxa", name: "Property records by lot (ACRIS)" },
  acrisMaster: { id: "bnx9-e6tj", name: "Property documents (ACRIS)" },
  taxLiens: { id: "9rz4-mjek", name: "Tax lien sale lists (DOF)" },
  facades: { id: "xubg-57si", name: "Facade inspection filings (DOB NOW)" },
  boilers: { id: "52dp-yji6", name: "Boiler inspection filings (DOB NOW)" },
  certificates: { id: "bs8b-p36w", name: "Certificates of occupancy (DOB)" },
  permits: { id: "rbx6-tga4", name: "Approved work permits (DOB NOW)" },
  asbestos: { id: "vq35-j9qm", name: "Asbestos abatement filings (DEP)" },
  exemptions: { id: "muvi-b6kx", name: "Property tax exemptions (DOF)" },
} as const;

export type DatasetKey = keyof typeof DATASETS;

export interface RawBuildingData {
  fetchedAt: string;
  hpdOpenByClass: Row[];
  /** Open HPD violations, newest inspection first, at most 300: derived from `hpdViolationRows`. */
  hpdOpenItems: Row[];
  hpdByYear: Row[];
  hpdTotal: Row[];
  /**
   * Housing violations inspected in the last twelve months, counted by status. The row list is capped
   * (open first), so on a building with more violations than the cap it can't say how many recent
   * ones were closed; this count can.
   */
  hpdYear: Row[];
  hpdComplaints12mo: Row[];
  hpdComplaintsOpen: Row[];
  hpdComplaintsByMonth: Row[];
  dobBisActive: Row[];
  /** Active DOB NOW violations, newest first, at most 50: derived from `dobNowRows`. */
  dobNowActive: Row[];
  /** Active city summonses, newest first, at most 50: derived from `ecbRows`. */
  ecbActive: Row[];
  /** HPD violations of every status: open first, then newest inspection, at most VIOLATION_LIMITS.hpd. */
  hpdViolationRows: Row[];
  /** DOB NOW violations of every status: active first, then newest, at most VIOLATION_LIMITS.dobNow. */
  dobNowRows: Row[];
  /** City summonses of every status: active first, then newest, at most VIOLATION_LIMITS.ecb. */
  ecbRows: Row[];
  /** BIS violations of every status, newest first, at most VIOLATION_LIMITS.bis. */
  dobBisRows: Row[];
  dobComplaintsActive: Row[];
  dobComplaintsTotal: Row[];
  /** HPD complaint problems (one row per problem) received in the last five years, newest first. */
  hpdComplaintRows: Row[];
  /** Lifetime distinct HPD complaints at this BIN. */
  hpdComplaintsTotal: Row[];
  /** DOB complaints at this BIN, newest complaint number first. Dates are MM/DD/YYYY text. */
  dobComplaintRows: Row[];
  /** 311 requests at this lot in the last five years, minus the HPD and DOB rows the two feeds above already cover. */
  n311Rows: Row[];
  elevators: Row[];
  bedbugs: Row[];
  registration: Row[];
  contacts: Row[];
  jurisdiction: Row[];
  n311: Row[];
  n311Total: Row[];
  pluto: Row[];
  litigations: Row[];
  vacate: Row[];
  /**
   * Residential evictions carried out in the last three years, newest first: date, apartment, court
   * index and docket numbers, marshal, and the possession and ejectment flags (docs/RESEARCH.md 5 t).
   */
  evictions: Row[];
  /**
   * Every health department visit to the lot, newest first, at most RAT_VISITS: inspections that
   * passed or failed, baiting, clean-ups. Only failed inspections become rows; the rest say whether
   * a failure was followed by a pass (docs/RESEARCH.md 2.17).
   */
  ratInspections: Row[];
  /** Emergency repair orders HPD gave a contractor, newest first, at most VIOLATION_LIMITS.repairs. */
  repairOrders: Row[];
  /** Emergency repair orders HPD's own staff carried out, newest first, at most VIOLATION_LIMITS.repairs. */
  handymanOrders: Row[];
  /** One row per stint in the Alternative Enforcement Program, newest first. */
  aep: Row[];
  /** One row per stint in the Heat Sensor Program. */
  heatSensors: Row[];
  /** The building's row on the Certification of No Harassment pilot list, when it is on it. */
  harassmentList: Row[];
  /** The lot's deeds and mortgages from ACRIS, newest recording first. Empty for a condo building (see `isCondoBillingLot`). */
  acrisDocs: Row[];
  /** Every time the lot was on a tax lien sale list, newest first. */
  taxLiens: Row[];
  facades: Row[];
  /** Accepted boiler inspection filings, newest filing year first. Dates are MM/DD/YYYY text. */
  boilers: Row[];
  /** Certificates of occupancy that state a number of dwelling units, newest first. */
  certificates: Row[];
  /** DOB NOW permits issued in the last twelve months, counted by work type. */
  permits: Row[];
  /** Asbestos abatement projects, one row each, newest start first. */
  asbestos: Row[];
  /** Approved 421-a and J-51 exemptions on the lot, newest tax year first. */
  exemptions: Row[];
  /** Datasets whose fetch failed; the report marks these sections unavailable. */
  failed: string[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Row limits for the complaint lists. A result of exactly this many rows means older ones were cut off. */
export const COMPLAINT_LIMITS = { hpd: 1000, dob: 500, n311: 500 } as const;

/**
 * Row limits for the violation history (open and closed). A result of exactly this many rows means
 * some were cut off. Open and active rows sort first, so the limit only ever drops old closed ones
 * (unless a building has more open rows than the limit).
 * HPD is 500, not 1000: a report is one D1 row (2 MB cap), and at 1000 the heaviest building we
 * tried (530 E 169 St, Bronx: 4,849 HPD violations, 1,155 open) stored 1.68 MB; at 500 it stores 1.31 MB.
 * `rats` caps the failed inspections listed and `repairs` each of the two repair-order queries; with
 * that building's 85 and 163 of them, and its legal records, it stores 1.55 MB.
 */
export const VIOLATION_LIMITS = { hpd: 500, dobNow: 300, ecb: 300, bis: 300, rats: 200, repairs: 200 } as const;

/**
 * Health department visits read per lot. Every visit is needed, not only the failed inspections: a
 * failure is closed by a later pass. No lot in the city has more than 487 (2026-10-03).
 */
export const RAT_VISITS = 500;

/** ACRIS documents looked up per lot: the newest this many of whatever is recorded against it. */
export const ACRIS_DOCS = 120;

/**
 * ACRIS document types, from its own code table (7isb-wh4c). Deeds are the conveyances it calls a
 * deed, less the ones that only correct or confirm an earlier one and timeshare deeds. Mortgages
 * are the types it calls a mortgage; an "agreement" (AGMT) can be a consolidation of older loans or
 * anything else, so it is not one.
 */
export const DEED_TYPES = ["DEED", "DEEDO", "DEEDP", "DEED, LE", "DEED, RC", "IDED", "REIT"] as const;
export const MORTGAGE_TYPES = ["MTGE", "M&CON", "CMTG"] as const;

/**
 * Exemption codes for the two tax breaks that come with rent stabilization, as the finance
 * department's code table (myn9-hwsy) describes them: 1920 is "J51" and the rest are "421A ...".
 * Its lettered variants (1920S, 5110-C) never appear in the exemption rows.
 */
export const J51_CODE = "1920";
export const A421_CODES = ["5110", "5113", "5114", "5116", "5117", "5118", "5119", "5120", "5121", "5122", "5123"] as const;

/** A condo building's own lot (7501-7599) is a billing lot: deeds are recorded against each apartment's lot instead. */
export function isCondoBillingLot(bbl: string): boolean {
  const lot = Number(bbl.slice(6));
  return lot >= 7501 && lot <= 7599;
}

/**
 * Row limits for the legal history: housing court cases (newest first; set well above what a building
 * has, so the Legal section lists every case) and three years of evictions.
 */
export const LEGAL_LIMITS = { cases: 300, evictions: 100 } as const;

/**
 * The open/active lists every card and the "What's on file" list read. They used to be their own
 * queries; they are now cut from the all-status queries above with the same filter, order and cap.
 */
export const ACTIVE_LIMITS = { hpdOpen: 300, dobNow: 50, ecb: 50 } as const;

/** The columns the old open-only queries selected. Derived rows carry exactly these, nothing more. */
export const HPD_OPEN_COLUMNS = ["violationid", "class", "inspectiondate", "novissueddate", "apartment", "story", "currentstatus", "rentimpairing", "novdescription"] as const;
export const DOB_NOW_ACTIVE_COLUMNS = ["violation_number", "violation_type", "violation_remarks", "violation_issue_date", "device_type", "device_number"] as const;
export const ECB_ACTIVE_COLUMNS = [
  "ecb_violation_number",
  "issue_date",
  "severity",
  "violation_type",
  "violation_description",
  "balance_due",
  "penality_imposed",
  "hearing_date",
  "hearing_status",
] as const;

/** Keep only `cols`, and only the ones the row has (Socrata omits null columns). */
function pick(r: Row, cols: readonly string[]): Row {
  const out: Row = {};
  for (const c of cols) if (r[c] !== undefined) out[c] = r[c];
  return out;
}

/**
 * Rows of one status, in the order the query returned them, capped. The all-status queries sort by
 * status first and by the old date order second, so the rows of one status come out in exactly the
 * order (and with the same cap) the old status-filtered query returned.
 */
function cut(rows: Row[], keep: (r: Row) => boolean, cols: readonly string[], cap: number): Row[] {
  return rows.filter(keep).slice(0, cap).map((r) => pick(r, cols));
}

/** `violationstatus=Open`, `$order=inspectiondate DESC`, `$limit=300`, as the old query had it. */
export const deriveHpdOpenItems = (rows: Row[]) => cut(rows, (r) => r.violationstatus === "Open", HPD_OPEN_COLUMNS, ACTIVE_LIMITS.hpdOpen);
/** `violation_status=Active`, `$order=violation_issue_date DESC`, `$limit=50`. */
export const deriveDobNowActive = (rows: Row[]) => cut(rows, (r) => r.violation_status === "Active", DOB_NOW_ACTIVE_COLUMNS, ACTIVE_LIMITS.dobNow);
/** `ecb_violation_status=ACTIVE`, `$order=issue_date DESC`, `$limit=50`. */
export const deriveEcbActive = (rows: Row[]) => cut(rows, (r) => r.ecb_violation_status === "ACTIVE", ECB_ACTIVE_COLUMNS, ACTIVE_LIMITS.ecb);

/** Start of the HPD and 311 complaint window: the same calendar day five years before `now`. */
export function complaintWindowStart(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return isoDate(d);
}

/**
 * Fan out every per-building query in parallel. A single failed dataset does not
 * fail the report; it lands in `failed` and the section shows "unavailable".
 */
export async function fetchBuildingData(bin: string, bbl: string, now: Date, opts: SodaOptions): Promise<RawBuildingData> {
  const yearAgo = isoDate(new Date(now.getTime() - 365 * 86400_000));
  const twoYearsAgo = isoDate(new Date(now.getTime() - 730 * 86400_000));
  const threeYearsAgo = isoDate(new Date(now.getTime() - 3 * 365 * 86400_000));
  const fiveYearsAgo = complaintWindowStart(now);
  const D = DATASETS;

  const queries = {
    hpdOpenByClass: () => soda(D.hpdViolations.id, { bin, violationstatus: "Open", $select: "class,count(*) as n", $group: "class" }, opts),
    // Every status, open first, then newest inspection. hpdOpenItems is cut from this (deriveHpdOpenItems).
    // `case(...)` rather than `violationstatus DESC` so a null or new status can never sort ahead of Open.
    hpdViolationRows: () =>
      soda(
        D.hpdViolations.id,
        {
          bin,
          $select:
            "violationid,class,inspectiondate,approveddate,novissueddate,originalcorrectbydate,originalcertifybydate,newcorrectbydate,newcertifybydate,certifieddate,apartment,story,ordernumber,novid,novtype,novdescription,currentstatus,currentstatusdate,violationstatus,rentimpairing",
          $order: "case(violationstatus='Open',1,true,0) DESC,inspectiondate DESC",
          $limit: VIOLATION_LIMITS.hpd,
        },
        opts,
      ),
    hpdByYear: () =>
      soda(D.hpdViolations.id, { bin, $select: "date_trunc_y(inspectiondate) as yr,class,count(*) as n", $group: "yr,class", $order: "yr" }, opts),
    hpdTotal: () => soda(D.hpdViolations.id, { bin, $select: "count(*) as n" }, opts),
    hpdYear: () => soda(D.hpdViolations.id, { bin, $where: `inspectiondate >= ${lit(yearAgo)}`, $select: "violationstatus,count(*) as n", $group: "violationstatus" }, opts),
    hpdComplaints12mo: () =>
      soda(
        D.hpdComplaints.id,
        {
          bin,
          $where: `received_date > ${lit(yearAgo)}`,
          $select: "major_category,count(distinct complaint_id) as complaints,count(*) as problems",
          $group: "major_category",
          $order: "complaints DESC",
        },
        opts,
      ),
    hpdComplaintsOpen: () =>
      soda(
        D.hpdComplaints.id,
        { bin, complaint_status: "OPEN", $select: "received_date,major_category,minor_category,apartment,space_type", $order: "received_date DESC", $limit: 25 },
        opts,
      ),
    hpdComplaintsByMonth: () =>
      soda(
        D.hpdComplaints.id,
        { bin, $where: `received_date > ${lit(twoYearsAgo)}`, $select: "date_trunc_ym(received_date) as m,count(distinct complaint_id) as n", $group: "m", $order: "m" },
        opts,
      ),
    dobBisActive: () =>
      soda(
        D.dobViolations.id,
        {
          bin,
          $where: "not contains(violation_category,'*')",
          $select: "number,violation_type,issue_date,description,violation_category,device_number",
          $order: "issue_date DESC",
          $limit: 50,
        },
        opts,
      ),
    // BIS active means the category has no `*`, which can't be sorted on, so the history is its own query.
    dobBisRows: () =>
      soda(
        D.dobViolations.id,
        {
          bin,
          $select: "number,violation_number,violation_type_code,violation_type,violation_category,issue_date,disposition_date,disposition_comments,description,device_number,ecb_number",
          $order: "issue_date DESC",
          $limit: VIOLATION_LIMITS.bis,
        },
        opts,
      ),
    // Every status, active first, then newest. dobNowActive is cut from this (deriveDobNowActive).
    dobNowRows: () =>
      soda(
        D.dobSafetyViolations.id,
        {
          bin,
          $select: "violation_number,violation_type,violation_remarks,violation_status,violation_issue_date,device_type,device_number,cycle_end_date",
          $order: "case(violation_status='Active',1,true,0) DESC,violation_issue_date DESC",
          $limit: VIOLATION_LIMITS.dobNow,
        },
        opts,
      ),
    // Every status, active first, then newest. ecbActive is cut from this (deriveEcbActive).
    ecbRows: () =>
      soda(
        D.ecbViolations.id,
        {
          bin,
          $select:
            "ecb_violation_number,ecb_violation_status,dob_violation_number,issue_date,served_date,severity,violation_type,violation_description,infraction_code1,section_law_description1,aggravated_level,respondent_name,penality_imposed,amount_paid,balance_due,hearing_date,hearing_time,hearing_status,certification_status",
          $order: "case(ecb_violation_status='ACTIVE',1,true,0) DESC,issue_date DESC",
          $limit: VIOLATION_LIMITS.ecb,
        },
        opts,
      ),
    dobComplaintsActive: () =>
      soda(D.dobComplaints.id, { bin, status: "ACTIVE", $select: "complaint_number,date_entered,complaint_category,unit", $limit: 50 }, opts),
    dobComplaintsTotal: () => soda(D.dobComplaints.id, { bin, $select: "count(*) as n" }, opts),
    // Complaint history (full report list). Plain params and $where are ANDed by Socrata.
    hpdComplaintRows: () =>
      soda(
        D.hpdComplaints.id,
        {
          bin,
          problem_duplicate_flag: "N",
          $where: `received_date > ${lit(fiveYearsAgo)}`,
          $select:
            "complaint_id,problem_id,received_date,type,major_category,minor_category,problem_code,complaint_status,complaint_status_date,problem_status,status_description,apartment,unit_type,space_type,unique_key",
          $order: "received_date DESC",
          $limit: COMPLAINT_LIMITS.hpd,
        },
        opts,
      ),
    // Same duplicate filter as hpdComplaintRows so the teaser count matches what the list can show.
    hpdComplaintsTotal: () => soda(D.hpdComplaints.id, { bin, problem_duplicate_flag: "N", $select: "count(distinct complaint_id) as n" }, opts),
    dobComplaintRows: () =>
      soda(
        D.dobComplaints.id,
        {
          bin,
          $select: "complaint_number,status,date_entered,complaint_category,unit,disposition_date,disposition_code,inspection_date",
          $order: "complaint_number DESC",
          $limit: COMPLAINT_LIMITS.dob,
        },
        opts,
      ),
    elevators: () =>
      soda(
        D.elevators.id,
        { bin, $select: "device_number,device_type,device_status,cat1_report_year,cat1_latest_report_filed,cat5_latest_report_filed,periodic_report_year,periodic_latest_inspection" },
        opts,
      ),
    bedbugs: () =>
      soda(
        D.bedbugs.id,
        {
          bin,
          $select: "filing_date,filing_period_start_date,filling_period_end_date,of_dwelling_units,infested_dwelling_unit_count,eradicated_unit_count,re_infested_dwelling_unit",
          $order: "filing_date DESC",
          $limit: 3,
        },
        opts,
      ),
    registration: () => soda(D.hpdRegistrations.id, { bin, $select: "registrationid,buildingid,lastregistrationdate,registrationenddate" }, opts),
    jurisdiction: () =>
      soda(D.hpdJurisdiction.id, { bin, $select: "buildingid,registrationid,legalstories,legalclassa,legalclassb,dobbuildingclass,managementprogram,recordstatus" }, opts),
    n311: () =>
      soda(
        D.n311.id,
        { bbl, $where: `created_date > ${lit(yearAgo)}`, $select: "agency,complaint_type,count(*) as n", $group: "agency,complaint_type", $order: "n DESC", $limit: 40 },
        opts,
      ),
    n311Total: () => soda(D.n311.id, { bbl, $select: "count(*) as n" }, opts),
    n311Rows: () =>
      soda(
        D.n311.id,
        {
          bbl,
          // HPD and DOB rows in 311 are the same complaints as ygpa-z7cr and eabe-havv (docs/RESEARCH.md 2.2, 2.9).
          $where: `created_date > ${lit(fiveYearsAgo)} AND agency not in ('HPD','DOB')`,
          $select: "unique_key,created_date,closed_date,agency,complaint_type,descriptor,descriptor_2,location_type,status,resolution_description",
          $order: "created_date DESC",
          $limit: COMPLAINT_LIMITS.n311,
        },
        opts,
      ),
    pluto: () =>
      soda(
        D.pluto.id,
        {
          bbl,
          $select:
            "address,zipcode,ownername,yearbuilt,yearalter1,yearalter2,unitsres,unitstotal,numbldgs,numfloors,bldgclass,landuse,zonedist1,histdist,landmark,condono,firm07_flag,pfirm15_flag,version",
        },
        opts,
      ),
    litigations: () =>
      soda(D.litigations.id, { bin, $select: "casetype,caseopendate,casestatus,findingofharassment,respondent,penalty", $order: "caseopendate DESC", $limit: LEGAL_LIMITS.cases }, opts),
    vacate: () => soda(D.vacateOrders.id, { bin, $select: "primary_vacate_reason,vacate_type,vacate_effective_date,actual_rescind_date,number_of_vacated_units" }, opts),
    // Every per-eviction field the legal card shows (docs/RESEARCH.md 5 t). The address is this building's,
    // and the borough, zip, geography and BIN/BBL columns repeat what the report already has.
    evictions: () =>
      soda(
        D.evictions.id,
        {
          bin,
          residential_commercial_ind: "Residential",
          $where: `executed_date > ${lit(threeYearsAgo)}`,
          $select: "executed_date,eviction_apt_num,court_index_number,docket_number,marshal_first_name,marshal_last_name,ejectment,eviction_possession",
          $order: "executed_date DESC",
          $limit: LEGAL_LIMITS.evictions,
        },
        opts,
      ),

    // ---- Violations section: failed rat inspections and city emergency repairs (docs/RESEARCH.md 2.17, 2.18) ----
    // Rat inspections are of the tax lot. The location, community and BIN columns repeat what the report has.
    ratInspections: () =>
      soda(
        D.ratInspections.id,
        { bbl, $select: "job_id,inspection_date,inspection_type,result,letter_type,observations,house_number,street_name", $order: "inspection_date DESC", $limit: RAT_VISITS },
        opts,
      ),
    // By BIN like every other HPD feed here, not by HPD's building id: that id is only known once the
    // jurisdiction query is back, and 1% of BINs have more than one.
    repairOrders: () =>
      soda(
        D.repairOrders.id,
        {
          bin,
          $select:
            "omonumber,apartment,lifecycle,worktypegeneral,omostatusreason,omoawardamount,omocreatedate,netchangeorders,omoawarddate,isaep,iscommercialdemolition,servicechargeflag,femaevent,omodescription",
          $order: "omocreatedate DESC",
          $limit: VIOLATION_LIMITS.repairs,
        },
        opts,
      ),
    handymanOrders: () =>
      soda(
        D.handymanOrders.id,
        {
          bin,
          $select:
            "hwonumber,lifecycle,worktypegeneral,hwostatusreason,hwocreatedate,isaep,iscommercialdemolition,femaevent,hwodescription,hwoapprovedamount,salestax,adminfee,chargeamount,datetransferdof",
          $order: "hwocreatedate DESC",
          $limit: VIOLATION_LIMITS.repairs,
        },
        opts,
      ),

    // ---- Legal section: city programs (docs/RESEARCH.md 2.19) ----
    aep: () =>
      soda(D.aep.id, { bin, $select: "aep_start_date,of_b_c_violations_at_start,current_status,discharge_date,aep_round", $order: "aep_start_date DESC" }, opts),
    heatSensors: () => soda(D.heatSensors.id, { bin, $select: "program_start_date,current_status,discharge_date", $order: "program_start_date DESC" }, opts),
    harassmentList: () =>
      soda(D.harassmentList.id, { bin, $select: "date_added,bqi,aep_order,discharged_7a,hpd_vacate_order,dob_vacate_order,harassment_finding", $order: "date_added DESC" }, opts),

    // ---- Landlord section: the lot's property records (docs/RESEARCH.md 2.20, 2.21) ----
    // The documents recorded against the lot, newest first: ids from 2003 on start with the recording
    // date, older ones with a borough prefix. Their types, dates and amounts are the second hop below.
    acrisLegals: () =>
      isCondoBillingLot(bbl)
        ? Promise.resolve<Row[]>([])
        : soda(
            D.acrisLegals.id,
            { ...lotOf(bbl), $select: "document_id", $group: "document_id", $order: "case(document_id < 'A',1,true,0) DESC,document_id DESC", $limit: ACRIS_DOCS },
            opts,
          ),
    taxLiens: () => soda(D.taxLiens.id, { ...lotOf(bbl), $select: "month,cycle,water_debt_only", $order: "month DESC", $limit: 50 }, opts),

    // ---- Building facts tiles (docs/RESEARCH.md 2.22, 2.23) ----
    // `cycle` is text ("10" sorts before "9"), so the newest cycle is picked in code.
    facades: () =>
      soda(D.facades.id, { bin, $select: "cycle,filing_type,current_status,filing_status,filing_date,submitted_on", $order: "submitted_on DESC", $limit: 100 }, opts),
    // `inspection_date` is MM/DD/YYYY text; the tracking number starts with the filing year.
    boilers: () =>
      soda(
        D.boilers.id,
        {
          bin_number: bin,
          $where: "starts_with(report_status,'Accepted')",
          $select: "tracking_number,boiler_id,report_type,inspection_date,defects_exist",
          $order: "tracking_number DESC",
          $limit: 100,
        },
        opts,
      ),
    certificates: () =>
      soda(
        D.certificates.id,
        { bin_number: bin, $where: "pr_dwelling_unit IS NOT NULL", $select: "c_o_issue_date,pr_dwelling_unit,issue_type", $order: "c_o_issue_date DESC", $limit: 10 },
        opts,
      ),
    // One row per issuance, renewals included, so permits are counted by their own number.
    permits: () =>
      soda(
        D.permits.id,
        {
          bin,
          $where: `issued_date > ${lit(yearAgo)}`,
          $select: "work_type,count(distinct work_permit) as permits,max(issued_date) as latest",
          $group: "work_type",
          $order: "permits DESC",
        },
        opts,
      ),
    // One row per floor and material of a project, so projects are grouped by their number.
    asbestos: () =>
      soda(D.asbestos.id, { bin, $select: "tru,start_date,status_description", $group: "tru,start_date,status_description", $order: "start_date DESC", $limit: 500 }, opts),
    exemptions: () =>
      soda(
        D.exemptions.id,
        {
          parid: bbl,
          $where: `status like 'A%' AND curexmptot > 0 AND exmp_code in (${[J51_CODE, ...A421_CODES].map(lit).join(",")})`,
          $select: "year,period,exmp_code,curexmptot",
          $order: "year DESC,period DESC",
          $limit: 10,
        },
        opts,
      ),
  };

  const keys = Object.keys(queries) as (keyof typeof queries)[];
  const settled = await Promise.allSettled(keys.map((k) => queries[k]()));
  const out: Record<string, Row[]> = {};
  const failed: string[] = [];
  keys.forEach((k, i) => {
    const r = settled[i]!;
    if (r.status === "fulfilled") out[k] = r.value;
    else {
      out[k] = [];
      failed.push(k);
    }
  });

  // The open/active lists, cut from the all-status rows. A failed source fails its list under the old name too.
  const derived = [
    ["hpdOpenItems", "hpdViolationRows", deriveHpdOpenItems],
    ["dobNowActive", "dobNowRows", deriveDobNowActive],
    ["ecbActive", "ecbRows", deriveEcbActive],
  ] as const;
  for (const [name, from, derive] of derived) {
    out[name] = derive(out[from] ?? []);
    if (failed.includes(from)) failed.push(name);
  }

  // Two requests need an id from the ones above, and run side by side: the registration's contacts,
  // and the type, date and amount of the lot's documents.
  const second = async (name: string, run: (() => Promise<Row[]>) | null): Promise<Row[]> => {
    if (!run) return [];
    try {
      return await run();
    } catch {
      failed.push(name);
      return [];
    }
  };
  const regId = out.registration?.[0]?.registrationid;
  const docIds = (out.acrisLegals ?? []).map((r) => r.document_id).filter((id): id is string => !!id);
  if (failed.includes("acrisLegals")) failed.push("acrisDocs");
  const [contacts, acrisDocs] = await Promise.all([
    second(
      "contacts",
      regId
        ? () =>
            soda(
              D.hpdContacts.id,
              { registrationid: regId, $select: "type,contactdescription,corporationname,firstname,lastname,businesshousenumber,businessstreetname,businessapartment,businesscity,businessstate,businesszip" },
              opts,
            )
        : null,
    ),
    second(
      "acrisDocs",
      docIds.length
        ? () =>
            soda(
              D.acrisMaster.id,
              {
                $where: `document_id in (${docIds.map(lit).join(",")}) AND doc_type in (${[...DEED_TYPES, ...MORTGAGE_TYPES].map(lit).join(",")})`,
                $select: "document_id,doc_type,document_date,document_amt,recorded_datetime,percent_trans",
                $order: "recorded_datetime DESC",
                $limit: ACRIS_DOCS,
              },
              opts,
            )
        : null,
    ),
  ]);

  const { acrisLegals: _ids, ...rows } = out;
  return { ...(rows as unknown as Omit<RawBuildingData, "fetchedAt" | "contacts" | "acrisDocs" | "failed">), fetchedAt: now.toISOString(), contacts, acrisDocs, failed };
}

/** A BBL as the borough, block and lot numbers the finance department's datasets are keyed on. */
function lotOf(bbl: string): { borough: number; block: number; lot: number } {
  return { borough: Number(bbl[0]), block: Number(bbl.slice(1, 6)), lot: Number(bbl.slice(6)) };
}
