// Address suggestions for the search box, from NYC Planning GeoSearch's autocomplete
// endpoint: the same directory the Worker resolves against, so anything picked here
// is an address we can report on. Free, no key, CORS-open, no preflight (plain GET).
// Docs: https://geosearch.planninglabs.nyc/docs/
//
// Pure, no DOM. The browser wiring lives in web/src/autocomplete.ts.

import { splitUnit } from "./address";

export const AUTOCOMPLETE_URL = "https://geosearch.planninglabs.nyc/v2/autocomplete";
export const MAX_SUGGESTIONS = 6;

export interface Suggestion {
  /** GeoSearch's own label. Submitting it makes the server resolve the exact same record. */
  label: string;
  /** "143 West 4 Street" */
  primary: string;
  /** "Greenwich Village · Manhattan 10012" */
  secondary: string;
  bin: string;
}

interface PeliasFeature {
  properties?: {
    label?: string;
    housenumber?: string;
    street?: string;
    postalcode?: string;
    borough?: string;
    neighbourhood?: string;
    addendum?: { pad?: { bin?: string; bbl?: string } };
  };
}

/** The text worth asking the geocoder about, or null until it starts with a house number. */
export function queryFor(raw: string): string | null {
  const q = splitUnit(raw).text.replace(/\s*,\s*/g, ", ");
  return q.length >= 3 && /^\d/.test(q) ? q : null;
}

export function autocompleteUrl(query: string): string {
  return `${AUTOCOMPLETE_URL}?text=${encodeURIComponent(query)}`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** GeoSearch response body -> display rows: addresses with a house number and BIN, de-duplicated, capped. */
export function parseSuggestions(body: unknown): Suggestion[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const f of features as PeliasFeature[]) {
    const p = f?.properties;
    const bin = p?.addendum?.pad?.bin;
    if (!p?.label || !p.housenumber || !p.street || !bin) continue;
    const key = p.label.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const area = [p.borough, p.postalcode].filter(Boolean).join(" ");
    out.push({
      label: p.label,
      primary: titleCase(`${p.housenumber} ${p.street}`),
      secondary: [p.neighbourhood, area].filter(Boolean).join(" · "),
      bin,
    });
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}
