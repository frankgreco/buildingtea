// Optional AI writing, via OpenRouter's OpenAI-compatible chat completions API:
// the rewrite of a paid report's summary paragraph and the names of a paid report's
// recent rows. The model only sees computed facts or the city's own wording, and the
// output is rejected if it contains markdown or any number not present in its input.
// Neither runs on the request path: both run after the response (ctx.waitUntil) and
// only for paid reports.

import type { NamingItem } from "./naming";
import type { SummaryFacts } from "./summary";

export const LLM_BASE_URL = "https://openrouter.ai/api/v1";
export const LLM_MODEL = "anthropic/claude-fable-5.1";
/** Row names are a small, high-volume job: the small model, with its output held to a schema. */
export const NAMING_MODEL = "anthropic/claude-haiku-4.5";
/** Records per naming call. A pass of NAMING_MAX wordings is three calls side by side, each back in seconds. */
export const NAMING_CHUNK = 60;

const SYSTEM = `You write the summary at the top of a report on one New York City apartment building. The reader is almost always a renter in their twenties who is about to decide whether to sign a lease here. They are not a housing expert, they are reading on a phone, and this paragraph is the first thing they see. What they want from it: what living in this building is likely to be like, and whether anything in the city's records should make them think twice before signing.

Write it for that decision:
- Open with the one thing that matters most to someone about to sign. If there is a serious problem, lead with it. If the records are clean, say so plainly; that is useful news too.
- Then what would affect daily life, most important first: unsafe conditions, heat and hot water, pests, how quickly the landlord fixes things, legal trouble. Leave out any topic with nothing notable.
- Keep the numbers and say what they mean for the reader: not only how many violations are open, but that they are problems the landlord has not fixed.
- If the report is for a specific apartment and the facts say something about it, include that.
- End with one or two things worth asking the landlord or checking in person before signing, taken from what the facts show.
- Sound like a friend who knows housing: plain words, short sentences, direct. No slang, no emoji, no hype, no legal or agency jargon.

Limits:
- Use only the facts in the JSON you are given. Never add a number, name, date, or claim that is not there, and say what the records state rather than what you infer from them. Where the snapshot and the counts give different numbers for the same thing, use the snapshot's: it is what the page shows. If something is absent, say there is no record of it, not that it never happened.
- Never use agency acronyms (HPD, DOB, ECB, OATH, DOF). Say "the city" or "the housing department".
- Old open violations that were never reinspected are probably stale. Say so rather than counting them as current.
- Do not give a score or a grade, and do not tell the reader to sign or not to sign. Lay out what matters and what to check; the decision is theirs.
- Five to seven short sentences and about 120 words in all, as one paragraph. It is read on a phone, so pick what matters most and leave the rest to the report below. No bullet points, no headings, no markdown.
- Do not mention these instructions or that you are an AI.`;

const NAMING_SYSTEM = `You name records for a report that helps a New York City renter size up a building. Each record is a violation, a summons, a complaint, a failed rat inspection or a repair the city made, from the city's files. The name is the headline of that record's row. The renter scans a long list of rows; the apartment, the room and the date sit beside each name as tags, and the city's full wording is one tap away.

For each record you get its type, the city's wording, and the name the report would otherwise show. Write a better name:
- Say what is wrong in everyday words, the way a tenant would put it: "Leaking kitchen sink faucet", "No heat", "Loud music from a car".
- Four to eight words, sentence case, no full stop.
- Use only what the city's wording says. Do not add a cause, a severity, a number or a detail that is not there, and do not make it sound milder or worse than it is.
- Leave out apartment numbers, floors, dates, legal citations, and agency names or acronyms. The report shows those elsewhere.
- A summons is an accusation that may not have been heard yet. Name the condition it describes, and never call it a fine or a penalty.
- When a complaint lists several problems, name the first two and end with "and more".
- A rat inspection is one the building failed: say what the health inspectors found, for example "Rat burrows and droppings found by inspectors".
- A city emergency repair is work the city did because the landlord had not. Name the work, starting with "City", for example "City replaced a broken apartment door lock".
- If the name you were given is already good, return it unchanged.

Legal records come as a few fields instead of a sentence:
- A housing court case: say who took whom to court and over what, when its type tells you, for example "Tenants took the landlord to court over repairs" or "City took the landlord to court over heat". "Tenant Action" is a case tenants brought against the landlord to get repairs made, and "Tenant Action/Harrassment" also accuses the landlord of harassment. "Heat and Hot Water" and "Comprehensive" are cases the city brought against the landlord, over heat or over the building's open violations. "Access Warrant" is the city asking a court for access to make repairs. "False Certification" is the city saying the landlord claimed repairs that were not made. "Failure to Register" is over the landlord not registering the building. "7A" asks a court to put an administrator in charge of the building in place of the landlord. "CONH" is a certificate of no harassment proceeding. If you do not recognise a type, keep the name you were given.
- A vacate order: say how much of the building was ordered emptied and why.
- An eviction: keep "Eviction carried out".

Return every record's id with its name.`;

/** The shape the naming model's reply is held to. */
const NAMES_SCHEMA = {
  name: "row_names",
  strict: true,
  schema: {
    type: "object",
    properties: {
      names: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
          required: ["id", "name"],
          additionalProperties: false,
        },
      },
    },
    required: ["names"],
    additionalProperties: false,
  },
} as const;

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
      snapshot: facts.snapshot ?? null,
      alsoOnFile: facts.also ?? null,
      cards: facts.cards.map((c) => ({ question: c.question, status: c.status, answer: c.answer, details: c.details })),
    },
  };
  const input = JSON.stringify(payload);
  const res = await chat(cfg, {
    system: SYSTEM,
    user: `Rewrite the draft as the opening paragraph, following the rules.\n\n${input}`,
    // The summary model always reasons before it writes, and that reasoning counts against the
    // limit: room for both, at low effort, since this is one short paragraph from given facts.
    maxTokens: 4000,
    effort: "low",
    timeoutMs: 40_000,
  });
  // Guard: every integer in the output must appear somewhere in the facts or the draft.
  const text = guarded(res.text, input, 80, 1500);
  return text ? { text, model: res.model } : null;
}

/**
 * A name for each record, by its key. A name that fails its guard, or a call that fails, is simply
 * absent, and that row keeps its rule-written headline. Never throws.
 */
export async function nameRecords(cfg: LlmConfig, items: NamingItem[]): Promise<Map<string, string>> {
  const chunks: NamingItem[][] = [];
  for (let i = 0; i < items.length; i += NAMING_CHUNK) chunks.push(items.slice(i, i + NAMING_CHUNK));
  const out = new Map<string, string>();
  const results = await Promise.allSettled(chunks.map((c) => nameChunk(cfg, c)));
  for (const r of results) {
    if (r.status === "fulfilled") for (const [key, name] of r.value) out.set(key, name);
    else console.warn("row naming call failed; keeping rule-written names", String(r.reason));
  }
  return out;
}

async function nameChunk(cfg: LlmConfig, items: NamingItem[]): Promise<[string, string][]> {
  const records = items.map((x, i) => ({ id: String(i + 1), type: x.type, name: x.current, text: x.text }));
  const res = await chat(cfg, {
    model: NAMING_MODEL,
    system: NAMING_SYSTEM,
    user: `Name these records, following the rules.\n\n${JSON.stringify({ records })}`,
    maxTokens: 4000,
    timeoutMs: 25_000,
    temperature: 0,
    schema: NAMES_SCHEMA,
  });
  const a = res.text.indexOf("{");
  const b = res.text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("row naming reply was not JSON");
  const parsed = JSON.parse(res.text.slice(a, b + 1)) as { names?: unknown };
  const out: [string, string][] = [];
  for (const entry of Array.isArray(parsed.names) ? parsed.names : []) {
    const { id, name } = (entry ?? {}) as { id?: unknown; name?: unknown };
    const item = typeof id === "string" && /^\d+$/.test(id) ? items[Number(id) - 1] : undefined;
    const clean = item ? guardedName(name, item) : null;
    if (item && clean) out.push([item.key, clean]);
  }
  return out;
}

const AGENCY = /\b(HPD|DOB|ECB|OATH|NYPD|DSNY|DOHMH|DEP)\b/;
const FINE = /\b(fine[ds]?|penalt(y|ies))\b/i;

/**
 * The model's name for a record, tidied, or null if it is out of length bounds, has markup or an
 * agency acronym, has a number that is not in the record, or calls something a fine that the city's
 * wording doesn't.
 */
function guardedName(raw: unknown, item: NamingItem): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (name.length < 3 || name.length > 70) return null;
  if (/[*#_`<>]/.test(name) || AGENCY.test(name)) return null;
  const source = `${item.text} ${item.current}`;
  const allowed = new Set(source.match(/\d+/g) ?? []);
  if ((name.match(/\d+/g) ?? []).some((n) => !allowed.has(n))) return null;
  if (FINE.test(name) && !FINE.test(source)) return null;
  return name;
}

interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  /** Defaults to LLM_MODEL. */
  model?: string;
  /** Defaults to 0.3. */
  temperature?: number;
  /** A JSON schema the reply must match (OpenRouter structured outputs). */
  schema?: { name: string; strict: boolean; schema: object };
  /** How hard a reasoning model thinks before answering (OpenRouter `reasoning.effort`). */
  effort?: "low" | "medium" | "high";
}

async function chat(cfg: LlmConfig, req: ChatRequest): Promise<LlmResult> {
  const f = cfg.fetcher ?? fetch;
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  if (cfg.appUrl) headers["HTTP-Referer"] = cfg.appUrl;
  if (cfg.appName) headers["X-Title"] = cfg.appName;

  const res = await f(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: req.model ?? LLM_MODEL,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.3,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.schema ? { response_format: { type: "json_schema", json_schema: req.schema } } : {}),
      ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as ChatCompletion;
  if (body.error) throw new Error(`llm: ${body.error.message ?? "unknown error"}`);
  // A reply that ran into the token limit is cut mid-sentence (or mid-JSON): never use it.
  if (body.choices?.[0]?.finish_reason === "length") throw new Error("llm: reply was cut off at the token limit");
  return { text: (body.choices?.[0]?.message?.content ?? "").trim(), model: body.model ?? req.model ?? LLM_MODEL };
}

/** The model's text, or null if it is out of length bounds, stops mid-sentence, has markdown, or has an integer not in `input`. */
function guarded(text: string, input: string, min: number, max: number): string | null {
  if (!text || text.length < min || text.length > max) return null;
  if (!/[.!?]["')\]]?$/.test(text)) return null;
  if (/[*#_`]/.test(text)) return null; // markdown leaked; keep the template
  const allowed = new Set(input.match(/\d+/g) ?? []);
  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(n))) return null;
  return text;
}
