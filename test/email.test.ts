import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { receiptEmail, sendEmail, watchAlertEmail, watchStartedEmail } from "../src/lib/email";

const env = { APP_NAME: "BuildingTea", EMAIL_FROM: "BuildingTea <hello@buildingtea.nyc>" } as Env;

afterEach(() => vi.restoreAllMocks());

describe("email templates", () => {
  it("receipt carries the link and a sharing warning, escaped for html", () => {
    const m = receiptEmail({ appName: "BuildingTea", addressLabel: "143 WEST 4 STREET <unit 3FW>", link: "https://buildingtea.nyc/r/abc#t=tok" });
    expect(m.subject).toBe("Your BuildingTea report for 143 WEST 4 STREET <unit 3FW>");
    expect(m.text).toContain("https://buildingtea.nyc/r/abc#t=tok");
    expect(m.html).toContain("&lt;unit 3FW&gt;");
    expect(m.html).not.toContain("<unit 3FW>");
  });

  it("watch emails list changes and a manage link", () => {
    const s = watchStartedEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", manageUrl: "https://m" });
    expect(s.text).toContain("https://m");
    const a = watchAlertEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", changes: ["Hazardous conditions open: 0 → 2"] });
    expect(a.subject).toContain("something changed");
    expect(a.html).toContain("<li>Hazardous conditions open: 0 → 2</li>");
  });
});

describe("sendEmail", () => {
  it("logs instead of sending when no API key is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendEmail(env, { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[email:dry-run] to=a@example.com"));
  });

  it("posts to Resend with the key and throws on a non-2xx", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await sendEmail({ ...env, RESEND_API_KEY: "re_test" }, { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init!.body))).toMatchObject({ from: env.EMAIL_FROM, to: ["a@example.com"], subject: "Hi" });

    fetchSpy.mockResolvedValue(new Response("nope", { status: 422 }));
    await expect(sendEmail({ ...env, RESEND_API_KEY: "re_test" }, { to: "a@example.com", subject: "Hi", html: "", text: "" })).rejects.toThrow(/resend 422/);
  });
});
