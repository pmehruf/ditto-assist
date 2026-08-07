/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Megaphone, X, ChevronLeft, ChevronRight } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "../utils/announcementHtml";
import { isoDateToDMY } from "../utils/dateFormat";
import { teamLabel } from "../utils/announcementDisplay";

/**
 * Non-blocking popup opened by clicking one of the Workspace Announcements
 * card's stat tiles (New / Went Live / Live Today) — deliberately styled
 * like AnnouncementAckModal (same overlay shell, header, scrollable
 * white content card) so it reads as the same "read an announcement"
 * surface advisors already know, but WITHOUT that modal's blocking /
 * scroll-to-unlock / mark-as-read mechanics: these announcements aren't
 * necessarily unread, this is just a fast way to browse the count behind a
 * stat tile without leaving the Workspace for the full archive.
 */
export function AnnouncementStatModal({
  theme,
  title,
  announcements,
  onClose,
}: {
  theme: "light" | "dark";
  /** e.g. "New This Week", "Went Live This Week", "Live Today". */
  title: string;
  announcements: QAAnnouncement[];
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(announcements.length === 1 ? 0 : null);
  const selected = selectedIdx !== null ? announcements[selectedIdx] : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`absolute inset-0 backdrop-blur-md ${theme === "dark" ? "bg-black/60" : "bg-stone-900/40"}`} />

      <div
        className={`relative w-full max-w-xl max-h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
          theme === "dark" ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        {/* Header */}
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b flex items-start justify-between gap-3 ${theme === "dark" ? "border-stone-800" : "border-stone-200"}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 shrink-0" style={{ color: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
              <h2 className={`text-sm font-bold uppercase tracking-wider truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                {title}
              </h2>
            </div>
            <p className={`text-xs font-semibold mt-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              {announcements.length} announcement{announcements.length === 1 ? "" : "s"}
              {selected ? " · " : ""}
              {selected && (selected.title || selected.category)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
              theme === "dark" ? "text-stone-400 hover:text-white hover:bg-white/[0.06]" : "text-stone-500 hover:text-stone-800 hover:bg-stone-100"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 flex flex-col px-5 py-4">
          {announcements.length === 0 ? (
            <div className={`flex-1 flex flex-col items-center justify-center text-center gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
              <Megaphone className="w-5 h-5 opacity-50" />
              <span className="text-[11.5px] font-medium">Nothing in this category right now.</span>
            </div>
          ) : selected === null ? (
            // LIST VIEW
            <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
              {announcements.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left rounded-xl border p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    theme === "dark"
                      ? "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.16]"
                      : "border-stone-200 bg-stone-50/60 hover:bg-white hover:border-stone-300"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span
                        className="text-[9px] font-mono font-bold bg-[#3B82F6]/10 px-1.5 py-[1px] rounded border border-[#3B82F6]/25"
                        style={{ color: "var(--accent)" }}
                      >
                        {item.title || item.category}
                      </span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                        theme === "dark" ? "bg-white/[0.04] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-500 border-stone-200"
                      }`}>
                        {teamLabel(item)}
                      </span>
                    </div>
                    <p className={`text-[11px] leading-snug font-medium line-clamp-1 ${theme === "dark" ? "text-white/60" : "text-stone-600"}`}>
                      {item.announcement.replace(/<[^>]+>/g, "")}
                    </p>
                  </div>
                  <div className={`shrink-0 flex flex-col items-end gap-0.5 text-[9.5px] font-semibold ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                    {item.effectiveDate && <span>Eff. {isoDateToDMY(item.effectiveDate)}</span>}
                    <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            // DETAIL VIEW
            <>
              {announcements.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSelectedIdx(null)}
                  className={`shrink-0 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide mb-2.5 cursor-pointer transition-colors ${
                    theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back to list
                </button>
              )}
              <div className="shrink-0 flex items-center gap-1.5 flex-wrap mb-2.5">
                <span
                  className="text-[9px] font-mono font-bold bg-[#3B82F6]/10 px-1.5 py-[1px] rounded border border-[#3B82F6]/25"
                  style={{ color: "var(--accent)" }}
                >
                  {selected.title || selected.category}
                </span>
                {selected.type && (
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                    theme === "dark"
                      ? "bg-amber-500/10 text-amber-500 border-amber-500/25"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {selected.type}
                  </span>
                )}
                {selected.rating !== undefined && selected.rating > 0 && (
                  <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-[1px] rounded border ${
                    theme === "dark"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  }`}>
                    Rating: {selected.rating}
                  </span>
                )}
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto pr-2 rounded-lg border border-stone-200 bg-[#ffffff] text-[#111827] p-3 text-xs leading-relaxed"
              >
                <AnnouncementContent content={selected.announcement} theme={theme} forceLightContrast />
              </div>

              <div className={`shrink-0 flex items-center justify-end gap-3 mt-2 text-[10px] font-semibold ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                <span>
                  {selected.announcementDate ? `Announced: ${isoDateToDMY(selected.announcementDate)}` : ""}
                  {selected.effectiveDate ? `${selected.announcementDate ? " · " : ""}Effective: ${isoDateToDMY(selected.effectiveDate)}` : ""}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
