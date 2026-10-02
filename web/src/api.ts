import type { CheckoutResponse, ClaimResponse, ReportResponse, SearchResponse } from "@shared/types";

const TOKEN_PREFIX = "bt:token:";

export function getToken(reportId: string): string | null {
  try {
    return localStorage.getItem(TOKEN_PREFIX + reportId);
  } catch {
    return null;
  }
}

export function setToken(reportId: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_PREFIX + reportId, token);
  } catch {
    /* private mode; the URL hash still carries it for this visit */
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | null;
  if (body === null) throw new Error(`Bad response (${res.status})`);
  return body;
}

export async function search(address: string): Promise<SearchResponse> {
  const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  return json<SearchResponse>(res);
}

export async function getReport(id: string, token: string | null): Promise<ReportResponse | null> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api/report/${encodeURIComponent(id)}`, { headers });
  if (res.status === 404) return null;
  return json<ReportResponse>(res);
}

export async function checkout(reportId: string, plan: "report" | "watch"): Promise<CheckoutResponse> {
  const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId, plan }) });
  if (!res.ok) throw new Error("Could not start checkout");
  return json<CheckoutResponse>(res);
}

export async function claim(reportId: string, sessionId: string): Promise<ClaimResponse> {
  const res = await fetch(`/api/report/${encodeURIComponent(reportId)}/claim?session_id=${encodeURIComponent(sessionId)}`);
  return json<ClaimResponse>(res);
}
