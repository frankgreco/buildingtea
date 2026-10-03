// Deterministic plain-English summary. Always available; the AI pass (llm.ts) only
// rewrites this using the same facts, so the page never depends on a model call.

import type { Snapshot } from "@shared/snapshot";
import type { Address, Bedbugs, Card, Counts, Cover, Ownership } from "@shared/types";

export interface SummaryFacts {
  address: Address;
  cover: Cover;
  counts: Counts;
  ownership: Ownership;
  bedbugs: Bedbugs;
  cards: Card[];
  /** The numbers the page shows as its snapshot (shared/snapshot.ts). Absent on reports stored before the rows they are counted from. */
  snapshot?: Snapshot | null;
}

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "an unknown date");
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

/**
 * The summary, written for the reader it almost always has: a renter about to decide whether to sign
 * a lease. It opens with what the building is (the free preview shows that sentence alone), leads
 * with the thing that matters most for that decision, and ends with what to ask or check before
 * signing. It never says to sign or not to.
 */
export function templateSummary(f: SummaryFacts): string {
  const { cover: cv, counts: c, ownership: own, bedbugs: bb } = f;
  const snap = f.snapshot ?? null;
  const s: string[] = [];

  // 1. What the building is.
  const kind = cv.elevators > 0 ? "elevator building" : cv.floors && cv.floors <= 6 ? "walk-up" : "building";
  const size = cv.unitsRes ? `${cv.unitsRes}-unit ` : "";
  const built = cv.yearBuilt ? ` from ${cv.yearBuilt}` : "";
  const hist = cv.historicDistrict ? ` in the ${cv.historicDistrict}` : "";
  s.push(`A ${size}${kind}${built}${hist}${cv.buildingsOnLot && cv.buildingsOnLot > 1 ? `, one of ${cv.buildingsOnLot} buildings on this lot` : ""}.`);

  // 2. The thing to know first: is it safe.
  const haz = c.openB + c.openC;
  const stale = haz > 0 && f.cards.find((x) => x.key === "safe")?.status === "warn";
  if (c.vacateActive) s.push("The big thing to know before signing: part or all of it is under a city vacate order right now, which means people have been ordered out.");
  else if (haz === 0) s.push("The city lists no open hazardous conditions here.");
  else if (stale)
    s.push(`The city lists ${plural(haz, "open hazardous condition")}, but all were recorded between ${fmt(c.oldestOpenHazardous)} and ${fmt(c.newestOpenHazardous)} and never reinspected, so they are probably old paperwork rather than live problems.`);
  else
    s.push(
      `The big thing to know before signing: the city has ${plural(haz, "hazardous problem")} on file here that the landlord hasn't fixed${c.openC ? `, ${c.openC} of them immediately hazardous` : ""}, the newest from ${fmt(c.newestOpenHazardous)}.`,
    );
  if (snap?.openInUnit && f.address.unit) s.push(`${plural(snap.openInUnit, "open violation")} ${snap.openInUnit === 1 ? "is" : "are"} in apartment ${f.address.unit} itself.`);

  // 3. Whether things get fixed.
  if (snap && snap.issued12mo >= 5 && snap.unfixed12mo * 2 >= snap.issued12mo) s.push(`${snap.unfixed12mo} of the ${snap.issued12mo} violations issued in the last year are still open.`);

  // 4. Heat and complaints. The snapshot counts each complaint once; older reports only have the per-category counts.
  const heat = snap ? snap.heatComplaints12mo : c.heat12mo;
  const complaints = snap ? snap.housingComplaints12mo : c.complaints12mo;
  if (heat >= 5) s.push(`Tenants complained to the city about heat or hot water ${heat} times in the last year.`);
  else if (complaints === 0) s.push("Tenants made no complaints to the city in the last 12 months.");
  else s.push(`Tenants made ${plural(complaints, "complaint")} to the city in the last year${c.openComplaints ? `, ${c.openComplaints} still open` : ""}.`);

  // 5. Paperwork and legal.
  const paper: string[] = [];
  if (own.registrationState === "lapsed") paper.push(`the landlord's city registration expired in ${fmt(own.registrationExpires)}`);
  if (bb.required && bb.missingLatest) paper.push("the latest required bedbug report was never filed");
  if (paper.length) s.push(`On paperwork, ${paper.join(" and ")}.`);
  const legal: string[] = [];
  if (c.litigationsPending) legal.push(`${plural(c.litigationsPending, "housing court case")} against the landlord ${c.litigationsPending === 1 ? "is" : "are"} pending`);
  if (c.ecbActive) legal.push(`the city has ${plural(c.ecbActive, "active summons", "active summonses")} against the building`);
  if (c.evictions3y >= 3) legal.push(`${plural(c.evictions3y, "eviction")} were carried out in the last three years`);
  if (legal.length) s.push(`${legal.join(", and ")}.`.replace(/^./, (ch) => ch.toUpperCase()));

  // 6. Bedbugs when notable.
  if ((bb.infested ?? 0) > 0) s.push(`The landlord reported ${plural(bb.infested!, "bedbug case")} out of ${bb.dwellingUnits ?? "?"} apartments last year${bb.eradicated ? ", treated" : ""}.`);

  // 7. What to do with it before signing.
  if (c.vacateActive) s.push("Before going any further, ask the landlord when that order will be lifted.");
  else if (haz > 0 && !stale) s.push("Before you sign, ask the landlord what is being done about the open problems, and look for them when you see the apartment.");
  else if (stale) s.push("Before you sign, ask the landlord whether those were fixed.");
  else if (heat >= 5) s.push("Before you sign, ask a current tenant how the heat was last winter.");
  else s.push("Nothing in the city's records stands out as a red flag, but see the apartment in person before you sign.");

  return s.join(" ");
}
