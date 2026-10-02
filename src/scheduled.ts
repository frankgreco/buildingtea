// Monthly watch digest. The cron in wrangler.jsonc fires every ten minutes and each
// run handles one watch that is due: the first digest 30 days after the watch started,
// then every 30 days. It rebuilds the report (so the emailed link is current), diffs
// the new snapshot against the one from the last digest, asks the model for a short
// note on what changed (none when nothing did), and sends one email. The watch is
// marked digested only after the email goes out, so a failure is retried on a later run.
//
// One per run on purpose: a report build is roughly twenty city-data requests plus
// KV and D1 calls, and the free plan caps a Worker invocation at 50 subrequests.
// 144 runs a day is capacity for ~4,000 digests a month; raise PER_RUN on Workers Paid.

import type { Report, WatchSnapshot } from "@shared/types";
import type { Env } from "./env";
import { diffSnapshots, snapshotOf } from "./lib/compute";
import { Db } from "./lib/db";
import { sendEmail, watchDigestEmail } from "./lib/email";
import { summarizeChanges } from "./lib/llm";
import { buildReport, enhanceSummary } from "./lib/pipeline";
import { randomToken, sha256Hex } from "./lib/tokens";

const PER_RUN = 1;

export interface WatchRunStats {
  due: number;
  digested: number;
  failed: number;
}

export async function runWatches(env: Env, ctx: ExecutionContext): Promise<WatchRunStats> {
  const db = new Db(env.DB);
  const batch = await db.listWatchesDue(PER_RUN);
  const stats: WatchRunStats = { due: batch.length, digested: 0, failed: 0 };
  for (const w of batch) {
    try {
      const row = await db.getReport(w.report_id);
      if (!row) continue;
      const prevReport = JSON.parse(row.report_json) as Report;
      const built = await buildReport(env, prevReport.address, prevReport.id);
      const next = snapshotOf(built.report);
      const prev: WatchSnapshot = w.last_snapshot_json ? (JSON.parse(w.last_snapshot_json) as WatchSnapshot) : snapshotOf(prevReport);
      const changes = diffSnapshots(prev, next);

      // The rebuild is idempotent: store it, then let the AI pass rewrite its summary off the critical path.
      await db.updateReportJson(w.report_id, built.report, built.teaser);
      ctx.waitUntil(enhanceSummary(env, w.report_id));

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
      await sendEmail(env, { to: w.email, ...watchDigestEmail({ appName: env.APP_NAME, addressLabel: w.address_label, link, manageUrl, changes, summary }) });

      // Only after the email is out, so a failed run is retried later.
      await db.markWatchDigested(w.id, next);
      stats.digested++;
    } catch (err) {
      stats.failed++;
      console.error(`watch ${w.id} failed`, String(err));
    }
  }
  if (stats.due) console.log("watch digest run", JSON.stringify(stats));
  return stats;
}
