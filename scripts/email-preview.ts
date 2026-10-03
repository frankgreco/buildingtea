// Renders the transactional email with sample data to HTML and plain-text files
// so copy and layout can be iterated on in a browser. No network, no Workers runtime.
//
//   pnpm email:preview            -> /tmp/buildingtea-emails/receipt.{html,txt}
//   OUT_DIR=./tmp pnpm email:preview
//
// To see it in a real inbox once Resend is set up, send it to yourself
// (the subject is prefixed "[test]"; the sample link points at a report that doesn't exist):
//
//   RESEND_API_KEY=re_... pnpm email:preview --send you@example.com

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../src/env";
import { receiptEmail, sendEmail } from "../src/lib/email";

const out = process.env.OUT_DIR ?? "/tmp/buildingtea-emails";
mkdirSync(out, { recursive: true });

const appName = "BuildingTea";
const addressLabel = "143 WEST 4 STREET";
const token = "sampletoken" + "x".repeat(32);
const link = `https://buildingtea.com/r/k7m3q9x2v5w8#t=${token}`;

const mails = {
  receipt: receiptEmail({ appName, addressLabel, link }),
};

for (const [name, m] of Object.entries(mails)) {
  // Preview only: the lockup is served from the site in real mail; here it comes from the working tree.
  const html = m.html.replace(`${new URL(link).origin}/logo-email.png`, `file://${resolve("web/public/logo-email.png")}`);
  writeFileSync(`${out}/${name}.html`, html);
  writeFileSync(`${out}/${name}.txt`, `Subject: ${m.subject}\n\n${m.text}\n`);
  console.log(`${out}/${name}.html`);
}

const sendTo = process.argv.includes("--send") ? process.argv[process.argv.indexOf("--send") + 1] : undefined;
if (sendTo !== undefined) {
  if (!sendTo || !sendTo.includes("@")) throw new Error("usage: pnpm email:preview --send you@example.com");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Set RESEND_API_KEY to send test emails.");
  const env = { RESEND_API_KEY: apiKey, EMAIL_FROM: process.env.EMAIL_FROM ?? "BuildingTea <no-reply@buildingtea.com>" } as Env;
  for (const [name, m] of Object.entries(mails)) {
    await sendEmail(env, { to: sendTo, subject: `[test] ${m.subject}`, html: m.html, text: m.text });
    console.log(`sent ${name} to ${sendTo}`);
  }
}
