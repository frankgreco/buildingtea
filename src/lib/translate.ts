// Rule-based translation of the city's violation wording into plain English.
// Deterministic on purpose: it runs on every line item, never invents facts, and
// is unit-tested. An LLM pass can be layered on top later for the long tail.

export interface Translated {
  what: string;
  where: string;
}

interface Rule {
  re: RegExp;
  what: string | ((m: RegExpExecArray) => string);
}

// Order matters: first match wins. Specific before generic.
const HPD_RULES: Rule[] = [
  { re: /REGISTRATION STATEMENT/i, what: "Landlord has not filed a valid registration with the city" },
  { re: /LEAD-BASED PAINT/i, what: "Lead paint hazard" },
  { re: /BED ?BUGS?/i, what: "Bedbugs" },
  { re: /ROACH/i, what: "Roaches" },
  { re: /\bMICE\b/i, what: "Mice" },
  { re: /\bRATS?\b/i, what: "Rats" },
  { re: /VERMIN/i, what: "Vermin" },
  { re: /MOLD/i, what: "Mold" },
  { re: /SELF[- ]CLOSING/i, what: "Apartment door doesn't close on its own (fire safety)" },
  { re: /SMOKE DETECT/i, what: "No working smoke detector" },
  { re: /CARBON MONOXIDE/i, what: "No working carbon monoxide detector" },
  { re: /WINDOW GUARD/i, what: "Missing window guards (child safety)" },
  { re: /FIRE RETARD|FIRE[- ]RATED/i, what: "Damaged fire-rated wall or door" },
  { re: /HOT WATER/i, what: "No hot water" },
  { re: /\bHEAT\b/i, what: "No heat or inadequate heat" },
  { re: /GAS\b.*(LEAK|SHUT)/i, what: "Gas problem" },
  { re: /SEWAGE/i, what: "Sewage leak" },
  { re: /WATER LEAK|LEAK/i, what: "Water leak" },
  { re: /SAGGING|STRUCTURAL/i, what: "Structural defect" },
  { re: /PEELING PAINT|PAINT.*PLASTER|PLASTER/i, what: "Peeling paint or broken plaster" },
  { re: /MORTISE LOCK|\bLOCK\b/i, what: "Broken lock" },
  { re: /ELECTRICAL OUTLET|WIRING|ELECTRIC/i, what: "Electrical problem" },
  { re: /GLASS PANEL|BROKEN GLASS|GLAZING/i, what: "Broken glass" },
  { re: /GARBAGE|REFUSE|RUBBISH/i, what: "Garbage not being removed" },
  { re: /TOILET|WATER CLOSET/i, what: "Toilet not working" },
  { re: /BASIN|SINK|LAVATORY/i, what: "Sink not working" },
  { re: /BATHTUB|SHOWER/i, what: "Bathtub or shower problem" },
  { re: /RADIATOR/i, what: "Radiator problem" },
  { re: /STOVE|RANGE|BURNER|OVEN/i, what: "Stove not working" },
  { re: /REFRIGERATOR/i, what: "Refrigerator not working" },
  { re: /ESCUTCHEON|RISER/i, what: "Loose pipe fitting" },
  { re: /CEILING/i, what: "Damaged ceiling" },
  { re: /\bFLOOR/i, what: "Damaged floor" },
  { re: /STAIR/i, what: "Stair hazard" },
  { re: /LIGHT(ING| FIXTURE)|ILLUMINAT/i, what: "Lighting out" },
  { re: /INTERCOM|BUZZER|BELL/i, what: "Intercom or buzzer broken" },
  { re: /ELEVATOR/i, what: "Elevator problem" },
  { re: /MAILBOX/i, what: "Mailbox broken" },
  { re: /\bDOOR/i, what: "Broken door" },
  { re: /WINDOW/i, what: "Broken window" },
  { re: /\bWALL/i, what: "Damaged wall" },
  { re: /ROOF/i, what: "Roof problem" },
  { re: /\bPIPE|PLUMBING/i, what: "Plumbing problem" },
];

/** HPD orders end with "...IN THE <room> LOCATED AT APT 4R, 4th STORY, 1st APARTMENT FROM EAST AT SOUTH". */
/** HPD uses these apartment values when the condition is not in a specific unit. */
export function isRealApartment(apt: string | null | undefined): apt is string {
  if (!apt) return false;
  const a = apt.trim().toUpperCase();
  return a !== "" && a !== "BLDG" && a !== "NA" && a !== "N/A" && a !== "NONE" && a !== "PUBLIC";
}

export function hpdWhere(text: string, apartment?: string | null, story?: string | null): string {
  const t = text.toUpperCase();
  const parts: string[] = [];
  const fromText = /LOCATED AT APT\s+([0-9A-Z-]+)/.exec(t)?.[1];
  const apt = isRealApartment(apartment) ? apartment : isRealApartment(fromText) ? fromText : undefined;
  if (apt) parts.push(`Apt ${apt}`);
  else if (/PUBLIC HALL|VESTIBULE|LOBBY|STAIR|CELLAR|BASEMENT|ROOF|BUILDING/.test(t)) parts.push("Common area");
  const floor = story && /^[1-9]\d*$/.test(story) ? story : /(\d+)(?:ST|ND|RD|TH) (?:STORY|STY)/.exec(t)?.[1];
  if (floor && !apt) parts.push(`floor ${floor}`);
  if (/ENTIRE APARTMENT/.test(t) && apt) parts.push("whole apartment");
  const room = /IN THE (\d+(?:ST|ND|RD|TH) )?(BATHROOM|KITCHEN|BEDROOM|ROOM|HALLWAY|LIVING ROOM)/.exec(t);
  if (room && !/ENTIRE APARTMENT/.test(t)) parts.push(room[2]!.toLowerCase());
  return parts.join(" · ") || "Building";
}

export function translateHpd(text: string, apartment?: string | null, story?: string | null): Translated {
  const where = hpdWhere(text, apartment, story);
  for (const rule of HPD_RULES) {
    const m = rule.re.exec(text);
    if (m) {
      const base = typeof rule.what === "function" ? rule.what(m) : rule.what;
      const scoped = /ENTIRE APARTMENT/i.test(text) && /Roaches|Mice|Rats|Bedbugs|Vermin|Mold/.test(base) ? `${base} throughout the apartment` : base;
      return { what: scoped, where };
    }
  }
  return { what: fallbackSentence(text), where };
}

/** Strip the legal citation prefix and sentence-case the rest, capped for display. */
export function fallbackSentence(text: string): string {
  let t = text.replace(/^[§\s\w.,()\/-]*?(?:ADM(?:INISTRATIVE)? CODE|HMC|MDL|RCNY)[^A-Z]*?(?=[A-Z]{3})/i, "").trim();
  t = t.replace(/\s+/g, " ");
  if (t.length > 140) t = t.slice(0, 137).replace(/\s+\S*$/, "") + "…";
  if (!t) return "City-recorded condition (see original wording)";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** DOB NOW / BIS / ECB wording is already readable; tidy the common codes. */
export function translateDob(kind: "bis" | "now" | "ecb", row: { type?: string; text?: string; device?: string }): string {
  const type = (row.type ?? "").trim();
  const text = (row.text ?? "").trim();
  if (kind === "now") {
    if (/FTC-VT-CAT1|FTF-VT-CAT1/i.test(type)) return "Elevator: missed the annual Category 1 safety test paperwork";
    if (/FTC-VT-PER|FTF-VT-PER/i.test(type)) return "Elevator: missed the periodic inspection paperwork";
    if (/ACC1/i.test(type)) return "Elevator: affirmation of correction not filed";
    if (/LBLVIO|HBLVIO|LL6291/i.test(type)) return "Boiler: inspection paperwork not filed";
    if (/BENCH/i.test(type)) return "Energy benchmarking report not filed";
    if (/FTC-AEU-HAZ|AEUHAZ/i.test(type)) return "Failed to certify that a hazardous city summons was corrected";
    if (/FACADE|FISP|LL11/i.test(type + text)) return "Facade inspection paperwork not filed";
    return text ? tidy(text) : tidy(type);
  }
  if (kind === "bis") {
    const code = type.split("-")[0]?.trim().toUpperCase();
    if (code === "E") return "Elevator violation";
    if (code === "LL6291" || code === "LBLVIO" || code === "HBLVIO") return "Boiler inspection violation";
    if (code === "BENCH") return "Energy benchmarking report not filed";
    if (code === "C") return text ? `Construction order: ${tidy(text)}` : "Construction violation";
    if (code === "P") return "Plumbing violation";
    if (code === "AEUHAZ1") return "Failed to certify that a hazardous city summons was corrected";
    return text ? tidy(text) : tidy(type);
  }
  // ecb
  const sev = /CLASS\s*-?\s*(\d)/i.exec(row.device ?? "")?.[1];
  const lead = type ? `${tidy(type)} summons` : "City summons";
  const detail = text ? tidy(text.replace(/^CLASS \d ITEMS?:\s*/i, "")) : "";
  return `${lead}${sev ? ` (class ${sev})` : ""}${detail ? `: ${detail}` : ""}`;
}

function tidy(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  if (t.length > 140) t = t.slice(0, 137).replace(/\s+\S*$/, "") + "…";
  if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t;
}
