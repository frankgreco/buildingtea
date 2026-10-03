// Preview-only entry for scripts/page-preview.ts: renders one screen with sample data through
// the real view code, with the network stubbed so the pages click through to each other
// offline. main.ts never imports this, so it stays out of the production bundle.

import { withUnit } from "@shared/address";
import type { Candidate, Report, Teaser } from "@shared/types";
import { SUPPORT_EMAIL } from "./legal";
import { renderCandidates, renderError, renderLegal, renderReport, renderSearch, renderTeaser, renderUnlocking } from "./render";

interface PreviewData {
  screen: string;
  report: Report;
  teaser: Teaser;
}

const data = (window as unknown as { __BT_PREVIEW__: PreviewData }).__BT_PREVIEW__;
const app = document.getElementById("app")!;
const go = (screen: string) => location.assign(`${screen}.html`);
const onNew = () => go("home");

// Copies of the messages main.ts and the search API show; main.ts runs on import, so it can't export them.
const NOT_CONFIRMED = "We couldn't confirm the payment. If you were charged, the link to your report is in your email.";
const NO_MATCH = "We couldn't find that address in the city's address directory.";

// Real GeoSearch rows for "143 w", in its response shape.
const SUGGEST_TYPED = "143 w";
const SUGGESTIONS = {
  features: [
    ["WEST 143 STREET", "Manhattan", "10030", "Central Harlem", "1060134"],
    ["WINDSOR PLACE", "Brooklyn", "11215", "Windsor Terrace", "3000000"],
    ["WARREN STREET", "Brooklyn", "11201", "Cobble Hill", "3003214"],
    ["WOLCOTT STREET", "Brooklyn", "11231", "Red Hook", "3000000"],
    ["WILLOW STREET", "Brooklyn", "11201", "Brooklyn Heights", "3001789"],
    ["WESTCHESTER SQUARE", "Bronx", "10461", "Westchester", "2000000"],
  ].map(([street, borough, postalcode, neighbourhood, bin]) => ({
    properties: { label: `143 ${street}, ${borough === "Manhattan" ? "New York" : borough}, NY, USA`, housenumber: "143", street, postalcode, borough, neighbourhood, addendum: { pad: { bin } } },
  })),
};

const CANDIDATES: Candidate[] = [
  { label: "100 BROADWAY, New York, NY", borough: "Manhattan", zip: "10005", bin: "1001026", bbl: "1000477501" },
  { label: "100 BROADWAY, Brooklyn, NY", borough: "Brooklyn", zip: "11249", bin: "3062000", bbl: "3021340001" },
  { label: "100 BROADWAY, Staten Island, NY", borough: "Staten Island", zip: "10310", bin: "5005000", bbl: "5001920001" },
];

// Checkout "redirects" to the unlocking screen, which then lands on the report; other API calls never answer.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://geosearch.planninglabs.nyc/") && data.screen === "home-autocomplete") return Response.json(SUGGESTIONS);
  if (url === "/api/checkout") {
    await new Promise((r) => setTimeout(r, 700));
    return Response.json({ url: "unlocking.html#next=report" });
  }
  if (url === "/api/sample") return Response.json({ report: data.report });
  if (url.startsWith("/api/")) return new Promise<Response>(() => {});
  return realFetch(input, init);
};

// In-app links: footer pages route to their preview files.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[data-nav]");
  if (!a) return;
  e.preventDefault();
  go((a.getAttribute("href") ?? "").slice(1) || "home");
});

// The gallery page sets the colour scheme of every frame.
window.addEventListener("message", (e) => {
  const theme = (e.data as { btTheme?: string } | null)?.btTheme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else if (theme === "system") delete document.documentElement.dataset.theme;
});

// Framed in the gallery, focusing an input must not scroll the gallery to that frame.
if (window.top !== window) {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (opts?: FocusOptions) {
    focus.call(this, { ...opts, preventScroll: true });
  };
}

function search(address: string) {
  renderSearch(app, { onSubmit: search, busy: true, value: address });
  setTimeout(() => go("teaser"), 1200);
}

// What the search box holds after picking a suggestion for the sample building.
const typed = withUnit(data.teaser.address.label, data.teaser.address.unit);

const screens: Record<string, () => void> = {
  home: () => renderSearch(app, { onSubmit: search }),
  "home-autocomplete": () => {
    renderSearch(app, { onSubmit: search });
    const input = app.querySelector<HTMLInputElement>("#addr")!;
    // The dropdown only opens for the focused input, and a framed page can't take focus on its own.
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => input });
    input.value = SUGGEST_TYPED;
    input.dispatchEvent(new Event("input"));
    setTimeout(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })), 400);
  },
  "home-busy": () => renderSearch(app, { onSubmit: search, busy: true, value: typed }),
  "home-error": () => renderSearch(app, { onSubmit: search, value: "1 Fake Street", error: NO_MATCH }),
  candidates: () => renderCandidates(app, CANDIDATES, () => go("teaser")),
  teaser: () => renderTeaser(app, data.teaser, { onNew }),
  unlocking: () => {
    renderUnlocking(app);
    const next = /next=([a-z-]+)/.exec(location.hash)?.[1];
    if (next) setTimeout(() => go(next), 1500);
  },
  "not-confirmed": () =>
    renderError(app, {
      title: "We ran into an issue",
      message: NOT_CONFIRMED,
      primary: { label: "Try again", onClick: () => go("unlocking") },
      secondary: { label: "Back", onClick: () => go("teaser") },
      onNew,
    }),
  report: () => renderReport(app, data.report, { onNew }),
  "not-found": () =>
    renderError(app, {
      title: "We couldn't find that",
      primary: { label: "New search", onClick: onNew },
      secondary: { label: "Contact support", href: `mailto:${SUPPORT_EMAIL}` },
      onNew,
    }),
  privacy: () => renderLegal(app, "privacy", { onNew }),
  terms: () => renderLegal(app, "terms", { onNew }),
};

const render = screens[data.screen];
if (!render) throw new Error(`Unknown preview screen: ${data.screen}`);
render();
