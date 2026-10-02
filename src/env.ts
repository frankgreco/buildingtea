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

  SOCRATA_APP_TOKEN?: string;
  RESEND_API_KEY?: string;

  /** OpenRouter (OpenAI-compatible). Summary rewrite is skipped when unset. */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  LLM_MODEL?: string;
}

/** Cloudflare's rate limiting binding (declared under "ratelimits" in wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
