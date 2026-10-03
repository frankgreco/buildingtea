import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { EmailError, receiptEmail, sendEmail } from "../src/lib/email";

const env = { APP_NAME: "BuildingTea", EMAIL_FROM: "BuildingTea <no-reply@buildingtea.com>" } as Env;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("email templates", () => {
  it("unlock email is the button only, escaped for html, with a Contact link in the footer", () => {
    const m = receiptEmail({ appName: "BuildingTea", addressLabel: "143 WEST 4 STREET <unit 3FW>", link: "https://buildingtea.com/r/abc#t=tok" });
    expect(m.subject).toBe("Your BuildingTea report for 143 WEST 4 STREET <unit 3FW>");
    expect(m.text).toContain("https://buildingtea.com/r/abc#t=tok");
    expect(m.html).toMatch(/&lt;unit 3fw&gt;/i);
    expect(m.html).not.toMatch(/<unit 3fw>/i);
    expect(m.html).toContain('href="https://buildingtea.com/r/abc#t=tok"');
    expect(m.html).not.toContain("Anyone with this link");
    expect(m.html).toContain('href="mailto:frank@lifeisfake.com"');
    expect(m.html).toContain(">Contact</a>");
    expect(m.html).not.toContain(">frank@lifeisfake.com<");
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

  const keyed = { ...env, RESEND_API_KEY: "re_test" } as Env;
  const hi = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

  it("sends the idempotency key and does not retry a permanent refusal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"name":"validation_error"}', { status: 422 }));
    const err = await sendEmail(keyed, hi, { idempotencyKey: "receipt/cs_1" }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailError);
    expect((err as EmailError).permanent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>)["idempotency-key"]).toBe("receipt/cs_1");
  });

  it("retries transient failures with the same key, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sent = sendEmail(keyed, hi, { idempotencyKey: "receipt/cs_7" });
    await vi.runAllTimersAsync();
    await expect(sent).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const keys = fetchSpy.mock.calls.map((c) => (c[1]!.headers as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys)).toEqual(new Set(["receipt/cs_7"]));
  });

  it("gives up after the last retry and reports a transient failure as not permanent", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("slow down", { status: 429 }));
    const sent = sendEmail(keyed, hi).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await sent;
    expect(err).toBeInstanceOf(EmailError);
    expect((err as EmailError).permanent).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("treats a reused key with a different payload as already sent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"name":"invalid_idempotent_request"}', { status: 409 }));
    await expect(sendEmail(keyed, hi, { idempotencyKey: "receipt/cs_7" })).resolves.toBeUndefined();
  });
});
