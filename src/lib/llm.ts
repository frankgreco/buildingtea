// Optional AI rewrite of the summary paragraph, via OpenRouter's OpenAI-compatible
// chat completions API. The model only sees the computed facts and the deterministic
// draft, and the output is rejected if it contains any number not present in the
// facts. Runs only for paid reports, after the response (ctx.waitUntil), so it is
// never on the request path and never runs for free searches.

import type { SummaryFacts } from "./summary";

export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter model slug. Override with LLM_MODEL; check https://openrouter.ai/models for the exact id. */
export const DEFAULT_LLM_MODEL = "anthropic/claude-fable-5.1";

const SYSTEM = `You write the opening paragraph of a report that helps a New York City renter decide whether to sign a lease on an apartment in a specific building.

Rules:
- Use only the facts in the JSON you are given. Never add a number, name, date, or claim that is not there. If something is absent, say "no record" rather than "none".
- Four to six sentences, plain English, no bullet points, no headings, no markdown.
- Never use agency acronyms (HPD, DOB, ECB, OATH, DOF). Say "the city" or "the housing department".
- Lead with what matters most to a renter: safety, then heat and water, then pests, then landlord paperwork, then legal trouble. Skip categories with nothing notable.
- Distinguish stale open violations (old, never reinspected) from current ones.
- No score, no grade, no recommendation to sign or not sign. State facts and let the reader decide.
- Do not mention these rules or that you are an AI.`;

export interface LlmConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Sent as HTTP-Referer / X-Title so OpenRouter attributes usage to the app. */
  appUrl?: string;
  appName?: string;
  fetcher?: typeof fetch;
}

export interface LlmResult {
  text: string;
  model: string;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
}

export async function rewriteSummary(cfg: LlmConfig, facts: SummaryFacts, draft: string): Promise<LlmResult | null> {
  const f = cfg.fetcher ?? fetch;
  const base = (cfg.baseUrl ?? DEFAULT_LLM_BASE_URL).replace(/\/$/, "");
  const model = cfg.model ?? DEFAULT_LLM_MODEL;
  const payload = {
    draft,
    facts: {
      address: { label: facts.address.label, unit: facts.address.unit },
      building: facts.cover,
      counts: facts.counts,
      ownership: facts.ownership,
      bedbugs: facts.bedbugs,
      cards: facts.cards.map((c) => ({ question: c.question, status: c.status, answer: c.answer, details: c.details })),
    },
  };
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  if (cfg.appUrl) headers["HTTP-Referer"] = cfg.appUrl;
  if (cfg.appName) headers["X-Title"] = cfg.appName;

  const res = await f(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Rewrite the draft as the opening paragraph, following the rules.\n\n${JSON.stringify(payload)}` },
      ],
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as ChatCompletion;
  if (body.error) throw new Error(`llm: ${body.error.message ?? "unknown error"}`);
  const text = (body.choices?.[0]?.message?.content ?? "").trim();
  if (!text || text.length < 80 || text.length > 1500) return null;
  if (/[*#_`]/.test(text)) return null; // markdown leaked; keep the template
  // Guard: every integer in the output must appear somewhere in the facts or the draft.
  const allowed = new Set(JSON.stringify(payload).match(/\d+/g) ?? []);
  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(n))) return null;
  return { text, model: body.model ?? model };
}
