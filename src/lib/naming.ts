// Which of a report's rows get a model-written name, and how the names are put back. Pure: the
// model call itself is llm.ts's nameRecords, so everything here is unit tested in Node.
//
// A row's rule-written headline is short where the rules know the wording ("Water leak") and a cut
// sentence of the city's own text where they don't (most summonses). After a purchase, a small model
// names every violation and complaint from the last twelve months, the window the charts show, and
// every legal record, whose rule-written headline is the city's own label ("Court case: Tenant
// Action"). A name is keyed on the record's type and the city's wording (less the part that only
// says which apartment), so rows that say the same thing get the same name and each wording is sent
// once.

import type { Complaint, LegalRecord, Report, ViolationRecord } from "@shared/types";

export interface NamingItem {
  /** The record's type and the city's wording: what a name is keyed on. */
  key: string;
  /** "housing violation", "city summons", "311 request" and so on, for the model. */
  type: string;
  /** The rule-written headline the row shows until it has a name. */
  current: string;
  /** The city's wording. */
  text: string;
}

/** Wordings one pass names at most, newest first. */
export const NAMING_MAX = 180;

const VIOLATION_TYPE: Record<ViolationRecord["source"], string> = {
  housing: "housing violation",
  buildings: "buildings violation",
  summons: "city summons",
  rats: "rat inspection",
  repairs: "city emergency repair",
};
const COMPLAINT_TYPE: Record<Complaint["source"], string> = { hpd: "housing complaint", dob: "buildings complaint", "311": "311 request" };

const LEGAL_TYPE: Record<LegalRecord["kind"], string> = { case: "housing court case", vacate: "vacate order", eviction: "eviction", program: "city program" };
/**
 * The fields a legal record is named from: what it is and how it stands, not who, when, how much or
 * which docket. Leaving the amounts out keeps the wordings few however many cases a building has.
 */
const LEGAL_FIELDS = ["Type", "Status", "Reason", "Harassment finding", "Apartments vacated"];

type Named = ViolationRecord | Complaint;

/**
 * The wording a violation is named from: the city's text without the tail that only says which
 * apartment it is in ("... LOCATED AT APT D5, 4th STORY, 1st APARTMENT FROM NORTH AT EAST"), so the
 * same condition in two apartments is one wording with one name. A rat inspection's wording is its
 * result and what the inspectors saw; a city repair's is the order's description.
 */
const violationText = (v: ViolationRecord) => (v.original ?? "").replace(/\s+LOCATED AT APT\b.*$/i, "").trim();

/**
 * The wording a complaint is named from. A housing complaint's starts with its apartment, which is
 * dropped for the same reason. A buildings complaint's is only codes and dates around its category,
 * which `what` already spells out, so the category is the wording.
 */
const complaintText = (c: Complaint) => (c.source === "dob" ? c.what : (c.original ?? "").replace(/^Apartment [^;]*;\s*/i, "")).trim();

/** A legal record has no sentence from the city, so its wording is its telling fields: "Type: Tenant Action; Status: Pending". */
const legalText = (x: LegalRecord) =>
  (Array.isArray(x.facts) ? x.facts : [])
    .filter(([k]) => LEGAL_FIELDS.includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

/** A row's key, or null when the city gave no wording to name it from. */
const keyOf = (type: string | undefined, text: string): string | null => (type && text ? `${type}\n${text}` : null);
/**
 * A repair order the city didn't carry out keeps its rule-written headline: its description is the
 * work that was ordered, and a name written from that alone would read as work that was done.
 */
const violationKey = (v: ViolationRecord) => (v.source === "repairs" && v.done === false ? null : keyOf(VIOLATION_TYPE[v.source], violationText(v)));
const complaintKey = (c: Complaint) => keyOf(COMPLAINT_TYPE[c.source], complaintText(c));
/** A city program has no wording from the city beyond its name: the headline the rules give it is already the plain one. */
const legalKey = (x: LegalRecord) => (x.kind === "program" ? null : keyOf(LEGAL_TYPE[x.kind], legalText(x)));

const violationsOf = (r: Report): ViolationRecord[] => (Array.isArray(r.violations?.items) ? r.violations!.items : []);
const complaintsOf = (r: Report): Complaint[] => (Array.isArray(r.complaints?.items) ? r.complaints.items : []);
const legalOf = (r: Report): LegalRecord[] => (Array.isArray(r.legal?.items) ? r.legal!.items : []);

/** The ISO date twelve months before the report was generated. */
function windowStart(r: Report): string {
  const d = new Date(r.generatedAt);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The distinct wordings that have no name yet, capped at NAMING_MAX: every legal record (there are
 * few, and the Legal section lists them all), then violations and complaints from the last twelve
 * months, newest first.
 */
export function pendingNames(r: Report): NamingItem[] {
  const since = windowStart(r);
  const legal: NamingItem[] = [];
  for (const x of legalOf(r)) {
    const key = legalKey(x);
    if (key && !x.name) legal.push({ key, type: LEGAL_TYPE[x.kind], current: x.what, text: legalText(x) });
  }
  const rows: { date: string; item: NamingItem }[] = [];
  const add = (rec: Named, key: string | null, type: string | undefined, text: string) => {
    if (!key || !type || rec.name || !rec.date || rec.date < since) return;
    rows.push({ date: rec.date, item: { key, type, current: rec.what, text } });
  };
  for (const v of violationsOf(r)) add(v, violationKey(v), VIOLATION_TYPE[v.source], violationText(v));
  for (const c of complaintsOf(r)) add(c, complaintKey(c), COMPLAINT_TYPE[c.source], complaintText(c));
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = new Set<string>();
  const out: NamingItem[] = [];
  for (const item of [...legal, ...rows.map((x) => x.item)]) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
    if (out.length >= NAMING_MAX) break;
  }
  return out;
}

/**
 * Put `names` on every row that has none and whose wording has one, whatever the row's date: an old
 * row that says what a recent one says gets the same name. Returns the same report when nothing changed.
 */
export function applyNames(r: Report, names: Map<string, string>): Report {
  if (!names.size) return r;
  let changed = false;
  const name = <T extends Named | LegalRecord>(rec: T, key: string | null): T => {
    const n = !rec.name && key ? names.get(key) : undefined;
    if (!n) return rec;
    changed = true;
    return { ...rec, name: n };
  };
  const violations = violationsOf(r).map((v) => name(v, violationKey(v)));
  const complaints = complaintsOf(r).map((c) => name(c, complaintKey(c)));
  const legal = legalOf(r).map((x) => name(x, legalKey(x)));
  if (!changed) return r;
  return {
    ...r,
    ...(r.violations ? { violations: { ...r.violations, items: violations } } : {}),
    complaints: { ...r.complaints, items: complaints },
    ...(r.legal ? { legal: { ...r.legal, items: legal } } : {}),
  };
}
