// Deterministic plain-English summary. Always available; the AI pass (llm.ts) only
// rewrites this using the same facts, so the page never depends on a model call.

import type { Address, Bedbugs, Card, Counts, Cover, Ownership } from "@shared/types";

export interface SummaryFacts {
  address: Address;
  cover: Cover;
  counts: Counts;
  ownership: Ownership;
  bedbugs: Bedbugs;
  cards: Card[];
}

const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "an unknown date");
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

export function templateSummary(f: SummaryFacts): string {
  const { cover: cv, counts: c, ownership: own, bedbugs: bb } = f;
  const s: string[] = [];

  // 1. What the building is.
  const kind = cv.elevators > 0 ? "elevator building" : cv.floors && cv.floors <= 6 ? "walk-up" : "building";
  const size = cv.unitsRes ? `${cv.unitsRes}-unit ` : "";
  const built = cv.yearBuilt ? ` from ${cv.yearBuilt}` : "";
  const hist = cv.historicDistrict ? ` in the ${cv.historicDistrict}` : "";
  s.push(`A ${size}${kind}${built}${hist}${cv.buildingsOnLot && cv.buildingsOnLot > 1 ? `, one of ${cv.buildingsOnLot} buildings on this lot` : ""}.`);

  // 2. Safety headline.
  const haz = c.openB + c.openC;
  const safe = f.cards.find((x) => x.key === "safe");
  if (c.vacateActive) s.push("Part or all of it is under an active city vacate order.");
  else if (haz === 0) s.push("The city lists no open hazardous conditions.");
  else if (safe?.status === "warn")
    s.push(`The city lists ${plural(haz, "open hazardous condition")}, but all were recorded between ${fmt(c.oldestOpenHazardous)} and ${fmt(c.newestOpenHazardous)} and never reinspected, so they are probably stale rather than active.`);
  else s.push(`${c.openC ? `${c.openC} immediately hazardous and ` : ""}${plural(c.openB, "hazardous condition")} are open right now, the newest from ${fmt(c.newestOpenHazardous)}.`);

  // 3. Heat / complaints.
  if (c.heat12mo >= 8) s.push(`Tenants filed ${plural(c.heat12mo, "heat or hot water complaint")} in the last year.`);
  else if (c.complaints12mo === 0) s.push("No complaints to the city in the last 12 months.");
  else s.push(`${plural(c.complaints12mo, "complaint")} to the city in the last year${c.openComplaints ? `, ${c.openComplaints} still open` : ", all resolved"}.`);

  // 4. Paperwork and legal.
  const paper: string[] = [];
  if (own.registrationState === "lapsed") paper.push(`the landlord's city registration expired in ${fmt(own.registrationExpires)}`);
  if (bb.required && bb.missingLatest) paper.push("the latest required bedbug report was never filed");
  if (paper.length) s.push(`On paperwork, ${paper.join(" and ")}.`);
  const legal: string[] = [];
  if (c.litigationsPending) legal.push(`${plural(c.litigationsPending, "housing court case")} against the landlord ${c.litigationsPending === 1 ? "is" : "are"} pending`);
  if (c.ecbActive) legal.push(`the city has ${plural(c.ecbActive, "active summons", "active summonses")} against the building`);
  if (c.evictions3y >= 3) legal.push(`${plural(c.evictions3y, "eviction")} were carried out in the last three years`);
  if (legal.length) s.push(`${legal.join(", and ")}.`.replace(/^./, (ch) => ch.toUpperCase()));

  // 5. Bedbugs when notable.
  if ((bb.infested ?? 0) > 0) s.push(`The landlord reported ${plural(bb.infested!, "bedbug case")} out of ${bb.dwellingUnits ?? "?"} apartments last year${bb.eradicated ? ", treated" : ""}.`);

  return s.join(" ");
}
