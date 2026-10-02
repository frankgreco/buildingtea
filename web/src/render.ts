// All page rendering. Data in, DOM out. No framework: three views and a handful of
// partials are not worth a dependency.

import type { Candidate, Card, LineItem, Report, Status, Teaser } from "@shared/types";
import { checkout } from "./api";
import { complaintsChart, violationsChart } from "./charts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const STATUS_ICON: Record<Status, string> = { good: "✓", warn: "!", serious: "!", critical: "✕", neutral: "–" };
const CARD_ICON: Record<Card["key"], string> = {
  safe: "<svg viewBox='0 0 24 24'><path d='M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z'/><path d='m9 12 2 2 4-4' class='s'/></svg>",
  heat: "<svg viewBox='0 0 24 24'><path d='M12 2c1 4-3 6-3 10a3 3 0 0 0 6 0c0-2-1-3-1-3s3 2 3 6a5 5 0 1 1-10 0c0-6 5-8 5-13z'/></svg>",
  pests: "<svg viewBox='0 0 24 24'><ellipse cx='12' cy='13' rx='6' ry='8'/><circle cx='12' cy='5' r='3'/><path d='M6 10 2 8M6 14H2M6 18l-4 2M18 10l4-2M18 14h4M18 18l4 2' class='s'/></svg>",
  elev: "<svg viewBox='0 0 24 24'><rect x='4' y='2' width='16' height='20' rx='2'/><path d='M9 10V7l-2 2M9 7l2 2M15 14v3l-2-2M15 17l2-2' class='s w'/></svg>",
  owner: "<svg viewBox='0 0 24 24'><circle cx='8' cy='9' r='5'/><path d='M12 9h10v3h-2v2h-2v-2h-2v3h-2' class='s'/></svg>",
  legal: "<svg viewBox='0 0 24 24'><path d='M12 3v18M5 7h14M8 21h8' class='s'/><path d='M5 7 2 14h6zM19 7l-3 7h6z'/></svg>",
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

// ---------- partials ----------

function topbar(onNew: () => void): HTMLElement {
  const div = document.createElement("div");
  div.className = "top";
  div.innerHTML = `<a class="brand" href="/"><span class="dot">⌂</span> BuildingTea</a><button class="pill-btn" type="button">New search</button>`;
  div.querySelector("a")!.onclick = (e) => {
    e.preventDefault();
    onNew();
  };
  div.querySelector("button")!.onclick = onNew;
  return div;
}

function hero(t: Teaser | Report): string {
  const a = t.address,
    c = t.cover;
  const facts: [string, string][] = [];
  if (c.yearBuilt) facts.push(["Built", String(c.yearBuilt)]);
  if (c.floors) facts.push(["Floors", String(c.floors)]);
  if (c.unitsRes != null) facts.push(["Apartments", String(c.unitsRes)]);
  facts.push(["Type", c.elevators > 0 ? "Elevator bldg" : c.floors && c.floors <= 6 ? "Walk-up" : "Building"]);
  if (c.elevators > 0) facts.push(["Elevators", String(c.elevators)]);
  if (c.buildingsOnLot && c.buildingsOnLot > 1) facts.push(["Buildings on lot", String(c.buildingsOnLot)]);
  if (c.historicDistrict) facts.push(["Extra", "Historic district"]);
  const street = `${a.houseNumber} ${titleCase(a.street)}`.trim();
  return `<header class="hero">
    <div class="kicker">Building report · ${esc(fmtDate(t.generatedAt))}</div>
    <h1><span class="hl">${esc(street || a.label)}</span>${a.unit ? `<span class="unit-chip">#${esc(a.unit)}</span>` : ""}</h1>
    <div class="sub">${esc([a.borough, a.zip].filter(Boolean).join(" "))}${a.lotOnly ? " · lot-level data only" : ""}</div>
    <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small>${esc(v)}</div>`).join("")}</div>
  </header>`;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n, suf) => `${n}${suf.toLowerCase()}`);
}

function statusPill(status: Status, label: string): string {
  return `<span class="status ${status}"><i aria-hidden="true">${STATUS_ICON[status]}</i>${esc(label)}</span>`;
}

function cardsHtml(cards: Card[]): string {
  return cards
    .map(
      (c) => `<section class="card q">
      <div class="head"><div class="titleRow"><div class="icon" aria-hidden="true">${CARD_ICON[c.key]}</div><h3>${esc(c.question)}</h3></div>${statusPill(c.status, c.label)}</div>
      <p class="ans">${esc(c.answer)}</p>
      ${c.details.length ? `<details><summary>Details</summary><ul>${c.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}
    </section>`,
    )
    .join("");
}

function itemsHtml(items: LineItem[]): string {
  if (!items.length) return `<p class="chart-sub">Nothing open on file.</p>`;
  return `<ul class="items">${items
    .map(
      (it) => `<li class="item"><div class="sev ${it.severity}" aria-hidden="true"></div><div>
      <div class="what">${esc(it.what)}</div>
      <div class="meta">${esc([it.where, fmtDay(it.date), it.state].filter(Boolean).join(" · "))}</div>
      ${it.original ? `<details><summary>Original wording</summary><p>${esc(it.original)}</p></details>` : ""}
    </div></li>`,
    )
    .join("")}</ul>`;
}

function chartCard(id: string, title: string, sub: string): string {
  return `<section class="card" id="${id}">
    <div class="chart-head"><h2>${esc(title)}</h2>
      <div class="toggle" role="group" aria-label="View"><button type="button" aria-pressed="true" data-view="chart">Chart</button><button type="button" aria-pressed="false" data-view="table">Table</button></div>
    </div>
    <p class="chart-sub">${esc(sub)}</p>
    <div class="chart-wrap" data-chart></div>
    <div class="legend" data-legend></div>
    <div data-table class="hidden"></div>
  </section>`;
}

function sourcesHtml(t: Teaser | Report): string {
  return `<section class="card"><h2>Where this comes from</h2><ul class="sources">${t.sources
    .map((s) => `<li>${esc(s.name)}: ${s.updatedAt ? `updated ${esc(fmtDate(s.updatedAt))}` : "update date unavailable"}</li>`)
    .join("")}</ul>
    <p class="fine">Records are public data published by New York City agencies and can lag or contain errors. Nothing here is legal advice. No score is assigned; read the details.</p></section>`;
}

// ---------- views ----------

export function renderSearch(root: HTMLElement, opts: { onSubmit: (address: string) => void; busy?: boolean; value?: string; error?: string }) {
  root.innerHTML = "";
  root.appendChild(topbar(() => renderSearch(root, { onSubmit: opts.onSubmit })));
  const div = document.createElement("div");
  div.innerHTML = `<header class="hero home">
      <div class="kicker">NYC apartments</div>
      <h1>Know the <span class="hl">building</span> before you sign.</h1>
      <p class="sub big">Paste the address of any New York City apartment. We pull the city's own records on violations, heat, bedbugs, elevators, the landlord, and court cases, and explain them in plain English.</p>
    </header>
    <form class="card search" id="searchForm">
      <label for="addr" class="kicker">Street address</label>
      <input id="addr" name="address" type="text" inputmode="text" autocomplete="street-address" placeholder="143 W 4th St #3FW, New York, NY" value="${esc(opts.value ?? "")}" ${opts.busy ? "disabled" : ""} required minlength="5" maxlength="200">
      <button class="btn primary" type="submit" ${opts.busy ? "disabled" : ""}>${opts.busy ? "Checking the city's records…" : "Check this building"}</button>
      ${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ""}
      <p class="fine">Include the borough or zip. Apartment number optional but useful.</p>
    </form>
    <section class="card">
      <h2>What you get</h2>
      <ul class="plain">
        <li><b>Is it safe?</b> Open hazardous conditions, with dates, so stale ones don't scare you.</li>
        <li><b>Does the heat work?</b> Heat and hot water complaints, month by month.</li>
        <li><b>Pests & bedbugs.</b> The landlord's required annual bedbug report and any pest violations.</li>
        <li><b>Who's the landlord?</b> The registered owner and managing agent, and whether the registration is current.</li>
        <li><b>Any legal trouble?</b> Court cases, city fines, vacate orders, evictions.</li>
      </ul>
    </section>
    <p class="fine center">Free to look up. Pay once to unlock the full report, or watch the building for alerts.</p>`;
  root.appendChild(div);
  const form = div.querySelector<HTMLFormElement>("#searchForm")!;
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = (div.querySelector<HTMLInputElement>("#addr")!.value || "").trim();
    if (v.length >= 5) opts.onSubmit(v);
  };
  if (!opts.busy) div.querySelector<HTMLInputElement>("#addr")?.focus();
}

export function renderCandidates(root: HTMLElement, message: string, candidates: Candidate[], onPick: (label: string) => void) {
  root.innerHTML = "";
  root.appendChild(topbar(() => renderSearch(root, { onSubmit: onPick })));
  const div = document.createElement("div");
  div.innerHTML = `<header class="hero"><div class="kicker">Which one?</div><h1>${esc(message)}</h1></header>
    <div class="card"><div class="links">${candidates
      .map((c) => `<a href="#" data-label="${esc(c.label)}"><span>${esc(c.label)}<small class="muted"> · ${esc(c.borough)} ${esc(c.zip)}</small></span><span class="arrow">→</span></a>`)
      .join("")}</div></div>
    <p class="fine center">Not here? <a href="/" id="again">Try a different spelling</a>, and include the borough or zip.</p>`;
  root.appendChild(div);
  div.querySelectorAll<HTMLAnchorElement>("a[data-label]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      onPick(a.dataset.label!);
    };
  });
  div.querySelector<HTMLAnchorElement>("#again")!.onclick = (e) => {
    e.preventDefault();
    renderSearch(root, { onSubmit: onPick });
  };
}

export function renderUnlocking(root: HTMLElement) {
  root.innerHTML = `<div class="top"><span class="brand"><span class="dot">⌂</span> BuildingTea</span></div>
    <div class="card center"><h2>Unlocking your report…</h2><p class="chart-sub">Confirming the payment with Stripe. This takes a second or two.</p><div class="spinner" aria-hidden="true"></div></div>`;
}

export function renderError(root: HTMLElement, message: string, onBack: () => void) {
  root.innerHTML = "";
  root.appendChild(topbar(onBack));
  const div = document.createElement("div");
  div.innerHTML = `<div class="card center"><h2>Hmm.</h2><p class="chart-sub">${esc(message)}</p><button class="btn" type="button">Back</button></div>`;
  div.querySelector("button")!.onclick = onBack;
  root.appendChild(div);
}

export function renderTeaser(root: HTMLElement, t: Teaser, opts: { onNew: () => void }) {
  root.innerHTML = "";
  root.appendChild(topbar(opts.onNew));
  const div = document.createElement("div");
  const rc = t.recordCounts;
  div.innerHTML = `${hero(t)}
    <section class="card gist"><span class="tag">the gist</span><h2>In plain English</h2>
      <p class="fade">${esc(t.summaryLead)} <span class="blur">The rest of this summary, and every count below, is in the full report.</span></p>
      <div class="note">Written from the city records listed at the bottom. Every number is traceable to a public dataset.</div>
    </section>
    <section class="card counts"><h2>What we found</h2>
      <div class="facts">
        <div class="fact"><small>Housing records</small>${rc.housingRecords.toLocaleString("en-US")}</div>
        <div class="fact"><small>Buildings dept. records</small>${rc.buildingsRecords.toLocaleString("en-US")}</div>
        <div class="fact"><small>311 requests since 2020</small>${rc.complaints311.toLocaleString("en-US")}</div>
      </div>
      <p class="chart-sub">Open versus closed, dates, apartments, and names are in the full report.</p>
    </section>
    <div class="grid">${t.questions
      .map(
        (q) => `<section class="card q locked"><div class="head"><div class="titleRow"><div class="icon" aria-hidden="true">${CARD_ICON[q.key]}</div><h3>${esc(q.question)}</h3></div><span class="status neutral"><i aria-hidden="true">🔒</i>Locked</span></div>
        <p class="ans blur">Answered in the full report with the city's own records, dates, and apartment numbers.</p></section>`,
      )
      .join("")}</div>
    <section class="card locked-chart"><h2>Violations by year · Complaints by month</h2><p class="chart-sub">Twenty years of history and the last two winters, charted. In the full report.</p><div class="ghost-chart" aria-hidden="true"></div></section>
    ${sourcesHtml(t)}
    <div class="cta"><div class="in">
      <button class="btn primary wide" type="button" id="unlock">Unlock the full report<small>one-time payment · link emailed to you</small></button>
    </div></div>`;
  root.appendChild(div);
  const btn = div.querySelector<HTMLButtonElement>("#unlock")!;
  btn.onclick = () => startCheckout(btn, t.id, "report");
}

export function renderReport(root: HTMLElement, r: Report, opts: { watchActive: boolean; token: string | null; onNew: () => void }) {
  root.innerHTML = "";
  root.appendChild(topbar(opts.onNew));
  const div = document.createElement("div");
  div.innerHTML = `${hero(r)}
    <section class="card gist"><span class="tag">the gist</span><h2>In plain English</h2>
      <p>${esc(r.summary)}</p>
      <div class="unitline">${esc(r.unitNote)}</div>
      <div class="note">${r.summarySource === "ai" ? "Written by an AI from" : "Written from"} the city records listed at the bottom. Every number is traceable to a public dataset.</div>
    </section>
    <div class="grid">${cardsHtml(r.cards)}</div>
    ${chartCard("chart1", "Violations by year", "Conditions the city recorded at this building over 20 years. Darker = more serious. Paperwork notices excluded.")}
    ${chartCard("chart2", "Complaints by month", "Tenant complaints to the city, last 24 months. Winter months shaded.")}
    <section class="card"><h2>What's on file right now</h2><p class="chart-sub">Translated from the city's wording. Tap any item to see the original.</p>${itemsHtml(r.items)}</section>
    <section class="card"><h2>Check it yourself</h2><p class="chart-sub">These go to the city's own sites for this exact building.</p>
      <div class="links">${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}<span class="arrow">↗</span></a>`).join("")}</div></section>
    ${sourcesHtml(r)}
    <div class="cta"><div class="in">
      <button class="btn" type="button" id="pdf">Save as PDF<small>share with roommates</small></button>
      ${
        opts.watchActive
          ? `<a class="btn watching" href="/api/report/${esc(r.id)}/manage?t=${esc(opts.token ?? "")}">Watching ✓<small>manage or cancel</small></a>`
          : `<button class="btn primary" type="button" id="watch">Watch this building<small>alerts when anything changes</small></button>`
      }
    </div></div>`;
  root.appendChild(div);
  violationsChart(div.querySelector("#chart1")!, r.charts);
  complaintsChart(div.querySelector("#chart2")!, r.charts);
  div.querySelector<HTMLButtonElement>("#pdf")!.onclick = () => window.print();
  const watch = div.querySelector<HTMLButtonElement>("#watch");
  if (watch) watch.onclick = () => startCheckout(watch, r.id, "watch");
  window.scrollTo({ top: 0 });
}

async function startCheckout(btn: HTMLButtonElement, reportId: string, plan: "report" | "watch") {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Opening secure checkout…";
  try {
    const { url } = await checkout(reportId, plan);
    location.assign(url);
  } catch {
    btn.disabled = false;
    btn.innerHTML = original;
    alert("Checkout didn't open. Please try again.");
  }
}
