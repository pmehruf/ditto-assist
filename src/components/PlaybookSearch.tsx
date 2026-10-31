/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK — keyword search over what's on screen, like the browser's
 * Ctrl+F. Matches are highlighted with the CSS Custom Highlight API (the page's
 * DOM and text are never changed). Ctrl/Cmd+F focuses the box while the page is
 * open; Enter / Shift+Enter move to the next / previous match; Esc clears.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

interface Props {
  target: RefObject<HTMLElement | null>;
  /** Changes whenever the searched content changes, so matches are found again. */
  refreshKey: string;
  theme: "light" | "dark";
}

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function findRanges(root: HTMLElement | null, query: string): Range[] {
  const q = query.trim().toLowerCase();
  if (!root || !q) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").toLowerCase();
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      out.push(r);
    }
  }
  return out;
}

export function PlaybookSearch({ target, refreshKey, theme }: Props) {
  const dark = theme === "dark";
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const paint = useCallback((i: number) => {
    if (!supported()) return;
    CSS.highlights.set("pb-match", new Highlight(...ranges.current));
    const r = ranges.current[i];
    if (r) {
      CSS.highlights.set("pb-current", new Highlight(r));
      r.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    } else {
      CSS.highlights.delete("pb-current");
    }
  }, []);

  // Ctrl/Cmd+F focuses this search box while the page is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Find matches again when the query or the content changes (after the content has painted).
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      ranges.current = findRanges(target.current, query);
      setCount(ranges.current.length);
      setCurrent(0);
      paint(0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [query, refreshKey, target, paint]);

  useEffect(() => () => {
    if (supported()) {
      CSS.highlights.delete("pb-match");
      CSS.highlights.delete("pb-current");
    }
  }, []);

  const go = (step: number) => {
    if (!count) return;
    const next = (current + step + count) % count;
    setCurrent(next);
    paint(next);
  };

  const box = dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-[#8A9BB0] text-[#1E293B]";
  const muted = dark ? "text-[#A9C0DC]" : "text-[#4C5A72]";
  return (
    <div className={`flex items-center gap-1 w-full max-w-md rounded-lg border px-2.5 py-1.5 shadow-sm ${box}`}>
      <style>{"::highlight(pb-match){background-color:#fde68a;color:#111827}::highlight(pb-current){background-color:#f97316;color:#ffffff}"}</style>
      <Search className={`w-3.5 h-3.5 shrink-0 ${muted}`} />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="Search keywords"
        aria-label="Search keywords"
        className="bg-transparent outline-none text-xs flex-1 min-w-0 placeholder:opacity-70"
      />
      {query && (
        <>
          <span className={`text-[11px] tabular-nums whitespace-nowrap ${muted}`}>{count ? `${current + 1} of ${count}` : "No matches"}</span>
          <button onClick={() => go(-1)} disabled={!count} aria-label="Previous match" className="p-0.5 rounded disabled:opacity-40"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => go(1)} disabled={!count} aria-label="Next match" className="p-0.5 rounded disabled:opacity-40"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={() => setQuery("")} aria-label="Clear search" className="p-0.5 rounded"><X className="w-3.5 h-3.5" /></button>
        </>
      )}
    </div>
  );
}
