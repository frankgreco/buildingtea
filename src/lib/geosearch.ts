// Address resolution via NYC Planning GeoSearch (Pelias over DCP's Property Address Directory).
// Docs: https://geosearch.planninglabs.nyc/docs/
// Design notes: docs/RESEARCH.md section 1.

import type { Candidate } from "@shared/types";

export const GEOSEARCH_BASE = "https://geosearch.planninglabs.nyc/v2";

/** whosonfirst borough ids, read from live GeoSearch responses on 2026-10-02. */
export const BOROUGH_GIDS: Record<string, string> = {
  manhattan: "whosonfirst:borough:421205771",
  bronx: "whosonfirst:borough:421205773",
  brooklyn: "whosonfirst:borough:421205765",
  queens: "whosonfirst:borough:421205767",
  "staten island": "whosonfirst:borough:421205775",
};

const BOROUGH_ALIASES: Record<string, string> = {
  manhattan: "manhattan",
  "new york": "manhattan",
  ny: "manhattan",
  nyc: "manhattan",
  bronx: "bronx",
  "the bronx": "bronx",
  bx: "bronx",
  brooklyn: "brooklyn",
  bk: "brooklyn",
  bklyn: "brooklyn",
  queens: "queens",
  "staten island": "staten island",
  si: "staten island",
  // Common Queens/Brooklyn locality names people type instead of the borough.
  "long island city": "queens",
  lic: "queens",
  astoria: "queens",
  flushing: "queens",
  jamaica: "queens",
  "forest hills": "queens",
  "jackson heights": "queens",
  sunnyside: "queens",
  woodside: "queens",
  ridgewood: "queens",
  bushwick: "brooklyn",
  williamsburg: "brooklyn",
  greenpoint: "brooklyn",
  "bed stuy": "brooklyn",
  "bedford stuyvesant": "brooklyn",
  "crown heights": "brooklyn",
  "park slope": "brooklyn",
  harlem: "manhattan",
  riverdale: "bronx",
};

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

export interface NormalizedAddress {
  /** What we send to GeoSearch. */
  text: string;
  unit: string | null;
  zip: string | null;
  /** Lower-case canonical borough name, when one was recognised in the input. */
  borough: string | null;
  isIntersection: boolean;
}

/**
 * Turn free text into something GeoSearch resolves well:
 * - pull the apartment/unit out (GeoSearch ignores it but we keep it for unit-level matching)
 * - pull the zip and borough out so we can validate the hit
 * - spell number words as digits ("One Penn Plaza" -> "1 Penn Plaza")
 * - flag intersections, which GeoSearch cannot geocode
 */
export function normalizeAddress(input: string): NormalizedAddress {
  let text = input.replace(/\s+/g, " ").trim();

  // Unit: "#34E", "Apt 3B", "Unit 12", "Ste 400", "Fl 3", "3FW" after a street type.
  let unit: string | null = null;
  const unitRe = /(?:#|\bapt\.?|\bapartment|\bunit|\bste\.?|\bsuite|\bfl\.?|\bfloor|\brm\.?|\broom)\s*([0-9A-Za-z-]+)/i;
  const m = unitRe.exec(text);
  if (m) {
    unit = m[1]!.toUpperCase();
    text = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  } else {
    const trailing = /\b(st|street|ave|avenue|rd|road|pl|place|blvd|boulevard|dr|drive|ln|lane|ct|court|pkwy|parkway|ter|terrace|way|sq|square|plaza|plz|concourse|expy|broadway|bowery)\b\.?\s+([0-9]{1,3}[A-Za-z]{1,3}|[A-Za-z]{1,2}[0-9]{1,3})\b/i;
    const t = trailing.exec(text);
    if (t) {
      unit = t[2]!.toUpperCase();
      text = (text.slice(0, t.index + t[1]!.length) + text.slice(t.index + t[0].length)).trim();
    }
  }

  // Zip
  let zip: string | null = null;
  const z = /\b(1[01]\d{3})(?:-\d{4})?\b/.exec(text);
  if (z) {
    zip = z[1]!;
    text = (text.slice(0, z.index) + text.slice(z.index + z[0].length)).trim();
  }

  // Borough / locality (longest alias first so "staten island" beats "island").
  let borough: string | null = null;
  const lower = text.toLowerCase();
  const aliases = Object.keys(BOROUGH_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const re = new RegExp(`(?:^|[\\s,])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,])`, "i");
    const hit = re.exec(lower);
    if (hit) {
      borough = BOROUGH_ALIASES[alias]!;
      // Only strip bare state/city words that confuse the geocoder; keep neighbourhood names (GeoSearch knows them).
      if (["ny", "nyc", "new york"].includes(alias)) {
        text = (text.slice(0, hit.index) + " " + text.slice(hit.index + hit[0].length)).trim();
      }
      break;
    }
  }
  text = text.replace(/\b(new york|ny)\b\.?,?/gi, " ").replace(/\busa?\b/gi, " ");

  // Number words at the start ("One Penn Plaza").
  text = text.replace(/^(one|two|three|four|five|six|seven|eight|nine|ten)\b/i, (w) => NUMBER_WORDS[w.toLowerCase()]!);

  // Intersections: "Broadway and 42nd St", "Broadway & 42nd", "Broadway at 42nd", "Broadway / 42nd".
  // Judged on the first comma-separated segment; a leading house number means it's an address.
  const firstSegment = text.split(",")[0]!.trim();
  const isIntersection = !/^\d/.test(firstSegment) && /^\S.*\s(?:and|&|at|\/)\s+\S/i.test(firstSegment);

  text = text.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");

  return { text, unit, zip, borough, isIntersection };
}

export interface GeoHit {
  label: string;
  borough: string;
  zip: string;
  bin: string;
  bbl: string;
  houseNumber: string;
  street: string;
  lat: number;
  lon: number;
  neighbourhood: string | null;
}

interface PeliasFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    label: string;
    housenumber?: string;
    street?: string;
    postalcode?: string;
    borough?: string;
    neighbourhood?: string;
    addendum?: { pad?: { bin?: string; bbl?: string; version?: string } };
  };
}

export async function geocode(text: string, opts: { boroughGid?: string; size?: number; fetcher?: typeof fetch } = {}): Promise<GeoHit[]> {
  const f = opts.fetcher ?? fetch;
  const url = new URL(`${GEOSEARCH_BASE}/search`);
  url.searchParams.set("text", text);
  url.searchParams.set("size", String(opts.size ?? 5));
  if (opts.boroughGid) url.searchParams.set("boundary.gid", opts.boroughGid);
  const res = await f(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geosearch ${res.status}`);
  const body = (await res.json()) as { features: PeliasFeature[] };
  return body.features
    .filter((ft) => ft.properties.addendum?.pad?.bin && ft.properties.addendum?.pad?.bbl)
    .map((ft) => ({
      label: ft.properties.label,
      borough: ft.properties.borough ?? "",
      zip: ft.properties.postalcode ?? "",
      bin: ft.properties.addendum!.pad!.bin!,
      bbl: ft.properties.addendum!.pad!.bbl!,
      houseNumber: ft.properties.housenumber ?? "",
      street: ft.properties.street ?? "",
      lon: ft.geometry.coordinates[0],
      lat: ft.geometry.coordinates[1],
      neighbourhood: ft.properties.neighbourhood ?? null,
    }));
}

export function isPlaceholderBin(bin: string): boolean {
  return /^[1-5]000000$/.test(bin);
}

export type ResolveResult =
  | { ok: true; hit: GeoHit; unit: string | null }
  | { ok: false; reason: "invalid" | "intersection" | "no_match" | "ambiguous"; message: string; candidates: Candidate[] };

/**
 * Resolve free text to exactly one building, or explain why not.
 * Accept the first hit only if it has a house number, a real BIN, and agrees with
 * any borough/zip the user supplied. Otherwise hand back candidates to pick from.
 */
export async function resolveAddress(input: string, fetcher?: typeof fetch): Promise<ResolveResult> {
  const n = normalizeAddress(input);
  if (n.text.length < 4) return { ok: false, reason: "invalid", message: "Enter a street address with a house number.", candidates: [] };
  if (n.isIntersection) {
    return { ok: false, reason: "intersection", message: "That looks like an intersection. Enter the building's house number and street.", candidates: [] };
  }
  if (!/\d/.test(n.text)) {
    return { ok: false, reason: "invalid", message: "Include the house number, like 143 West 4th Street.", candidates: [] };
  }

  const boroughGid = n.borough ? BOROUGH_GIDS[n.borough] : undefined;
  let hits = await geocode(n.text, { boroughGid, fetcher });
  if (hits.length === 0 && boroughGid) hits = await geocode(n.text, { fetcher });

  const candidates: Candidate[] = hits.map((h) => ({ label: h.label, borough: h.borough, zip: h.zip, bin: h.bin, bbl: h.bbl }));
  if (hits.length === 0) return { ok: false, reason: "no_match", message: "We couldn't find that address in the city's address directory.", candidates };

  const wantHouse = /^\s*([0-9]+[A-Za-z]?(?:-[0-9]+)?)\b/.exec(n.text)?.[1]?.toUpperCase().replace(/-/g, "");
  const agrees = (h: GeoHit) => {
    if (!h.houseNumber) return false;
    if (wantHouse && h.houseNumber.toUpperCase().replace(/-/g, "") !== wantHouse) return false;
    if (n.zip && h.zip && h.zip !== n.zip) return false;
    if (n.borough && h.borough && h.borough.toLowerCase() !== n.borough) return false;
    return true;
  };

  const good = hits.filter(agrees);
  if (good.length === 0) {
    return { ok: false, reason: "ambiguous", message: "Pick the address you meant.", candidates };
  }
  // Distinct buildings among agreeing hits; GeoSearch often returns the same BIN under several labels.
  const distinctBins = new Set(good.map((h) => h.bin));
  if (distinctBins.size > 1 && !n.zip && !n.borough) {
    return { ok: false, reason: "ambiguous", message: "That address exists in more than one borough. Add the borough or zip.", candidates };
  }
  return { ok: true, hit: good[0]!, unit: n.unit };
}
