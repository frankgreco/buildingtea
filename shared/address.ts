// Address pieces shared by the Worker (resolution) and the browser (autocomplete).
// The geocoder ignores apartment numbers, so both sides strip the unit before
// asking it and keep the unit for unit-level matching.

/** "#34E", "Apt 3B", "Unit 12", "Ste 400", "Fl 3", "Rm 2" anywhere in the text. */
const UNIT_RE = /(?:#|\bapt\.?|\bapartment|\bunit|\bste\.?|\bsuite|\bfl\.?|\bfloor|\brm\.?|\broom)\s*([0-9A-Za-z-]+)/i;

/** A bare unit right after the street type: "143 W 4th St 3FW", "40 Wall St W12". */
const TRAILING_UNIT_RE =
  /\b(st|street|ave|avenue|rd|road|pl|place|blvd|boulevard|dr|drive|ln|lane|ct|court|pkwy|parkway|ter|terrace|way|sq|square|plaza|plz|concourse|expy|broadway|bowery)\b\.?\s+([0-9]{1,3}[A-Za-z]{1,3}|[A-Za-z]{1,2}[0-9]{1,3})\b/i;

export interface SplitUnit {
  /** The input with the unit removed (whitespace collapsed, not otherwise normalised). */
  text: string;
  /** Upper-cased unit, or null when none was recognised. */
  unit: string | null;
}

export function splitUnit(input: string): SplitUnit {
  const text = input.replace(/\s+/g, " ").trim();
  const m = UNIT_RE.exec(text);
  if (m) {
    return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim(), unit: m[1]!.toUpperCase() };
  }
  const t = TRAILING_UNIT_RE.exec(text);
  if (t) {
    return { text: (text.slice(0, t.index + t[1]!.length) + text.slice(t.index + t[0].length)).replace(/\s+/g, " ").trim(), unit: t[2]!.toUpperCase() };
  }
  return { text, unit: null };
}

/** Put a unit back into a geocoder label: "143 WEST 4 STREET, New York, NY, USA" + "3FW" -> "143 WEST 4 STREET #3FW, New York, NY, USA". */
export function withUnit(label: string, unit: string | null): string {
  if (!unit) return label;
  const comma = label.indexOf(",");
  return comma === -1 ? `${label} #${unit}` : `${label.slice(0, comma)} #${unit}${label.slice(comma)}`;
}
