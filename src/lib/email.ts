// Transactional email through Resend's HTTP API. With no API key configured the
// message is logged instead, so local development never needs an email account.
//
// The HTML follows the house email structure shared with Essence and Peach & Cherry
// (emails/ in those repos): brand on top, one card with kicker, headline, lead, button,
// a detail panel, a hairline "not for you" block, then a middot footer. The styling is
// the site's own (web/src/styles.css): cream page, ink borders, hard offset shadows,
// the yellow h1 highlight, the coral tag chip. Preview every email with `pnpm email:preview`.

import type { Env } from "../env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dry-run] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------- frame ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "143 WEST 4 STREET" -> "143 West 4 Street"; tokens with digits (3FW, 10B) stay uppercase. */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/[a-z0-9]+/g, (w) => (/\d/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)));
}

const SUPPORT = "hello@buildingtea.com";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The site's light-scheme tokens (web/src/styles.css :root). */
const C = { page: "#fff3df", surface: "#fcfcfb", ink: "#16142b", text: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", accent: "#ff5a3c", hilite: "#ffd84d" } as const;

interface PanelRow {
  /** Bold lead-in, e.g. "$3.00 a month". Rows without one get a coral bullet with a hanging indent. */
  lead?: string;
  text: string;
}

interface Frame {
  /** The inbox preview line; hidden in the body. */
  preheader: string;
  /** Small uppercase line above the headline, like the site's .kicker. */
  kicker: string;
  /** Coral pill at the card's top right, like the site's "the gist" tag. */
  tag?: string;
  /** The headline, highlighted in yellow like the site's h1. */
  title: string;
  /** Plain text; escaped here. */
  lead: string;
  /** The site's .btn.primary, with its optional small sub-label. */
  cta: { label: string; url: string; sub?: string };
  /** Small muted line under the button, e.g. the raw link for copy-paste. */
  ctaNote?: string;
  /** A .perk-style tile: page colour, ink border. */
  panel?: { kicker: string; rows: PanelRow[] };
  /** Put the panel between the lead and the button (when the panel is the content). */
  panelFirst?: boolean;
  foot?: { title?: string; text: string; link: { label: string; url: string } };
  /** Any absolute URL on our origin; the lockup and footer links are derived from it. */
  link: string;
}

function frame(f: Frame): string {
  const origin = new URL(f.link).origin;
  const s = (extra: string) => `font-family:${FONT};${extra}`;
  const kicker = (text: string, extra = "") => `<div style="${s(`font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${C.secondary};${extra}`)}">${esc(text)}</div>`;
  const rowStyle = s(`font-size:15px;line-height:23px;color:${C.text};padding-bottom:8px;`);
  const row = (html: string) => `<div style="${rowStyle}">${html}</div>`;
  const bullet = (html: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top" width="16" style="${s(`width:16px;font-size:15px;line-height:23px;font-weight:900;color:${C.accent};padding-bottom:8px;`)}">&bull;</td><td valign="top" style="${rowStyle}">${html}</td></tr></table>`;

  const panel = f.panel
    ? `<tr><td class="px" style="padding:0 28px 26px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background-color:${C.page};border:2px solid ${C.ink};border-radius:14px;">
    <tr><td style="padding:14px 16px 8px;">
      ${kicker(f.panel.kicker, "padding-bottom:8px;")}
      ${f.panel.rows.map((r) => (r.lead ? row(`<strong>${esc(r.lead)}</strong>&nbsp;&nbsp;${esc(r.text)}`) : bullet(esc(r.text)))).join("")}
    </td></tr>
  </table>
</td></tr>`
    : "";

  const cta = `<tr><td class="px" align="left" style="padding:${f.panelFirst ? "0" : "20px"} 28px 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>
    <td align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border:2px solid ${C.ink};border-radius:14px;box-shadow:3px 3px 0 ${C.ink};">
      <a href="${esc(f.cta.url)}" style="${s("display:block;padding:11px 22px;font-size:15px;line-height:20px;font-weight:900;color:#ffffff;text-decoration:none;text-align:center;")}">${esc(f.cta.label)}${
        f.cta.sub ? `<span style="display:block;font-size:11px;line-height:15px;font-weight:700;opacity:0.9;">${esc(f.cta.sub)}</span>` : ""
      }</a>
    </td>
  </tr></table>
  ${f.ctaNote ? `<div style="${s(`font-size:12px;line-height:18px;color:${C.muted};padding-top:12px;word-break:break-all;`)}">${esc(f.ctaNote)}</div>` : ""}
</td></tr>`;

  const foot = f.foot
    ? `<tr><td class="px" style="padding:0 28px 28px;border-top:2px solid ${C.grid};">
  ${f.foot.title ? `<div style="${s(`font-size:17px;font-weight:900;letter-spacing:-0.01em;color:${C.text};padding-top:22px;`)}">${esc(f.foot.title)}</div>` : ""}
  <div style="${s(`font-size:15px;line-height:23px;color:${C.secondary};padding-top:${f.foot.title ? "6px" : "22px"};padding-bottom:12px;`)}">${esc(f.foot.text)}</div>
  <a href="${esc(f.foot.link.url)}" style="${s(`font-size:15px;font-weight:800;color:${C.text};text-decoration:underline;`)}">${esc(f.foot.link.label)}</a>
</td></tr>`
    : "";

  const tag = f.tag
    ? `<td align="right" valign="top" style="padding-left:12px;"><span style="${s(`display:inline-block;background-color:${C.accent};color:#ffffff;border:2px solid ${C.ink};border-radius:999px;padding:3px 10px;font-weight:900;font-size:12px;line-height:16px;white-space:nowrap;transform:rotate(3deg);`)}">${esc(f.tag)}</span></td>`
    : "";
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
            <tr><td class="px" style="padding:22px 28px ${f.panelFirst ? "18px" : "4px"};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top">${kicker(f.kicker, "padding-top:4px;")}</td>${tag}</tr></table>
              <div class="h1" style="${s(`font-size:32px;line-height:36px;font-weight:900;letter-spacing:-0.03em;color:${C.text};padding-top:8px;`)}"><span style="background-color:${C.hilite};background:linear-gradient(transparent 55%,${C.hilite} 55%);padding:0 2px;">${esc(f.title)}</span></div>
              <div style="${s(`font-size:16px;line-height:25px;color:${C.secondary};padding-top:12px;`)}">${esc(f.lead)}</div>
            </td></tr>
            ${f.panelFirst ? panel + cta : cta + panel}
            ${foot}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:26px 16px 0;">
          <div style="${s(`font-size:12px;line-height:20px;color:${C.muted};`)}">${footLink(`${origin}/privacy`, "Privacy")}&nbsp;&middot;&nbsp;${footLink(`${origin}/terms`, "Terms")}&nbsp;&middot;&nbsp;${footLink(`mailto:${SUPPORT}`, SUPPORT)}</div>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>
`;
}

// ---------- the emails ----------

const WHAT = "new hazardous conditions, city fines, vacate orders, court cases, bedbug reports, or a change of landlord";

export function receiptEmail(args: { appName: string; addressLabel: string; link: string }): Omit<Mail, "to"> {
  const { appName, addressLabel, link } = args;
  const address = titleCase(addressLabel);
  const snapshot = "The report shows the city's records as of today. To keep it current, turn on a watch from the report page: a fresh report and a note on what changed, once a month.";
  return {
    subject: `Your ${appName} report for ${addressLabel}`,
    text: `Here is your building report for ${addressLabel}:\n\n${link}\n\nThis link is your key to the report. Anyone with it can open it, so share it with roommates on purpose, not by accident.\n\n${snapshot}`,
    html: frame({
      link,
      preheader: `Your full report for ${address} is ready.`,
      kicker: "Your building report",
      tag: "unlocked",
      title: address,
      lead: "The gist in plain English, the six questions answered, twenty years of violations charted, and every city record it came from.",
      cta: { label: "Open your report", url: link, sub: "no login, the link is the key" },
      ctaNote: `Or copy the link: ${link}`,
      panel: {
        kicker: "Keep this link",
        rows: [
          { lead: "It's your key.", text: "Anyone with it can open the report, so share it with roommates on purpose, not by accident." },
          { lead: "It's a snapshot.", text: snapshot },
        ],
      },
    }),
  };
}

export function watchStartedEmail(args: { appName: string; addressLabel: string; link: string; manageUrl: string; monthly: string | null }): Omit<Mail, "to"> {
  const { appName, addressLabel, link, manageUrl, monthly } = args;
  const address = titleCase(addressLabel);
  // The acknowledgment NY and CA auto-renewal law asks for: price, cadence, and how to cancel, in a form the buyer keeps.
  const price = monthly ? `${monthly} a month plus any sales tax` : "billed monthly at the price shown at checkout";
  const terms = `Your watch is ${price}, charged to the card you used, and it renews every month until you cancel. Cancelling stops the next charge; your watch runs through the end of the period you've paid for. Keep this email as your record of the terms.`;
  const promise = (where: string) => `Once a month we'll re-check the city's records for ${where}, refresh your report, and email you what changed: ${WHAT}.`;
  return {
    subject: `${appName} is now watching ${addressLabel}`,
    text: `${promise(addressLabel)}\n\nYour report: ${link}\n\n${terms}\n\nManage or cancel any time: ${manageUrl}`,
    html: frame({
      link,
      preheader: `Once a month: a fresh report for ${address} and a note on what changed.`,
      kicker: "Watch confirmed",
      tag: "watching",
      title: address,
      lead: promise("this building"),
      cta: { label: "Open your report", url: link, sub: "refreshed every month" },
      ctaNote: `Or copy the link: ${link}`,
      panel: {
        kicker: "The terms",
        rows: [
          monthly ? { lead: `${monthly} a month`, text: "plus any sales tax, charged to the card you used." } : { lead: "Billed monthly", text: "at the price shown at checkout, plus any sales tax, charged to the card you used." },
          { lead: "Renews every month", text: "until you cancel." },
          { lead: "Cancel any time", text: "stops the next charge; your watch runs through the end of the period you've paid for." },
        ],
      },
      foot: { title: "Not for you? No hard feelings.", text: "Cancel in a couple of clicks on your billing page. Keep this email as your record of the terms.", link: { label: "Manage or cancel", url: manageUrl } },
    }),
  };
}

/**
 * The monthly check-in. `summary` is the short AI-written paragraph about the changes
 * (or null when the model was unavailable); the change list itself is the receipts.
 */
export function watchDigestEmail(args: { appName: string; addressLabel: string; link: string; manageUrl: string; changes: string[]; summary: string | null }): Omit<Mail, "to"> {
  const { appName, addressLabel, link, manageUrl, changes, summary } = args;
  const address = titleCase(addressLabel);
  const n = changes.length;
  const count = n === 1 ? "1 change" : `${n} changes`;
  const fallback = n
    ? `Since your last check, ${n === 1 ? "one thing" : `${n} things`} changed in the city's records for ${address}. Your report has been refreshed.`
    : `Nothing new showed up in the city's records for ${address} since your last check. Your report has been refreshed anyway, so it's current as of today.`;
  const lead = summary?.trim() || fallback;
  const list = changes.map((c) => `- ${c}`).join("\n");
  return {
    subject: n ? `${appName}: ${count} at ${addressLabel}` : `${appName}: nothing new at ${addressLabel}`,
    text: `${lead}\n\n${n ? `What changed:\n${list}\n\n` : ""}Open the fresh report: ${link}\n\nYou're getting this once a month because you're watching ${addressLabel}. Manage or stop this watch: ${manageUrl}`,
    html: frame({
      link,
      preheader: lead.length > 140 ? `${lead.slice(0, 137)}…` : lead,
      kicker: n ? "Monthly check · something changed" : "Monthly check · all quiet",
      tag: "watching",
      title: address,
      lead,
      panelFirst: true,
      ...(n ? { panel: { kicker: "What changed", rows: changes.map((text) => ({ text })) } } : {}),
      cta: { label: "Open the fresh report", url: link, sub: "rebuilt today from the city's records" },
      foot: { text: `You're getting this once a month because you're watching ${address}.`, link: { label: "Manage or stop this watch", url: manageUrl } },
    }),
  };
}
