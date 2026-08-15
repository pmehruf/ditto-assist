/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from "react";
import { X } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "./AnnouncementContent";
import { isoDateToDMY } from "../utils/dateFormat";
import { ratingColorClasses, teamLabel } from "../utils/announcementDisplay";
import { ClippedButton } from "./ClippedButton";

/**
 * Read-only "readability window" popup for a single announcement — used by
 * both the Announcement Manager's table (admin) and the advisor-facing
 * Announcements archive, so a long announcement never has to be read inside
 * a cramped in-cell/in-tile scrollbox. Purely a viewer: unlike
 * AnnouncementAckModal there's no scroll-to-enable gate, and it closes via
 * the X button, a backdrop click, or Escape.
 */
export function AnnouncementReadModal({
  item,
  theme,
  onClose,
}: {
  item: QAAnnouncement;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const dark = theme === "dark";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Announcement">
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} onClick={onClose} />

      <div
        className={`relative w-full max-w-2xl max-h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
          // Plain opaque hex, not bg-white — floating modal shell, must stay
          // fully opaque regardless of card-surface translucency.
          dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        {/* Header */}
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b flex items-start justify-between gap-3 ${dark ? "border-stone-800" : "border-stone-200"}`}>
          <div className="min-w-0">
            <h2 className={`text-sm font-bold break-words ${dark ? "text-white" : "text-stone-900"}`}>
              {item.title || item.category}
            </h2>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span
                className="text-[9px] font-mono font-bold bg-[#3B82F6]/10 px-1.5 py-[1px] rounded border border-[#3B82F6]/25"
                style={{ color: "var(--accent)" }}
              >
                {item.category}
              </span>
              {item.type && (
                <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                  dark ? "bg-amber-500/10 text-amber-500 border-amber-500/25" : "bg-amber-50 text-amber-700 border-amber-200"
                }`}>
                  {item.type}
                </span>
              )}
              <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                dark ? "bg-white/[0.04] text-stone-300 border-white/[0.08]" : "bg-stone-100 text-stone-600 border-stone-200"
              }`}>
                {teamLabel(item)}
              </span>
              {item.rating !== undefined && item.rating > 0 && (
                <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-[1px] rounded border ${ratingColorClasses(item.rating, dark)}`}>
                  Rating: {item.rating}
                </span>
              )}
            </div>
          </div>
          <ClippedButton
            type="button"
            onClick={onClose}
            cornerBg={dark ? "#12151A" : "#ffffff"}
            className={`p-1.5 shrink-0 ${dark ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"}`}
            title="Close"
          >
            <X className="w-4 h-4" />
          </ClippedButton>
        </div>

        {/* Body */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed ${
            dark ? "text-stone-100" : "text-stone-850"
          }`}
        >
          <AnnouncementContent content={item.announcement} theme={theme} />
        </div>

        {/* Footer — metadata */}
        <div className={`shrink-0 px-5 py-3 border-t flex items-center justify-between gap-3 text-[10px] font-semibold ${
          dark ? "border-stone-800 text-stone-500" : "border-stone-200 text-stone-500"
        }`}>
          <span className="truncate">By: <span className="font-semibold">{item.addedBy}</span></span>
          <span className="shrink-0 whitespace-nowrap">
            {item.announcementDate ? `Announced: ${isoDateToDMY(item.announcementDate)}` : ""}
            {item.effectiveDate ? `${item.announcementDate ? " · " : ""}Effective: ${isoDateToDMY(item.effectiveDate)}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
