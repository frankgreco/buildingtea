import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

const env = {
  APP_NAME: "BuildingTea",
  CANONICAL_HOST: "buildingtea.com",
  ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
} as unknown as Env;

const get = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers }, env);

describe("host and https redirects", () => {
  it("sends the alias domain and www hosts to the canonical https origin, keeping the path", async () => {
    for (const url of ["https://buildingteanyc.com/r/abc?x=1", "https://www.buildingtea.com/r/abc?x=1", "http://www.buildingteanyc.com/r/abc?x=1"]) {
      const res = await get(url);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://buildingtea.com/r/abc?x=1");
    }
  });

  it("upgrades plain http on the canonical host", async () => {
    const res = await get("http://buildingtea.com/api/health");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://buildingtea.com/api/health");
    const viaProxyHeader = await get("https://buildingtea.com/api/health", { "x-forwarded-proto": "http" });
    expect(viaProxyHeader.status).toBe(301);
  });

  it("serves the canonical https host and local dev without redirecting", async () => {
    expect((await get("https://buildingtea.com/api/health")).status).toBe(200);
    expect((await get("http://localhost:8787/api/health")).status).toBe(200);
    expect((await get("https://buildingtea.frank.workers.dev/api/health")).status).toBe(200);
    const spa = await get("https://buildingtea.com/r/abc");
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("spa");
  });

  it("sets security headers and no-store on the API", async () => {
    const res = await get("https://buildingtea.com/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
