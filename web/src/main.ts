// Tiny router: "/" is the search page, "/r/:id" is a report (teaser or full),
// "/privacy" and "/terms" are static pages.
// The access token travels in the URL hash from emailed links, is stored in
// localStorage, and is sent as a bearer header on API calls.

import { claim, getReport, getToken, search, setToken } from "./api";
import { SUPPORT_EMAIL } from "./legal";
import { renderCandidates, renderError, renderLegal, renderReport, renderSearch, renderTeaser, renderUnlocking } from "./render";

const app = document.getElementById("app")!;

function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route();
}

async function route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/privacy" || path === "/terms") {
    renderLegal(app, path.slice(1) as "privacy" | "terms", { onNew: () => navigate("/") });
    return;
  }
  const m = /^\/r\/([A-Za-z0-9]{8,32})$/.exec(path);
  if (!m) {
    renderSearch(app, { onSubmit: onSearch });
    return;
  }
  const id = m[1]!;

  // 1. Token in the hash (from an emailed link): store it and strip it from the URL.
  const hashToken = /[#&]t=([A-Za-z0-9_-]{40,50})/.exec(location.hash)?.[1];
  if (hashToken) {
    setToken(id, hashToken);
    history.replaceState(null, "", path);
  }

  // 2. Back from Stripe: exchange the session id for a token.
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("session_id");
  if (sessionId) {
    renderUnlocking(app);
    const token = await claimWithRetry(id, sessionId);
    if (token) setToken(id, token);
    history.replaceState(null, "", path);
    if (!token) {
      renderError(app, {
        title: "We ran into an issue",
        message: "We couldn't confirm the payment. If you were charged, the link to your report is in your email.",
        primary: { label: "Try again", onClick: () => navigate(`${path}?session_id=${encodeURIComponent(sessionId)}`, true) },
        secondary: { label: "Back", onClick: () => navigate(path, true) },
        onNew: () => navigate("/"),
      });
      return;
    }
  }

  // 3. Load whichever version the token entitles us to.
  const res = await getReport(id, getToken(id)).catch(() => null);
  if (!res) {
    renderError(app, {
      title: "We couldn't find that",
      primary: { label: "New search", onClick: () => navigate("/") },
      secondary: { label: "Contact support", href: `mailto:${SUPPORT_EMAIL}` },
      onNew: () => navigate("/"),
    });
    return;
  }
  if (res.kind === "full") renderReport(app, res.report, { onNew: () => navigate("/") });
  else renderTeaser(app, res.teaser, { onNew: () => navigate("/") });
}

async function claimWithRetry(id: string, sessionId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await claim(id, sessionId);
      if (r.ok) return r.token;
      if (r.reason !== "not_paid") return null;
    } catch {
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

async function onSearch(address: string) {
  renderSearch(app, { onSubmit: onSearch, busy: true, value: address });
  let res;
  try {
    res = await search(address);
  } catch {
    renderSearch(app, { onSubmit: onSearch, value: address, error: "Something went wrong talking to the city's data. Try again." });
    return;
  }
  if (res.ok) {
    navigate(`/r/${res.reportId}`);
    return;
  }
  if (res.candidates && res.candidates.length) {
    renderCandidates(app, res.candidates, (label) => onSearch(label));
    return;
  }
  renderSearch(app, { onSubmit: onSearch, value: address, error: res.message });
}

// In-app links (footer) navigate without a full reload; modified clicks keep browser behaviour.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[data-nav]");
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href")!);
});

window.addEventListener("popstate", route);
route();
