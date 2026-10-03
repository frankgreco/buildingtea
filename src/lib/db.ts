// D1 access. Every query in one place so the schema has a single consumer.

import type { Report, Teaser } from "@shared/types";

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

export interface TokenRow {
  token_hash: string;
  report_id: string;
  /** "purchase" on every token minted here; a row of any other kind unlocks nothing. */
  kind: string;
  purchase_id: number | null;
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

  /** Mint a token for a paid purchase. `kind` is NOT NULL in the schema; 'purchase' is the only kind written. */
  async insertToken(tokenHash: string, reportId: string, purchaseId: number): Promise<void> {
    await this.d1.prepare("INSERT INTO access_tokens (token_hash, report_id, kind, purchase_id) VALUES (?1, ?2, 'purchase', ?3)").bind(tokenHash, reportId, purchaseId).run();
  }

  /** Whether a token unlocks a report: it has to be one of the report's tokens, minted for a purchase that is paid. */
  async resolveToken(reportId: string, tokenHash: string): Promise<boolean> {
    const t = await this.d1.prepare("SELECT * FROM access_tokens WHERE report_id = ?1 AND token_hash = ?2").bind(reportId, tokenHash).first<TokenRow>();
    if (!t || t.kind !== "purchase") return false;
    const p = await this.d1.prepare("SELECT status FROM purchases WHERE id = ?1").bind(t.purchase_id).first<{ status: string }>();
    return p?.status === "paid";
  }

  // ---- stripe idempotency ----

  /** Returns true if the event is new (and records it), false if already processed. */
  async recordStripeEvent(id: string, type: string): Promise<boolean> {
    const res = await this.d1.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?1, ?2)").bind(id, type).run();
    return (res.meta.changes ?? 0) > 0;
  }
}
