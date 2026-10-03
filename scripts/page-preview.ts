// Renders every screen of the site to standalone HTML files, plus a gallery that frames them
// all at phone and desktop width, so layout and copy can be reviewed in a browser without the
// Worker. The pages run the real view code (web/src/render.ts) through web/src/preview.ts with
// the network stubbed, and click through to each other: search, teaser, checkout, report.
//
//   pnpm pages:preview                  -> /tmp/buildingtea-pages/index.html
//   pnpm pages:preview --id <reportId>  -> a specific report instead of the one with the most items
//   OUT_DIR=./tmp pnpm pages:preview
//
// The sample report is read from the local D1 database: run `pnpm dev` and search an address once.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const out = process.env.OUT_DIR ?? "/tmp/buildingtea-pages";
mkdirSync(out, { recursive: true });

const SCREENS: { id: string; title: string; when: string }[] = [
  { id: "home", title: "Home", when: "First visit." },
  { id: "home-autocomplete", title: "Home · typing", when: "Address suggestions from the city's directory as you type." },
  { id: "home-busy", title: "Home · searching", when: "After submitting, while the city's records load (a few seconds)." },
  { id: "home-error", title: "Home · no match", when: "The address isn't in the city's directory." },
  { id: "candidates", title: "Pick an address", when: "The address matches more than one building." },
  { id: "teaser", title: "Free preview", when: "Every search lands here. The unlock button opens Stripe Checkout." },
  { id: "unlocking", title: "Unlocking", when: "Back from Stripe Checkout while the payment is confirmed." },
  { id: "not-confirmed", title: "Payment not confirmed", when: "Stripe hasn't confirmed the payment after about 7 seconds." },
  { id: "report", title: "Full report", when: "After paying, or from the emailed link." },
  { id: "not-found", title: "Report not found", when: "A bad or deleted report link." },
  { id: "privacy", title: "Privacy", when: "Footer link." },
  { id: "terms", title: "Terms", when: "Footer link." },
];

// ---- sample data: one stored report from the local D1 database ----

const idArg = process.argv.includes("--id") ? process.argv[process.argv.indexOf("--id") + 1] : undefined;
if (idArg !== undefined && !/^[A-Za-z0-9]{8,32}$/.test(idArg)) throw new Error("usage: pnpm pages:preview --id <reportId>");
// A report can approach D1's 2 MB row cap; execFileSync's default 1 MB buffer would cut it off.
const sql = `SELECT report_json, teaser_json FROM reports ${idArg ? `WHERE id = '${idArg}'` : ""}
  ORDER BY json_array_length(report_json, '$.items') DESC, generated_at DESC LIMIT 1`;
const rows = JSON.parse(execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "buildingtea", "--local", "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 })) as {
  results: { report_json: string; teaser_json: string }[];
}[];
const row = rows[0]?.results[0];
if (!row) throw new Error(idArg ? `No report ${idArg} in the local database.` : "No reports in the local database. Run `pnpm dev` and search an address once.");
const report = JSON.parse(row.report_json);
const teaser = JSON.parse(row.teaser_json);

// ---- the preview bundle and the site's stylesheet ----

// One IIFE per page, so the chart library that the site loads with a dynamic import() (web/src/echart.ts)
// is inlined into it: the pages stay self-contained. Library mode leaves `process.env.NODE_ENV` for a
// consumer to replace, and echarts reads it, so it is defined here as the site build defines it.
const built = await build({
  configFile: false,
  logLevel: "warn",
  resolve: { alias: { "@shared": resolve("shared") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { write: false, minify: false, lib: { entry: resolve("web/src/preview.ts"), formats: ["iife"], name: "BuildingTeaPreview" } },
});
const output = (Array.isArray(built) ? built[0] : built) as { output: { type: string; code?: string }[] };
const bundle = output.output.find((o) => o.type === "chunk")?.code;
if (!bundle) throw new Error("Preview bundle came out empty.");

// The site follows the system colour scheme; the gallery can also force either one per frame.
const css = readFileSync("web/src/styles.css", "utf8");
const darkVars = /@media \(prefers-color-scheme: dark\) \{\s*:root:where\(:not\(\[data-theme="light"\]\)\) \{([^}]*)\}/.exec(css)?.[1];
if (!darkVars) throw new Error("Couldn't find the dark-mode block in styles.css; update the pattern in page-preview.ts.");
const pageCss = `${css}\n:root[data-theme="dark"] {${darkVars}}\n`;
const favicon = `data:image/svg+xml,${encodeURIComponent(readFileSync("web/public/favicon.svg", "utf8"))}`;

// Inline <script> bodies must not contain "</script".
const inline = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1");

for (const s of SCREENS) {
  const data = JSON.stringify({ screen: s.id, report, teaser }).replace(/</g, "\\u003c");
  writeFileSync(
    `${out}/${s.id}.html`,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${s.title} · BuildingTea preview</title>
<link rel="icon" href="${favicon}">
<style>${pageCss}</style>
</head>
<body>
<div id="app" class="wrap"></div>
<script>window.__BT_PREVIEW__ = ${data};</script>
<script>${inline(bundle)}</script>
</body>
</html>
`,
  );
}

// ---- the gallery ----

const sample = `${report.address.label}${report.address.unit ? ` #${report.address.unit}` : ""}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
writeFileSync(
  `${out}/index.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuildingTea · every screen</title>
<link rel="icon" href="${favicon}">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, -apple-system, sans-serif; background: #e9e6df; color: #16142b; }
  header { position: sticky; top: 0; z-index: 2; background: #16142b; color: #fff3df; padding: 12px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; }
  header h1 { font-size: 17px; margin: 0; font-weight: 900; letter-spacing: -0.02em; }
  header .sample { font-size: 12px; opacity: 0.75; }
  header nav { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; flex-basis: 100%; }
  header nav a { color: #fff3df; opacity: 0.85; text-decoration: none; }
  header nav a:hover { opacity: 1; text-decoration: underline; }
  .theme { margin-left: auto; display: inline-flex; border: 2px solid #fff3df; border-radius: 999px; overflow: hidden; }
  .theme button { border: 0; background: transparent; color: #fff3df; font: inherit; font-size: 12px; font-weight: 800; padding: 4px 10px; cursor: pointer; }
  .theme button[aria-pressed="true"] { background: #fff3df; color: #16142b; }
  main { padding: 8px 24px 64px; }
  section { padding: 22px 0 6px; border-bottom: 1px solid #d3cfc5; scroll-margin-top: 90px; }
  section h2 { margin: 0; font-size: 18px; font-weight: 900; letter-spacing: -0.02em; }
  section h2 small { font-size: 12px; color: #77736b; font-weight: 700; margin-right: 6px; }
  section p { margin: 2px 0 12px; color: #52514e; }
  section p a { font-weight: 800; color: #16142b; margin-left: 6px; }
  .frames { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .frame { display: flex; flex-direction: column; gap: 6px; }
  .frame span { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #77736b; }
  .phone iframe { width: 390px; height: 760px; border: 0; border-radius: 22px; box-shadow: 0 0 0 8px #16142b; background: #fff; }
  .phone { padding: 8px; }
  .desk { width: 720px; height: 450px; overflow: hidden; border-radius: 8px; box-shadow: 0 0 0 1px #16142b, 0 10px 30px rgba(0,0,0,0.12); background: #fff; }
  .desk iframe { width: 1440px; height: 900px; border: 0; transform: scale(0.5); transform-origin: 0 0; }
</style>
</head>
<body>
<header>
  <h1>BuildingTea · every screen</h1>
  <span class="sample">Sample: ${esc(sample)} (real city data from the local database). Each frame scrolls and clicks like the site.</span>
  <div class="theme" role="group" aria-label="Colour scheme"><button type="button" data-theme="system" aria-pressed="true">System</button><button type="button" data-theme="light" aria-pressed="false">Light</button><button type="button" data-theme="dark" aria-pressed="false">Dark</button></div>
  <nav>${SCREENS.map((s, i) => `<a href="#${s.id}">${i + 1}. ${esc(s.title)}</a>`).join("")}</nav>
</header>
<main>
${SCREENS.map(
  (s, i) => `<section id="${s.id}">
  <h2><small>${i + 1}</small>${esc(s.title)}</h2>
  <p>${esc(s.when)}<a href="${s.id}.html" target="_blank">Open full size ↗</a></p>
  <div class="frames">
    <div class="frame"><span>Phone · 390</span><div class="phone"><iframe src="${s.id}.html" title="${esc(s.title)} on a phone" loading="lazy"></iframe></div></div>
    <div class="frame"><span>Desktop · 1440 at half size</span><div class="desk"><iframe src="${s.id}.html" title="${esc(s.title)} on a desktop" loading="lazy" tabindex="-1"></iframe></div></div>
  </div>
</section>`,
).join("\n")}
<section>
  <h2>Not shown here</h2>
  <p>Stripe Checkout (hosted by Stripe), the receipt email (<code>pnpm email:preview</code>), and the PDF: press “Save as PDF” on a full report to see the real print preview.</p>
</section>
</main>
<script>
  let theme = "system";
  const frames = () => document.querySelectorAll("iframe");
  const send = (f) => f.contentWindow && f.contentWindow.postMessage({ btTheme: theme }, "*");
  frames().forEach((f) => f.addEventListener("load", () => send(f)));
  document.querySelectorAll(".theme button").forEach((b) => b.addEventListener("click", () => {
    theme = b.dataset.theme;
    document.querySelectorAll(".theme button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    frames().forEach(send);
  }));
</script>
</body>
</html>
`,
);

console.log(`${out}/index.html  (${SCREENS.length} screens, sample: ${sample})`);
