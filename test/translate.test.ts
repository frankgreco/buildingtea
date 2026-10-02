import { describe, expect, it } from "vitest";
import { fallbackSentence, hpdWhere, translateDob, translateHpd } from "../src/lib/translate";

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
