// D1 access. Every query in one place so the schema has a single consumer.

import type { Report, Teaser, WatchSnapshot } from "@shared/types";

export interface ReportRow {
  id: string;
  bin: string;
  bbl: string;
  unit: string | null;
  address_label: string;
  report_json: string;
  teaser_json: string;
  generated_at: string;
}

export interface PurchaseRow {
  id: number;
  report_id: string;
  stripe_session_id: string;
  stripe_customer_id: string | null;
  email: string | null;
  status: "pending" | "paid" | "failed";
  paid_at: string | null;
}

export interface WatchRow {
  id: number;
  report_id: string;
  bin: string;
  bbl: string;
  unit: string | null;
  address_label: string;
  email: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: "active" | "past_due" | "canceled";
  last_snapshot_json: string | null;
  last_checked_at: string | null;
  last_alert_at: string | null;
}

export interface TokenRow {
  token_hash: string;
  report_id: string;
  kind: "purchase" | "watch";
  purchase_id: number | null;
  watch_id: number | null;
}

export class Db {
  constructor(private d1: D1Database) {}

  // ---- reports ----

  async insertReport(report: Report, teaser: Teaser): Promise<void> {
    await this.d1
      .prepare("INSERT INTO reports (id, bin, bbl, unit, address_label, report_json, teaser_json, generated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(report.id, report.address.bin, report.address.bbl, report.address.unit, report.address.label, JSON.stringify(report), JSON.stringify(teaser), report.generatedAt)
      .run();
  }

  async updateReportJson(id: string, report: Report, teaser: Teaser): Promise<void> {
    await this.d1
      .prepare("UPDATE reports SET report_json = ?2, teaser_json = ?3, generated_at = ?4 WHERE id = ?1")
      .bind(id, JSON.stringify(report), JSON.stringify(teaser), report.generatedAt)
      .run();
  }

  async getReport(id: string): Promise<ReportRow | null> {
    return (await this.d1.prepare("SELECT * FROM reports WHERE id = ?1").bind(id).first<ReportRow>()) ?? null;
  }

  /** Most recent report for a building+unit newer than `since`, for the 24h reuse path. */
  async recentReportFor(bin: string, unit: string | null, since: string): Promise<ReportRow | null> {
    return (
      (await this.d1
        .prepare("SELECT * FROM reports WHERE bin = ?1 AND (unit IS ?2) AND generated_at > ?3 ORDER BY generated_at DESC LIMIT 1")
        .bind(bin, unit, since)
        .first<ReportRow>()) ?? null
    );
  }

  // ---- purchases ----

  async insertPendingPurchase(reportId: string, sessionId: string): Promise<void> {
    await this.d1.prepare("INSERT OR IGNORE INTO purchases (report_id, stripe_session_id, status) VALUES (?1, ?2, 'pending')").bind(reportId, sessionId).run();
  }

  async getPurchaseBySession(sessionId: string): Promise<PurchaseRow | null> {
    return (await this.d1.prepare("SELECT * FROM purchases WHERE stripe_session_id = ?1").bind(sessionId).first<PurchaseRow>()) ?? null;
  }

  /**
   * Mark a purchase paid. `first` is true when this call performed the transition
   * (the caller sends the receipt); false when it was already paid (webhook and claim race).
   */
  async markPurchasePaid(sessionId: string, reportId: string, email: string | null, customerId: string | null): Promise<{ first: boolean; purchaseId: number }> {
    const res = await this.d1
      .prepare(
        `INSERT INTO purchases (report_id, stripe_session_id, stripe_customer_id, email, status, paid_at)
         VALUES (?1, ?2, ?3, ?4, 'paid', ?5)
         ON CONFLICT(stripe_session_id) DO UPDATE SET
           status = 'paid',
           email = COALESCE(excluded.email, purchases.email),
           stripe_customer_id = COALESCE(excluded.stripe_customer_id, purchases.stripe_customer_id),
           paid_at = COALESCE(purchases.paid_at, excluded.paid_at)
         WHERE purchases.status != 'paid'`,
      )
      .bind(reportId, sessionId, customerId, email, new Date().toISOString())
      .run();
    const row = await this.getPurchaseBySession(sessionId);
    if (!row) throw new Error("purchase row missing after upsert");
    return { first: (res.meta.changes ?? 0) > 0, purchaseId: row.id };
  }

  async markPurchaseFailed(sessionId: string): Promise<void> {
    await this.d1.prepare("UPDATE purchases SET status = 'failed' WHERE stripe_session_id = ?1 AND status = 'pending'").bind(sessionId).run();
  }

  // ---- access tokens ----

  async insertToken(tokenHash: string, reportId: string, ref: { purchaseId: number } | { watchId: number }): Promise<void> {
    const kind = "purchaseId" in ref ? "purchase" : "watch";
    await this.d1
      .prepare("INSERT INTO access_tokens (token_hash, report_id, kind, purchase_id, watch_id) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(tokenHash, reportId, kind, "purchaseId" in ref ? ref.purchaseId : null, "watchId" in ref ? ref.watchId : null)
      .run();
  }

  /** Resolve a token for a report. Returns the watch when the token is a watch token (any non-canceled status). */
  async resolveToken(reportId: string, tokenHash: string): Promise<{ kind: "purchase" } | { kind: "watch"; watch: WatchRow } | null> {
    const t = await this.d1.prepare("SELECT * FROM access_tokens WHERE report_id = ?1 AND token_hash = ?2").bind(reportId, tokenHash).first<TokenRow>();
    if (!t) return null;
    if (t.kind === "purchase") {
      const p = await this.d1.prepare("SELECT status FROM purchases WHERE id = ?1").bind(t.purchase_id).first<{ status: string }>();
      return p?.status === "paid" ? { kind: "purchase" } : null;
    }
    const w = await this.d1.prepare("SELECT * FROM watches WHERE id = ?1 AND status != 'canceled'").bind(t.watch_id).first<WatchRow>();
    return w ? { kind: "watch", watch: w } : null;
  }

  // ---- watches ----

  /** Insert a watch, or reactivate an existing one for the same subscription. Returns the row and whether it was created. */
  async upsertWatch(w: {
    reportId: string;
    bin: string;
    bbl: string;
    unit: string | null;
    addressLabel: string;
    email: string;
    customerId: string;
    subscriptionId: string;
    snapshot: WatchSnapshot;
  }): Promise<{ watch: WatchRow; created: boolean }> {
    const existing = await this.watchBySubscription(w.subscriptionId);
    if (existing) {
      if (existing.status !== "active") await this.setWatchStatus(w.subscriptionId, "active");
      return { watch: { ...existing, status: "active" }, created: false };
    }
    await this.d1
      .prepare(
        `INSERT OR IGNORE INTO watches (report_id, bin, bbl, unit, address_label, email, stripe_customer_id, stripe_subscription_id, status, last_snapshot_json, last_checked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10)`,
      )
      .bind(w.reportId, w.bin, w.bbl, w.unit, w.addressLabel, w.email, w.customerId, w.subscriptionId, JSON.stringify(w.snapshot), new Date().toISOString())
      .run();
    const watch = await this.watchBySubscription(w.subscriptionId);
    if (!watch) throw new Error("watch row missing after insert");
    return { watch, created: true };
  }

  async setWatchStatus(subscriptionId: string, status: WatchRow["status"]): Promise<void> {
    await this.d1.prepare("UPDATE watches SET status = ?2 WHERE stripe_subscription_id = ?1").bind(subscriptionId, status).run();
  }

  async watchBySubscription(subscriptionId: string): Promise<WatchRow | null> {
    return (await this.d1.prepare("SELECT * FROM watches WHERE stripe_subscription_id = ?1").bind(subscriptionId).first<WatchRow>()) ?? null;
  }

  async activeWatchForBin(bin: string, unit: string | null): Promise<WatchRow | null> {
    return (await this.d1.prepare("SELECT * FROM watches WHERE bin = ?1 AND (unit IS ?2) AND status = 'active' LIMIT 1").bind(bin, unit).first<WatchRow>()) ?? null;
  }

  async listActiveWatches(limit = 200, offset = 0): Promise<WatchRow[]> {
    const res = await this.d1.prepare("SELECT * FROM watches WHERE status IN ('active','past_due') ORDER BY id LIMIT ?1 OFFSET ?2").bind(limit, offset).all<WatchRow>();
    return res.results;
  }

  async updateWatchSnapshot(id: number, snapshot: WatchSnapshot, alerted: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.d1
      .prepare("UPDATE watches SET last_snapshot_json = ?2, last_checked_at = ?3, last_alert_at = CASE WHEN ?4 = 1 THEN ?3 ELSE last_alert_at END WHERE id = ?1")
      .bind(id, JSON.stringify(snapshot), now, alerted ? 1 : 0)
      .run();
  }

  // ---- stripe idempotency ----

  /** Returns true if the event is new (and records it), false if already processed. */
  async recordStripeEvent(id: string, type: string): Promise<boolean> {
    const res = await this.d1.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?1, ?2)").bind(id, type).run();
    return (res.meta.changes ?? 0) > 0;
  }
}
