import { describe, expect, it } from "vitest";
import { isPlaceholderBin, normalizeAddress, resolveAddress } from "../src/lib/geosearch";

describe("normalizeAddress", () => {
  it("pulls a #unit and zip out of a Queens hyphenated address", () => {
    const n = normalizeAddress("23-10 42nd Rd #34E Long Island City, NY 11101");
    expect(n.unit).toBe("34E");
    expect(n.zip).toBe("11101");
    expect(n.borough).toBe("queens");
    expect(n.text).toMatch(/^23-10 42nd Rd/);
    expect(n.text).not.toMatch(/34E|11101|, NY/);
    expect(n.isIntersection).toBe(false);
  });

  it("pulls a bare trailing unit after the street type", () => {
    const n = normalizeAddress("143 W 4th St 3FW New York, NY");
    expect(n.unit).toBe("3FW");
    expect(n.borough).toBe("manhattan");
    expect(n.text).toMatch(/^143 W 4th St/);
    expect(n.text).not.toMatch(/3FW/);
  });

  it("handles Apt and Unit words", () => {
    expect(normalizeAddress("1130 Anderson Ave Apt 4B, Bronx").unit).toBe("4B");
    expect(normalizeAddress("1130 Anderson Ave unit 12, Bronx").unit).toBe("12");
    expect(normalizeAddress("1130 Anderson Ave, Bronx").unit).toBeNull();
  });

  it("spells number words as digits", () => {
    expect(normalizeAddress("One Penn Plaza, New York").text).toMatch(/^1 Penn Plaza/);
  });

  it("flags intersections", () => {
    expect(normalizeAddress("Broadway and 42nd Street, Manhattan").isIntersection).toBe(true);
    expect(normalizeAddress("Broadway & 42nd St").isIntersection).toBe(true);
    expect(normalizeAddress("350 Fifth Avenue, Manhattan").isIntersection).toBe(false);
  });

  it("recognises boroughs and common localities", () => {
    expect(normalizeAddress("100 Broadway, Brooklyn").borough).toBe("brooklyn");
    expect(normalizeAddress("37-11 35th Ave, Astoria").borough).toBe("queens");
    expect(normalizeAddress("100 Broadway").borough).toBeNull();
  });
});

describe("isPlaceholderBin", () => {
  it("detects million BINs", () => {
    expect(isPlaceholderBin("1000000")).toBe(true);
    expect(isPlaceholderBin("4000000")).toBe(true);
    expect(isPlaceholderBin("2003068")).toBe(false);
  });
});

describe("resolveAddress", () => {
  const feature = (label: string, borough: string, zip: string, bin: string, bbl: string, housenumber = "100", street = "BROADWAY") => ({
    geometry: { coordinates: [-73.9, 40.7] },
    properties: { label, borough, postalcode: zip, housenumber, street, addendum: { pad: { bin, bbl } } },
  });
  const fakeFetch = (features: unknown[]) => (async () => new Response(JSON.stringify({ features }), { status: 200 })) as unknown as typeof fetch;

  it("rejects intersections before calling the geocoder", async () => {
    const r = await resolveAddress("Broadway and 42nd St, Manhattan", fakeFetch([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("intersection");
  });

  it("asks the user to choose when the same number exists in two boroughs and no borough was given", async () => {
    const r = await resolveAddress(
      "100 Broadway",
      fakeFetch([feature("100 BROADWAY, Brooklyn, NY, USA", "Brooklyn", "11249", "3324734", "3021310001"), feature("100 BROADWAY, New York, NY, USA", "Manhattan", "10005", "1001024", "1000460003")]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates).toHaveLength(2);
    }
  });

  it("accepts the hit that agrees with the zip", async () => {
    const r = await resolveAddress(
      "100 Broadway 10005",
      fakeFetch([feature("100 BROADWAY, Brooklyn, NY, USA", "Brooklyn", "11249", "3324734", "3021310001"), feature("100 BROADWAY, New York, NY, USA", "Manhattan", "10005", "1001024", "1000460003")]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hit.bin).toBe("1001024");
  });

  it("rejects a hit whose house number differs (vanity names like One Penn Plaza)", async () => {
    const r = await resolveAddress("One Penn Plaza, New York", fakeFetch([feature("31 PENN PLAZA, New York, NY, USA", "Manhattan", "10001", "1015171", "1008060058", "31", "PENN PLAZA")]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous");
  });
});
