// Transactional email through Resend's HTTP API. With no API key configured the
// message is logged instead, so local development never needs an email account.
//
// The HTML follows the house email structure shared with Essence and Peach & Cherry
// (emails/ in those repos), with only the parts the receipt uses: brand on top, one card
// with kicker, headline and button, then a middot footer. The styling is
// the site's own (web/src/styles.css): cream page, ink borders, hard offset shadows,
// the yellow h1 highlight, the coral tag chip. Preview the email with `pnpm email:preview`.

import type { Env } from "../env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** A send Resend refused. `permanent` means retrying the same message cannot succeed (bad address, bad payload). */
export class EmailError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`resend ${status}: ${body.slice(0, 200)}`);
    this.name = "EmailError";
  }
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 409 && this.status !== 429;
  }
}

/** Waits between attempts; a Retry-After header wins when it is shorter than 5 s. */
export const RETRY_DELAYS_MS = [500, 2000];

/**
 * Send one email. `idempotencyKey` (e.g. "receipt/cs_123") makes retries safe: Resend
 * remembers a key for 24 hours and never sends the same key twice. Transient failures
 * (network, timeouts, 429, 5xx, a concurrent request with the same key) are retried;
 * anything else throws an EmailError.
 */
export async function sendEmail(env: Env, mail: Mail, opts: { idempotencyKey?: string } = {}): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dry-run] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return;
  }
  const headers: Record<string, string> = { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" };
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey.slice(0, 256);
  const body = JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text });

  for (let attempt = 0; ; attempt++) {
    let failure: EmailError | Error;
    let wait = RETRY_DELAYS_MS[attempt];
    try {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
      const text = await res.text();
      // Same key, different payload: an earlier attempt for this key already went out.
      if (res.status === 409 && text.includes("invalid_idempotent_request")) return;
      failure = new EmailError(res.status, text);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (wait !== undefined && retryAfter > 0 && retryAfter * 1000 < 5000) wait = Math.max(wait, retryAfter * 1000);
      if ((failure as EmailError).permanent) throw failure;
    } catch (err) {
      if (err instanceof EmailError && err.permanent) throw err;
      failure = err instanceof Error ? err : new Error(String(err));
    }
    if (wait === undefined) throw failure;
    await new Promise((r) => setTimeout(r, wait));
  }
}

// ---------- frame ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "143 WEST 4 STREET" -> "143 West 4 Street"; tokens with digits (3FW, 10B) stay uppercase. */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/[a-z0-9]+/g, (w) => (/\d/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)));
}

const SUPPORT = "frank@lifeisfake.com";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The site's light-scheme tokens (web/src/styles.css :root). */
const C = { page: "#fff3df", surface: "#fcfcfb", ink: "#16142b", text: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", accent: "#ff5a3c", hilite: "#ffd84d" } as const;

interface Frame {
  /** The inbox preview line; hidden in the body. */
  preheader: string;
  /** Small uppercase line above the headline, like the site's .kicker. */
  kicker: string;
  /** Coral pill at the card's top right, like the site's "the gist" tag. */
  tag: string;
  /** The headline, highlighted in yellow like the site's h1. */
  title: string;
  /** The site's .btn.primary. No sub-label. */
  cta: { label: string; url: string };
  /** Any absolute URL on our origin; the lockup and footer links are derived from it. */
  link: string;
}

function frame(f: Frame): string {
  const origin = new URL(f.link).origin;
  const s = (extra: string) => `font-family:${FONT};${extra}`;
  const kicker = `<div style="${s(`font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${C.secondary};padding-top:4px;`)}">${esc(f.kicker)}</div>`;
  const tag = `<span style="${s(`display:inline-block;background-color:${C.accent};color:#ffffff;border:2px solid ${C.ink};border-radius:999px;padding:3px 10px;font-weight:900;font-size:12px;line-height:16px;white-space:nowrap;transform:rotate(3deg);`)}">${esc(f.tag)}</span>`;
  const cta = `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>
    <td align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border:2px solid ${C.ink};border-radius:14px;box-shadow:3px 3px 0 ${C.ink};">
      <a href="${esc(f.cta.url)}" style="${s("display:block;padding:13px 24px;font-size:16px;line-height:20px;font-weight:900;color:#ffffff;text-decoration:none;text-align:center;")}">${esc(f.cta.label)}</a>
    </td>
  </tr></table>`;
  const footLink = (href: string, label: string) => `<a href="${esc(href)}" style="color:${C.muted};font-weight:700;text-decoration:none;">${esc(label)}</a>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(f.title)}</title>
  <style>
    body { margin: 0; padding: 0; word-spacing: normal; }
    table { border-collapse: collapse; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 18px !important; padding-right: 18px !important; }
      .h1 { font-size: 27px !important; line-height: 30px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${esc(f.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background-color:${C.page};">
    <tr><td align="center" style="padding:28px 16px 40px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
        <tr><td align="left" style="padding:0 0 18px;">
          <a href="${esc(origin)}/" style="display:inline-block;"><img src="${esc(origin)}/logo-email.png" width="180" height="50" alt="BuildingTea NYC" border="0" style="${s(`display:block;width:180px;height:50px;font-size:15px;font-weight:900;color:${C.ink};`)}"></a>
        </td></tr>
        <tr><td bgcolor="${C.surface}" style="background-color:${C.surface};border:2px solid ${C.ink};border-radius:20px;box-shadow:5px 5px 0 ${C.ink};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="px" style="padding:22px 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top">${kicker}</td><td align="right" valign="top" style="padding-left:12px;">${tag}</td></tr></table>
              <div class="h1" style="${s(`font-size:32px;line-height:36px;font-weight:900;letter-spacing:-0.03em;color:${C.text};padding-top:8px;`)}"><span style="background-color:${C.hilite};background:linear-gradient(transparent 55%,${C.hilite} 55%);padding:0 2px;">${esc(f.title)}</span></div>
              <div style="padding-top:16px;">${cta}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:26px 16px 0;">
          <div style="${s(`font-size:12px;line-height:20px;color:${C.muted};`)}">${footLink(`${origin}/privacy`, "Privacy")}&nbsp;&middot;&nbsp;${footLink(`${origin}/terms`, "Terms")}&nbsp;&middot;&nbsp;${footLink(`mailto:${SUPPORT}`, "Contact")}</div>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>
`;
}

// ---------- the email ----------

export function receiptEmail(args: { appName: string; addressLabel: string; link: string }): Omit<Mail, "to"> {
  const { appName, addressLabel, link } = args;
  const address = titleCase(addressLabel);
  return {
    subject: `Your ${appName} report for ${addressLabel}`,
    text: `Your building report for ${address}:\n\n${link}`,
    html: frame({
      link,
      preheader: `Your report for ${address} is unlocked.`,
      kicker: "Your building report",
      tag: "unlocked",
      title: address,
      cta: { label: "Open your report", url: link },
    }),
  };
}
