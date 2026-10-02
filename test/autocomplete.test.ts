import { describe, expect, it } from "vitest";
import { splitUnit, withUnit } from "../shared/address";
import { MAX_SUGGESTIONS, autocompleteUrl, parseSuggestions, queryFor } from "../shared/suggest";

// Shape captured from a live GeoSearch v2 /autocomplete response on 2026-10-02.
const feature = (label: string, housenumber: string, street: string, extra: Record<string, unknown> = {}) => ({
  properties: { label, housenumber, street, borough: "Manhattan", postalcode: "10012", neighbourhood: "Greenwich Village", addendum: { pad: { bin: "1008881", bbl: "1005520033" } }, ...extra },
});

describe("splitUnit", () => {
  it("pulls #, Apt and bare trailing units and upper-cases them", () => {
    expect(splitUnit("23-10 42nd Rd #34e Long Island City")).toEqual({ text: "23-10 42nd Rd Long Island City", unit: "34E" });
    expect(splitUnit("1130 Anderson Ave Apt 4B, Bronx")).toEqual({ text: "1130 Anderson Ave , Bronx", unit: "4B" });
    expect(splitUnit("143 W 4th St 3FW New York")).toEqual({ text: "143 W 4th St New York", unit: "3FW" });
  });
  it("leaves addresses without a unit alone, including partial typing", () => {
    expect(splitUnit("143 w 4th st")).toEqual({ text: "143 w 4th st", unit: null });
    expect(splitUnit("143 w 4th st a")).toEqual({ text: "143 w 4th st a", unit: null });
    expect(splitUnit("2 West End Ave")).toEqual({ text: "2 West End Ave", unit: null });
  });
});

describe("withUnit", () => {
  it("puts the unit after the street, before the locality", () => {
    expect(withUnit("143 WEST 4 STREET, New York, NY, USA", "3FW")).toBe("143 WEST 4 STREET #3FW, New York, NY, USA");
    expect(withUnit("143 WEST 4 STREET", "3FW")).toBe("143 WEST 4 STREET #3FW");
    expect(withUnit("143 WEST 4 STREET, New York, NY, USA", null)).toBe("143 WEST 4 STREET, New York, NY, USA");
  });
});

describe("queryFor", () => {
  it("waits for a house number and strips the unit", () => {
    expect(queryFor("")).toBeNull();
    expect(queryFor("we")).toBeNull();
    expect(queryFor("west 4th")).toBeNull();
    expect(queryFor("143")).toBe("143");
    expect(queryFor("143 w 4th st #3fw, new york")).toBe("143 w 4th st, new york");
  });
  it("builds a plain GET url (no custom headers, so no CORS preflight)", () => {
    expect(autocompleteUrl("23-10 42nd rd")).toBe("https://geosearch.planninglabs.nyc/v2/autocomplete?text=23-10%2042nd%20rd");
  });
});

describe("parseSuggestions", () => {
  it("formats rows and keeps the raw label for submission", () => {
    const [s] = parseSuggestions({ features: [feature("143 WEST 4 STREET, New York, NY, USA", "143", "WEST 4 STREET")] });
    expect(s).toEqual({ label: "143 WEST 4 STREET, New York, NY, USA", primary: "143 West 4 Street", secondary: "Greenwich Village · Manhattan 10012", bin: "1008881" });
  });
  it("drops rows without a house number or BIN, de-duplicates labels, and caps the list", () => {
    const features = [
      feature("WEST 4 STREET, New York, NY, USA", "", "WEST 4 STREET"),
      feature("1 MAIN STREET, New York, NY, USA", "1", "MAIN STREET", { addendum: {} }),
      ...Array.from({ length: 10 }, (_, i) => feature(`${i % 8} BROADWAY, New York, NY, USA`, String(i % 8), "BROADWAY")),
    ];
    const out = parseSuggestions({ features });
    expect(out.length).toBe(MAX_SUGGESTIONS);
    expect(new Set(out.map((s) => s.label)).size).toBe(out.length);
    expect(out.every((s) => s.primary.endsWith(" Broadway"))).toBe(true);
  });
  it("tolerates garbage", () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions({})).toEqual([]);
    expect(parseSuggestions({ features: [{}, { properties: null }] })).toEqual([]);
  });
});
