// Minimal Socrata (SODA 2.1) client for NYC Open Data.
// Throttling: with an app token Socrata does not rate-limit normal use; without one,
// requests share an IP-based pool. Always send the token in production.

export const SODA_BASE = "https://data.cityofnewyork.us/resource";

export type Row = Record<string, string | undefined>;

export class SodaError extends Error {
  constructor(public dataset: string, public status: number, message: string) {
    super(`${dataset}: ${status} ${message}`);
  }
}

export interface SodaOptions {
  appToken?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

/** Build the query string. Values are passed through encodeURIComponent; SoQL keys keep their `$`. */
export function sodaUrl(dataset: string, params: Record<string, string | number>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${SODA_BASE}/${dataset}.json?${qs}`;
}

export async function soda(dataset: string, params: Record<string, string | number>, opts: SodaOptions = {}): Promise<Row[]> {
  const f = opts.fetcher ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.appToken) headers["X-App-Token"] = opts.appToken;
  const res = await f(sodaUrl(dataset, params), { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SodaError(dataset, res.status, text.slice(0, 200));
  }
  return (await res.json()) as Row[];
}

/** SoQL string literal (single quotes doubled). */
export function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
