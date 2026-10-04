import { afterEach, describe, expect, it, vi } from "vitest";
import type { Report } from "../shared/types";
import type { Env } from "../src/env";
import { SAMPLE_ENHANCE_RETRY_SECONDS, SAMPLE_MAX_AGE_DAYS, sampleReport, sampleReportId } from "../src/lib/pipeline";

const ADDRESS = "1018 Eastern Parkway, Brooklyn";
const SUMMARY = "The city lists no open hazardous conditions at this building, and tenants made no complaints to the city in the last year. See the apartment in person before you sign.";

/** The two tables' worth of D1 the sample touches: one reports row, read by id, inserted and updated. */
function fakeDb() {
  const rows = new Map<string, { id: string; report_json: string; teaser_json: string }>();
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: string[]) => ({
        first: async () => (sql.startsWith("SELECT * FROM reports WHERE id") ? (rows.get(args[0]!) ?? null) : null),
        run: async () => {
          if (sql.startsWith("INSERT INTO reports")) rows.set(args[0]!, { id: args[0]!, report_json: args[5]!, teaser_json: args[6]! });
          else if (sql.startsWith("UPDATE reports SET report_json")) rows.set(args[0]!, { id: args[0]!, report_json: args[1]!, teaser_json: args[2]! });
          else throw new Error(`unexpected statement: ${sql}`);
        },
      }),
    }),
  };
  return { rows, d1 };
}

function fakeKv() {
  const values = new Map<string, string>();
  const puts: { key: string; ttl: number | undefined }[] = [];
  return {
    values,
    puts,
    kv: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        values.set(key, value);
        puts.push({ key, ttl: opts?.expirationTtl });
      },
    },
  };
}

/** The address lookup, the city's data (every query answers with no rows) and the model, each counted. */
function stubFetch() {
  const calls = { geo: 0, city: 0, model: 0 };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("geosearch.planninglabs.nyc")) {
      calls.geo++;
      return Response.json({
        features: [
          {
            geometry: { coordinates: [-73.9348, 40.669] },
            properties: { label: "1018 EASTERN PARKWAY, Brooklyn, NY, USA", housenumber: "1018", street: "EASTERN PARKWAY", postalcode: "11213", borough: "Brooklyn", addendum: { pad: { bin: "3037516", bbl: "3013950033" } } },
          },
        ],
      });
    }
    if (url.includes("data.cityofnewyork.us")) {
      calls.city++;
      return Response.json([]);
    }
    if (url.includes("openrouter.ai")) {
      calls.model++;
      return Response.json({ model: "test", choices: [{ message: { content: SUMMARY } }] });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return calls;
}

function setup(over: Partial<Env> = {}) {
  const db = fakeDb();
  const cache = fakeKv();
  const env = { DB: db.d1, CACHE: cache.kv, SAMPLE_ADDRESS: ADDRESS, OPENAI_API_KEY: "sk-test", CANONICAL_HOST: "buildingtea.com", APP_NAME: "BuildingTea", ...over } as unknown as Env;
  const deferred: Promise<unknown>[] = [];
  const stored = async () => JSON.parse(db.rows.get(await sampleReportId(ADDRESS))!.report_json) as Report;
  return { env, db, cache, deferred, defer: (work: Promise<unknown>) => void deferred.push(work), stored };
}

afterEach(() => vi.unstubAllGlobals());

describe("the landing page's sample", () => {
  it("builds on the first request and asks the model for nothing in that invocation", async () => {
    const calls = stubFetch();
    const s = setup();
    const report = await sampleReport(s.env, s.defer, new Date("2026-10-03T12:00:00Z"));
    expect(report?.address.bin).toBe("3037516");
    expect(report?.summarySource).toBe("template");
    expect((await s.stored()).id).toBe(await sampleReportId(ADDRESS));
    expect(s.deferred).toHaveLength(0);
    expect(calls.model).toBe(0);
    // The build's own requests stay under the 50 one invocation gets.
    expect(calls.geo + calls.city).toBeLessThanOrEqual(50);
    expect(calls.city).toBe(42);
  });

  it("has a later request start the model's work behind its response, once", async () => {
    const calls = stubFetch();
    const s = setup();
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:00:00Z"));
    const built = { ...calls };

    const second = await sampleReport(s.env, s.defer, new Date("2026-10-03T12:05:00Z"));
    expect(second?.summarySource).toBe("template");
    expect(s.deferred).toHaveLength(1);
    expect(s.cache.puts).toEqual([{ key: `sample-enhance:${second!.id}:${second!.generatedAt}`, ttl: SAMPLE_ENHANCE_RETRY_SECONDS }]);
    // A request that arrives while that work runs doesn't pay for it again.
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:05:01Z"));
    expect(s.deferred).toHaveLength(1);

    await Promise.all(s.deferred);
    // The invocation that called the model made no city requests.
    expect({ geo: calls.geo, city: calls.city }).toEqual({ geo: built.geo, city: built.city });
    expect(calls.model).toBe(1);
    expect(await s.stored()).toMatchObject({ summarySource: "ai", summary: SUMMARY });

    const third = await sampleReport(s.env, s.defer, new Date("2026-10-03T13:00:00Z"));
    expect(third?.summary).toBe(SUMMARY);
    expect(s.deferred).toHaveLength(1);
    expect(calls.model).toBe(1);
  });

  it("tries the model again only after the mark expires when the first try changed nothing", async () => {
    const calls = stubFetch();
    const s = setup();
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:00:00Z"));
    // A reply the guard rejects (a number that is in no fact) leaves the template summary in place.
    vi.stubGlobal("fetch", async () => {
      calls.model++;
      return Response.json({ model: "test", choices: [{ message: { content: `${SUMMARY} There were 987654 of them.` } }] });
    });
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:05:00Z"));
    await Promise.all(s.deferred);
    expect((await s.stored()).summarySource).toBe("template");
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:10:00Z"));
    expect([s.deferred.length, calls.model]).toEqual([1, 1]);
    // KV drops the mark after its TTL; the next request then tries once more.
    s.cache.values.clear();
    await sampleReport(s.env, s.defer, new Date("2026-10-03T19:00:00Z"));
    await Promise.all(s.deferred);
    expect([s.deferred.length, calls.model]).toEqual([2, 2]);
  });

  it("never marks or defers anything without a model key", async () => {
    const calls = stubFetch();
    const s = setup({ OPENAI_API_KEY: undefined });
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:00:00Z"));
    await sampleReport(s.env, s.defer, new Date("2026-10-03T12:05:00Z"));
    expect(s.deferred).toHaveLength(0);
    expect(s.cache.puts).toEqual([]);
    expect(calls.model).toBe(0);
  });

  it("rebuilds a stale sample behind the response, and leaves the model to the request after that", async () => {
    const calls = stubFetch();
    const s = setup();
    const first = new Date("2026-10-03T12:00:00Z");
    await sampleReport(s.env, s.defer, first);
    const later = new Date(first.getTime() + (SAMPLE_MAX_AGE_DAYS + 1) * 86_400_000);

    // The stale one is served, and only a rebuild is deferred.
    const served = await sampleReport(s.env, s.defer, later);
    expect(served?.generatedAt).toBe(first.toISOString());
    expect(s.deferred).toHaveLength(1);
    await Promise.all(s.deferred);
    expect(calls.model).toBe(0);
    expect(calls.city).toBe(84);
    expect((await s.stored()).generatedAt).toBe(later.toISOString());

    await sampleReport(s.env, s.defer, new Date(later.getTime() + 60_000));
    await Promise.all(s.deferred);
    expect(s.deferred).toHaveLength(2);
    expect(calls.model).toBe(1);
    expect(calls.city).toBe(84);
    expect((await s.stored()).summarySource).toBe("ai");
  });

  it("is null without a sample address", async () => {
    const s = setup({ SAMPLE_ADDRESS: undefined });
    expect(await sampleReport(s.env, s.defer)).toBeNull();
  });
});
