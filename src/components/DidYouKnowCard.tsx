/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";

interface DidYouKnowItem {
  id: string;
  source: "Health" | "Term";
  question: string;
  answer: string;
}

type CardState = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; items: DidYouKnowItem[] };

const ROTATE_MS = 10000;

/**
 * "Did you know!?" — UPDATED LOGIC (2026-09): no longer controlled through
 * the Announcement Manager (the old "Insight" type is retired — see
 * server.ts, which no longer has a dedicated insight route). Instead this is
 * a live, continuously-sliding feed of Health + Term FAQ pairs (question AND
 * answer — an advisor needs both, an answer alone doesn't stand on its own),
 * sourced from GET /api/did-you-know (see src/server/knowledgeBase/didYouKnow.ts).
 * Visibility and daily rotation are entirely server-side (tag-based
 * Health/Term/both filtering, shortest-combined-length-first ordering,
 * refreshed once a day) — this component only renders whatever list it's
 * handed and rotates through it locally, same "continuous sliding format"
 * chrome as HomeAnnouncementCard (slide/fade transition, position dots,
 * prev/next chevrons) but with its OWN independent timer/index — it isn't
 * wired to App.tsx's shared `noticeIndex` the way the Updates feed is, since
 * this card's content is a completely different rotation.
 *
 * Font sizes here are deliberately ~1-2px smaller than this card's previous
 * single-Insight version (13px/12.5px) per explicit product feedback: an
 * advisor reads both the question and the answer, so fitting as much as
 * possible into one view without scrolling matters more than usual.
 *
 * Lives in the narrow column of the Home Dashboard's supporting row (see
 * LookupIntroPage.tsx) — `h-full` + the body's `flex-1 min-h-0
 * overflow-y-auto` let this card fill exactly the height that column
 * measures from its sibling cell and scroll internally if a pair is too
 * long to fit, same pattern the "Updates - Live feed" card uses.
 */
export function DidYouKnowCard({ theme }: { theme: "light" | "dark" }) {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [index, setIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"right-to-left" | "left-to-right">("right-to-left");
  const indexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/did-you-know")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((body) => {
        if (cancelled) return;
        const items: DidYouKnowItem[] = Array.isArray(body?.items) ? body.items : [];
        setState(items.length > 0 ? { kind: "ready", items } : { kind: "empty" });
      })
      .catch((err) => {
        console.error("Failed to load the Did You Know feed:", err);
        if (!cancelled) setState({ kind: "empty" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Own local auto-rotation timer — deliberately independent of App.tsx's
  // shared announcement carousel timer (see this component's doc comment).
  useEffect(() => {
    if (state.kind !== "ready" || state.items.length <= 1) return;
    const timer = setInterval(() => {
      setSlideDirection("right-to-left");
      setIndex((i) => (i + 1) % state.items.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const headerIconColor = theme === "dark" ? "#FBBF24" : "#B45309";
  const headerIconBg = theme === "dark" ? "#FBBF241A" : "#B453091A";

  const cardClass = `relative rounded-2xl border px-5 py-3.5 h-full flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const items = state.kind === "ready" ? state.items : [];
  const item = items.length > 0 ? items[index % items.length] : null;

  const goTo = (idx: number) => {
    setSlideDirection(idx > indexRef.current ? "right-to-left" : "left-to-right");
    setIndex(idx);
  };

  // Position dots are a "we're moving through a feed" animation cue, not a
  // literal 1:1 count of every FAQ (the pool can run to 30 items across
  // Health+Term) — explicit product feedback. A FIXED row of dots
  // (MAX_VISIBLE_DOTS, or fewer for a short feed); the lit dot's SLOT
  // sweeps left-to-right one position per rotation (`index % windowSize`)
  // and wraps back to the start, rather than mapping 1:1 to an item.
  //
  // This is a deliberate fix for an earlier version that instead kept a
  // sliding window of real item indices RECENTERED on the current item
  // every render — since recentering always puts the active item back at
  // the same middle slot, the lit dot never actually moved and the fade
  // shape never changed, so the whole row looked static despite the feed
  // itself rotating underneath it. Sweeping a fixed slot across a fixed
  // row is what actually reads as motion.
  const MAX_VISIBLE_DOTS = 8;
  const windowSize = Math.min(items.length, MAX_VISIBLE_DOTS) || 1;
  const activeDotPos = items.length > 0 ? index % windowSize : 0;
  const visibleDots = Array.from({ length: windowSize }, (_, pos) => {
    const distanceFromEdge = Math.min(pos, windowSize - 1 - pos);
    const fade = windowSize <= 3 ? 1 : distanceFromEdge === 0 ? 0.3 : distanceFromEdge === 1 ? 0.65 : 1;
    return { pos, fade };
  });

  const motionVariants = {
    enter: (dir: "right-to-left" | "left-to-right") => ({ x: dir === "right-to-left" ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: "right-to-left" | "left-to-right") => ({ x: dir === "right-to-left" ? -40 : 40, opacity: 0 }),
  };

  return (
    <div className={cardClass}>
      {/* Header — the Health/Term FAQ source badge sits on this same line,
          right-aligned, instead of its own row below (explicit request:
          frees up a full line of vertical space for the question/answer
          body). Only rendered once an item is actually loaded. */}
      <div className="flex items-center justify-between gap-2 select-none mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
            <Lightbulb className="w-3.5 h-3.5" />
          </div>
          <span className={`text-[13px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            Did you know!?
          </span>
        </div>
        {item && (
          <span
            className={`text-[10px] font-bold uppercase tracking-wide truncate shrink-0 ${
              item.source === "Health"
                ? theme === "dark" ? "text-emerald-400" : "text-emerald-700"
                : theme === "dark" ? "text-sky-400" : "text-sky-700"
            }`}
          >
            {item.source} FAQ
          </span>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="animate-pulse space-y-1.5">
          <div className={`h-3 w-full rounded ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
          <div className={`h-3 w-4/5 rounded ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
        </div>
      )}

      {state.kind === "empty" && (
        <p className={`text-[11.5px] font-medium leading-relaxed ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
          No FAQs available yet — connect the Health and/or Term FAQ sheet under Connections.
        </p>
      )}

      {item && (
        <>
          {/* Body — flex-1 min-h-0 so it fills whatever room the card has,
              with internal scroll as a safety net for an unusually long
              pair (see this component's doc comment). */}
          <div
            className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-0.5"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: theme === "dark" ? "#475569 transparent" : "#94A3B8 transparent",
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={item.id}
                custom={slideDirection}
                variants={motionVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 260, damping: 28 }}
                className="space-y-1"
              >
                <p className={`text-[12px] font-bold leading-snug ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                  {item.question}
                </p>
                <p className={`text-[11.5px] leading-relaxed whitespace-pre-wrap ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>
                  {item.answer}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Position + navigation — omitted for a single-item feed, same
              convention HomeAnnouncementCard uses. */}
          {items.length > 1 && (
            <div
              className="flex items-center justify-between gap-2 mt-[clamp(4px,0.8vh,10px)] pt-[clamp(4px,0.8vh,8px)] border-t border-dashed shrink-0"
              style={{ borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(168,162,158,0.35)" }}
            >
              <div className="flex items-center gap-1 select-none">
                {visibleDots.map(({ pos, fade }) => {
                  const isActive = pos === activeDotPos;
                  // Dots don't map 1:1 to items (see visibleDots' comment) —
                  // clicking one jumps the same number of steps forward/back
                  // as it is from the currently lit slot, so the click still
                  // does something sensible without pretending pos === item.
                  const targetIdx = ((index + (pos - activeDotPos)) % items.length + items.length) % items.length;
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => goTo(targetIdx)}
                      className="shrink-0 py-1 px-[1.5px] cursor-pointer group leading-none transition-opacity duration-300"
                      style={{ opacity: fade }}
                      title={isActive ? "Current FAQ" : pos < activeDotPos ? "Go back" : "Go forward"}
                    >
                      <span
                        className={`block h-[5px] rounded-full transition-all duration-300 ${
                          isActive
                            ? "w-4"
                            : theme === "dark" ? "w-[5px] bg-stone-600 group-hover:bg-stone-500" : "w-[5px] bg-stone-400 group-hover:bg-stone-500"
                        }`}
                        style={isActive ? { backgroundColor: theme === "dark" ? "#FBBF24" : "#B45309" } : undefined}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => goTo((index - 1 + items.length) % items.length)}
                  style={{ backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)" }}
                  className={`w-6 h-6 rounded-md transition-all cursor-pointer flex items-center justify-center border hover:scale-[1.05] active:scale-[0.95] ${
                    theme === "dark" ? "border-white/[0.08]" : "border-slate-200"
                  }`}
                  title="Previous FAQ"
                >
                  <ChevronLeft className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                </button>
                <button
                  type="button"
                  onClick={() => goTo((index + 1) % items.length)}
                  style={{ backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)" }}
                  className={`w-6 h-6 rounded-md transition-all cursor-pointer flex items-center justify-center border hover:scale-[1.05] active:scale-[0.95] ${
                    theme === "dark" ? "border-white/[0.08]" : "border-slate-200"
                  }`}
                  title="Next FAQ"
                >
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DidYouKnowCard;
