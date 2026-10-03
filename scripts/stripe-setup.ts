// One-time, idempotent Stripe setup. Creates the report product, its price and the
// webhook endpoint if they don't exist, then prints the env values to store as
// GitHub Actions secrets. Safe to re-run; it never duplicates.
//
//   STRIPE_SECRET_KEY=rk_test_... APP_URL=https://buildingtea.com pnpm stripe:setup
//
// Optional: REPORT_PRICE_CENTS (default 600, a $6 report). A Stripe price can't be edited, so a new
// amount creates a new price: store the STRIPE_PRICE_REPORT this prints, and the old price stops
// being used.
// Use a sandbox key first (`stripe sandbox create` gives you one with no account).

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (a restricted key, rk_..., with write access to Products, Prices and Webhook Endpoints).");
  process.exit(1);
}
const appUrl = (process.env.APP_URL ?? "https://buildingtea.com").replace(/\/$/, "");
const reportCents = Number(process.env.REPORT_PRICE_CENTS ?? 600);

const stripe = new Stripe(key); // SDK-pinned API version

// Stripe Tax product code. Required when Managed Payments is on (Stripe acts as merchant of
// record and handles sales tax). txcd_10103000 = software as a service, personal use.
const TAX_CODE = process.env.STRIPE_TAX_CODE ?? "txcd_10103000";

async function ensureProduct(slug: string, name: string, description: string): Promise<Stripe.Product> {
  const found = await stripe.products.search({ query: `active:'true' AND metadata['buildingtea']:'${slug}'` });
  const existing = found.data[0];
  if (existing) {
    const update: Stripe.ProductUpdateParams = {};
    if (existing.tax_code !== TAX_CODE) update.tax_code = TAX_CODE;
    if (existing.description !== description) update.description = description;
    return Object.keys(update).length ? stripe.products.update(existing.id, update) : existing;
  }
  return stripe.products.create({ name, description, metadata: { buildingtea: slug }, tax_code: TAX_CODE });
}

async function ensurePrice(product: Stripe.Product, cents: number): Promise<Stripe.Price> {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find((p) => p.unit_amount === cents && p.currency === "usd" && !p.recurring);
  if (match) return match;
  return stripe.prices.create({ product: product.id, currency: "usd", unit_amount: cents });
}

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
];

async function ensureWebhook(url: string): Promise<{ endpoint: Stripe.WebhookEndpoint; created: boolean }> {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find((e) => e.url === url);
  if (existing) return { endpoint: existing, created: false };
  const endpoint = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, description: "BuildingTea fulfilment" });
  return { endpoint, created: true };
}

async function main() {
  const report = await ensureProduct("report", "BuildingTea building report", "One-time: the full plain-English report for one NYC building, with an emailed link and PDF.");
  const reportPrice = await ensurePrice(report, reportCents);
  const { endpoint, created } = await ensureWebhook(`${appUrl}/api/stripe/webhook`);

  console.log("\nStore these as GitHub Actions secrets (and in .dev.vars for local work):\n");
  console.log(`STRIPE_PRICE_REPORT=${reportPrice.id}`);
  if (created && endpoint.secret) console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
  else console.log(`STRIPE_WEBHOOK_SECRET=<existing endpoint ${endpoint.id}; reveal the signing secret in the Stripe Dashboard>`);
  console.log(`\nWebhook URL: ${endpoint.url}`);
  console.log(`Report: $${(reportCents / 100).toFixed(2)} one-time`);
  console.log("\nReminder: Stripe Tax is a separate decision. It needs an active tax registration before it collects anything.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
