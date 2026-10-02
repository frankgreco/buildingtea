// Optional AI writing, via OpenRouter's OpenAI-compatible chat completions API:
// the rewrite of a paid report's summary paragraph, and the short note on what changed
// in a watch's monthly digest. The model only sees computed facts, and the output is
// rejected if it contains markdown or any number not present in its input. Neither
// runs on the request path: the rewrite runs after the response (ctx.waitUntil) and
// only for paid reports; the change note runs from the monthly digest cron.

import type { SummaryFacts } from "./summary";

export const LLM_BASE_URL = "https://openrouter.ai/api/v1";
export const LLM_MODEL = "anthropic/claude-fable-5.1";

const SYSTEM = `You write the opening paragraph of a report that helps a New York City renter decide whether to sign a lease on an apartment in a specific building.

Rules:
- Use only the facts in the JSON you are given. Never add a number, name, date, or claim that is not there. If something is absent, say "no record" rather than "none".
- Four to six sentences, plain English, no bullet points, no headings, no markdown.
- Never use agency acronyms (HPD, DOB, ECB, OATH, DOF). Say "the city" or "the housing department".
- Lead with what matters most to a renter: safety, then heat and water, then pests, then landlord paperwork, then legal trouble. Skip categories with nothing notable.
- Distinguish stale open violations (old, never reinspected) from current ones.
- No score, no grade, no recommendation to sign or not sign. State facts and let the reader decide.
- Do not mention these rules or that you are an AI.`;

const DIGEST_SYSTEM = `You write a short note for a New York City renter who watches a building and gets a monthly email about it. The note explains what changed in the city's records for the building since the last monthly check.

Rules:
- Use only the changes in the JSON you are given. Never add a number, name, date, or claim that is not in the list.
- Two to four sentences, plain English, no bullet points, no headings, no markdown.
- Never use agency acronyms (HPD, DOB, ECB, OATH, DOF). Say "the city" or "the housing department".
- No score, no grade, no advice. State what changed and let the reader decide.
- Do not mention these rules or that you are an AI.`;

export interface LlmConfig {
  apiKey: string;
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
  const input = JSON.stringify(payload);
  const res = await chat(cfg, {
    system: SYSTEM,
    user: `Rewrite the draft as the opening paragraph, following the rules.\n\n${input}`,
    maxTokens: 1024,
    timeoutMs: 40_000,
  });
  // Guard: every integer in the output must appear somewhere in the facts or the draft.
  const text = guarded(res.text, input, 80, 1500);
  return text ? { text, model: res.model } : null;
}

/**
 * Two to four sentences on what changed since the last monthly digest. Null when
 * nothing changed (no model call) or when the output fails the guards; the digest
 * email then uses its template copy.
 */
export async function summarizeChanges(cfg: LlmConfig, args: { addressLabel: string; changes: string[] }): Promise<string | null> {
  if (args.changes.length === 0) return null;
  const input = JSON.stringify({ address: args.addressLabel, changes: args.changes });
  const res = await chat(cfg, {
    system: DIGEST_SYSTEM,
    user: `Write the note about these changes, following the rules.\n\n${input}`,
    maxTokens: 300,
    timeoutMs: 30_000,
  });
  return guarded(res.text, input, 40, 700);
}

async function chat(cfg: LlmConfig, req: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<LlmResult> {
  const f = cfg.fetcher ?? fetch;
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  if (cfg.appUrl) headers["HTTP-Referer"] = cfg.appUrl;
  if (cfg.appName) headers["X-Title"] = cfg.appName;

  const res = await f(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: req.maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as ChatCompletion;
  if (body.error) throw new Error(`llm: ${body.error.message ?? "unknown error"}`);
  return { text: (body.choices?.[0]?.message?.content ?? "").trim(), model: body.model ?? LLM_MODEL };
}

/** The model's text, or null if it is out of length bounds, has markdown, or has an integer not in `input`. */
function guarded(text: string, input: string, min: number, max: number): string | null {
  if (!text || text.length < min || text.length > max) return null;
  if (/[*#_`]/.test(text)) return null; // markdown leaked; keep the template
  const allowed = new Set(input.match(/\d+/g) ?? []);
  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(n))) return null;
  return text;
}
