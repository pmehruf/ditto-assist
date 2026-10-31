/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type ReactNode } from "react";
import {
  Sparkles,
  FileSpreadsheet,
  ClipboardCheck,
  Briefcase,
  Newspaper,
  Megaphone,
  ArrowUpRight,
  Gift,
  FolderOpen,
  Milestone,
} from "lucide-react";
import { ProductAssistIcon } from "../components/icons";
import { QaPerformancePeek } from "../components/QaPerformancePeek";
import { DidYouKnowCard } from "../components/DidYouKnowCard";
import { HomeAnnouncementCard } from "../components/HomeAnnouncementCard";
import { AnnouncementCounterCard } from "../components/AnnouncementCounterCard";
import { AnnouncementStatModal } from "../components/AnnouncementStatModal";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMeasuredHeight } from "../hooks/useMeasuredHeight";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { TrainingHomePage } from "./TrainingHomePage";

type HomeTabId =
  | "lookup"
  | "product_assist"
  | "qa_dashboard"
  | "coverage_projection"
  | "specific_illness_check"
  | "advisory_zone"
  | "announcement_archive"
  | "my_activity";

interface LookupIntroPageProps {
  theme: "light" | "dark";
  currentUser: LoggedUser | null;
  setShowIntro: (value: boolean) => void;
  setActiveTab: (value: HomeTabId) => void;
  // True for a signed-in advisor whose Department/Role catalog names
  // resolve to "Advisory"/"Trainee Advisor" (see App.tsx's own comment
  // on this derivation). Renders TrainingHomePage instead of the usual
  // Workspace Tools dashboard below.
  showTrainingHome?: boolean;
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
  // state — feeds the Announcement Counter card below QA Performance (see
  // that component's own doc comment for why it lives there now).
  allAnnouncements: QAAnnouncement[];
  // Same gate the sidebar uses (App.tsx's hasAccess) — Quick Actions should
  // only ever offer tools this advisor can actually open.
  hasAccess: (featureId: string, action: "Viewer" | "Editor") => boolean;
  // Expands the sidebar's own "Other Resources" disclosure (App.tsx's
  // showResourceLinks) — the Other Resources tile below has no page of its
  // own to navigate to (that list only ever lived in the sidebar), so its
  // CTA opens that same disclosure instead of calling setActiveTab.
  onOpenExternalResources: () => void;
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
  onOpen: () => void;
  /** Renders a "SOON" badge, dims the tile, and disables its click
   * behavior — for a tool that's visible (so advisors know it's coming) but
   * not yet launched. See renderTile below. */
  comingSoon?: boolean;
}

/**
 * Home page — the advisor's *workspace*, not a dashboard for any one
 * module. Left column reads top to bottom as two rows, matching the
 * hierarchy an advisor should read at a glance:
 *  1. WORKSPACE TOOLS — the primary Advisory Workspace tools (Declaration
 *     Assist, Product Assist, Cover Projection Assist, Specific Illness
 *     Assist) in one row of 4, all compact size (see renderTile's
 *     `compact` doc comment for why).
 *  2. DID YOU KNOW + QA PERFORMANCE STACK — a narrow 320px cell holding a
 *     live Health/Term FAQ feed (Did You Know — see DidYouKnowCard.tsx)
 *     next to a wider cell that stacks QA Performance, the Announcement
 *     Counter card, and the reference tiles (Plan References,
 *     Announcements, Other Resources — My Activity was dropped from this
 *     tile set by explicit request, though it's still reachable from the
 *     sidebar) as a 2-column grid at the bottom. CSS Grid
 *     stretch sizes the Did You Know cell to match the QA Performance
 *     cell's own natural stacked height with no JS measurement (explicit
 *     request; see this row's own JSX comment below). (QA Dashboard isn't
 *     a tile here — it's still fully reachable via the QA Performance
 *     card's "View QA Dashboard" link.)
 * The right column is the Announcements carousel (real, single-item
 * content with auto-rotation — see HomeAnnouncementCard.tsx) in its own
 * full-height column alongside the two rows above.
 * Genuinely responsive at every breakpoint (CSS Grid/Flex with real
 * breakpoints, independently reflowing) — see App.tsx's
 * #main-scrollable-body comment for the matching overflow change this
 * relies on. Below `lg` (1024px) the page is a simple stacked column; at
 * `lg` and up it becomes the two-column grid below (left 2/3 the three rows
 * above, right 1/3 Updates feed). This used to be a fixed-width "poster"
 * uniformly scaled to fit the viewport (see the removed ScaleToFit.tsx) —
 * replaced with real fluid layout because uniform scaling shrank
 * everything (text included) together as the left sidebar expanded,
 * instead of letting the grid reflow independently. The left column's
 * bottom and the Updates card's bottom still land on the same line at
 * `lg`+, now via `leftColRef`'s live height measurement alone (see below)
 * rather than a fixed authored height plus a shared scale factor.
 * The `activeTab === "lookup" && showIntro` condition and wrapping
 * `<motion.div key="intro">` deliberately stay in App.tsx (see
 * the AnimatePresence block in App.tsx for why — moving them here would break the
 * AnimatePresence exit animation).
 */
export function LookupIntroPage(props: LookupIntroPageProps) {
  // Trainee Advisors in Advisory bypass every tile/hook below — a plain welcome screen, nothing to
  // measure or fetch. Decided here, before the hook-using page mounts, so the Rules of Hooks hold.
  if (props.showTrainingHome) {
    return <TrainingHomePage theme={props.theme} firstName={props.currentUser?.name?.split(" ")[0]} />;
  }
  return <LookupIntroPageContent {...props} />;
}

function LookupIntroPageContent({
  theme,
  currentUser,
  setShowIntro,
  setActiveTab,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection,
  hasAccess,
  onOpenExternalResources,
  allAnnouncements,
}: LookupIntroPageProps) {
  const firstName = currentUser?.name?.split(" ")[0];

  // Which Announcement Counter stat's browse-list modal is open, if any —
  // see AnnouncementStatModal.tsx.
  const [openStat, setOpenStat] = useState<{ title: string; list: QAAnnouncement[] } | null>(null);

  // Gates the two-column grid below (`lg` and up) and the leftColRef
  // height-matching effect that keeps the right column's height in sync
  // with it — below `lg` the page is a simple stacked single column and
  // neither applies.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // LEFT COLUMN height, measured live — Workspace Tools (the merged tools
  // + former References grid) + the supporting row (QA Performance / Did
  // you know), all at their own natural content height. The Updates - Live
  // feed card's height is then set to this EXACT measured number, so its
  // bottom edge lands on the same line as the left column's bottom edge by
  // construction — not by hand-computed guesswork: the browser's own layout
  // of the left column is the source of truth, so this stays correct even
  // if tile labels wrap differently.
  const [leftColRef, announcementHeightPx] = useMeasuredHeight(isDesktop);

  // QA PERFORMANCE COLUMN height (QA Performance + Announcement Counter +
  // the 4 reference tiles), measured the exact same way, applied to Did You
  // Know's wrapper — a SECOND, independent pairing of the same technique
  // used just above for the Updates card, not CSS Grid `items-stretch`.
  // Stretch was tried here first and looked right in isolation, but it's a
  // percentage-based mechanism: a stretched grid item only has a definite
  // height for CHILD percentage resolution once the row's own height is
  // already resolved, and grid resolves an auto-sized row's height from its
  // items' own CONTENT size first — which, for a `flex-1 min-h-0
  // overflow-y-auto` scroll region with no already-definite ancestor
  // height, falls back to the scrolling content's full natural size (flex's
  // `min-height: auto` default). Net effect: a long FAQ pair grew the card
  // (and, transitively, `leftColRef`'s measured total, and so the Updates
  // card too) instead of scrolling internally — the exact overflow this is
  // fixing. A JS-measured PIXEL height (like `announcementHeightPx` above)
  // has no such circularity — it's a real number, not a percentage — so
  // Did You Know's own `h-full` + internal scroll body (see
  // DidYouKnowCard.tsx) resolves against a genuine definite height and
  // contains any FAQ length without affecting this column's height at all.
  const [qaColRef, qaColHeightPx] = useMeasuredHeight(isDesktop);

  // PRIMARY — the tools an advisor reaches for every day.
  const ADVISORY_WORKSPACE: QuickActionTile[] = [
    {
      id: "lookup",
      featureId: "lookup",
      title: "Declaration Assist",
      tag: "Map conditions to declarations",
      icon: <Sparkles className="w-[18px] h-[18px]" />,
      hex: "#0EA5E9",
      onOpen: () => setShowIntro(false),
    },
    {
      // Launched (2026-09) — moved up to 2nd position, right after
      // Declaration Assist, and no longer masked as "Coming Soon".
      id: "product_assist",
      featureId: "product_assist",
      title: "Product Assist",
      tag: "Ask questions about insurer plans",
      icon: <ProductAssistIcon className="w-[18px] h-[18px]" />,
      hex: "#6366F1",
      onOpen: () => setActiveTab("product_assist"),
    },
    {
      id: "coverage_projection",
      featureId: "coverage_projection",
      title: "Cover Projection Assist",
      tag: "Base, bonus & restoration cover",
      icon: <FileSpreadsheet className="w-[18px] h-[18px]" />,
      hex: "#22C55E",
      onOpen: () => setActiveTab("coverage_projection"),
    },
    {
      id: "specific_illness_check",
      featureId: "specific_illness_check",
      title: "Specific Illness Assist",
      tag: "2-year waiting period lookup",
      icon: <ClipboardCheck className="w-[18px] h-[18px]" />,
      hex: "#14B8A6",
      onOpen: () => setActiveTab("specific_illness_check"),
    },
  ];

  // Quality/reference tools, visited less often than the above — rendered
  // as their own 2-column grid below (see visibleQuality below), kept as its
  // own array here only for data organization. QA Dashboard is not a tile
  // here (it's still fully reachable — the QA Performance card in Quick
  // Peek below links straight to it via "View QA Dashboard").
  const QUALITY_REFERENCES: QuickActionTile[] = [
    {
      id: "advisory_zone",
      featureId: "advisory_zone",
      title: "Payment Journey",
      tag: "Plan questions & illness lists",
      icon: <Milestone className="w-4 h-4" />,
      hex: "#F59E0B",
      onOpen: () => setActiveTab("advisory_zone"),
    },
    {
      id: "announcement_archive",
      featureId: "announcement_archive",
      title: "Announcements",
      tag: "Browse every posted update",
      icon: <Newspaper className="w-4 h-4" />,
      hex: "#FB7185",
      onOpen: () => setActiveTab("announcement_archive"),
    },
    // My Activity removed from this Home dashboard tile set by explicit
    // request (2026-09) — it's still fully reachable from the sidebar's
    // Library group, just no longer duplicated here as its own tile.
  ];

  // Mirrors the sidebar's own "Other Resources" disclosure (App.tsx's
  // renderResourceLinksSection) — that link list has no page/tab of its
  // own, so this tile's onOpen opens the sidebar's disclosure directly
  // instead of calling setActiveTab, same as every other tile's onOpen
  // pattern. Readable by every signed-in user (same as the sidebar
  // original), so it's appended unconditionally below rather than filtered
  // by hasAccess like QUALITY_REFERENCES.
  const OTHER_RESOURCES_TILE: QuickActionTile = {
    id: "other_resources",
    featureId: "other_resources",
    title: "Other Resources",
    tag: "Access guides & useful links",
    icon: <FolderOpen className="w-4 h-4" />,
    hex: "#22C55E",
    onOpen: onOpenExternalResources,
  };

  // Every advisor sees Declaration Assistant (it's the app's default tab,
  // never gated); everything else follows the exact same permission check
  // the sidebar uses, so Quick Actions never offers a tool this advisor
  // couldn't otherwise reach.
  const visibleAdvisory = ADVISORY_WORKSPACE.filter((mod) => mod.id === "lookup" || hasAccess(mod.featureId, "Viewer"));
  const visibleQuality = [...QUALITY_REFERENCES.filter((mod) => hasAccess(mod.featureId, "Viewer")), OTHER_RESOURCES_TILE];

  /** Shared tile renderer for the Workspace Tools grid (icon box size,
   * padding, title weight all key off `compact`) — currently always
   * called with `compact: true` (see the grid render below), keeping this
   * section's authored height down so it doesn't push the supporting cards
   * further down the page than necessary. The non-compact path is left in
   * place for a future caller that wants the heavier look.
   *
   * Clicking a tile navigates straight to its page via `onOpen()` (removed
   * 2026-09, explicit request — this used to expand an inline "Quick
   * Guide" blurb + separate CTA button below the tile group instead of
   * navigating immediately; that accordion step is gone). */
  const renderTile = (mod: QuickActionTile, compact: boolean) => {
    const comingSoon = !!mod.comingSoon;
    return (
      <button
        key={mod.id}
        type="button"
        disabled={comingSoon}
        aria-disabled={comingSoon}
        onClick={() => {
          if (comingSoon) return;
          mod.onOpen();
        }}
        title={comingSoon ? "A new tool is coming soon" : mod.title}
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
          // supporting cards below start higher on the page. Back to
          // `p-[clamp(8px,1.1vh,12px)]` (was briefly bumped up when the
          // tagline below first stopped truncating) — these tiles are now
          // wider (see the two-main-sections grid's column ratio below),
          // which is what actually gives a wrapped tagline's second line
          // room to breathe; the extra padding was compensating for the
          // OLD, narrower tile width and just cost vertical space the
          // supporting cards below needed back once QA Performance's real
          // (loaded, taller-than-its-skeleton) content is on screen. The
          // non-compact size below is kept for any future caller that
          // needs the heavier look this originally shipped with (e.g. a
          // single-row, few-tiles case) — not used by the current render
          // path.
          compact ? "p-[clamp(8px,1.1vh,12px)]" : "p-[clamp(14px,1.8vh,20px)]"
        } ${
          comingSoon
            ? theme === "dark"
              ? "bg-white/[0.02] border-white/[0.06]"
              : "bg-stone-100/60 border-stone-200"
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

        {/* TWO MAIN SECTIONS — left (Workspace Tools, QA Performance,
            Announcement Counter, Did you know) and right (Updates - Live
            feed), side by side from `lg` up. Below `lg` they stack (left
            column's pieces, then Updates) — completely unaffected by
            anything below.
            Column ratio bumped from 2fr:1fr to 2.3fr:1fr (a modest ~3
            percentage-point shift) — by explicit request, Updates gives up
            a slice of its width to the left column, most of which reaches
            the Workspace Tools tiles below (see renderTile — wider tiles
            are what let a tagline fit without wrapping to a second line).
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
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)] lg:items-start gap-[clamp(10px,1.8vh,24px)] flex-1 min-h-0">
          {/* LEFT — 2/3: Workspace Tools, QA Performance, Did you know. */}
          <div ref={leftColRef} className="min-w-0 flex flex-col gap-[clamp(10px,1.8vh,24px)] min-h-0">
            {/* WORKSPACE TOOLS — row 1 only: the primary Advisory Workspace
                tools (Declaration Assist, Product Assist, Cover Projection
                Assist, Specific Illness Assist) — the
                former "References" tier (Plan References, Announcements,
                Other Resources) instead renders as a 2-column
                tile grid below QA Performance + the Announcement Counter
                card (explicit request; see the row below). Every tile still
                renders at the COMPACT size. Responsive: 1
                column on a phone-width viewport, 2 on a narrow tablet, 4
                side by side from lg up. */}
            {visibleAdvisory.length > 0 && (
              <div className="shrink-0">
                <SectionLabel icon={<Briefcase className="w-4 h-4" />} text="Workspace Tools" hex={lightSafe("#0EA5E9", theme)} size="lg" />
                <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-[clamp(8px,1.2vh,12px)]">
                  {visibleAdvisory.map((mod) => renderTile(mod, true))}
                </div>
              </div>
            )}

            {/* DID YOU KNOW + QA PERFORMANCE STACK — Did You Know takes the
                fixed-320px narrow cell that the reference tiles used to
                occupy; QA Performance's column stacks THREE things — QA
                Performance, the Announcement Counter card, and the
                reference tiles themselves (Plan References, Announcements,
                Other Resources — My Activity was dropped
                from this set by explicit request) as a 2-column grid at the
                bottom. Did You Know's height is set to `qaColHeightPx` — a
                JS measurement of this row's right cell (via `qaColRef`
                below), NOT CSS Grid stretch (tried first; see
                `qaColHeightPx`'s own doc comment above for why that broke
                — a fixed, definite pixel height was the actual fix, same
                technique `announcementHeightPx` already uses for the
                Updates card). Below `lg` the measurement resets to null and
                everything renders at natural height, stacked. */}
            <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-[clamp(10px,1.8vh,24px)]">
              {/* LEFT — Did You Know. Fixed to `qaColHeightPx` (see above) —
                  a genuine, definite pixel height, so its own `h-full` +
                  internal `flex-1 min-h-0 overflow-y-auto` body (see
                  DidYouKnowCard.tsx) can actually resolve against it: a long
                  FAQ pair scrolls internally instead of growing the card
                  (and, transitively, `leftColRef`'s measured total and the
                  Updates card past the viewport — the overflow bug this
                  fixes). The card's overall height still fills the space
                  next to QA Performance + Announcement Counter + the tiles
                  below them, right down to their shared bottom line. */}
              <div className="min-w-0" style={isDesktop && qaColHeightPx ? { height: qaColHeightPx } : undefined}>
                <DidYouKnowCard theme={theme} />
              </div>
              {/* RIGHT — QA Performance, Announcement Counter, then the 4
                  reference tiles as a 2-column grid — `ref={qaColRef}` is what
                  Did You Know's height above is measured from. All three
                  stay `shrink-0` at their own natural height — including
                  the tile grid now (previously force-fit to a fixed
                  `clamp(160px,20vh,220px)`, a leftover from when Did You
                  Know itself used to be capped at that height; the tiles'
                  actual content is much shorter, so that fixed height just
                  stretched each tile row and read as mostly-empty cards —
                  see AnnouncementCounterCard's own comment for where that
                  freed space went instead). Two tiles side by side still
                  automatically equal QA Performance's own width, since both
                  share this same column — no separate width matching
                  needed. */}
              <div ref={qaColRef} className="min-w-0 flex flex-col gap-[clamp(10px,1.8vh,24px)]">
                <div className="shrink-0">
                  <QaPerformancePeek
                    theme={theme}
                    userEmail={currentUser?.email || ""}
                    onOpenQaDashboard={() => setActiveTab("qa_dashboard")}
                  />
                </div>
                <div className="shrink-0">
                  <AnnouncementCounterCard theme={theme} allAnnouncements={allAnnouncements} onOpenStat={(title, list) => setOpenStat({ title, list })} />
                </div>
                {/* An odd last tile spans both columns so the 2-column
                    grid never leaves an empty cell. */}
                <div className="shrink-0 grid grid-cols-2 gap-[clamp(6px,1vh,10px)] [&>*:last-child:nth-child(odd)]:col-span-2">
                  {visibleQuality.map((mod) => renderTile(mod, true))}
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
            {/* Below the desktop breakpoint there's no measured height to
                bound the card, so cap it to the viewport (shared .vp-panel
                rule) and let the card's own body scroll a long
                announcement instead of growing. */}
            <div className={`min-w-0 flex-1 min-h-0 [&>*]:h-full ${isDesktop ? "" : "vp-panel flex flex-col [&>*]:min-h-0"}`}>
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
