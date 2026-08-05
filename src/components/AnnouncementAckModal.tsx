/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Megaphone, CheckCircle2 } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "../utils/announcementHtml";
import { isoDateToDMY } from "../utils/dateFormat";
import { ClippedButton } from "./ClippedButton";

/**
 * Blocking read-and-acknowledge overlay. Rendered by App.tsx over the whole
 * app whenever the signed-in user still has unacknowledged announcements
 * (see GET /api/announcements/unacknowledged for the server-side eligibility
 * rules — pre-feature history and pre-join announcements never appear here).
 *
 * Shows ONE announcement at a time, oldest first, each with its own
 * dedicated Mark-as-Read button that stays disabled until the reader has
 * actually scrolled the announcement's full content into view (announcements
 * short enough not to scroll enable the button immediately). There is
 * deliberately no close/skip affordance — dismissal IS acknowledgement.
 */
export function AnnouncementAckModal({
  theme,
  announcements,
  onAcknowledge,
}: {
  theme: "light" | "dark";
  /** Unacked queue, oldest first; the first entry is the one displayed. */
  announcements: QAAnnouncement[];
  /** Called with the announcement's id after Mark as Read; the parent
   * removes it from the queue (and POSTs the ack). */
  onAcknowledge: (id: string) => void;
}) {
  const current = announcements[0];
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Re-evaluate scrollability whenever the displayed announcement changes:
  // content that fits without scrolling unlocks the button right away;
  // otherwise the reader has to reach the bottom first. The rAF defers the
  // measurement one frame so it reads the *rendered* height of the new
  // content, not the previous announcement's.
  useEffect(() => {
    setHasScrolledToEnd(false);
    setSubmitting(false);
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = 0;
        if (el.scrollHeight <= el.clientHeight + 2) setHasScrolledToEnd(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [current?.id]);

  if (!current) return null;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || hasScrolledToEnd) return;
    // 8px tolerance — fractional scroll positions on zoomed/HiDPI displays
    // mean scrollTop + clientHeight rarely lands exactly on scrollHeight.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      setHasScrolledToEnd(true);
    }
  };

  const remaining = announcements.length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Unread announcements — read and acknowledge to continue"
    >
      {/* Blurred, darkened backdrop. Deliberately NOT clickable-to-close. */}
      <div className={`absolute inset-0 backdrop-blur-md ${theme === "dark" ? "bg-black/60" : "bg-stone-900/40"}`} />

      <div
        className={`relative w-full max-w-xl max-h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
          // Plain opaque hex, not bg-white — this is a modal shell floating
          // over the whole app (backdrop included), not a stationary card,
          // so it must stay fully opaque regardless of the card surface's
          // translucency (Unified Surface Philosophy).
          theme === "dark" ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        {/* Header */}
        <div className={`shrink-0 px-5 pt-4 pb-3 border-b ${theme === "dark" ? "border-stone-800" : "border-stone-200"}`}>
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 shrink-0" style={{ color: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <h2 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              Read &amp; Acknowledge to Continue
            </h2>
          </div>
          <p className={`text-xs font-semibold mt-1 ${theme === "dark" ? "text-amber-400" : "text-amber-700"}`}>
            You have {remaining} unread announcement{remaining === 1 ? "" : "s"}. Please read and acknowledge{" "}
            {remaining === 1 ? "it" : "each one"} to continue using the app.
          </p>
        </div>

        {/* Current announcement */}
        <div className="min-h-0 flex-1 flex flex-col px-5 py-4">
          {/* Tag row mirrors the Announcement Manager tiles so the popup
              reads as the same object advisors already know. */}
          <div className="shrink-0 flex items-center gap-1.5 flex-wrap mb-2.5">
            <span
              className="text-[9px] font-mono font-bold bg-[#3B82F6]/10 px-1.5 py-[1px] rounded border border-[#3B82F6]/25"
              style={{ color: "var(--accent)" }}
            >
              {current.title || current.category}
            </span>
            {current.type && (
              <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded border ${
                theme === "dark"
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/25"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}>
                {current.type}
              </span>
            )}
            {current.rating !== undefined && current.rating > 0 && (
              <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-[1px] rounded border ${
                theme === "dark"
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}>
                Rating: {current.rating}
              </span>
            )}
          </div>

          {/* Scrolling body — the scroll-to-end requirement lives here.
              Deliberately a forced-light card regardless of the ambient
              theme: at bg-white/[0.02] (near-transparent) on the dark
              modal's own near-black background, this box barely registered
              as its own surface and the announcement's authored content
              (body text plus any author-picked colors) rendered too low-
              contrast to read comfortably. A plain white card — same
              contract AnnouncementContent's `forceLightContrast` already
              gives the QA lookup-page card — reads clearly in both themes
              and matches how the announcement looked when it was written. */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            // bg-[#ffffff], not bg-white — same reasoning as the modal
            // shell above: a floating overlay needs to stay fully opaque,
            // not pick up the card surface's translucency.
            className="min-h-0 flex-1 overflow-y-auto pr-2 rounded-lg border border-stone-200 bg-[#ffffff] text-stone-850 p-3 text-xs leading-relaxed"
          >
            <AnnouncementContent content={current.announcement} theme={theme} forceLightContrast />
          </div>

          {/* Metadata line — dates only; no author byline here (the popup
              speaks for the QA/compliance process, not a person). */}
          <div className={`shrink-0 flex items-center justify-end gap-3 mt-2 text-[10px] font-semibold ${
            theme === "dark" ? "text-stone-500" : "text-stone-500"
          }`}>
            <span>
              {current.announcementDate ? `Announced: ${isoDateToDMY(current.announcementDate)}` : ""}
              {current.effectiveDate ? `${current.announcementDate ? " · " : ""}Effective: ${isoDateToDMY(current.effectiveDate)}` : ""}
            </span>
          </div>
        </div>

        {/* Footer — dedicated Mark-as-Read for THIS announcement */}
        <div className={`shrink-0 px-5 py-3 border-t flex items-center justify-between gap-3 ${
          theme === "dark" ? "border-stone-800" : "border-stone-200"
        }`}>
          <span className={`text-[10px] font-semibold ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            {hasScrolledToEnd ? "Thanks for reading." : "Scroll to the end to enable the button."}
          </span>
          <ClippedButton
            type="button"
            disabled={!hasScrolledToEnd || submitting}
            onClick={() => {
              if (!hasScrolledToEnd || submitting) return;
              setSubmitting(true);
              onAcknowledge(current.id);
            }}
            cornerBg={theme === "dark" ? "#12151A" : "#ffffff"}
            className={`px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all ${
              hasScrolledToEnd && !submitting
                ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                : "bg-stone-400/40 text-stone-500 cursor-not-allowed"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {submitting ? "Saving…" : "Mark as Read"}
          </ClippedButton>
        </div>
      </div>
    </div>
  );
}
