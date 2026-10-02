// Inline address dropdown for the search box. Suggestions come from NYC's GeoSearch
// (shared/suggest.ts); picking one submits it straight away, carrying along any
// apartment the user typed. Keyboard: arrows to move, Enter to pick, Esc to close.

import { splitUnit, withUnit } from "@shared/address";
import { autocompleteUrl, parseSuggestions, queryFor, type Suggestion } from "@shared/suggest";

const DEBOUNCE_MS = 120;
const CACHE_MAX = 200;

export function attachAutocomplete(input: HTMLInputElement, onPick: (address: string) => void): void {
  const list = document.createElement("ul");
  list.className = "ac-list";
  list.id = `${input.id}-list`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.insertAdjacentElement("afterend", list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);

  let items: Suggestion[] = [];
  let active = -1;
  let debounce = 0;
  let seq = 0;
  let inflight: AbortController | null = null;
  const cache = new Map<string, Suggestion[]>();

  function close() {
    items = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function highlight() {
    Array.from(list.children).forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function show(next: Suggestion[]) {
    items = next;
    active = -1;
    list.replaceChildren(
      ...items.map((s, i) => {
        const li = document.createElement("li");
        li.id = `${list.id}-${i}`;
        li.setAttribute("role", "option");
        const primary = document.createElement("span");
        primary.className = "ac-primary";
        primary.textContent = s.primary;
        const secondary = document.createElement("span");
        secondary.className = "ac-secondary";
        secondary.textContent = s.secondary;
        li.append(primary, secondary);
        // A mouse press must not steal focus from the input; touch keeps its default so the list can scroll.
        li.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "mouse") e.preventDefault();
        });
        li.addEventListener("click", () => pick(i));
        li.addEventListener("pointermove", () => {
          if (active !== i) {
            active = i;
            highlight();
          }
        });
        return li;
      }),
    );
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(items.length > 0));
    highlight();
  }

  function pick(i: number) {
    const s = items[i];
    if (!s) return;
    const address = withUnit(s.label, splitUnit(input.value).unit);
    input.value = address;
    close();
    onPick(address);
  }

  async function load(q: string) {
    const cached = cache.get(q);
    if (cached) {
      show(cached);
      return;
    }
    inflight?.abort();
    inflight = new AbortController();
    const mine = ++seq;
    try {
      const res = await fetch(autocompleteUrl(q), { signal: inflight.signal });
      if (!res.ok) return;
      const parsed = parseSuggestions(await res.json());
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(q, parsed);
      if (mine === seq && document.activeElement === input) show(parsed);
    } catch {
      /* aborted or offline: the form still works without suggestions */
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(debounce);
    const q = queryFor(input.value);
    if (!q) {
      inflight?.abort();
      seq++;
      close();
      return;
    }
    debounce = window.setTimeout(() => void load(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % items.length;
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      highlight();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      close();
    }
  });

  // Reopen the last results when focus returns; close when focus tabs away or a press lands outside.
  input.addEventListener("focus", () => {
    const q = queryFor(input.value);
    const cached = q ? cache.get(q) : undefined;
    if (list.hidden && cached?.length) show(cached);
  });
  input.addEventListener("blur", (e) => {
    if (e.relatedTarget) close();
  });
  const onPressOutside = (e: PointerEvent) => {
    if (!input.isConnected) {
      document.removeEventListener("pointerdown", onPressOutside);
      return;
    }
    const t = e.target as Node | null;
    if (!list.hidden && t && !input.contains(t) && !list.contains(t)) close();
  };
  document.addEventListener("pointerdown", onPressOutside);
}
