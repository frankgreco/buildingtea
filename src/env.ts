/** Worker bindings and secrets. Mirrors wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  SEARCH_LIMITER: RateLimiter;

  APP_NAME: string;
  CANONICAL_HOST: string;
  EMAIL_FROM: string;

  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_REPORT: string;
  STRIPE_PRICE_WATCH: string;
  /** BuildingTea's own Customer Portal configuration (bpc_...); without it Stripe uses the account default. */
  STRIPE_PORTAL_CONFIG?: string;

  SOCRATA_APP_TOKEN?: string;
  RESEND_API_KEY?: string;

  /** OpenRouter key (OpenAI-compatible API). Summary rewrite is skipped when unset. */
  OPENAI_API_KEY?: string;
}

/** Cloudflare's rate limiting binding (declared under "ratelimits" in wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
