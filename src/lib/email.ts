// Transactional email through Resend's HTTP API. With no API key configured the
// message is logged instead, so local development never needs an email account.

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function receiptEmail(args: { appName: string; addressLabel: string; link: string }): Omit<Mail, "to"> {
  const { appName, addressLabel, link } = args;
  return {
    subject: `Your ${appName} report for ${addressLabel}`,
    text: `Here is your building report for ${addressLabel}:\n\n${link}\n\nThis link is your key to the report. Anyone with it can open it, so share it with roommates on purpose, not by accident.\n\nThe report re-checks the city's records every time you open it.`,
    html: `<p>Here is your building report for <strong>${esc(addressLabel)}</strong>:</p><p><a href="${esc(link)}">${esc(link)}</a></p><p>This link is your key to the report. Anyone with it can open it, so share it with roommates on purpose, not by accident.</p><p>The report re-checks the city's records every time you open it.</p>`,
  };
}

export function watchStartedEmail(args: { appName: string; addressLabel: string; link: string; manageUrl: string }): Omit<Mail, "to"> {
  const { appName, addressLabel, link, manageUrl } = args;
  return {
    subject: `${appName} is now watching ${addressLabel}`,
    text: `We'll check the city's records for ${addressLabel} every night and email you when something changes: new hazardous conditions, city fines, vacate orders, court cases, bedbug reports, or a change of landlord.\n\nYour report: ${link}\nManage or cancel: ${manageUrl}`,
    html: `<p>We'll check the city's records for <strong>${esc(addressLabel)}</strong> every night and email you when something changes: new hazardous conditions, city fines, vacate orders, court cases, bedbug reports, or a change of landlord.</p><p>Your report: <a href="${esc(link)}">${esc(link)}</a></p><p><a href="${esc(manageUrl)}">Manage or cancel</a></p>`,
  };
}

export function watchAlertEmail(args: { appName: string; addressLabel: string; link: string; changes: string[] }): Omit<Mail, "to"> {
  const { appName, addressLabel, link, changes } = args;
  const list = changes.map((c) => `- ${c}`).join("\n");
  return {
    subject: `${appName}: something changed at ${addressLabel}`,
    text: `Overnight changes in the city's records for ${addressLabel}:\n\n${list}\n\nSee the full report: ${link}`,
    html: `<p>Overnight changes in the city's records for <strong>${esc(addressLabel)}</strong>:</p><ul>${changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><p><a href="${esc(link)}">See the full report</a></p>`,
  };
}
