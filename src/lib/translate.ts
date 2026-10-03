// Rule-based translation of the city's violation wording into plain English.
// Deterministic on purpose: it runs on every line item, never invents facts, and
// is unit-tested. An LLM pass can be layered on top later for the long tail.

import { normalizeUnit } from "@shared/address";
import { titleCase } from "./email";

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
  // BGLD and BLD are common misspellings of BLDG in HPD's data.
  return a !== "" && a !== "BLDG" && a !== "BGLD" && a !== "BLD" && a !== "NA" && a !== "N/A" && a !== "NONE" && a !== "PUBLIC";
}

/** Wording that puts an HPD violation outside any apartment. */
const COMMON_AREA_RE = /PUBLIC HALL|VESTIBULE|LOBBY|STAIR|CELLAR|BASEMENT|ROOF|BUILDING/;
const hpdApartment = (t: string, apartment?: string | null) => {
  const fromText = /LOCATED AT APT\s+([0-9A-Z-]+)/.exec(t)?.[1];
  return isRealApartment(apartment) ? apartment : isRealApartment(fromText) ? fromText : undefined;
};
const hpdFloor = (t: string, story?: string | null) => (story && /^[1-9]\d*$/.test(story) ? story : /(\d+)(?:ST|ND|RD|TH) (?:STORY|STY)/.exec(t)?.[1]);

/**
 * Where an HPD violation is, as data for grouping, from the same reading `hpdWhere` puts into words:
 * the apartment it names (normalised), else a common area ("Common area", or just a floor), else the
 * building as a whole.
 */
export function hpdPlace(text: string, apartment?: string | null, story?: string | null): { area: "apartment" | "common" | "building"; unit?: string } {
  const t = text.toUpperCase();
  const unit = normalizeUnit(hpdApartment(t, apartment));
  if (unit) return { area: "apartment", unit };
  return COMMON_AREA_RE.test(t) || hpdFloor(t, story) ? { area: "common" } : { area: "building" };
}

export function hpdWhere(text: string, apartment?: string | null, story?: string | null): string {
  const t = text.toUpperCase();
  const parts: string[] = [];
  const apt = hpdApartment(t, apartment);
  if (apt) parts.push(`Apt ${apt}`);
  else if (COMMON_AREA_RE.test(t)) parts.push("Common area");
  const floor = hpdFloor(t, story);
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

// ---------- complaints ----------

/**
 * DOB complaint categories (eabe-havv `complaint_category`), transcribed from DOB's
 * "Complaint Categories" list, Rev. 9/21 (6 pages), which the dataset's own data dictionary
 * names as the current list: https://www.nyc.gov/assets/buildings/pdf/complaint_category.pdf
 * 4C, 4D and 4F are retired codes that appear only in the older Rev. 12/18 list attached to the
 * dataset (https://data.cityofnewyork.us/api/views/eabe-havv/files/dc709ed2-7af1-429c-92c9-71ec3a4c23fa?download=true&filename=DOBComplaints_complaint_category_list.pdf).
 * Wording is DOB's; only shouted words (NONE, ILLEGAL, ...) are de-capitalised, "PMT" is spelled
 * "Permit", and the unexplained "+" marks on 45, 71 and 83 are dropped. Single-digit codes are
 * zero-padded as they appear in the data ("1" -> "01"). Codes newer than Rev. 9/21 (7R, 2V, 8P, ...)
 * are not here and render as "Buildings complaint (code XX)".
 */
export const DOB_COMPLAINT_CATEGORY: Record<string, string> = {
  "01": "Accident – Construction/Plumbing",
  "02": "Accident – To Public",
  "03": "Adjacent Buildings – Not Protected",
  "04": "After Hours Work – Illegal",
  "05": "Permit – None (Building/PA/Demo etc.)",
  "06": "Construction – Change Grade/Change Watercourse",
  "07": "Construction – Change Watercourse",
  "08": "Contractor's Sign – None",
  "09": "Debris – Excessive",
  "10": "Debris/Building – Falling or In Danger of Falling",
  "11": "Demolition – No Permit",
  "12": "Demolition – Unsafe/Illegal/Mechanical Demo",
  "13": "Elevator In (FDNY) Readiness – None",
  "14": "Excavation – Undermining Adjacent Building",
  "15": "Fence – None/Inadequate/Illegal",
  "16": "Inadequate Support/Shoring",
  "17": "Material/Personnel Hoist – No Permit",
  "18": "Material Storage – Unsafe",
  "19": "Mechanical Demolition – Illegal",
  "1A": "Illegal Conversion Commercial Building/Space to Dwelling Units",
  "1B": "Illegal Tree Removal/Topo. Change in SNAD",
  "1C": "Damage Assessment Request or Report (Disaster)",
  "1D": "Con Edison Referral",
  "1E": "Suspended (Hanging) Scaffolds – No Permit/License/Dangerous/Accident",
  "1F": "Failure to Comply with Annual Crane Inspection",
  "1G": "Stalled Construction Site",
  "1H": "Emergency Asbestos Response Inspection",
  "1J": "Jewelry/Dentistry Torch: Gas Piping Removed w/o Permit",
  "1K": "Bowstring Truss Tracking Complaint",
  "1L": "Gas Utility Referral",
  "1U": "Special Operations Compliance Inspection",
  "1V": "Electrical Enforcement Work Order (DOB)",
  "1W": "Plumbing Enforcement Work Order (DOB)",
  "1X": "Construction Enforcement Work Order (DOB)",
  "1Y": "Enforcement Work Order (DOB)",
  "1Z": "Enforcement Work Order (DOB)",
  "20": "Landmark Building – Illegal Work",
  "21": "Safety Net/Guard Rail – Damaged/Inadequate/None (over 6-stories/75FT)",
  "22": "Safety Netting – None",
  "23": "Sidewalk Shed/Supported Scaffold/Inadequate/Defect/None/No Permit/No Cert",
  "24": "Sidewalk Shed – None",
  "25": "Warning Signs/Lights – None",
  "26": "Watchman – None",
  "27": "Auto Repair – Illegal",
  "28": "Building – In Danger of Collapse",
  "29": "Building – Vacant, Open and Unguarded",
  "2A": "Posted Notice or Order Removed/Tampered With",
  "2B": "Failure to Comply with Vacate Order",
  "2C": "Smoking Ban – Smoking on Construction Site",
  "2D": "Smoking Signs – No Smoking Signs Not Observed on Construction Site",
  "2E": "Tracking Complaint for Full Demolition Notification",
  "2F": "Building Under Structural Monitoring",
  "2G": "Advertising Sign/Billboard/Posters/Flexible Fabric – Illegal",
  "2H": "Second Avenue Subway Construction",
  "2J": "Sandy: Building Destroyed",
  "2K": "Structurally Compromised Building (LL33/08)",
  "2L": "Façade (LL11/98) – Unsafe Notification",
  "2M": "Monopole Tracking Complaint",
  "2N": "COVID-19 Executive Order",
  "2P": "Façades Unit Compliance Inspection",
  "30": "Building Shaking/Vibrating/Struct Stability Affected",
  "31": "Certificate of Occupancy – None/Illegal/Contrary to CO",
  "32": "C of O - Not Being Complied With",
  "33": "Commercial Use – Illegal",
  "34": "Compactor Room/Refuse Chute – Illegal",
  "35": "Curb Cut/Driveway/Carport – Illegal",
  "36": "Driveway/Carport – Illegal",
  "37": "Egress: Locked/Blocked/Improper/No Secondary Means",
  "38": "Egress: Exit Door Not Proper",
  "39": "Egress: No Secondary Means",
  "3A": "Unlicensed/Illegal/Improper Electrical Work in Progress",
  "3B": "Routine Inspection",
  "3C": "Plan Compliance Inspection",
  "3D": "Bicycle Access Waiver Request – Elevator Safety",
  "3E": "Bicycle Access Waiver Request – Alternate Parking",
  "3G": "Restroom Non-Compliance with Local Law 79/16",
  "3H": "DCP/BSA Compliance Inspection",
  "40": "Falling – Part of Building",
  "41": "Falling – Part of Building in Danger of",
  "42": "Fence – Illegal",
  "43": "Structural Stability Affected",
  "44": "Fireplace/Wood Stove – Illegal",
  "45": "Illegal Conversion",
  "46": "PA Permit – None",
  "47": "PA Permit – Not Being Complied With",
  "48": "Residential Use – Illegal",
  "49": "Storefront or Business Sign/Awning/Marquee/Canopy – Illegal",
  "4A": "Illegal Hotel Rooms in Residential Buildings",
  "4B": "SEP – Professional Certification Compliance Audit",
  "4C": "Excavation Tracking Complaint",
  "4D": "Interior Demo Tracking Complaint",
  "4E": "Stalled Sites Tracking Complaint",
  "4F": "SST Tracking Complaint",
  "4G": "Illegal Conversion No Access Follow-Up",
  "4H": "V.E.S.T. Program (DOB & NYPD)",
  "4J": "M.A.R.C.H. Program (Interagency)",
  "4K": "CSC: DM Tracking Complaint",
  "4L": "CSC: High-Rise Tracking Complaint",
  "4M": "CSC: Low-Rise Tracking Complaint",
  "4N": "Retaining Wall Tracking Complaint",
  "4P": "Legal/Padlock Tracking Complaint",
  "4S": "Sustainability Enforcement Work Order",
  "4W": "Woodside Settlement Project",
  "4X": "After Hours Work – With an AHV Permit",
  "50": "Sign Falling: Danger/Sign Erection or Display In-Progress (Illegal)",
  "51": "Illegal Social Club",
  "52": "Sprinkler System – Inadequate",
  "53": "Vent/Exhaust – Illegal/Improper",
  "54": "Wall/Retaining Wall – Bulging/Cracked",
  "55": "Zoning: Non-Conforming",
  "56": "Boiler: Fumes/Smoke/Carbon Monoxide",
  "57": "Boiler: Illegal",
  "58": "Boiler: Defective/Inoperative/No Permit",
  "59": "Electrical Wiring: Defective/Exposed – In Progress",
  "5A": "Request for Joint FDNY/DOB Inspection",
  "5B": "Non-Compliance: with Lightweight Materials",
  "5C": "Structural Stability Impacted – New Building Under Construction",
  "5D": "Non-Compliance: with TPPN 1/00 – Vertical Enlargements",
  "5E": "Amusement Ride Accident/Incident",
  "5F": "Compliance Inspection",
  "5G": "Unlicensed/Illegal/Improper Work In-Progress",
  "5H": "Illegal Activity",
  "5J": "Multi Agency Joint Inspection",
  "60": "Electrical Work: Improper",
  "61": "Electrical Work: Unlicensed, In-Progress",
  "62": "Elevator: Danger Condition/Shaft Open/Unguarded",
  "63": "Elevator: Defective/Inoperative",
  "64": "Elevator Shaft: Open and Unguarded",
  "65": "Gas Hook-Up/Piping – Illegal or Defective",
  "66": "Plumbing Work – Illegal/No Permit (also Sprinkler/Standpipe)",
  "67": "Crane: No Permit/License/Cert/Unsafe/Illegal",
  "68": "Crane/Scaffold: Unsafe/Illegal Operations",
  "69": "Crane/Scaffold: Unsafe Installation/Equipment",
  "6A": "Vesting Inspection",
  "6B": "Semi-Annual Homeless Shelter Inspection: Plumbing",
  "6C": "Semi-Annual Homeless Shelter Inspection: Construction",
  "6D": "Semi-Annual Homeless Shelter Inspection: Electrical",
  "6M": "Elevator: Multiple Devices on Property",
  "6S": "Elevator: Single Device on Property/No Alternate Service",
  "6V": "Tenant Safety Inspection",
  "6W": "Tenant Safety – Failure to Post/Distribute",
  "6X": "Work Without Permits Watch List Compliance",
  "6Y": "Local Law Audits",
  "6Z": "Training Compliance",
  "70": "Suspension Scaffold Hanging – No Work In-Progress",
  "71": "SRO: Illegal Work/No Permit/Change in Occupancy Use",
  "72": "SRO: Change in Occupancy/Use",
  "73": "Failure to Maintain",
  "74": "Illegal Commercial/Manufacturing Use in Residential Zone",
  "75": "Adult Establishment",
  "76": "Unlicensed/Illegal/Improper Plumbing Work In-Progress",
  "77": "Contrary to LL58/87 (Handicap Access)",
  "78": "Privately Owned Public Space/Non-Compliance",
  "79": "Lights from Parking Lot Shining on Building",
  "7A": "Integrity Complaint Referral",
  "7B": "Illegal Commercial or Manufacturing Use in a C1 or C2 Zone",
  "7F": "CSE: Tracking Compliance",
  "7G": "CSE: Sweep",
  "7J": "Work Without a Permit – Occupied Multiple Dwelling",
  "7K": "Local Law 188/17 Compliance Inspections – Active Jobs",
  "7L": "DOHMH Referral – Tenant Protection Non-Compliance",
  "7N": "Privately Owned Public Space/Compliance Inspection",
  "80": "Elevator Not Inspected/Illegal/No Permit",
  "81": "Elevator: Accident",
  "82": "Boiler: Accident/Explosion",
  "83": "Construction: Contrary/Beyond Approved Plans/Permits",
  "84": "Façade: Defective/Cracking",
  "85": "Failure to Retain Water/Improper Drainage (LL103/89)",
  "86": "Work Contrary to Stop Work Order",
  "87": "Request for Deck Safety Inspection",
  "88": "Safety Net/Guard Rail – Damaged/Inadequate/None (6-stories 75FT or Less)",
  "89": "Accident – Cranes/Derricks/Suspension",
  "8A": "Construction Safety Compliance (CSC) Action",
  "90": "Unlicensed/Illegal Activity",
  "91": "Site Conditions Endangering Workers",
  "92": "Illegal Conversion of Manufacturing/Industrial Space",
  "93": "Request for Retaining Wall Safety Inspection",
  "94": "Plumbing: Defective/Leaking/Not Maintained",
  "95": "Bronx 2nd Offense Pilot Project",
  "96": "Unlicensed Boiler, Electrical, Plumbing or Sign Work Completed",
  "97": "Other Agency Jurisdiction",
  "98": "Refer to Operations for Determination",
  "99": "Other",
};

/** Headline for a DOB complaint category code; unknown codes stay visible but unlabelled. */
export function dobComplaintCategory(code: string | null | undefined): string {
  let c = (code ?? "").trim().toUpperCase();
  if (!c) return "Buildings complaint";
  if (c.length === 1) c = c.padStart(2, "0");
  return DOB_COMPLAINT_CATEGORY[c] ?? `Buildings complaint (code ${c})`;
}

/**
 * DOB complaint categories whose official description (DOB_COMPLAINT_CATEGORY) is about a topic the
 * report groups complaints by. Heat: the four "Boiler: ..." codes. Plumbing: the codes whose subject
 * is plumbing work or plumbing defects. Left out on purpose: 01 (an accident at construction or
 * plumbing work) and 96 (unlicensed boiler, electrical, plumbing or sign work), which name several trades.
 */
export const DOB_COMPLAINT_TOPIC: Record<string, "heat" | "plumbing"> = {
  "56": "heat",
  "57": "heat",
  "58": "heat",
  "82": "heat",
  "1W": "plumbing",
  "66": "plumbing",
  "6B": "plumbing",
  "76": "plumbing",
  "94": "plumbing",
};

export function dobComplaintTopic(code: string | null | undefined): "heat" | "plumbing" | null {
  let c = (code ?? "").trim().toUpperCase();
  if (c.length === 1) c = c.padStart(2, "0");
  return DOB_COMPLAINT_TOPIC[c] ?? null;
}

// HPD complaint problems (ygpa-z7cr). Keys are "MAJOR|MINOR|CODE", "MAJOR|*|CODE", "MAJOR|MINOR"
// or "MAJOR", most specific first. Covers the common pairs; the rest fall back to the city's words.
const HPD_COMPLAINT_HEADLINE: Record<string, string> = {
  // Heat: the minor category is the scope (ENTIRE BUILDING / APARTMENT ONLY); the code says what.
  "HEAT/HOT WATER|*|NO HEAT": "No heat",
  "HEAT/HOT WATER|*|NO HOT WATER": "No hot water",
  "HEAT/HOT WATER|*|NO HEAT AND NO HOT WATER": "No heat or hot water",
  "HEAT/HOT WATER|*|HEAT ON IN SUMMER": "Heat on in summer",
  "HEAT/HOT WATER": "Heat or hot water problem",
  "UNSANITARY CONDITION|PESTS|MICE": "Mice",
  "UNSANITARY CONDITION|PESTS|ROACHES": "Roaches",
  "UNSANITARY CONDITION|PESTS|BED BUGS": "Bedbugs",
  "UNSANITARY CONDITION|PESTS|FLIES": "Flies",
  "UNSANITARY CONDITION|PESTS|FLEAS": "Fleas",
  "UNSANITARY CONDITION|PESTS|TERMITES": "Termites",
  "UNSANITARY CONDITION|PESTS": "Pests",
  "UNSANITARY CONDITION|MOLD": "Mold",
  "UNSANITARY CONDITION|GARBAGE/RECYCLING STORAGE|ACCUMULATION": "Garbage piling up",
  "UNSANITARY CONDITION|GARBAGE/RECYCLING STORAGE|MISSING OR INADEQUATE CANS/LID": "Missing or inadequate garbage cans",
  "UNSANITARY CONDITION|GARBAGE/RECYCLING STORAGE": "Garbage problem",
  "UNSANITARY CONDITION|SEWAGE|RAW SEWAGE ACCUMULATION": "Raw sewage",
  "UNSANITARY CONDITION|SEWAGE": "Sewage problem",
  "UNSANITARY CONDITION": "Unsanitary condition",
  "PLUMBING|WATER SUPPLY|NO WATER": "No water",
  "PLUMBING|WATER SUPPLY|NO HOT WATER": "No hot water",
  "PLUMBING|WATER SUPPLY|NO COLD WATER": "No cold water",
  "PLUMBING|WATER SUPPLY|LOW WATER PRESSURE": "Low water pressure",
  "PLUMBING|WATER SUPPLY|SCALDING HOT WATER": "Scalding hot water",
  "PLUMBING|WATER SUPPLY|DISCOLORED WATER": "Discolored water",
  "PLUMBING|WATER SUPPLY": "Water supply problem",
  "PLUMBING|BASIN/SINK": "Sink problem",
  "PLUMBING|BATHTUB/SHOWER": "Bathtub or shower problem",
  "PLUMBING|TOILET": "Toilet problem",
  "PLUMBING|RADIATOR": "Radiator problem",
  "PLUMBING|STEAM PIPE/RISER": "Steam pipe problem",
  "PLUMBING|BOILER": "Boiler problem",
  "PLUMBING|SEWER": "Blocked or broken sewer pipe",
  "PLUMBING": "Plumbing problem",
  "WATER LEAK|HEAVY FLOW": "Heavy water leak",
  "WATER LEAK|SLOW LEAK": "Slow water leak",
  "WATER LEAK|DAMP SPOT": "Damp spot on a wall or ceiling",
  "WATER LEAK": "Water leak",
  "PAINT/PLASTER|WALL": "Peeling paint or plaster on a wall",
  "PAINT/PLASTER|CEILING": "Peeling paint or plaster on the ceiling",
  "PAINT/PLASTER": "Peeling paint or plaster",
  "DOOR/WINDOW|DOOR": "Broken door",
  "DOOR/WINDOW|DOOR FRAME": "Broken door frame",
  "DOOR/WINDOW|WINDOW FRAME": "Broken window frame",
  "DOOR/WINDOW|WINDOW PANE": "Broken window pane",
  "DOOR/WINDOW": "Broken door or window",
  "ELECTRIC|POWER OUTAGE": "Power outage",
  "ELECTRIC|NO LIGHTING": "No lighting",
  "ELECTRIC|LIGHTING": "Lighting problem",
  "ELECTRIC|OUTLET/SWITCH": "Broken outlet or switch",
  "ELECTRIC|WIRING|EXPOSED": "Exposed wiring",
  "ELECTRIC|WIRING": "Wiring problem",
  "ELECTRIC": "Electrical problem",
  "ELEVATOR": "Elevator problem",
  "FLOORING/STAIRS|FLOOR": "Damaged floor",
  "FLOORING/STAIRS|STAIRS": "Damaged stairs",
  "FLOORING/STAIRS": "Damaged floor or stairs",
  "APPLIANCE|ELECTRIC/GAS RANGE": "Stove not working",
  "APPLIANCE|REFRIGERATOR": "Refrigerator not working",
  "APPLIANCE": "Appliance not working",
  "SAFETY|SMOKE DETECTOR": "No working smoke detector",
  "SAFETY|CARBON MONOXIDE DETECTOR": "No working carbon monoxide detector",
  "SAFETY|WINDOW GUARD BROKEN/MISSING": "Missing or broken window guards",
  "SAFETY|FIRE ESCAPE": "Fire escape problem",
  "SAFETY|SPRINKLER": "Sprinkler problem",
  "SAFETY": "Safety problem",
  "GENERAL|BELL/BUZZER/INTERCOM": "Intercom or buzzer broken",
  "GENERAL|COOKING GAS": "Cooking gas shut off",
  "GENERAL|VENTILATION SYSTEM": "Ventilation broken",
  "GENERAL|JANITOR/SUPER": "No janitor or super available",
  "GENERAL|SIGNAGE MISSING": "Required notice not posted",
  "GENERAL|MAILBOX": "Broken mailbox",
  "GENERAL|CABINET": "Damaged cabinet",
};

/** Plain-English headline for one HPD complaint problem. */
export function complaintHeadline(major?: string | null, minor?: string | null, code?: string | null): string {
  const M = (major ?? "").trim().toUpperCase();
  const m = (minor ?? "").trim().toUpperCase();
  const c = (code ?? "").trim().toUpperCase();
  const hit = HPD_COMPLAINT_HEADLINE[`${M}|${m}|${c}`] ?? HPD_COMPLAINT_HEADLINE[`${M}|*|${c}`] ?? HPD_COMPLAINT_HEADLINE[`${M}|${m}`] ?? HPD_COMPLAINT_HEADLINE[M];
  if (hit) return hit;
  const words = [m || M, c && c !== "N/A" ? c : ""].filter(Boolean).join(": ");
  return words ? titleCase(words) : "Housing complaint";
}

/**
 * HPD complaint `major_category` (ygpa-z7cr) as a category name. Covers every value filed in the
 * year to 2026-10-03 except LINE OF TRAVEL (no published meaning), which falls back to the city's words.
 */
const HPD_COMPLAINT_CATEGORY: Record<string, string> = {
  "HEAT/HOT WATER": "Heat and hot water",
  "UNSANITARY CONDITION": "Unsanitary conditions (pests, mold, garbage)",
  PLUMBING: "Plumbing",
  "WATER LEAK": "Water leaks",
  "PAINT/PLASTER": "Paint and plaster",
  "DOOR/WINDOW": "Doors and windows",
  GENERAL: "General (gas, intercom, locks, cabinets, mailbox)",
  ELECTRIC: "Electrical",
  "FLOORING/STAIRS": "Floors and stairs",
  APPLIANCE: "Appliances",
  SAFETY: "Safety (detectors, window guards, fire escapes)",
  ELEVATOR: "Elevator",
  "OUTSIDE BUILDING": "Outside the building (roof, pavement, gutters)",
};

export function complaintCategoryName(major: string | null | undefined): string {
  const M = (major ?? "").trim().toUpperCase();
  if (!M) return "Other";
  return HPD_COMPLAINT_CATEGORY[M] ?? sentence(M);
}

/** "LINE OF TRAVEL" -> "Line of travel". */
function sentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * HPD complaint `apartment` is free text cut to six characters ("2NDFLO", "BUILDI", "APT3A").
 * Returns a unit label only when the value looks like one.
 */
export function complaintApartment(apt: string | null | undefined): string | null {
  if (!isRealApartment(apt)) return null;
  const a = apt.trim().toUpperCase().replace(/^(?:APT|UNIT)/, "").replace(/[\s#.]/g, "");
  if (/^\d+(?:ST|ND|RD|TH)$/.test(a)) return null; // "2ND" is a floor
  return /^(?:\d{1,4}[A-Z]{0,2}|\d{1,4}-[A-Z0-9]{1,3}|[A-Z]{1,2}-?\d{1,4}[A-Z]?|[A-Z]|PH\d{0,3}[A-Z]?)$/.test(a) ? a : null;
}

/** 311 agencies in plain words; anything else shows its code. */
export const AGENCY_NAMES: Record<string, string> = {
  NYPD: "Police",
  DEP: "Environmental Protection",
  DSNY: "Sanitation",
  DOHMH: "Health Dept",
  DOT: "Transportation",
  DPR: "Parks",
  DHS: "Homeless Services",
  TLC: "Taxi & Limousine",
  DCWP: "Consumer Protection",
};

/** 311 request headline: agency, complaint type, then the descriptors that add something. */
export function translate311(row: { agency?: string; complaint_type?: string; descriptor?: string; descriptor_2?: string }): string {
  const code = (row.agency ?? "").trim();
  const who = AGENCY_NAMES[code.toUpperCase()] ?? code;
  const na = (v: string | undefined) => /^N\/?A$/i.test((v ?? "").trim());
  const type = tidy(row.complaint_type ?? "");
  // DEP repeats the type in the descriptor ("Noise" / "Noise: Alarms (NR3)").
  let d1 = na(row.descriptor) ? "" : tidy(row.descriptor ?? "");
  const rest = d1.slice(type.length);
  if (type && d1.toLowerCase().startsWith(type.toLowerCase()) && /^\s*[:,]/.test(rest)) d1 = rest.replace(/^\s*[:,]\s*/, "");
  const raw2 = (row.descriptor_2 ?? "").trim();
  // descriptor_2 is often "N/A" or a short code already shown in descriptor ("Fire Hydrant Emergency (FHE)" / "FHE").
  const d2 = !raw2 || na(raw2) || /^[A-Z0-9]{1,4}$/.test(raw2) || d1.toLowerCase().includes(raw2.toLowerCase()) ? "" : tidy(raw2);
  const body = [type, d1 && d1.toLowerCase() !== type.toLowerCase() ? d1 : "", d2].filter(Boolean).join(", ") || "311 request";
  return who ? `${who}: ${body}` : body;
}

// ---------- building facts ----------

/**
 * HPD `managementprogram` (kj4p-ruqc), who runs the building. HPD publishes no code list; these
 * are the values the dataset holds (checked 2026-10-03, citywide counts in docs/RESEARCH.md 2.15)
 * whose meaning could be confirmed from the code itself and the owners PLUTO lists for sample
 * buildings. Anything else shows title-cased; UNDEFINED means no program is recorded.
 */
const HOUSING_PROGRAM: Record<string, string> = {
  PVT: "Private",
  NYCHA: "Public housing (NYCHA)",
  "M-L (STATE)": "Mitchell-Lama (state-supervised)",
  "M-L (RF CITY)": "Mitchell-Lama (city-supervised)",
  "M-L (NRF CITY)": "Mitchell-Lama (city-supervised)",
  "7A": "Court-appointed 7A administrator",
  "CENTRAL MGT": "City-owned, managed by the housing department",
  "ALT MGT": "City-owned, in an alternative management program",
  "LOFT LAW": "Loft Law building",
  "LOW INCOME RENT": "Low-income rental program",
};

export function housingProgram(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!c || c === "UNDEFINED") return null;
  return HOUSING_PROGRAM[c] ?? titleCase(c);
}

/** PLUTO `landuse` (1-11; documented as zero-padded 01-11, served unpadded). */
const LAND_USE: Record<number, string> = {
  1: "One- and two-family homes",
  2: "Walk-up apartments",
  3: "Elevator apartments",
  4: "Homes and businesses (mixed use)",
  5: "Commercial and office",
  6: "Industrial and manufacturing",
  7: "Transportation and utility",
  8: "Public facilities and institutions",
  9: "Open space and recreation",
  10: "Parking",
  11: "Vacant land",
};

export function landUseName(code: string | null | undefined): string | null {
  const n = Number((code ?? "").trim());
  return Number.isInteger(n) ? (LAND_USE[n] ?? null) : null;
}

/** First letter of the DOF/PLUTO building class (`bldgclass`): its family, in plain words. */
const CLASS_FAMILY: Record<string, string> = {
  A: "One-family home",
  B: "Two-family home",
  C: "Walk-up apartments",
  D: "Elevator apartments",
  E: "Warehouse",
  F: "Factory or industrial",
  G: "Garage or gas station",
  H: "Hotel",
  I: "Hospital or health facility",
  J: "Theater",
  K: "Store building",
  L: "Loft building",
  M: "Religious building",
  N: "Asylum or home",
  O: "Office building",
  P: "Place of assembly or culture",
  Q: "Outdoor recreation",
  R: "Condominium",
  S: "Homes with stores or offices",
  T: "Transportation facility",
  U: "Utility",
  V: "Vacant land",
  W: "School or educational",
  Y: "Government installation",
  Z: "Miscellaneous",
};

export function buildingClassFamily(code: string | null | undefined): string | null {
  return CLASS_FAMILY[(code ?? "").trim().charAt(0).toUpperCase()] ?? null;
}

/** 311 noise complaint types (all start with "Noise"), in plain words. */
const NOISE_TYPE: Record<string, string> = {
  "NOISE - RESIDENTIAL": "noise from apartments or houses",
  "NOISE - STREET/SIDEWALK": "street and sidewalk noise",
  "NOISE - COMMERCIAL": "noise from bars, stores or other businesses",
  "NOISE - VEHICLE": "vehicle noise",
  "NOISE - HELICOPTER": "helicopter noise",
  "NOISE - PARK": "noise from a park",
  "NOISE - HOUSE OF WORSHIP": "noise from a house of worship",
  // DEP: construction hours, equipment, alarms, barking dogs.
  NOISE: "construction, equipment or alarm noise",
};

export function noiseTypeName(type: string | null | undefined): string {
  const t = (type ?? "").trim();
  const hit = NOISE_TYPE[t.toUpperCase()];
  if (hit) return hit;
  const rest = t.replace(/^noise\s*[-:,]?\s*/i, "").toLowerCase();
  return rest ? `${rest} noise` : "noise";
}

/** HPD registration contact `type` ("HeadOfficer") as a role ("Head officer"). */
export function contactRole(type: string | null | undefined): string {
  const spaced = (type ?? "").trim().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Contact";
}
