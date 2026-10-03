// Privacy policy and terms, served at /privacy and /terms. Plain English and short on
// purpose. Edit the text here and bump LEGAL_EFFECTIVE when it changes materially.

export const SUPPORT_EMAIL = "frank@lifeisfake.com";
export const LEGAL_EFFECTIVE = "October 2, 2026";

const mail = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;

export const LEGAL: Record<"privacy" | "terms", { title: string; html: string }> = {
  privacy: {
    title: "Privacy",
    html: `<h2>What we collect</h2>
<ul>
<li>The address you search and the report we build from public city records.</li>
<li>If you buy a report, Stripe takes your email and payment details as the seller of record and tells us your email so we can send your link. We never see your card.</li>
<li>Standard request logs (IP address, browser) that Cloudflare keeps briefly to run and protect the site.</li>
<li>Cookie-free, aggregate traffic counts. No tracking cookies, no accounts, no ad pixels.</li>
</ul>
<h2>How we use it</h2>
<p>To build and deliver your report, to email you the link to it, and to keep the site running. We don't send marketing email, and we don't sell your information or share it for advertising.</p>
<h2>Who else handles it</h2>
<p>Stripe (payments and receipts), Resend (sends our email), Cloudflare (hosts the site), and OpenRouter, the AI service that writes the plain-English summary; it receives the building's public records and never your email. Address suggestions come from NYC Planning's GeoSearch service directly from your browser, so it sees what you type in the search box.</p>
<h2>Public records</h2>
<p>Reports repeat what New York City publishes on NYC Open Data about buildings and their registered owners and agents. That information is public and comes from the City, not from us.</p>
<h2>Keeping and deleting</h2>
<p>We keep reports and purchase records so your link keeps working. Email ${mail} to have your email address and anything tied to it deleted.</p>
<h2>Do Not Track</h2>
<p>We don't track you across other sites, so we treat every visitor the same whether or not your browser sends a Do Not Track signal.</p>
<h2>Changes and contact</h2>
<p>If this policy changes, we'll update the date above. Questions: ${mail}.</p>`,
  },
  terms: {
    title: "Terms",
    html: `<h2>What BuildingTea is</h2>
<p>Plain-English reports about New York City buildings, built from the City's public records, with a summary written by an AI. It's information to help you ask better questions. It isn't legal, financial, or professional advice, and it's no substitute for seeing the apartment and reading the lease.</p>
<h2>Accuracy</h2>
<p>City records can be late, incomplete, or filed against the wrong building or apartment, and the AI summary can get things wrong. We don't promise that any report is accurate or complete. Check anything that matters against the City's own sites, which every report links to.</p>
<h2>Not a consumer report</h2>
<p>BuildingTea isn't a consumer reporting agency, and reports aren't consumer reports under the Fair Credit Reporting Act. Don't use them to make decisions about anyone's housing, employment, credit, or insurance.</p>
<h2>Buying a report</h2>
<p>The one-time price is shown at checkout. Stripe is the seller of record: it processes the payment, sends the receipt, and handles refunds and disputes. The link we email is the key to your report. Anyone with the link can open it, so share it on purpose.</p>
<h2>Fair use</h2>
<p>Search like a person, for your own use. Don't scrape, resell, or republish reports, and don't use them to harass anyone.</p>
<h2>No warranty, limited liability</h2>
<p>The service is provided as is. To the extent the law allows, we aren't liable for losses from using it, and our total liability is capped at what you paid us in the past twelve months.</p>
<h2>The rest</h2>
<p>New York law governs these terms. We may update them; the date above is the current version. Questions: ${mail}.</p>`,
  },
};
