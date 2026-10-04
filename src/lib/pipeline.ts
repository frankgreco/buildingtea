// The whole thing: address -> BIN/BBL -> parallel city queries -> Report + Teaser -> D1.
// Used by the search route.

import type { Address, Report, Teaser } from "@shared/types";
import type { Env } from "../env";
import { computeReport, teaserOf } from "./compute";
import { fetchBuildingData } from "./datasets";
import { Db } from "./db";
import { isPlaceholderBin, resolveAddress, type GeoHit } from "./geosearch";
import { snapshotOf } from "@shared/snapshot";
import { nameRecords, rewriteSummary } from "./llm";
import { applyNames, pendingNames } from "./naming";
import { alsoOnFile, type SummaryFacts } from "./summary";
import { randomId, sha256Hex } from "./tokens";

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

/**
 * Fetch and compute for a resolved address. Does not touch the database. The city requests are the
 * only ones a build makes, and with the address lookup they come close to the 50 subrequests one
 * invocation gets (datasets.ts), so nothing else that fetches should share an invocation with it.
 */
export async function buildReport(env: Env, address: Address, id = randomId(), now = new Date()): Promise<Built> {
  const raw = await fetchBuildingData(address.bin, address.bbl, now, { appToken: env.SOCRATA_APP_TOKEN, timeoutMs: 9000 });
  const report = computeReport({ id, address, raw, now });
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

/** Exactly what the AI summary is written from. */
export function summaryFacts(r: Report): SummaryFacts {
  return { address: r.address, cover: r.cover, counts: r.counts, ownership: r.ownership, bedbugs: r.bedbugs, cards: r.cards, snapshot: snapshotOf(r), also: alsoOnFile(r) };
}

/**
 * The model's work on a paid report, in one pass and one write: rewrite the template summary, and
 * name the last twelve months' rows (naming.ts). Each is skipped when it is already done and keeps
 * what the report has on any failure. Called via ctx.waitUntil after a purchase, and for the
 * landing page's sample (below); never in an invocation that also builds a report.
 */
export async function enhanceReport(env: Env, reportId: string): Promise<void> {
  if (!env.OPENAI_API_KEY) return;
  const db = new Db(env.DB);
  const row = await db.getReport(reportId);
  if (!row) return;
  const report = JSON.parse(row.report_json) as Report;
  const cfg = { apiKey: env.OPENAI_API_KEY, appUrl: `https://${env.CANONICAL_HOST}`, appName: env.APP_NAME };
  const pending = pendingNames(report);
  const [summary, names] = await Promise.all([
    report.summarySource === "ai"
      ? null
      : rewriteSummary(cfg, summaryFacts(report), report.summary).catch((err) => {
          console.warn("summary rewrite failed; keeping template", String(err));
          return null;
        }),
    pending.length ? nameRecords(cfg, pending) : new Map<string, string>(),
  ]);
  let updated = applyNames(report, names);
  if (summary) updated = { ...updated, summary: summary.text, summarySource: "ai" };
  if (updated === report) return;
  await db.updateReportJson(reportId, updated, JSON.parse(row.teaser_json) as Teaser);
}

/** How many days the landing page's sample report is served before it is rebuilt. */
export const SAMPLE_MAX_AGE_DAYS = 30;

/** The sample's report id: fixed for an address, so changing SAMPLE_ADDRESS starts a fresh one. */
export async function sampleReportId(address: string): Promise<string> {
  return `sample${(await sha256Hex(address.trim().toLowerCase())).slice(0, 18)}`;
}

/** How long after one try at the sample's summary and row names the next request may try again. */
export const SAMPLE_ENHANCE_RETRY_SECONDS = 6 * 3600;

/**
 * The landing page's sample: a full report on env.SAMPLE_ADDRESS, stored like any other under a
 * fixed id. The first request builds it. After SAMPLE_MAX_AGE_DAYS the stored one is still served
 * while its replacement is built behind the response, so the sample never claims something about a
 * real building that the city's records stopped saying months ago.
 *
 * The model's summary and row names never share an invocation with a build, which uses nearly all
 * of the invocation's subrequests on its own. A request that builds does only that. A later request
 * that finds the stored sample without the model's summary starts that work behind the response
 * (`defer`), once per build every SAMPLE_ENHANCE_RETRY_SECONDS: a mark in KV keeps the requests that
 * arrive while it runs, or after it failed, from each paying for it again.
 *
 * Null when no sample is configured or its address doesn't resolve.
 */
export async function sampleReport(env: Env, defer: (work: Promise<unknown>) => void, now = new Date()): Promise<Report | null> {
  const input = env.SAMPLE_ADDRESS?.trim();
  if (!input) return null;
  const db = new Db(env.DB);
  const id = await sampleReportId(input);
  const row = await db.getReport(id);
  const build = async (): Promise<Report | null> => {
    const resolved = await resolveAddress(input);
    if (!resolved.ok) {
      console.warn(`sample address did not resolve: ${input} (${resolved.reason})`);
      return null;
    }
    const built = await buildReport(env, addressFromHit(resolved.hit, resolved.unit), id, now);
    if (row) await db.updateReportJson(id, built.report, built.teaser);
    else await db.insertReport(built.report, built.teaser);
    return built.report;
  };
  if (!row) return build();
  const report = JSON.parse(row.report_json) as Report;
  if (Date.parse(report.generatedAt) < now.getTime() - SAMPLE_MAX_AGE_DAYS * 86_400_000) {
    defer(build());
  } else if (report.summarySource !== "ai" && env.OPENAI_API_KEY) {
    const mark = `sample-enhance:${id}:${report.generatedAt}`;
    if (!(await env.CACHE.get(mark))) {
      await env.CACHE.put(mark, now.toISOString(), { expirationTtl: SAMPLE_ENHANCE_RETRY_SECONDS });
      defer(enhanceReport(env, id));
    }
  }
  return report;
}
