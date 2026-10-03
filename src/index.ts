// Worker entry. One Hono app serves the API under /api and hands everything else
// to the static asset server (the Vite build in web/dist). The two alias domains
// redirect to the canonical host so there is exactly one origin and no CORS.

import { Hono } from "hono";
import type { Env } from "./env";
import { api } from "./routes/api";

export const app = new Hono<{ Bindings: Env }>();

// Canonical host + https redirect (buildingteanyc.com, www hosts, and any plain-http
// request -> https://buildingtea.com). Local dev and the workers.dev preview are exempt.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".workers.dev");
  const insecure = url.protocol === "http:" || c.req.header("x-forwarded-proto") === "http";
  if (!isLocal && (host !== c.env.CANONICAL_HOST || insecure)) {
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
  // API responses are per visitor unless a route says otherwise (the public sample report does).
  if (c.req.path.startsWith("/api/") && !c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

app.route("/api", api);

// Everything else is the SPA. not_found_handling=single-page-application serves index.html.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
