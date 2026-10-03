import { describe, expect, it } from "vitest";
import { normalizeUnit } from "../shared/address";
import { complaintApartment, complaintHeadline, DOB_COMPLAINT_CATEGORY, DOB_COMPLAINT_TOPIC, dobComplaintCategory, dobComplaintTopic, fallbackSentence, hpdPlace, hpdWhere, translate311, translateDob, translateHpd } from "../src/lib/translate";

describe("translateHpd", () => {
  it("translates the common orders", () => {
    expect(translateHpd("§ 27-2005, 27-2007, 27-2041.1 HMC: REPLACE OR REPAIR THE SELF-CLOSING DOORS THAT IS MISSING OR DEFECTIVE HINGES AT ENTRANCE DOOR LEADING TO APT AND MAKE DOOR SELF CLOSING IN THE ENTRANCE LOCATED AT APT D5, 4th STORY").what).toMatch(/door doesn't close on its own/);
    expect(translateHpd("SECTION 27-2046.1 HMC: REPAIR OR REPLACE THE CARBON MONOXIDE DETECTING DEVICE(S). MISSING IN THE ENTIRE APARTMENT LOCATED AT APT 2F").what).toBe("No working carbon monoxide detector");
    expect(translateHpd("§ 27-2056.6 ADM CODE - CORRECT THE LEAD-BASED PAINT HAZARD - PAINT THAT TESTED POSITIVE FOR LEAD CONTENT LOCATED AT APT 4R").what).toBe("Lead paint hazard");
    expect(translateHpd("§27-2107 ADM CODE OWNER FAILED TO FILE A VALID REGISTRATION STATEMENT WITH THE DEPARTMENT").what).toMatch(/registration/);
  });

  it("scopes infestations to the whole apartment when the order says so", () => {
    expect(translateHpd("HMC ADM CODE: § 27-2017.4 ABATE THE INFESTATION CONSISTING OF ROACHES IN THE ENTIRE APARTMENT LOCATED AT APT D1, 4th STORY").what).toBe("Roaches throughout the apartment");
  });

  it("extracts where", () => {
    expect(hpdWhere("...LOCATED AT APT 4R, 4th STORY, 1st APARTMENT FROM WEST AT NORTH")).toBe("Apt 4R");
    expect(hpdWhere("...IN THE 1st BATHROOM FROM NORTH AT WEST LOCATED AT APT 2F, 2nd STORY")).toBe("Apt 2F · bathroom");
    expect(hpdWhere("D26-10.01 ADM CODE PROPERLY REPAIR THE BROKEN FIRE RETARD WALLS AT STAIR 1ST STY PUBLIC HALL TO CELLAR.")).toBe("Common area · floor 1");
    expect(hpdWhere("SMOKE DETECTOR MISSING IN THE ENTIRE APARTMENT LOCATED AT APT NA, 2nd STORY", "NA", "2")).toBe("floor 2");
    expect(hpdWhere("BROKEN GLASS PANEL AT BUILDING VESTIBULE DOOR AT PUBLIC HALL, 1st STORY", "BLDG")).toBe("Common area · floor 1");
  });

  it("reads the same place as data: a normalised apartment, a common area, or the building", () => {
    expect(hpdPlace("...LOCATED AT APT 4R, 4th STORY, 1st APARTMENT FROM WEST AT NORTH")).toEqual({ area: "apartment", unit: "4R" });
    expect(hpdPlace("REPAIR THE SINK", " 2-f ")).toEqual({ area: "apartment", unit: "2F" });
    expect(hpdPlace("D26-10.01 ADM CODE PROPERLY REPAIR THE BROKEN FIRE RETARD WALLS AT STAIR 1ST STY PUBLIC HALL TO CELLAR.")).toEqual({ area: "common" });
    expect(hpdPlace("SMOKE DETECTOR MISSING IN THE ENTIRE APARTMENT LOCATED AT APT NA, 2nd STORY", "NA", "2")).toEqual({ area: "common" });
    expect(hpdPlace("§ 27-2005 ADM CODE POST THE REQUIRED NOTICE", "BLDG", "")).toEqual({ area: "building" });
  });

  it("normalises apartment numbers for matching", () => {
    expect(["D5", "d-5", "Apt D5", "APT3A", "#4 R", "Unit 12"].map(normalizeUnit)).toEqual(["D5", "D5", "D5", "3A", "4R", "12"]);
    expect([null, undefined, "", " - "].map(normalizeUnit)).toEqual([null, null, null, null]);
  });

  it("falls back to a sentence-cased excerpt", () => {
    const f = fallbackSentence("§ 27-2005 ADM CODE PROPERLY SECURE THE LOOSE ESCUCHEON PLATE AT UPPER RISER");
    expect(f.startsWith("P")).toBe(true);
    expect(f).not.toMatch(/§/);
  });
});

describe("translateDob", () => {
  it("decodes DOB NOW elevator paperwork codes", () => {
    expect(translateDob("now", { type: "FTC-VT-CAT1-CO", text: "Violation Issued-Failure To File 2024 Cat1 Test Affirmation of Correction" })).toMatch(/Category 1/);
    expect(translateDob("now", { type: "LBLVIO" })).toMatch(/Boiler/);
  });
  it("describes ECB summonses with class", () => {
    expect(translateDob("ecb", { type: "Elevators", text: "CLASS 2 ITEMS: CAR TOP IS NOT MAINTAINED IN A SAFE CONDITION", device: "CLASS - 2" })).toBe("Elevators summons (class 2): Car top is not maintained in a safe condition");
  });
});

describe("DOB complaint categories", () => {
  it("decodes codes from DOB's list", () => {
    expect(dobComplaintCategory("45")).toBe("Illegal Conversion");
    expect(dobComplaintCategory("6S")).toBe("Elevator: Single Device on Property/No Alternate Service");
    expect(dobComplaintCategory("4A")).toBe("Illegal Hotel Rooms in Residential Buildings");
    expect(dobComplaintCategory("2B")).toBe("Failure to Comply with Vacate Order");
    expect(dobComplaintCategory("94")).toBe("Plumbing: Defective/Leaking/Not Maintained");
    expect(dobComplaintCategory("4C")).toBe("Excavation Tracking Complaint"); // retired, from the Rev. 12/18 list
  });
  it("pads single digits and leaves unknown codes visible", () => {
    expect(dobComplaintCategory("5")).toBe(DOB_COMPLAINT_CATEGORY["05"]);
    expect(dobComplaintCategory("7R")).toBe("Buildings complaint (code 7R)");
    expect(dobComplaintCategory("")).toBe("Buildings complaint");
  });
  it("transcribes every code as two characters", () => {
    expect(Object.keys(DOB_COMPLAINT_CATEGORY)).toHaveLength(183);
    for (const k of Object.keys(DOB_COMPLAINT_CATEGORY)) expect(k).toMatch(/^[0-9][0-9A-Z]$/);
  });
});

describe("HPD complaint headlines", () => {
  it("says what the problem is", () => {
    expect(complaintHeadline("HEAT/HOT WATER", "ENTIRE BUILDING", "NO HEAT")).toBe("No heat");
    expect(complaintHeadline("HEAT/HOT WATER", "APARTMENT ONLY", "NO HOT WATER")).toBe("No hot water");
    expect(complaintHeadline("UNSANITARY CONDITION", "PESTS", "OTHER")).toBe("Pests");
    expect(complaintHeadline("UNSANITARY CONDITION", "PESTS", "BED BUGS")).toBe("Bedbugs");
    expect(complaintHeadline("UNSANITARY CONDITION", "MOLD", "N/A")).toBe("Mold");
    expect(complaintHeadline("WATER LEAK", "SOMETHING NEW", "X")).toBe("Water leak");
    expect(complaintHeadline("SAFETY", "SMOKE DETECTOR", "BROKEN OR MISSING")).toBe("No working smoke detector");
  });
  it("falls back to the city's words, title-cased", () => {
    expect(complaintHeadline("OUTSIDE BUILDING", "ROOF DOOR/HATCH", "BROKEN")).toBe("Roof Door/Hatch: Broken");
    expect(complaintHeadline("GENERAL", "TENANT HARASSMENT", "N/A")).toBe("Tenant Harassment");
    expect(complaintHeadline(null, null, null)).toBe("Housing complaint");
  });
  it("only shows apartment values that look like units", () => {
    expect(complaintApartment("3B")).toBe("3B");
    expect(complaintApartment("APT3A")).toBe("3A");
    expect(complaintApartment("D5")).toBe("D5");
    for (const junk of ["BLDG", "BUILDI", "2NDFLO", "BASEME", "1STFL", "2ND", "WHOLEB", "", undefined]) expect(complaintApartment(junk)).toBeNull();
  });
});

describe("translate311", () => {
  it("drops descriptor_2 when it is N/A or a code already shown", () => {
    expect(translate311({ agency: "DSNY", complaint_type: "Illegal Dumping", descriptor: "Removal Request", descriptor_2: "N/A" })).toBe("Sanitation: Illegal Dumping, Removal Request");
    expect(translate311({ agency: "OOS", complaint_type: "Taxi Report", descriptor: "Taxi Report" })).toBe("OOS: Taxi Report");
    expect(translate311({ agency: "NYPD", complaint_type: "Panhandling", descriptor: "N/A" })).toBe("Police: Panhandling");
    expect(translate311({ agency: "DEP", complaint_type: "Noise", descriptor: "Noise: Alarms (NR3)", descriptor_2: "NR3" })).toBe("Environmental Protection: Noise, Alarms (NR3)");
  });
});

describe("DOB complaint topics", () => {
  it("are read off DOB's own category descriptions: boilers are heat, plumbing is plumbing", () => {
    for (const [code, topic] of Object.entries(DOB_COMPLAINT_TOPIC)) {
      expect(DOB_COMPLAINT_CATEGORY[code], code).toMatch(topic === "heat" ? /^Boiler\b/ : /\bPlumbing\b/);
    }
    // Every "Boiler: ..." code is heat; codes naming several trades are left out.
    const boilers = Object.entries(DOB_COMPLAINT_CATEGORY).filter(([, d]) => /^Boiler:/.test(d)).map(([c]) => c);
    expect(boilers.every((c) => DOB_COMPLAINT_TOPIC[c] === "heat")).toBe(true);
    expect(dobComplaintTopic("96")).toBeNull();
    expect(dobComplaintTopic("01")).toBeNull();
    expect(dobComplaintTopic(" 58 ")).toBe("heat");
    expect(dobComplaintTopic("1w")).toBe("plumbing");
  });
});
