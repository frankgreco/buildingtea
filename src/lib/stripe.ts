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

/** Tags sessions in the Dashboard so report vs watch funnels can be compared. */
const INTEGRATION_ID = { report: "buildingtea_report_qkzmwvtp", watch: "buildingtea_watch_hsrdnbyx" } as const;

export async function createCheckout(env: Env, args: { reportId: string; plan: "report" | "watch"; origin: string; addressLabel: string }): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient(env);
  const success = `${args.origin}/r/${args.reportId}?session_id={CHECKOUT_SESSION_ID}&plan=${args.plan}`;
  const cancel = `${args.origin}/r/${args.reportId}`;
  const common = {
    client_reference_id: args.reportId,
    success_url: success,
    cancel_url: cancel,
    metadata: { report_id: args.reportId, plan: args.plan, address: args.addressLabel.slice(0, 200) },
    integration_identifier: INTEGRATION_ID[args.plan],
    // No payment_method_types: Stripe picks eligible methods (Apple Pay, Link, card...) dynamically.
  } satisfies Partial<Stripe.Checkout.SessionCreateParams> & { integration_identifier: string };

  if (args.plan === "report") {
    return stripe.checkout.sessions.create({
      ...common,
      mode: "payment",
      line_items: [{ price: env.STRIPE_PRICE_REPORT, quantity: 1 }],
      customer_creation: "if_required",
    } as Stripe.Checkout.SessionCreateParams);
  }
  return stripe.checkout.sessions.create({
    ...common,
    mode: "subscription",
    line_items: [{ price: env.STRIPE_PRICE_WATCH, quantity: 1 }],
    subscription_data: { metadata: { report_id: args.reportId } },
  } as Stripe.Checkout.SessionCreateParams);
}

export async function retrieveSession(env: Env, sessionId: string): Promise<Stripe.Checkout.Session> {
  return stripeClient(env).checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
}

export async function verifyWebhook(env: Env, rawBody: string, signature: string): Promise<Stripe.Event> {
  const stripe = stripeClient(env);
  return stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider());
}

export async function portalUrl(env: Env, customerId: string, returnUrl: string): Promise<string> {
  const session = await stripeClient(env).billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

export function sessionIsPaid(s: Stripe.Checkout.Session): boolean {
  return s.payment_status === "paid" || s.payment_status === "no_payment_required";
}
