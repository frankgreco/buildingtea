import { describe, expect, it, vi } from "vitest";
import { summarizeChanges, type LlmConfig } from "../src/lib/llm";

const changes = ["Hazardous conditions open: 0 → 2", "Registered owner: ACME LLC → 12 MAIN HOLDINGS LLC"];
const args = { addressLabel: "12 MAIN STREET, Brooklyn, NY 11201", changes };

/** A fetcher that answers every chat completion with `content`. */
function fakeFetcher(content: string) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 }),
  );
}

const cfg = (fetcher: ReturnType<typeof fakeFetcher>): LlmConfig => ({ apiKey: "sk-test", fetcher: fetcher as unknown as typeof fetch });

describe("summarizeChanges", () => {
  it("returns null for no changes without calling the model", async () => {
    const f = fakeFetcher("unused");
    expect(await summarizeChanges(cfg(f), { ...args, changes: [] })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns the paragraph for a clean response and sends the changes as JSON", async () => {
    const text = "Since last month, the number of open hazardous conditions went from 0 to 2. The city also lists a new registered owner, 12 Main Holdings LLC.";
    const f = fakeFetcher(`  ${text}\n`);
    expect(await summarizeChanges(cfg(f), args)).toBe(text);
    expect(f).toHaveBeenCalledOnce();
    const body = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ max_tokens: 300, temperature: 0.3 });
    expect(body.messages[1].content).toContain(JSON.stringify({ address: args.addressLabel, changes }));
  });

  it("returns null when the response has a number that is not in the input", async () => {
    const f = fakeFetcher("Since last month, the number of open hazardous conditions went from 0 to 3, and the building changed owners.");
    expect(await summarizeChanges(cfg(f), args)).toBeNull();
  });

  it("returns null when the response has markdown", async () => {
    const f = fakeFetcher("Since last month, **two** new hazardous conditions opened, and the city lists a new registered owner.");
    expect(await summarizeChanges(cfg(f), args)).toBeNull();
  });
});
