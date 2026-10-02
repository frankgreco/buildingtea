// Monthly watch digest. The cron in wrangler.jsonc fires every ten minutes and each
// run handles one watch that is due: the first digest 30 days after the watch started,
// then every 30 days. It rebuilds the report (so the emailed link is current), diffs
// the new snapshot against the one from the last digest, has the model write a short
// note on what changed (template copy in quiet months, with no AI call), and sends
// one email. The watch is
// marked digested only after the email goes out. A failure backs the watch off for a
// few hours (so it can't block the queue) and is retried; an address Resend refuses
// outright skips that month instead of retrying, and burning inference, forever.
//
// One per run on purpose: a report build is roughly twenty city-data requests plus
// KV and D1 calls, and the free plan caps a Worker invocation at 50 subrequests.
// 144 runs a day is capacity for ~4,000 digests a month; raise PER_RUN on Workers Paid.

import type { Report, WatchSnapshot } from "@shared/types";
import type { Env } from "./env";
import { diffSnapshots, snapshotOf } from "./lib/compute";
import { Db } from "./lib/db";
import { EmailError, sendEmail, watchDigestEmail } from "./lib/email";
import { summarizeChanges } from "./lib/llm";
import { buildReport, enhanceSummary, summaryFacts } from "./lib/pipeline";
import { randomToken, sha256Hex } from "./lib/tokens";

const PER_RUN = 1;

export interface WatchRunStats {
  due: number;
  digested: number;
  /** Undeliverable this month (Resend refused the address or payload); skipped until next month. */
  skipped: number;
  failed: number;
}

export async function runWatches(env: Env, ctx: ExecutionContext): Promise<WatchRunStats> {
  const db = new Db(env.DB);
  const batch = await db.listWatchesDue(PER_RUN);
  const stats: WatchRunStats = { due: batch.length, digested: 0, skipped: 0, failed: 0 };
  for (const w of batch) {
    let next: WatchSnapshot | null = null;
    try {
      const row = await db.getReport(w.report_id);
      if (!row) throw new Error(`report ${w.report_id} missing`);
      const prevReport = JSON.parse(row.report_json) as Report;
      const built = await buildReport(env, prevReport.address, prevReport.id);
      next = snapshotOf(built.report);
      const prev: WatchSnapshot = w.last_snapshot_json ? (JSON.parse(w.last_snapshot_json) as WatchSnapshot) : snapshotOf(prevReport);
      const changes = diffSnapshots(prev, next);

      // The rebuild is idempotent. The report's AI summary is only rewritten when the facts it is
      // written from changed; otherwise the previous one still describes this exact data. Quiet
      // months therefore cost no inference at all.
      const sameFacts = prevReport.summarySource === "ai" && JSON.stringify(summaryFacts(prevReport)) === JSON.stringify(summaryFacts(built.report));
      const report: Report = sameFacts ? { ...built.report, summary: prevReport.summary, summarySource: "ai" } : built.report;
      await db.updateReportJson(w.report_id, report, built.teaser);
      if (!sameFacts) ctx.waitUntil(enhanceSummary(env, w.report_id));

      // The note for the email: written by the model only when something changed; template copy otherwise.
      const summary =
        env.OPENAI_API_KEY && changes.length
          ? await summarizeChanges(
              { apiKey: env.OPENAI_API_KEY, appUrl: `https://${env.CANONICAL_HOST}`, appName: env.APP_NAME },
              { addressLabel: w.address_label, changes },
            ).catch((err) => {
              console.warn(`watch ${w.id} change note failed; using template`, String(err));
              return null;
            })
          : null;

      // Mint a fresh link for this digest; earlier links stay valid.
      const token = randomToken();
      await db.insertToken(await sha256Hex(token), w.report_id, { watchId: w.id });
      const link = `https://${env.CANONICAL_HOST}/r/${w.report_id}#t=${token}`;
      const manageUrl = `https://${env.CANONICAL_HOST}/api/report/${w.report_id}/manage?t=${token}`;
      // One key per watch per cycle: a retry after a timeout can't send this month's email twice.
      await sendEmail(
        env,
        { to: w.email, ...watchDigestEmail({ appName: env.APP_NAME, addressLabel: w.address_label, link, manageUrl, changes, summary, monthly: w.price_label ?? null }) },
        { idempotencyKey: `digest/${w.id}/${w.last_digest_at ?? w.created_at}` },
      );

      // Only after the email is out, so a failed run is retried later.
      await db.markWatchDigested(w.id, next);
      stats.digested++;
    } catch (err) {
      if (err instanceof EmailError && err.permanent && next) {
        await db.markWatchDigested(w.id, next).catch(() => {});
        stats.skipped++;
        console.error(`watch ${w.id} undeliverable; skipping this month`, String(err));
      } else {
        await db.markWatchAttempted(w.id).catch(() => {});
        stats.failed++;
        console.error(`watch ${w.id} failed; retrying in a few hours`, String(err));
      }
    }
  }
  if (stats.due) console.log("watch digest run", JSON.stringify(stats));
  return stats;
}
