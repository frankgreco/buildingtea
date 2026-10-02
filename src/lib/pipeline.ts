// The whole thing: address -> BIN/BBL -> parallel city queries -> Report + Teaser -> D1.
// Used by the search route (first view) and the nightly watch job (refresh).

import type { Address, Report, SourceStamp, Teaser } from "@shared/types";
import type { Env } from "../env";
import { computeReport, teaserOf } from "./compute";
import { DATASETS, fetchBuildingData } from "./datasets";
import { Db } from "./db";
import { isPlaceholderBin, resolveAddress, type GeoHit } from "./geosearch";
import { rewriteSummary } from "./llm";
import { datasetUpdatedAt } from "./soda";
import { randomId } from "./tokens";

const SOURCE_KEYS = ["hpdViolations", "hpdComplaints", "dobSafetyViolations", "ecbViolations", "n311", "bedbugs", "hpdRegistrations", "pluto"] as const;

/** Dataset "last updated" stamps, cached in KV for six hours. */
export async function sourceStamps(env: Env): Promise<SourceStamp[]> {
  const key = "sources:v1";
  const cached = await env.CACHE.get<SourceStamp[]>(key, "json");
  if (cached) return cached;
  const stamps = await Promise.all(
    SOURCE_KEYS.map(async (k) => {
      const d = DATASETS[k];
      return { id: d.id, name: d.name, updatedAt: await datasetUpdatedAt(d.id) } satisfies SourceStamp;
    }),
  );
  await env.CACHE.put(key, JSON.stringify(stamps), { expirationTtl: 6 * 3600 });
  return stamps;
}

export function addressFromHit(hit: GeoHit, unit: string | null): Address {
  return {
    label: hit.label.replace(/, USA$/, ""),
    borough: hit.borough,
    zip: hit.zip,
    bin: hit.bin,
    bbl: hit.bbl,
    houseNumber: hit.houseNumber,
    street: hit.street,
    unit,
    lotOnly: isPlaceholderBin(hit.bin),
    hpdBuildingId: null,
    lat: hit.lat,
    lon: hit.lon,
  };
}

export interface Built {
  report: Report;
  teaser: Teaser;
}

/** Fetch and compute for a resolved address. Does not touch the database. */
export async function buildReport(env: Env, address: Address, id = randomId(), now = new Date()): Promise<Built> {
  const [raw, sources] = await Promise.all([
    fetchBuildingData(address.bin, address.bbl, now, { appToken: env.SOCRATA_APP_TOKEN, timeoutMs: 9000 }),
    sourceStamps(env),
  ]);
  const report = computeReport({ id, address, raw, sources, now });
  const teaser = teaserOf(report, raw);
  return { report, teaser };
}

export type SearchOutcome =
  | { ok: true; report: Report; teaser: Teaser; reused: boolean }
  | { ok: false; reason: "invalid" | "intersection" | "no_match" | "ambiguous"; message: string; candidates: { label: string; borough: string; zip: string; bin: string; bbl: string }[] };

/**
 * Resolve, reuse a report generated in the last 24h for the same building+unit if
 * there is one, otherwise build and store a new one.
 */
export async function search(env: Env, input: string): Promise<SearchOutcome> {
  const resolved = await resolveAddress(input);
  if (!resolved.ok) return resolved;
  const db = new Db(env.DB);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const recent = await db.recentReportFor(resolved.hit.bin, resolved.unit, since);
  if (recent) {
    return { ok: true, report: JSON.parse(recent.report_json) as Report, teaser: JSON.parse(recent.teaser_json) as Teaser, reused: true };
  }
  const built = await buildReport(env, addressFromHit(resolved.hit, resolved.unit));
  await db.insertReport(built.report, built.teaser);
  return { ok: true, ...built, reused: false };
}

/**
 * Rewrite the stored summary with the LLM. Called via ctx.waitUntil after a purchase.
 * Silently keeps the template on any failure.
 */
export async function enhanceSummary(env: Env, reportId: string): Promise<void> {
  if (!env.OPENAI_API_KEY) return;
  const db = new Db(env.DB);
  const row = await db.getReport(reportId);
  if (!row) return;
  const report = JSON.parse(row.report_json) as Report;
  if (report.summarySource === "ai") return;
  try {
    const result = await rewriteSummary(
      { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.LLM_MODEL, appUrl: `https://${env.CANONICAL_HOST}`, appName: env.APP_NAME },
      { address: report.address, cover: report.cover, counts: report.counts, ownership: report.ownership, bedbugs: report.bedbugs, cards: report.cards },
      report.summary,
    );
    if (!result) return;
    const updated: Report = { ...report, summary: result.text, summarySource: "ai" };
    const teaser = JSON.parse(row.teaser_json) as Teaser;
    await db.updateReportJson(reportId, updated, teaser);
  } catch (err) {
    console.warn("summary rewrite failed; keeping template", String(err));
  }
}
