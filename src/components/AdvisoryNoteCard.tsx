/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle } from "lucide-react";

interface AdvisoryNoteCardProps {
  theme: "light" | "dark";
  /** Extra sizing/spacing classes for the outer card — default matches the
      original Home-page placement's width/margin. */
  className?: string;
}

/**
 * "Advisory Note" warning card — extracted from LookupIntroPage.tsx (the
 * Home page) and moved to the Declarations page, where it now sits ahead of
 * the primary "Find a Match" action.
 */
export function AdvisoryNoteCard({ theme, className = "mb-3 max-w-[34.375rem]" }: AdvisoryNoteCardProps) {
  return (
    <div
      style={{
        padding: "clamp(10px, 1.8vh, 14px)",
        ...(theme === "dark"
          ? { background: "linear-gradient(135deg, #0f1f3d 0%, #14243f 45%, #7f1d1d 100%)" }
          : {}),
      }}
      className={`rounded-2xl shadow-xs ${className} ${
        theme === "light" ? "bg-gradient-to-br from-indigo-100 via-rose-100 to-red-200" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${theme === "dark" ? "text-[#ff9f43]" : "text-amber-700"}`} />
        <span
          style={{ fontSize: "clamp(10px, 1.5vh, 12px)" }}
          className={`font-mono uppercase tracking-wide font-black ${
            theme === "dark" ? "text-[#ff9f43]" : "text-amber-700"
          }`}
        >
          Advisory Note
        </span>
      </div>
      <p
        style={{ fontSize: "clamp(10px, 1.5vh, 12px)" }}
        className={`leading-relaxed font-medium ${
          theme === "dark" ? "text-white/85" : "text-stone-800"
        }`}
      >
        Results may not be accurate in every case. This tool supports your judgement, it doesn't replace it. Always verify before disclosing, and reach out to your mentor when you need clarity.
      </p>
    </div>
  );
}
