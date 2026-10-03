# BuildingTea

Paste a New York City address, get a plain-English report on the building from the city's own public records: open violations, heat complaints, bedbugs, elevators, who the landlord is, any court cases, and noise complaints. Free to look up; pay once to unlock the full report.

- Canonical site: `buildingtea.com` (`buildingteanyc.com` and the `www.` hosts redirect there)
- Data map and verification notes: [`docs/RESEARCH.md`](docs/RESEARCH.md)
- Status rules: [`docs/RULES.md`](docs/RULES.md)

## How it works

```
address ──▶ GeoSearch ──▶ BIN + BBL ──▶ 29 parallel NYC Open Data queries ───▶ Report + Teaser ──▶ D1
                                                                                     │
   teaser (free) ◀── GET /api/report/:id ──────────────────────────────────────────┘
   full report  ◀── GET /api/report/:id  + Authorization: Bearer <token>
```

1. As the user types, the browser asks GeoSearch's autocomplete endpoint directly (free, no key, CORS-open; `shared/suggest.ts`, `web/src/autocomplete.ts`) and shows a dropdown of real NYC addresses, so what gets submitted is something we can resolve. `POST /api/search` then resolves the address with NYC Planning's GeoSearch, fans out the Socrata queries listed in `src/lib/datasets.ts`, computes the report (`src/lib/compute.ts`), stores it, and returns only the teaser.
2. The page shows the teaser: the report's own layout with most of it locked. What is free is the first sentence of the summary, the number of open violations, the building facts, the newest complaint, violation and legal record as one sample row each, and the owner and manager. Nothing else from the report is sent before a purchase.
3. `POST /api/checkout` creates a Stripe Checkout Session with the report id as `client_reference_id`.
4. Stripe redirects back to `/r/:id?session_id=…`. The page calls `GET /api/report/:id/claim`, which verifies the session with Stripe, fulfils idempotently, and returns an access token. The Stripe webhook does the same fulfilment and is the source of truth if the user never lands on the success page.
5. The full report is served to any request carrying a valid token. The token is also emailed as a link so the user can come back from any device.

### How access works (no accounts)

There is no user table. The purchase is the identity and the token is the credential.

- Report ids are random, public, and not secret. The teaser lives at `/r/:id`.
- On payment the server mints a 256-bit token, stores only its SHA-256 hash in `access_tokens`, and emails the link `/r/:id#t=<token>`. The page moves the token into `localStorage` and strips it from the URL.
- A report can have several valid tokens (one per emailed link, one per claim), and all of them keep working.

### Why these choices

- **TypeScript + Hono on Cloudflare Workers.** The runtime is V8; every binding (D1, KV, static assets, rate limiting) is typed. One Worker serves both the API and the built frontend from one origin, so there is no CORS.
- **D1, not Postgres.** Three small tables. D1 is durable, has 30-day point-in-time restore, and no free-tier pausing.
- **No mirror of the city data.** Every search hits NYC Open Data live (sub-second per query); nothing needs a multi-million-row copy.
- **No Terraform.** `wrangler.jsonc` already declares every resource, and `wrangler deploy` applies it. Stripe objects are created by an idempotent script. GitHub Actions is the only other moving part.
- **Deterministic first, AI second.** Every number and status is computed in code and unit-tested. The optional AI pass does two things, only for paid reports and after the response: it rewrites the summary paragraph from the computed facts, and it gives the last twelve months' violation and complaint rows shorter names from the city's own wording (`src/lib/naming.ts`). Either output is rejected if it introduces a number that isn't in its input, and a rejected name leaves the rule-written one in place; the city's wording is always shown in the opened row.

## Repository layout

```
src/              Worker: routes, pipeline, status rules, Stripe, D1, email
  index.ts        entry (host redirect, /api, static assets)
  routes/api.ts   search / report / checkout / claim / webhook
  lib/compute.ts  raw city rows -> Report, Teaser
  lib/datasets.ts the exact Socrata queries
shared/types.ts   wire types shared with the frontend
web/              Vite + TypeScript frontend (no framework), builds to web/dist; ECharts
                  (web/src/echart.ts) loads on demand for the report's two history charts
migrations/       D1 schema
scripts/          stripe-setup.ts (idempotent product, price, webhook)
test/             Vitest unit tests for the pure modules
docs/             RESEARCH.md (data map), RULES.md (status rules)
.github/          check.yml (PRs), deploy.yml (main -> Cloudflare)
```

## Local development

Requirements: Node 22+, pnpm (via corepack), a Cloudflare account (free), a Stripe sandbox.

```bash
pnpm install
cp .dev.vars.example .dev.vars        # sandbox Stripe values (see Stripe setup)
pnpm migrate:local                    # creates the local D1 database
pnpm dev                              # builds the frontend and starts wrangler dev on :8787
```

Two secret files, both gitignored: `.dev.vars` holds **sandbox** values and is what `wrangler dev` reads; `.prod.vars` holds **live** values and is what gets pushed to the deployed Worker (`pnpm exec wrangler secret bulk .prod.vars`) and copied into GitHub Actions secrets. Never put a live key in `.dev.vars`.

`pnpm dev:web` runs Vite with hot reload on :5173, proxying `/api` to the Worker.

`pnpm pages:preview` renders every screen (search, teaser, report, errors, legal) with a report from the local database to `/tmp/buildingtea-pages/index.html`, framed at phone and desktop width with a light/dark switch. The pages run the real view code and click through to each other offline.

Checks: `pnpm check` runs typecheck, tests, the frontend build, and a dry-run deploy.

To exercise Stripe locally, forward webhooks: `stripe listen --forward-to localhost:8787/api/stripe/webhook` and put the printed `whsec_` in `.dev.vars`.

## Stripe setup

Create a sandbox (`stripe sandbox create` works without an account), make a **restricted** API key with write access to Products, Prices, Checkout Sessions, Customers and Webhook Endpoints, then:

```bash
STRIPE_SECRET_KEY=rk_test_... APP_URL=https://buildingtea.com pnpm stripe:setup
```

It creates the report product (with the tax code Stripe Managed Payments requires), its price and the webhook endpoint, and prints `STRIPE_PRICE_REPORT` and (on first run) `STRIPE_WEBHOOK_SECRET`.

The Stripe account is shared with Essence. Webhook endpoints are account-wide, so each app's endpoint also receives the other's events; BuildingTea ignores sessions with no matching report and every session that isn't a one-time payment, and Essence ignores customers that belong to none of its organizations. Re-running never duplicates anything. Run it once with a sandbox key (values go in `.dev.vars`) and once with the live key (values go in `.prod.vars`).

This account has Stripe **Managed Payments** enabled: Stripe is the merchant of record, adds sales tax at checkout (so a $6 report shows as $6.53 in NYC), and handles tax filing. Every product therefore needs a `tax_code`, which the script sets.

## Deploying

One-time, from your machine with `wrangler login`:

```bash
pnpm exec wrangler d1 create buildingtea          # paste database_id into wrangler.jsonc
pnpm exec wrangler kv namespace create CACHE      # paste id into wrangler.jsonc
```

Both domains must be zones in your Cloudflare account (buying through Cloudflare Registrar does this). `wrangler deploy` then attaches them as custom domains from the `routes` block in `wrangler.jsonc` and issues certificates. The Worker redirects every non-canonical host to `buildingtea.com`, so there is one origin and no CORS.

In GitHub, create a `production` environment and add these repository secrets:

| Secret | Required | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | Workers Scripts:Edit, D1:Edit, Workers KV Storage:Edit, Account Settings:Read |
| `CLOUDFLARE_ACCOUNT_ID` | yes | |
| `STRIPE_SECRET_KEY` | yes | restricted key, live mode |
| `STRIPE_WEBHOOK_SECRET` | yes | from `stripe:setup` |
| `STRIPE_PRICE_REPORT` | yes | from `stripe:setup` |
| `SOCRATA_APP_TOKEN` | recommended | free; register at data.cityofnewyork.us → profile → Developer Settings |
| `RESEND_API_KEY` | recommended | without it, emails are logged, not sent |
| `OPENAI_API_KEY` | optional | OpenRouter key; enables the AI-written summary and row names for paid reports. Models and endpoint are fixed in `src/lib/llm.ts` (`anthropic/claude-fable-5.1` for the summary, `anthropic/claude-haiku-4.5` for names) |

Every push to `main` runs `.github/workflows/deploy.yml`: typecheck, tests, frontend build, D1 migrations, push secrets into the Worker, deploy, smoke test. Pull requests run `check.yml` with no secrets.

### Email

One transactional email goes out through [Resend](https://resend.com): the unlock link after a report purchase. The template is in `src/lib/email.ts`; `pnpm email:preview` renders it to `/tmp/buildingtea-emails`. Until `RESEND_API_KEY` is set, emails are only logged.

1. In Resend, add the domain `buildingtea.com` and add the DNS records it lists (DKIM, plus SPF and MX on its sending subdomain) in Cloudflare DNS. Wait for Resend to show the domain as verified.
2. Create an API key with sending access, limited to that domain. Add it as the `RESEND_API_KEY` GitHub secret (and to `.prod.vars`). The next push to `main` pushes it into the Worker.
3. Send yourself the sample to check real inboxes: `RESEND_API_KEY=re_... pnpm email:preview --send you@example.com`.

The landing page shows a sample under the search box: a full, unlocked report on `SAMPLE_ADDRESS` (a var in `wrangler.jsonc`; remove it to show none). `GET /api/sample` serves it from the database under a fixed id, builds it on the first request, and rebuilds it behind the response once it is 30 days old (`sampleReport` in `src/lib/pipeline.ts`), so it never describes a real building with months-old records. It gets the same AI summary and row names as a paid report.

The sender is `EMAIL_FROM` in `wrangler.jsonc` (`BuildingTea <no-reply@buildingtea.com>`); replies are not received. The footer's Contact link and the legal pages point to the support address in `web/src/legal.ts`.

## Operations

- **Cost.** Workers, D1, KV and static hosting are all on Cloudflare's free tier at this scale. A report build is 29 city-data requests (28 in parallel, then the registration contacts), plus 8 dataset stamps when the KV cache is cold. Domains are the only fixed cost.
- **Backups.** D1 keeps 30 days of point-in-time history (`pnpm exec wrangler d1 time-travel`). For an off-platform copy, `pnpm exec wrangler d1 export buildingtea --remote --output backup.sql`.
- **Logs.** `pnpm exec wrangler tail` streams the Worker; observability is enabled in `wrangler.jsonc`.
- **Email failures.** Every send carries an idempotency key, so retries never duplicate an email. Transient Resend failures are retried in place. A receipt that still fails is logged and not sent again; search the logs for `receipt email`.
- **Upstream outages.** A failed dataset doesn't fail a search; the report notes the section as unavailable. If GeoSearch is down, search returns `upstream` and the page says so.
- **Data freshness.** Reports are reused for 24 hours per building+unit.
