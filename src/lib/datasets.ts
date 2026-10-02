// The city datasets we read and the exact queries we run per building.
// Every id, column and join key here was verified live on 2026-10-02; see docs/RESEARCH.md.

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
} as const;

export type DatasetKey = keyof typeof DATASETS;

export interface RawBuildingData {
  fetchedAt: string;
  hpdOpenByClass: Row[];
  hpdOpenItems: Row[];
  hpdByYear: Row[];
  hpdTotal: Row[];
  hpdComplaints12mo: Row[];
  hpdComplaintsOpen: Row[];
  hpdComplaintsByMonth: Row[];
  dobBisActive: Row[];
  dobNowActive: Row[];
  ecbActive: Row[];
  dobComplaintsActive: Row[];
  dobComplaintsTotal: Row[];
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
  evictions3y: Row[];
  /** Datasets whose fetch failed; the report marks these sections unavailable. */
  failed: string[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fan out every per-building query in parallel. A single failed dataset does not
 * fail the report; it lands in `failed` and the section shows "unavailable".
 */
export async function fetchBuildingData(bin: string, bbl: string, now: Date, opts: SodaOptions): Promise<RawBuildingData> {
  const yearAgo = isoDate(new Date(now.getTime() - 365 * 86400_000));
  const twoYearsAgo = isoDate(new Date(now.getTime() - 730 * 86400_000));
  const threeYearsAgo = isoDate(new Date(now.getTime() - 3 * 365 * 86400_000));
  const D = DATASETS;

  const queries = {
    hpdOpenByClass: () => soda(D.hpdViolations.id, { bin, violationstatus: "Open", $select: "class,count(*) as n", $group: "class" }, opts),
    hpdOpenItems: () =>
      soda(
        D.hpdViolations.id,
        {
          bin,
          violationstatus: "Open",
          $select: "violationid,class,inspectiondate,novissueddate,apartment,story,currentstatus,rentimpairing,novdescription",
          $order: "inspectiondate DESC",
          $limit: 300,
        },
        opts,
      ),
    hpdByYear: () =>
      soda(D.hpdViolations.id, { bin, $select: "date_trunc_y(inspectiondate) as yr,class,count(*) as n", $group: "yr,class", $order: "yr" }, opts),
    hpdTotal: () => soda(D.hpdViolations.id, { bin, $select: "count(*) as n" }, opts),
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
    dobNowActive: () =>
      soda(
        D.dobSafetyViolations.id,
        {
          bin,
          violation_status: "Active",
          $select: "violation_number,violation_type,violation_remarks,violation_issue_date,device_type,device_number",
          $order: "violation_issue_date DESC",
          $limit: 50,
        },
        opts,
      ),
    ecbActive: () =>
      soda(
        D.ecbViolations.id,
        {
          bin,
          ecb_violation_status: "ACTIVE",
          $select: "ecb_violation_number,issue_date,severity,violation_type,violation_description,balance_due,penality_imposed,hearing_date,hearing_status",
          $order: "issue_date DESC",
          $limit: 50,
        },
        opts,
      ),
    dobComplaintsActive: () =>
      soda(D.dobComplaints.id, { bin, status: "ACTIVE", $select: "complaint_number,date_entered,complaint_category,unit", $limit: 50 }, opts),
    dobComplaintsTotal: () => soda(D.dobComplaints.id, { bin, $select: "count(*) as n" }, opts),
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
    pluto: () =>
      soda(
        D.pluto.id,
        {
          bbl,
          $select: "address,zipcode,ownername,yearbuilt,yearalter1,yearalter2,unitsres,unitstotal,numbldgs,numfloors,bldgclass,landuse,zonedist1,histdist,landmark,condono,version",
        },
        opts,
      ),
    litigations: () =>
      soda(D.litigations.id, { bin, $select: "casetype,caseopendate,casestatus,findingofharassment,respondent,penalty", $order: "caseopendate DESC", $limit: 10 }, opts),
    vacate: () => soda(D.vacateOrders.id, { bin, $select: "primary_vacate_reason,vacate_type,vacate_effective_date,actual_rescind_date,number_of_vacated_units" }, opts),
    evictions3y: () =>
      soda(D.evictions.id, { bin, residential_commercial_ind: "Residential", $where: `executed_date > ${lit(threeYearsAgo)}`, $select: "count(*) as n" }, opts),
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

  // Contacts depend on the registration id.
  let contacts: Row[] = [];
  const regId = out.registration?.[0]?.registrationid;
  if (regId) {
    try {
      contacts = await soda(
        DATASETS.hpdContacts.id,
        { registrationid: regId, $select: "type,contactdescription,corporationname,firstname,lastname,businesshousenumber,businessstreetname,businessapartment,businesscity,businessstate,businesszip" },
        opts,
      );
    } catch {
      failed.push("contacts");
    }
  }

  return { ...(out as unknown as Omit<RawBuildingData, "fetchedAt" | "contacts" | "failed">), fetchedAt: now.toISOString(), contacts, failed };
}
