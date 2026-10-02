import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { receiptEmail, sendEmail, watchDigestEmail, watchStartedEmail } from "../src/lib/email";

const env = { APP_NAME: "BuildingTea", EMAIL_FROM: "BuildingTea <no-reply@buildingtea.com>" } as Env;

afterEach(() => vi.restoreAllMocks());

describe("email templates", () => {
  it("receipt carries the link and a sharing warning, escaped for html", () => {
    const m = receiptEmail({ appName: "BuildingTea", addressLabel: "143 WEST 4 STREET <unit 3FW>", link: "https://buildingtea.com/r/abc#t=tok" });
    expect(m.subject).toBe("Your BuildingTea report for 143 WEST 4 STREET <unit 3FW>");
    expect(m.text).toContain("https://buildingtea.com/r/abc#t=tok");
    expect(m.html).toMatch(/&lt;unit 3fw&gt;/i);
    expect(m.html).not.toMatch(/<unit 3fw>/i);
    expect(m.html).toContain('href="https://buildingtea.com/r/abc#t=tok"');
    expect(m.text).not.toContain("re-checks");
  });

  it("watch confirmation states the price, the renewal, and how to cancel", () => {
    const s = watchStartedEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", manageUrl: "https://m", monthly: "$3.00" });
    expect(s.text).toContain("$3.00 a month plus any sales tax");
    expect(s.text).toContain("renews every month until you cancel");
    expect(s.text).toContain("https://m");
    expect(s.html).toContain('href="https://m"');
    const noPrice = watchStartedEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", manageUrl: "https://m", monthly: null });
    expect(noPrice.text).toContain("price shown at checkout");
  });

  it("monthly digest leads with the summary, lists the changes, and carries the manage link", () => {
    const d = watchDigestEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", manageUrl: "https://m", changes: ["Hazardous conditions open: 0 → 2"], summary: "One new hazardous violation this month." });
    expect(d.subject).toBe("BuildingTea: 1 change at X");
    expect(d.text).toContain("One new hazardous violation this month.");
    expect(d.html).toContain("Hazardous conditions open: 0 → 2");
    expect(d.html).toContain('href="https://m"');
    const quiet = watchDigestEmail({ appName: "BuildingTea", addressLabel: "X", link: "https://l", manageUrl: "https://m", changes: [], summary: null });
    expect(quiet.subject).toBe("BuildingTea: nothing new at X");
    expect(quiet.text).toContain("Nothing new showed up");
    expect(quiet.html).not.toContain("What changed");
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
