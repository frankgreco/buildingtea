import { describe, expect, it } from "vitest";
import { looksLikeToken, randomId, randomToken, sha256Hex } from "../src/lib/tokens";

describe("tokens", () => {
  it("makes url-safe ids and tokens", () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9]{12}$/);
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeToken(t)).toBe(true);
    expect(looksLikeToken("short")).toBe(false);
    expect(new Set(Array.from({ length: 50 }, randomToken)).size).toBe(50);
  });

  it("hashes with sha256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
