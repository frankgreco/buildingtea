// The HTTP API. Five routes plus a health check. See README "How access works".

import { Hono } from "hono";
import type Stripe from "stripe";
import type { CheckoutRequest, CheckoutResponse, ClaimResponse, Report, ReportResponse, SampleResponse, SearchRequest, SearchResponse, Teaser } from "@shared/types";
import type { Env } from "../env";
import { Db } from "../lib/db";
import { receiptEmail, sendEmail } from "../lib/email";
import { enhanceReport, sampleReport, search } from "../lib/pipeline";
import { createCheckout, retrieveSession, sessionIsPaid, verifyWebhook, type WaitUntil } from "../lib/stripe";
import { looksLikeToken, randomToken, sha256Hex } from "../lib/tokens";

type Ctx = { Bindings: Env };

export const api = new Hono<Ctx>();

api.get("/health", (c) => c.json({ ok: true, app: c.env.APP_NAME }));

// ---- 1. search: address -> teaser ----
api.post("/search", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "anon";
  const { success } = await c.env.SEARCH_LIMITER.limit({ key: ip });
  if (!success) return c.json<SearchResponse>({ ok: false, reason: "rate_limited", message: "Too many searches. Try again in a minute." }, 429);

  let body: SearchRequest;
  try {
    body = (await c.req.json()) as SearchRequest;
  } catch {
    return c.json<SearchResponse>({ ok: false, reason: "invalid", message: "Send JSON with an address field." }, 400);
  }
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (address.length < 5 || address.length > 200) return c.json<SearchResponse>({ ok: false, reason: "invalid", message: "Enter a street address." }, 400);

  try {
    const out = await search(c.env, address);
    if (!out.ok) return c.json<SearchResponse>({ ok: false, reason: out.reason, message: out.message, candidates: out.candidates });
    return c.json<SearchResponse>({ ok: true, reportId: out.report.id, teaser: out.teaser });
  } catch (err) {
    console.error("search failed", String(err));
    return c.json<SearchResponse>({ ok: false, reason: "upstream", message: "The city's data service didn't answer. Try again in a moment." }, 502);
  }
});

// ---- the landing page's sample: a full report on one fixed address, open to everyone ----
api.get("/sample", async (c) => {
  try {
    const report = await sampleReport(c.env, (work) => c.executionCtx.waitUntil(work.catch((e) => console.error("sample", String(e)))));
    if (!report) return c.json({ error: "no_sample" }, 404);
    // The same for every visitor, and it changes about once a month.
    c.header("cache-control", "public, max-age=3600");
    return c.json<SampleResponse>({ report });
  } catch (err) {
    console.error("sample failed", String(err));
    return c.json({ error: "upstream" }, 502);
  }
});

// ---- 2. report: teaser without a token, full report with one ----
api.get("/report/:id", async (c) => {
  const id = c.req.param("id");
  const db = new Db(c.env.DB);
  const row = await db.getReport(id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const teaser = JSON.parse(row.teaser_json) as Teaser;

  const token = bearer(c.req.header("authorization"));
  if (!looksLikeToken(token)) return c.json<ReportResponse>({ kind: "teaser", teaser });
  if (!(await db.resolveToken(id, await sha256Hex(token)))) return c.json<ReportResponse>({ kind: "teaser", teaser });

  const report = JSON.parse(row.report_json) as Report;
  return c.json<ReportResponse>({ kind: "full", report });
});

// ---- 3. checkout: create a Stripe Checkout Session ----
api.post("/checkout", async (c) => {
  let body: CheckoutRequest;
  try {
    body = (await c.req.json()) as CheckoutRequest;
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  if (body.plan !== "report") return c.json({ error: "invalid_plan" }, 400);
  const db = new Db(c.env.DB);
  const row = await db.getReport(String(body.reportId ?? ""));
  if (!row) return c.json({ error: "not_found" }, 404);
  const origin = requestOrigin(c.req.raw, c.env.CANONICAL_HOST);
  const session = await createCheckout(c.env, { reportId: row.id, origin, addressLabel: row.address_label });
  await db.insertPendingPurchase(row.id, session.id);
  if (!session.url) return c.json({ error: "stripe" }, 502);
  return c.json<CheckoutResponse>({ url: session.url });
});

// ---- 4. claim: the success page exchanges the session id for an access token ----
api.get("/report/:id/claim", async (c) => {
  const id = c.req.param("id");
  const sessionId = c.req.query("session_id") ?? "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return c.json<ClaimResponse>({ ok: false, reason: "unknown_session" }, 400);
  let session: Stripe.Checkout.Session;
  try {
    session = await retrieveSession(c.env, sessionId);
  } catch {
    return c.json<ClaimResponse>({ ok: false, reason: "unknown_session" }, 404);
  }
  if (session.client_reference_id !== id) return c.json<ClaimResponse>({ ok: false, reason: "mismatch" }, 400);
  if (!sessionIsPaid(session)) return c.json<ClaimResponse>({ ok: false, reason: "not_paid" }, 402);

  // Fulfil idempotently here too, so the user never waits on webhook delivery.
  const result = await fulfil(c.env, session, c.executionCtx);
  if (!result) return c.json<ClaimResponse>({ ok: false, reason: "not_paid" }, 402);
  return c.json<ClaimResponse>({ ok: true, token: result.token });
});

// ---- 5. Stripe webhook: the source of truth for fulfilment ----
api.post("/stripe/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.text("missing signature", 400);
  const raw = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await verifyWebhook(c.env, raw, sig);
  } catch (err) {
    console.warn("webhook signature failed", String(err));
    return c.text("bad signature", 400);
  }
  const db = new Db(c.env.DB);
  if (!(await db.recordStripeEvent(event.id, event.type))) return c.json({ received: true, duplicate: true });

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (sessionIsPaid(session)) await fulfil(c.env, session, c.executionCtx);
      break;
    }
    case "checkout.session.async_payment_failed": {
      await db.markPurchaseFailed(event.data.object.id);
      break;
    }
    default:
      break;
  }
  return c.json({ received: true });
});

// ---------- helpers ----------

function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim();
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Where Stripe should send the user back to. In production that is always the
 * canonical host. In `wrangler dev` the request URL carries the first custom
 * domain, so we trust a localhost Origin/Referer from the browser instead.
 * Only loopback origins are honoured, so this cannot become an open redirect.
 */
export function requestOrigin(req: Request, canonicalHost: string): string {
  const candidates = [req.headers.get("origin"), req.headers.get("referer"), req.url];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const o = new URL(c).origin;
      if (LOCAL_ORIGIN.test(o)) return o;
    } catch {
      /* ignore */
    }
  }
  return `https://${canonicalHost}`;
}

/**
 * Fulfil a paid Checkout Session: record the purchase, mint an access token,
 * and on the first fulfilment send the email and start the AI summary. Safe to call
 * more than once per session (webhook and claim both call it); each call mints its
 * own token, all of which stay valid.
 */
export async function fulfil(env: Env, session: Stripe.Checkout.Session, ctx: WaitUntil): Promise<{ token: string } | null> {
  // A report is a one-time payment; a session in any other mode is not one of ours to fulfil.
  if (session.mode !== "payment") return null;
  const db = new Db(env.DB);
  const reportId = session.client_reference_id ?? session.metadata?.report_id;
  if (!reportId) return null;
  const row = await db.getReport(reportId);
  if (!row) return null;
  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  const token = randomToken();
  const link = `https://${env.CANONICAL_HOST}/r/${reportId}#t=${token}`;
  const quiet = (p: Promise<unknown>, what: string) => ctx.waitUntil(p.catch((e) => console.error(what, String(e))));

  const { first, purchaseId } = await db.markPurchasePaid(session.id, reportId, email, customerId);
  await db.insertToken(await sha256Hex(token), reportId, purchaseId);
  console.log(`fulfil report session=${session.id} report=${reportId} first=${first} email=${email ? "yes" : "no"}`);
  if (first) {
    quiet(enhanceReport(env, reportId), "enhance");
    if (email) quiet(sendEmail(env, { to: email, ...receiptEmail({ appName: env.APP_NAME, addressLabel: row.address_label, link }) }, { idempotencyKey: `receipt/${session.id}` }), "receipt email");
  }
  return { token };
}
