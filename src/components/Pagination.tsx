/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClippedButton } from "./ClippedButton";

interface PaginationProps {
  theme: "light" | "dark";
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Numbered page control — "Previous, 1, 2, 3 ... Next" — shared by every
 * server-paginated table in the app (PED Repository, Activity Log, AI
 * Mapping Review, Search History, Announcement History, User Management).
 * Deliberately NOT infinite-scroll: every one of those tables needs an
 * addressable page number, not a scroll position.
 *
 * Shows every page when there are 7 or fewer; otherwise always shows the
 * first two, the last two, the current page +/-1, and collapses the rest
 * into an ellipsis — the standard "1 2 ... 8 9 10 ... 41 42" treatment.
 */
export function Pagination({ theme, page, totalPages, onPageChange, className = "" }: PaginationProps) {
  const dark = theme === "dark";
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(page, totalPages);
  const btnBase =
    "min-w-[26px] h-[26px] px-1.5 flex items-center justify-center text-[10.5px] font-bold rounded-md transition-all shrink-0";

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      <ClippedButton
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        cornerBg={dark ? "#0e2236" : "#ffffff"}
        className={`p-1.5 ${dark ? "text-stone-300" : "text-stone-600"}`}
        title="Previous page"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </ClippedButton>

      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className={`px-1 text-[10.5px] font-bold select-none ${dark ? "text-stone-500" : "text-stone-400"}`}>
            &hellip;
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={`${btnBase} ${
              p === page
                ? "text-white"
                : dark
                ? "text-stone-400 hover:text-stone-200 hover:bg-white/[0.06]"
                : "text-stone-500 hover:text-stone-800 hover:bg-black/[0.04]"
            }`}
            style={p === page ? { backgroundColor: "var(--action-navy)" } : undefined}
          >
            {p}
          </button>
        )
      )}

      <ClippedButton
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        cornerBg={dark ? "#0e2236" : "#ffffff"}
        className={`p-1.5 ${dark ? "text-stone-300" : "text-stone-600"}`}
        title="Next page"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </ClippedButton>
    </div>
  );
}

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const keep = new Set<number>([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = Array.from(keep)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);

  const result: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("ellipsis");
    result.push(p);
    prev = p;
  }
  return result;
}
