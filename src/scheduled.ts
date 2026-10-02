// Nightly watch job: rebuild each watched building's report, diff it against the
// stored snapshot, email on meaningful change, and refresh the stored report so the
// next page view is current. Runs under the cron trigger in wrangler.jsonc.

import type { Report, WatchSnapshot } from "@shared/types";
import type { Env } from "./env";
import { diffSnapshots, snapshotOf } from "./lib/compute";
import { Db } from "./lib/db";
import { sendEmail, watchAlertEmail } from "./lib/email";
import { buildReport, enhanceSummary } from "./lib/pipeline";
import { randomToken, sha256Hex } from "./lib/tokens";

const CONCURRENCY = 4;

export interface WatchRunStats {
  checked: number;
  alerted: number;
  failed: number;
}

export async function runWatches(env: Env, ctx: ExecutionContext): Promise<WatchRunStats> {
  const db = new Db(env.DB);
  const stats: WatchRunStats = { checked: 0, alerted: 0, failed: 0 };
  let offset = 0;
  for (;;) {
    const batch = await db.listActiveWatches(200, offset);
    if (batch.length === 0) break;
    offset += batch.length;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      await Promise.all(
        batch.slice(i, i + CONCURRENCY).map(async (w) => {
          try {
            const row = await db.getReport(w.report_id);
            if (!row) return;
            const prevReport = JSON.parse(row.report_json) as Report;
            const built = await buildReport(env, prevReport.address, prevReport.id);
            const next = snapshotOf(built.report);
            const prev: WatchSnapshot = w.last_snapshot_json ? (JSON.parse(w.last_snapshot_json) as WatchSnapshot) : snapshotOf(prevReport);
            const changes = diffSnapshots(prev, next);

            // Keep an AI summary when nothing changed; otherwise fall back to the template and re-run the rewrite.
            const keepAi = prevReport.summarySource === "ai" && changes.length === 0;
            const report: Report = keepAi ? { ...built.report, summary: prevReport.summary, summarySource: "ai" } : built.report;
            await db.updateReportJson(w.report_id, report, built.teaser);
            if (!keepAi) ctx.waitUntil(enhanceSummary(env, w.report_id));

            if (changes.length) {
              // Mint a fresh link for the alert; earlier links stay valid.
              const token = randomToken();
              await db.insertToken(await sha256Hex(token), w.report_id, { watchId: w.id });
              const link = `https://${env.CANONICAL_HOST}/r/${w.report_id}#t=${token}`;
              await sendEmail(env, { to: w.email, ...watchAlertEmail({ appName: env.APP_NAME, addressLabel: w.address_label, link, changes }) });
              stats.alerted++;
            }
            await db.updateWatchSnapshot(w.id, next, changes.length > 0);
            stats.checked++;
          } catch (err) {
            stats.failed++;
            console.error(`watch ${w.id} failed`, String(err));
          }
        }),
      );
    }
  }
  console.log("watch run", JSON.stringify(stats));
  return stats;
}
