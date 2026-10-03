// Stripe on Workers: fetch-based HTTP client and SubtleCrypto for webhook signatures.
// Checkout Sessions are the only payment surface; no card data ever touches us.

import Stripe from "stripe";
import type { Env } from "../env";

/** The SDK pins its own current API version; we don't override it. */
export function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}

/** The smallest slice of ExecutionContext the fulfilment path needs (Hono and workers-types disagree on the full shape). */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Tags report sessions in the Dashboard so the funnel can be followed. */
const INTEGRATION_ID = "buildingtea_report_qkzmwvtp";

export async function createCheckout(env: Env, args: { reportId: string; origin: string; addressLabel: string }): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient(env);
  const success = `${args.origin}/r/${args.reportId}?session_id={CHECKOUT_SESSION_ID}&plan=report`;
  const cancel = `${args.origin}/r/${args.reportId}`;
  const params = {
    client_reference_id: args.reportId,
    success_url: success,
    cancel_url: cancel,
    metadata: { report_id: args.reportId, plan: "report", address: args.addressLabel.slice(0, 200) },
    integration_identifier: INTEGRATION_ID,
    // No payment_method_types: Stripe picks eligible methods (Apple Pay, Link, card...) dynamically.
    mode: "payment",
    line_items: [{ price: env.STRIPE_PRICE_REPORT, quantity: 1 }],
    customer_creation: "if_required",
  } satisfies Stripe.Checkout.SessionCreateParams & { integration_identifier: string };
  return stripe.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams);
}

export async function retrieveSession(env: Env, sessionId: string): Promise<Stripe.Checkout.Session> {
  return stripeClient(env).checkout.sessions.retrieve(sessionId);
}

export async function verifyWebhook(env: Env, rawBody: string, signature: string): Promise<Stripe.Event> {
  const stripe = stripeClient(env);
  return stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider());
}

export function sessionIsPaid(s: Stripe.Checkout.Session): boolean {
  return s.payment_status === "paid" || s.payment_status === "no_payment_required";
}
