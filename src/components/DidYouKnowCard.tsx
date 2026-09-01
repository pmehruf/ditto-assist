/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { AnnouncementContent } from "./AnnouncementContent";

interface InsightRow {
  id: number;
  announcement: string;
}

type CardState = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; announcement: string };

/**
 * "Did you know!?" — a thought-of-the-day style card. Lives in the narrow
 * 260px column of the Home Dashboard's supporting row (LookupIntroPage.tsx),
 * next to QA Performance + the Announcement Counter card stacked in the
 * wide cell — the same slot the Announcement Counter card used to occupy,
 * swapped by explicit request since this card's content (a single Insight)
 * suits a tall, naturally-vertical, scrollable card far better than a strip
 * of horizontal stat numbers does. Content is sourced from the Insight type
 * in the Announcement Manager (see QAAnnouncementForm.tsx's "Insight"
 * branch and server.ts's dedicated GET /api/announcements/insight route)
 * rather than being hardcoded here — an admin publishes an Insight the same
 * way they publish any other announcement, and the latest one appears here
 * automatically.
 *
 * `h-full` + the body's `flex-1 min-h-0 overflow-y-auto` let this card fill
 * exactly the height LookupIntroPage.tsx measures from its sibling cell
 * (QA Performance + Announcement Counter's combined natural height — see
 * that page's `useMeasuredHeight` usage) and scroll internally if an
 * Insight is too long to fit, same pattern the "Updates - Live feed" card
 * uses for its own height-matched column.
 */
export function DidYouKnowCard({ theme }: { theme: "light" | "dark" }) {
  const [state, setState] = useState<CardState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/announcements/insight")
      .then((res) => (res.ok ? res.json() : { entry: null }))
      .then((body) => {
        if (cancelled) return;
        const entry: InsightRow | null = body?.entry || null;
        if (entry && typeof entry.announcement === "string" && entry.announcement.trim()) {
          setState({ kind: "ready", announcement: entry.announcement });
        } else {
          setState({ kind: "empty" });
        }
      })
      .catch((err) => {
        console.error("Failed to load Insight for the Did you know card:", err);
        if (!cancelled) setState({ kind: "empty" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const headerIconColor = theme === "dark" ? "#FBBF24" : "#B45309";
  const headerIconBg = theme === "dark" ? "#FBBF241A" : "#B453091A";

  const cardClass = `relative rounded-2xl border px-5 py-3.5 h-full flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 select-none mb-2 shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
          <Lightbulb className="w-3.5 h-3.5" />
        </div>
        <span className={`text-[13px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          Did you know!?
        </span>
      </div>

      {/* Body — flex-1 min-h-0 so it fills whatever room the card has
          (natural height when stacked/short, the full flex-grown height at
          `lg`+ — see this component's doc comment) with internal scroll as
          a safety net for an unusually long Insight rather than overflow. */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {state.kind === "loading" && (
          <div className="animate-pulse space-y-1.5">
            <div className={`h-3 w-full rounded ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
            <div className={`h-3 w-4/5 rounded ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
          </div>
        )}

        {state.kind === "empty" && (
          <p className={`text-[12.5px] font-medium leading-relaxed ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            No insight has been published yet.
          </p>
        )}

        {state.kind === "ready" && (
          <AnnouncementContent
            content={state.announcement}
            theme={theme}
            className="text-[13px] leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}

export default DidYouKnowCard;
