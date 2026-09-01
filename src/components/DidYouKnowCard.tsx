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
 * "Did you know!?" — a small, thought-of-the-day style card sitting below
 * QA Performance on the Home Dashboard (LookupIntroPage.tsx), same width.
 * Content is sourced from the Insight type in the Announcement Manager (see
 * QAAnnouncementForm.tsx's "Insight" branch and server.ts's dedicated
 * GET /api/announcements/insight route) rather than being hardcoded here —
 * an admin publishes an Insight the same way they publish any other
 * announcement, and the latest one appears here automatically. Deliberately
 * compact: this is a glanceable aside, not another full dashboard section.
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

  const cardClass = `relative rounded-2xl border px-5 py-3.5 flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 select-none mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
          <Lightbulb className="w-3.5 h-3.5" />
        </div>
        <span className={`text-[13px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          Did you know!?
        </span>
      </div>

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
          className="text-[12.5px] leading-relaxed"
        />
      )}
    </div>
  );
}

export default DidYouKnowCard;
