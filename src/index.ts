// Worker entry. One Hono app serves the API under /api and hands everything else
// to the static asset server (the Vite build in web/dist). The two alias domains
// redirect to the canonical host so there is exactly one origin and no CORS.

import { Hono } from "hono";
import type { Env } from "./env";
import { api } from "./routes/api";
import { runWatches } from "./scheduled";

const app = new Hono<{ Bindings: Env }>();

// Canonical host redirect (buildingtea.com, buildingteanyc.com -> buildingtea.nyc).
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".workers.dev");
  if (!isLocal && host !== c.env.CANONICAL_HOST) {
    url.hostname = c.env.CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// Security headers for everything we serve.
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("x-frame-options", "DENY");
  if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
});

app.route("/api", api);

// Everything else is the SPA. not_found_handling=single-page-application serves index.html.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWatches(env, ctx));
  },
} satisfies ExportedHandler<Env>;
