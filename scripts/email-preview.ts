// Renders the three transactional emails with sample data to HTML and plain-text files
// so copy and layout can be iterated on in a browser. No network, no Workers runtime.
//
//   pnpm email:preview            -> /tmp/buildingtea-emails/{receipt,watch-started,watch-digest,watch-digest-quiet}.{html,txt}
//   OUT_DIR=./tmp pnpm email:preview

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { receiptEmail, watchDigestEmail, watchStartedEmail } from "../src/lib/email";

const out = process.env.OUT_DIR ?? "/tmp/buildingtea-emails";
mkdirSync(out, { recursive: true });

const appName = "BuildingTea";
const addressLabel = "143 WEST 4 STREET";
const token = "sampletoken" + "x".repeat(32);
const link = `https://buildingtea.com/r/k7m3q9x2v5w8#t=${token}`;
const manageUrl = `https://buildingtea.com/api/report/k7m3q9x2v5w8/manage?t=${token}`;

const mails = {
  receipt: receiptEmail({ appName, addressLabel, link }),
  "watch-started": watchStartedEmail({ appName, addressLabel, link, manageUrl, monthly: "$3.00" }),
  "watch-digest": watchDigestEmail({
    appName,
    addressLabel,
    link,
    manageUrl,
    changes: ["Hazardous conditions open: 0 → 2", "New housing court case filed Sep 28, 2026", "Registered owner changed: 143 W4 LLC → GREENWICH HOLDINGS LLC"],
    summary:
      "A busier month than usual at 143 West 4 Street. The city opened two hazardous violations, a tenant filed a housing court case on September 28, and the building changed hands on paper: the registered owner is now Greenwich Holdings LLC.",
  }),
  "watch-digest-quiet": watchDigestEmail({ appName, addressLabel, link, manageUrl, changes: [], summary: null }),
};

for (const [name, m] of Object.entries(mails)) {
  // Preview only: the lockup is served from the site in real mail; here it comes from the working tree.
  const html = m.html.replace(`${new URL(link).origin}/logo-email.png`, `file://${resolve("web/public/logo-email.png")}`);
  writeFileSync(`${out}/${name}.html`, html);
  writeFileSync(`${out}/${name}.txt`, `Subject: ${m.subject}\n\n${m.text}\n`);
  console.log(`${out}/${name}.html`);
}
