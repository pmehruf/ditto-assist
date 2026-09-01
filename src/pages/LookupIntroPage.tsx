/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type ReactNode } from "react";
import {
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  AlertTriangle,
  ClipboardCheck,
  Briefcase,
  Newspaper,
  History,
  Megaphone,
  ArrowUpRight,
  Gift,
} from "lucide-react";
import { DeclarationMapIcon, ProductAssistIcon } from "../components/icons";
import { QaPerformancePeek } from "../components/QaPerformancePeek";
import { DidYouKnowCard } from "../components/DidYouKnowCard";
import { HomeAnnouncementCard } from "../components/HomeAnnouncementCard";
import { AnnouncementCounterCard } from "../components/AnnouncementCounterCard";
import { AnnouncementStatModal } from "../components/AnnouncementStatModal";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMeasuredHeight } from "../hooks/useMeasuredHeight";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";

type HomeTabId =
  | "lookup"
  | "product_assist"
  | "qa_dashboard"
  | "coverage_projection"
  | "specific_illness_check"
  | "advisory_zone"
  | "announcement_archive"
  | "resources"
  | "my_activity";

interface LookupIntroPageProps {
  theme: "light" | "dark";
  currentUser: LoggedUser | null;
  setShowIntro: (value: boolean) => void;
  setActiveTab: (value: HomeTabId) => void;
  // Announcement carousel — the same shared state App.tsx already drives the
  // Declaration Assist page's carousel with (see HomeAnnouncementCard.tsx's
  // doc comment: one rotation timer in App.tsx, read by whichever page
  // currently renders an announcement card).
  activeAnnouncements: QAAnnouncement[];
  noticeIndex: number;
  setNoticeIndex: (updater: number | ((prev: number) => number)) => void;
  slideDirection: "right-to-left" | "left-to-right";
  setSlideDirection: (value: "right-to-left" | "left-to-right") => void;
  // The FULL (uncapped) announcement list — App.tsx's own `qaAnnouncements`
  // state — feeding the Announcement Counter card's weekly stats, which
  // need accurate counts past the 8-item cap `activeAnnouncements` uses.
  allAnnouncements: QAAnnouncement[];
  // Same gate the sidebar uses (App.tsx's hasAccess) — Quick Actions should
  // only ever offer tools this advisor can actually open.
  hasAccess: (featureId: string, action: "Viewer" | "Editor") => boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Every accent hex on this page was picked for the dark theme (mostly
 * Tailwind -400/-500 shades), which reads fine on a near-black card but
 * washes out against the light theme's white/60 cards — low contrast,
 * "blends into the card" instead of standing out. This maps each of those
 * accents to a darker (-700-ish) equivalent used ONLY in light theme;
 * dark theme always gets the original hex back unchanged. */
const ACCENT_LIGHT_MODE: Record<string, string> = {
  "#FACC15": "#B45309", // yellow-400 -> amber-700
  "#2DD4BF": "#0F766E", // teal-400 -> teal-700
  "#F87171": "#B91C1C", // red-400 -> red-700
  "#34D399": "#047857", // emerald-400 -> emerald-700
  "#0EA5E9": "#0369A1", // sky-500 -> sky-700
  "#22C55E": "#15803D", // green-500 -> green-700
  "#8B5CF6": "#6D28D9", // violet-500 -> violet-700
  "#F59E0B": "#B45309", // amber-500 -> amber-700
  "#EC4899": "#BE185D", // pink-500 -> pink-700
  "#64748B": "#334155", // slate-500 -> slate-700
  "#38BDF8": "#0369A1", // sky-400 -> sky-700
  "#FB923C": "#C2410C", // orange-400 -> orange-700
  "#FB7185": "#BE123C", // rose-400 -> rose-700
  "#14B8A6": "#0F766E", // teal-500 -> teal-700
  "#6366F1": "#4338CA", // indigo-500 -> indigo-700
};
function lightSafe(hex: string, theme: "light" | "dark"): string {
  if (theme === "dark") return hex;
  return ACCENT_LIGHT_MODE[hex] ?? hex;
}

/**
 * A small uppercase-tracked label used above every section, so the page
 * reads as a set of clearly-titled modules rather than one continuous
 * surface.
 */
function SectionLabel({
  icon,
  text,
  hex,
  size = "md",
}: {
  icon: ReactNode;
  text: string;
  hex: string;
  /** "lg" gives Advisory Workspace (the primary section) a touch more
   * visual weight than the "md" secondary/supporting sections use — the
   * only difference between them is type size, never a heavier card
   * treatment, so the hierarchy stays legible without reading as heavy.
   * It also keeps a slightly higher minimum bottom margin than "md" on a
   * short viewport, so the primary section compresses less than
   * secondary/supporting ones as available height shrinks. */
  size?: "md" | "lg";
}) {
  return (
    <div className={`flex items-center gap-2 select-none ${size === "lg" ? "mb-[clamp(6px,1vh,12px)]" : "mb-[clamp(3px,0.7vh,12px)]"}`}>
      <span style={{ color: hex }}>{icon}</span>
      <span
        style={{ color: hex }}
        className={`font-mono uppercase tracking-[0.2em] font-bold ${size === "lg" ? "text-[13px]" : "text-[12px]"}`}
      >
        {text}
      </span>
    </div>
  );
}

interface QuickActionTile {
  id: string;
  featureId: string;
  title: string;
  tag: string;
  icon: ReactNode;
  hex: string;
  instructions: string;
  ctaLabel: string;
  onOpen: () => void;
  /** Renders a "SOON" badge, dims the tile, and disables its click/expand
   * behavior — for a tool that's visible (so advisors know it's coming) but
   * not yet launched. See renderTile below. */
  comingSoon?: boolean;
}

/**
 * Home page — the advisor's *workspace*, not a dashboard for any one
 * module. Two tiers, matching the hierarchy an advisor should read at a
 * glance ("these are my tools" -> "these are updates/activity"):
 *  1. WORKSPACE TOOLS — one merged section/grid under a single heading,
 *     combining the day-to-day tools (Declaration Assist, Product Assist,
 *     Cover Projection Assist, Specific Illness Assist) with what used to
 *     be a separate "References" tier (Plan References, Announcements,
 *     Declaration Map, My Activity) — all tiles render at the same
 *     compact size (see renderTile's `compact` doc comment for why: a
 *     taller authored section here means more of the page before the
 *     supporting cards, on every screen size, now that layout is fluid
 *     rather than uniformly scaled to fit). (QA Dashboard isn't a tile
 *     here — it's still fully reachable via the QA Performance card's
 *     "View QA Dashboard" link in Quick Peek below.)
 *  2. SUPPORTING — a 1:2 row of the Announcement Counter (New This Week /
 *     Went Live This Week / Live Today, see AnnouncementCounterCard.tsx —
 *     click a stat to browse it, via AnnouncementStatModal.tsx) and QA
 *     Performance + Did you know (a short Insight card, see
 *     DidYouKnowCard.tsx), paired with the Announcements carousel (real,
 *     single-item content with auto-rotation — see HomeAnnouncementCard.tsx)
 *     in its own full-height column alongside. (Recent Searches was removed
 *     from Home.)
 * Genuinely responsive at every breakpoint (CSS Grid/Flex with real
 * breakpoints, independently reflowing) — see App.tsx's
 * #main-scrollable-body comment for the matching overflow change this
 * relies on. Below `lg` (1024px) the page is a simple stacked column; at
 * `lg` and up it becomes the two-column grid below (left 2/3 Workspace
 * Tools + QA Performance/Did you know, right 1/3 Updates feed). This used
 * to be a fixed-width "poster" uniformly scaled to fit the viewport (see
 * the removed ScaleToFit.tsx) — replaced with real fluid layout because
 * uniform scaling shrank everything (text included) together as the left
 * sidebar expanded, instead of letting the grid reflow independently. QA
 * Performance and the Announcement card's bottoms still land on the same
 * line at `lg`+, now via `leftColRef`'s live height measurement alone (see
 * below) rather than a fixed authored height plus a shared scale factor.
 * The `activeTab === "lookup" && showIntro` condition and wrapping
 * `<motion.div key="intro">` deliberately stay in App.tsx (see
 * ResourcesPage.tsx for why — moving them here would break the
 * AnimatePresence exit animation).
 */
export function LookupIntroPage({
  theme,
  currentUser,
  setShowIntro,
  setActiveTab,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection,
  allAnnouncements,
  hasAccess,
}: LookupIntroPageProps) {
  const firstName = currentUser?.name?.split(" ")[0];

  // Which Announcement Counter stat tile's popup (if any) is open — holds
  // the tile's title + the exact filtered list it represents.
  const [openStat, setOpenStat] = useState<{ title: string; list: QAAnnouncement[] } | null>(null);

  // Gates the two-column grid below (`lg` and up) and the leftColRef
  // height-matching effect that keeps the right column's height in sync
  // with it — below `lg` the page is a simple stacked single column and
  // neither applies.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // LEFT COLUMN height, measured live — Workspace Tools (the merged tools
  // + former References grid) + the Quick Guide panel (whichever of these
  // render) + the supporting row (QA Performance + Announcement Counter /
  // Did you know), all at their own natural content height. The Updates -
  // Live feed card's height is then set to this EXACT measured number, so
  // its bottom edge lands on the same line as the left column's bottom
  // edge by construction — not by hand-computed guesswork: the browser's
  // own layout of the left column is the source of truth, so this stays
  // correct even if a Quick Guide panel opens/closes, tile labels wrap
  // differently, or the Announcement Counter's numbers change width.
  const [leftColRef, announcementHeightPx] = useMeasuredHeight(isDesktop);

  // RIGHT CELL of the supporting row (QA Performance + Announcement
  // Counter, stacked) height, measured the same way — applied to the "Did
  // you know!?" card in the narrow 260px cell next to it, so THEIR bottom
  // edges also land on the same line (see DidYouKnowCard.tsx's own doc
  // comment: `h-full` + internal scroll is what lets it fill this exact
  // height and stay readable even if an Insight is too long to fit).
  const [supportingRowRightCellRef, didYouKnowHeightPx] = useMeasuredHeight(isDesktop);

  // Every Quick Action tile expands the same inline panel below its group
  // instead of navigating immediately — clicking a tile shows a short blurb
  // + a CTA that does the actual navigating. Accordion-style: one tile's
  // panel open at a time, keyed by id (not a boolean) so switching tiles
  // swaps the content instead of stacking multiple panels. Shared across
  // BOTH Advisory Workspace and Quality & References so only one guide is
  // ever open at a time regardless of which group it came from.
  const [expandedTileId, setExpandedTileId] = useState<string | null>(null);

  // PRIMARY — the tools an advisor reaches for every day.
  const ADVISORY_WORKSPACE: QuickActionTile[] = [
    {
      id: "lookup",
      featureId: "lookup",
      title: "Declaration Assist",
      tag: "Map conditions to declarations",
      icon: <Sparkles className="w-[18px] h-[18px]" />,
      hex: "#0EA5E9",
      instructions:
        "Results may not be accurate in every case. This tool supports your judgement, it doesn't replace it. Always verify before disclosing, and reach out to your mentor when you need clarity.",
      ctaLabel: "Lets Put Them In Their Place",
      onOpen: () => setShowIntro(false),
    },
    {
      id: "coverage_projection",
      featureId: "coverage_projection",
      title: "Cover Projection Assist",
      tag: "Base, bonus & restoration cover",
      icon: <FileSpreadsheet className="w-[18px] h-[18px]" />,
      hex: "#22C55E",
      instructions:
        "Enter the plan and premium details to project Base Cover, Bonus accrual, and Restoration Benefit growth across the policy term.",
      ctaLabel: "Open Cover Projection Assist",
      onOpen: () => setActiveTab("coverage_projection"),
    },
    {
      id: "specific_illness_check",
      featureId: "specific_illness_check",
      title: "Specific Illness Assist",
      tag: "2-year waiting period lookup",
      icon: <ClipboardCheck className="w-[18px] h-[18px]" />,
      hex: "#14B8A6",
      instructions:
        "Check whether a declared medical condition carries a 2-year specific illness waiting period, and see exactly how it's mapped under each plan.",
      ctaLabel: "Open Specific Illness Assist",
      onOpen: () => setActiveTab("specific_illness_check"),
    },
    {
      // Kept last (4th) deliberately — a not-yet-launched, masked "surprise"
      // tile reads better tucked at the end of the row than interrupting
      // the three real, everyday tools up front.
      id: "product_assist",
      featureId: "product_assist",
      title: "Product Assist",
      tag: "Ask questions about insurer plans",
      icon: <ProductAssistIcon className="w-[18px] h-[18px]" />,
      hex: "#6366F1",
      instructions:
        "Ask questions about insurer plans and get verified answers grounded in the Knowledge Base's documents and announcements.",
      ctaLabel: "Open Product Assist",
      onOpen: () => setActiveTab("product_assist"),
      // Not yet launched — visible so advisors know it's coming, but masked
      // and non-interactive until it ships. Remove this line to re-enable.
      comingSoon: true,
    },
  ];

  // Quality/reference tools, visited less often than the above — merged
  // into the same Workspace Tools grid as ADVISORY_WORKSPACE at render
  // time (see QUICK_ACTIONS below), kept as its own array here only for
  // data organization. QA Dashboard is not a tile here (it's still fully
  // reachable — the QA Performance card in Quick Peek below links
  // straight to it via "View QA Dashboard").
  const QUALITY_REFERENCES: QuickActionTile[] = [
    {
      id: "advisory_zone",
      featureId: "advisory_zone",
      title: "Plan References",
      tag: "Payment-journey & illness lists",
      icon: <BookOpen className="w-4 h-4" />,
      hex: "#F59E0B",
      instructions: "Look up payment-journey questions and plan-specific illness lists before you're mid-call with a customer.",
      ctaLabel: "Open Plan References",
      onOpen: () => setActiveTab("advisory_zone"),
    },
    {
      id: "announcement_archive",
      featureId: "announcement_archive",
      title: "Announcements",
      tag: "Browse every posted update",
      icon: <Newspaper className="w-4 h-4" />,
      hex: "#FB7185",
      instructions: "Browse the full searchable archive of every posted QA and General announcement, filterable by date.",
      ctaLabel: "Open Announcements",
      onOpen: () => setActiveTab("announcement_archive"),
    },
    {
      id: "resources",
      featureId: "resources",
      title: "Declaration Map",
      tag: "Visual rules & payout mapping",
      icon: <DeclarationMapIcon width={16} height={16} color="currentColor" />,
      hex: "#EC4899",
      instructions: "Browse the visual guide to medical declaration rules and payout mapping structures.",
      ctaLabel: "Open Declaration Map",
      onOpen: () => setActiveTab("resources"),
    },
    {
      id: "my_activity",
      featureId: "my_activity",
      title: "My Activity",
      tag: "Your personal search history",
      icon: <History className="w-4 h-4" />,
      hex: "#8B5CF6",
      instructions: "Review your own past lookups and searches — a personal log of everything you've searched in Declaration Assist.",
      ctaLabel: "Open My Activity",
      onOpen: () => setActiveTab("my_activity"),
    },
  ];

  // Every advisor sees Declaration Assistant (it's the app's default tab,
  // never gated); everything else follows the exact same permission check
  // the sidebar uses, so Quick Actions never offers a tool this advisor
  // couldn't otherwise reach.
  const visibleAdvisory = ADVISORY_WORKSPACE.filter((mod) => mod.id === "lookup" || hasAccess(mod.featureId, "Viewer"));
  const visibleQuality = QUALITY_REFERENCES.filter((mod) => hasAccess(mod.featureId, "Viewer"));
  const QUICK_ACTIONS = [...visibleAdvisory, ...visibleQuality];

  const expandedTile = QUICK_ACTIONS.find((mod) => mod.id === expandedTileId) || null;

  /** Shared tile renderer for the Workspace Tools grid (icon box size,
   * padding, title weight all key off `compact`) — currently always
   * called with `compact: true` (see the grid render below), keeping this
   * section's authored height down so it doesn't push the supporting cards
   * further down the page than necessary. The non-compact path is left in
   * place for a future caller that wants the heavier look. */
  const renderTile = (mod: QuickActionTile, compact: boolean) => {
    const expanded = expandedTileId === mod.id;
    const comingSoon = !!mod.comingSoon;
    return (
      <button
        key={mod.id}
        type="button"
        disabled={comingSoon}
        aria-disabled={comingSoon}
        onClick={() => {
          if (comingSoon) return;
          setExpandedTileId((prev) => (prev === mod.id ? null : mod.id));
        }}
        title={comingSoon ? "A new tool is coming soon" : `${mod.title} — show quick guide`}
        aria-expanded={comingSoon ? undefined : expanded}
        // Icon-left / text-right row instead of a stacked (icon-on-top)
        // layout — on a wide monitor a 3-across grid gives each tile far
        // more width than a small stacked block needs, which read as a
        // mostly-empty card. A horizontal row naturally uses the tile's
        // full assigned width at every breakpoint instead of only its
        // top-left corner. `items-start` (was `items-center`) — now that
        // the tagline below can wrap to two lines instead of always
        // truncating to one, top-aligning the icon with the title's own
        // line reads better than centering it against a now-variable-height
        // text block.
        className={`group relative flex items-start gap-3 text-left rounded-xl border transition-all duration-200 min-w-0 ${
          comingSoon ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:-translate-y-0.5"
        } ${
          // The single Workspace Tools grid (Advisory Workspace + the
          // former References tier, merged into one section — see the
          // grid above this render function) renders every tile compact,
          // keeping the merged section's authored height close to what it
          // was pre-merge — a shorter Workspace Tools section means the
          // supporting cards below start higher on the page. Bumped
          // slightly from `p-[clamp(8px,1.1vh,12px)]` — the tagline below
          // no longer truncates to one line, so some tiles now wrap to two
          // lines, and this gives that second line real padding instead of
          // it reading cramped against the tile's border. The non-compact
          // size below is kept for any future caller that needs the
          // heavier look this originally shipped with (e.g. a single-row,
          // few-tiles case) — not used by the current render path.
          compact ? "p-[clamp(10px,1.3vh,14px)]" : "p-[clamp(14px,1.8vh,20px)]"
        } ${
          comingSoon
            ? theme === "dark"
              ? "bg-white/[0.02] border-white/[0.06]"
              : "bg-stone-100/60 border-stone-200"
            : expanded
            ? theme === "dark"
              ? "bg-white/[0.06] border-white/[0.24]"
              : "bg-white border-stone-400 shadow-sm"
            : theme === "dark"
            ? "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.16]"
            : "bg-white/60 border-stone-300 hover:bg-white hover:border-stone-400 hover:shadow-sm"
        }`}
      >
        {/* comingSoon fully masks the tile's identity — it's meant to be a
            surprise, not a preview, so the icon, title, and tag never
            render the real ones below; a generic "gift" icon + "Coming
            Soon" copy replace them entirely instead of layering a badge
            over the real content. */}
        <div
          className={`rounded-lg border flex items-center justify-center shrink-0 transition-transform duration-200 ${comingSoon ? "" : "group-hover:scale-105"} ${
            compact ? "w-8 h-8" : "w-10 h-10"
          }`}
          style={
            comingSoon
              ? undefined
              : {
                  backgroundColor: `${lightSafe(mod.hex, theme)}1A`,
                  borderColor: `${lightSafe(mod.hex, theme)}4D`,
                  color: lightSafe(mod.hex, theme),
                }
          }
        >
          {comingSoon ? (
            <Gift className={compact ? "w-4 h-4" : "w-[18px] h-[18px]"} />
          ) : (
            mod.icon
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={`font-black uppercase tracking-wide truncate ${compact ? "text-[12px]" : "text-[13px]"} ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            {comingSoon ? "Coming Soon" : mod.title}
          </h3>
          {/* No more `truncate` — some taglines were getting clipped with
              an ellipsis at this tile's width even though the full text is
              short enough to just wrap onto a second line (see this tile's
              own bumped padding above, which gives that second line
              room). */}
          <p className={`font-semibold leading-snug mt-0.5 ${compact ? "text-[11px]" : "text-[12px]"} ${theme === "dark" ? "text-white/50" : "text-stone-500"}`}>
            {comingSoon ? "A new tool is on the way" : mod.tag}
          </p>
        </div>
      </button>
    );
  };

  // Conditionally mounted (not just visually collapsed) — a Tailwind flex
  // `gap` inserts space around EVERY flex child regardless of that child's
  // own rendered height, so the previous always-mounted-but-0-height
  // (grid-rows-[0fr]) version silently wasted two full section gaps in the
  // default/idle state (nothing expanded), which is the page's normal
  // resting state. Unmounting it entirely when idle removes that dead
  // space; the tradeoff is the close transition is now an unmount instead
  // of an animated collapse, which only affects switching/closing, not the
  // far more common "load Home, nothing open yet" case.
  const quickGuidePanel = expandedTile && (
    <div
      key={expandedTile.id}
      className="rounded-xl border-l-[3px] pl-4 pr-4 py-3.5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-5 animate-fade-in"
      style={{
        borderLeftColor: lightSafe(expandedTile.hex, theme),
        backgroundColor: theme === "dark" ? "rgba(255,255,255,0.02)" : "rgba(250,250,249,0.6)",
      }}
    >
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <span className="shrink-0 mt-0.5" style={{ color: lightSafe(expandedTile.hex, theme) }}>
          {expandedTile.id === "lookup" ? <AlertTriangle className="w-[18px] h-[18px]" /> : expandedTile.icon}
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: lightSafe(expandedTile.hex, theme) }}>
            {expandedTile.id === "lookup" ? "Before You Start" : "Quick Guide"}
          </div>
          <p className={`text-[14px] leading-relaxed font-medium ${theme === "dark" ? "text-white/80" : "text-stone-700"}`}>
            {expandedTile.instructions}
          </p>
        </div>
      </div>
      <PrimaryCtaButton theme={theme} onClick={expandedTile.onOpen} className="shrink-0 self-start sm:self-center">
        {expandedTile.ctaLabel}
      </PrimaryCtaButton>
    </div>
  );

  return (
    <>
      <div
        // Section rhythm scales with actual viewport HEIGHT (clamp on vh)
        // instead of a fixed px gap — a tall monitor gets the original
        // comfortable spacing, a shorter browser viewport (real monitor
        // height minus tab strip/bookmarks bar/app header) gets a
        // proportionally tighter one, so the page fits at 100% zoom without
        // relying on the user zooming out. Genuinely fluid at every
        // breakpoint now (no more fixed-width "poster" uniformly scaled to
        // fit — see this component's doc comment) — `max-w-[1900px]` just
        // keeps line/card widths from growing unreasonably wide on an
        // ultra-wide monitor, same cap at every size.
        // pb-6 (was a `clamp(4px,0.6vh,12px)` that bottomed out at a bare
        // 4px on a short viewport) — a plain fixed bottom margin per
        // explicit request, so the page's content never reads as pinned
        // edge-to-edge against the footer bar below it, regardless of how
        // tall the viewport is.
        className={`w-full max-w-[1900px] mx-auto font-sans flex flex-col flex-1 min-h-0 gap-[clamp(10px,1.8vh,24px)] pb-6 ${
          theme === "dark" ? "text-[#FFFFFF]" : "text-stone-900"
        }`}
      >
        {/* WORKSPACE HEADER — full-width greeting, shared by both sections
            below rather than living inside either column. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 shrink-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <div className="w-6 h-0.5 flex-shrink-0 self-center" style={{ backgroundColor: "var(--accent)" }} />
            <h1
              className={`font-black tracking-tight truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}
              style={{ fontSize: "clamp(20px, 2.4vw, 26px)" }}
            >
              {getGreeting()}{firstName ? `, ${firstName}` : ""}.
            </h1>
          </div>
        </div>

        {/* TWO MAIN SECTIONS — left 2/3 (Workspace Tools, QA Performance,
            Announcement Counter, Did you know) and right 1/3 (Updates -
            Live feed), side by side from `lg` up. Below `lg` they stack
            (left column's pieces, then Updates) — completely unaffected by
            anything below.
            `lg:items-start` — the left column sizes to its own natural
            content (Workspace Tools + the supporting row's own natural
            height) instead of being stretched to fill this row's full
            flex-1 height (the previous default `items-stretch` behavior).
            That stretch used to be load-bearing — the supporting row and
            its cards absorbed the extra space via `flex-1` so it wouldn't
            sit as dead space below the cards — but it's exactly what made
            the Announcement Counter card (and, transitively, Did you know,
            matched to a sibling cell's now-inflated height) read as
            oversized relative to its actual content (see the supporting
            row's own `lg:items-start` comment below for the matching fix
            one level down). The Updates card's height is still set to the
            left column's own measured total height (via `leftColRef`
            below) — so the two columns' bottoms land on exactly the same
            line, it's just that "the left column's height" now means its
            true natural content height, not an inflated stretched one. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start gap-[clamp(10px,1.8vh,24px)] flex-1 min-h-0">
          {/* LEFT — 2/3: Workspace Tools, QA Performance, Did you know. */}
          <div ref={leftColRef} className="min-w-0 flex flex-col gap-[clamp(10px,1.8vh,24px)] min-h-0">
            {/* WORKSPACE TOOLS — the former "References" tier (Plan
                References, Announcements, etc.) now lives in this same
                grid under this one heading instead of its own separate
                "References" label/section; QUICK_ACTIONS is already the
                combined visibleAdvisory + visibleQuality list. Every tile
                renders at the COMPACT size (same as the old References
                row) rather than the larger Workspace Tools size — with up
                to 8 tiles now sharing one grid (wrapping to 2 rows), using
                the taller non-compact padding on both rows would grow this
                section's authored height noticeably, pushing the
                supporting cards below further down the page for no real
                benefit. Responsive: 1 column on a phone-width viewport,
                2 on a narrow tablet, 4 side by side from lg up (wraps to a
                second row past 4 tiles). */}
            {QUICK_ACTIONS.length > 0 && (
              <div className="shrink-0">
                <SectionLabel icon={<Briefcase className="w-4 h-4" />} text="Workspace Tools" hex={lightSafe("#0EA5E9", theme)} size="lg" />
                <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-[clamp(8px,1.2vh,12px)]">
                  {QUICK_ACTIONS.map((mod) => renderTile(mod, true))}
                </div>
              </div>
            )}

            {/* QUICK GUIDE — shared accordion panel for whichever tile (from
                either group above) is currently expanded. */}
            {quickGuidePanel && <div className="shrink-0">{quickGuidePanel}</div>}

            {/* DID YOU KNOW + (QA PERFORMANCE / ANNOUNCEMENT COUNTER) — side
                by side from `lg` up (stacked below it). Did you know sits in
                the fixed-260px narrow cell (was the Announcement Counter
                card's slot) — its content is a single short Insight that
                scrolls internally if too long (see DidYouKnowCard.tsx), so a
                tall narrow column suits it far better than the Counter
                card's inherently-horizontal strip of stat numbers ever did.
                QA Performance and the Announcement Counter are stacked in
                the wide `minmax(0,1fr)` cell instead — the Counter card is
                now a wide, horizontal layout (3-up stat grid + a Last 30
                Days strip, see AnnouncementCounterCard.tsx) matching QA
                Performance's own full width, rather than the narrow stacked
                card it used to be.
                `lg:items-start` — without it, CSS Grid's default
                `items-stretch` (plus `align-content: stretch` on a single
                auto row inside this row's own `flex-1 min-h-0` — i.e. a
                definite-height container) stretches the RIGHT cell to fill
                the ENTIRE leftover space in the left column, not just its
                own QA Performance + Counter content — which is exactly
                what made the Counter card read as oversized/dominant
                before (and, via `supportingRowRightCellRef` below, would
                have fed that same inflated number into Did you know's
                height too). With `items-start`, the right cell sizes to
                its own natural content, and Did you know's height is set
                to `didYouKnowHeightPx` — that cell's own measured (now
                accurate) height — so its bottom edge still lands on
                exactly the same line as that cell's, forming one clean
                rectangle, just no longer forcing extra dead space into
                either card. Below `lg`, neither items-start nor the height
                style applies — natural height, stacked, exactly as
                before. */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start gap-[clamp(10px,1.8vh,24px)] flex-1 min-h-0">
              <div
                className="min-w-0"
                style={isDesktop && didYouKnowHeightPx ? { height: didYouKnowHeightPx } : undefined}
              >
                <DidYouKnowCard theme={theme} />
              </div>
              <div ref={supportingRowRightCellRef} className="min-w-0 flex flex-col gap-[clamp(10px,1.8vh,24px)]">
                <div className="shrink-0">
                  <QaPerformancePeek
                    theme={theme}
                    userEmail={currentUser?.email || ""}
                    onOpenQaDashboard={() => setActiveTab("qa_dashboard")}
                  />
                </div>
                <div className="shrink-0">
                  <AnnouncementCounterCard
                    theme={theme}
                    allAnnouncements={allAnnouncements}
                    onOpenStat={(title, list) => setOpenStat({ title, list })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — 1/3: "Updates - Live feed" label (same level/row as
              "Workspace Tools" on the left — both are the first thing in
              their column) sitting OUTSIDE the Announcement card, then the
              card itself below it. Below `lg`, natural height throughout.
              At `lg`+, `announcementHeightPx` (the left column's own
              measured total height) is applied to THIS OUTER wrapper —
              the label is `shrink-0` and the card wrapper is `flex-1
              min-h-0`, so the card automatically absorbs "measured total
              minus the label and gap" with no separate calculation, and
              still lands its bottom edge exactly on the left column's. */}
          <div
            className="min-w-0 min-h-0 flex flex-col gap-[clamp(6px,1vh,12px)]"
            style={isDesktop && announcementHeightPx ? { height: announcementHeightPx } : undefined}
          >
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 select-none min-w-0">
                {/* Aqua blue (#0EA5E9), same hex SectionLabel uses for
                    "Workspace Tools" above — this label sits at the same
                    row/level as that one in the mirrored right column, so
                    it now matches it exactly instead of standing out in
                    the rose/pink this used to be. */}
                <Megaphone className="w-4 h-4" style={{ color: lightSafe("#0EA5E9", theme) }} />
                <span
                  className="font-mono uppercase tracking-[0.2em] font-bold text-[13px] truncate"
                  style={{ color: lightSafe("#0EA5E9", theme) }}
                >
                  Updates - Live feed
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("announcement_archive")}
                className={`flex items-center gap-0.5 text-[12px] font-bold uppercase tracking-wide cursor-pointer transition-colors shrink-0 ${
                  theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
                }`}
              >
                View all
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            <div className="min-w-0 flex-1 min-h-0 [&>*]:h-full">
              <HomeAnnouncementCard
                theme={theme}
                activeAnnouncements={activeAnnouncements}
                noticeIndex={noticeIndex}
                setNoticeIndex={setNoticeIndex}
                slideDirection={slideDirection}
                setSlideDirection={setSlideDirection}
              />
            </div>
          </div>
        </div>
      </div>

      {openStat && <AnnouncementStatModal theme={theme} title={openStat.title} announcements={openStat.list} onClose={() => setOpenStat(null)} />}
    </>
  );
}
