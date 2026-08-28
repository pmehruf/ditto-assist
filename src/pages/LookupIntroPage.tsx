/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  AlertTriangle,
  ClipboardCheck,
  Briefcase,
  Layers,
  Newspaper,
  History,
  Megaphone,
  ArrowUpRight,
} from "lucide-react";
import { DeclarationMapIcon, ProductAssistIcon } from "../components/icons";
import { QaPerformancePeek } from "../components/QaPerformancePeek";
import { HomeAnnouncementCard } from "../components/HomeAnnouncementCard";
import { AnnouncementCounterCard } from "../components/AnnouncementCounterCard";
import { AnnouncementStatModal } from "../components/AnnouncementStatModal";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { ScaleToFit } from "../components/ScaleToFit";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";

/** Reference width the desktop ("poster") composition is authored at — see
 * ScaleToFit.tsx. Below this constant's matching breakpoint (`lg`, 1024px)
 * the page uses its original, independently-responsive stacked layout. */
const DESKTOP_CANVAS_WIDTH = 1536;

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
 * module. Three tiers, matching the hierarchy an advisor should read at a
 * glance ("these are my tools" -> "these are reference tools" -> "these are
 * updates/activity"):
 *  1. PRIMARY — Advisory Workspace: the day-to-day tools (Declaration
 *     Assist, Product Assist, Cover Projection Assist, Specific Illness
 *     Assist), given slightly more visual weight than the tier below it.
 *  2. SECONDARY — Quality & References: Plan References, Announcements,
 *     Declaration Map, My Activity — same tile pattern, deliberately more
 *     compact. (QA Dashboard isn't a tile here — it's still fully
 *     reachable via the QA Performance card's "View QA Dashboard" link in
 *     Quick Peek below.)
 *  3. SUPPORTING — a 1:2 row of the Announcement Counter (New This Week /
 *     Went Live This Week / Live Today, see AnnouncementCounterCard.tsx —
 *     click a stat to browse it, via AnnouncementStatModal.tsx) and QA
 *     Performance, paired with the Announcements carousel (real, single-
 *     item content with auto-rotation — see HomeAnnouncementCard.tsx) in
 *     its own full-height column alongside. (Recent Searches was removed
 *     from Home.)
 * Below the `lg` breakpoint, layout is genuinely responsive (CSS Grid/Flex
 * with real breakpoints, independently reflowing) — see App.tsx's
 * #main-scrollable-body comment for the matching overflow change this
 * replaces.
 * At `lg` and up, by explicit request, the composition switches to a fixed-
 * width "poster" — one deliberate reference layout (DESKTOP_CANVAS_WIDTH),
 * uniformly scaled to fit whatever desktop/monitor space is available (see
 * ScaleToFit.tsx) — specifically so QA Performance and the Announcement
 * card's bottoms always land on the same line and the whole composition
 * grows/shrinks together across screen sizes, rather than each piece
 * reflowing independently and drifting out of proportion with each other.
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

  // Desktop/large-monitor "poster" composition (see ScaleToFit.tsx) only
  // activates at the same `lg` breakpoint the two-column grid below already
  // switches on — below it, the page keeps its original, independently-
  // responsive stacked layout, completely untouched by anything here.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // LEFT COLUMN height, measured live — Workspace Tools + References + the
  // Quick Guide panel (whichever of these render) + QA Performance (whose
  // own height is now a deliberate fixed constant at desktop, not natural —
  // see QaPerformancePeek.tsx). The Announcement card's height is then set
  // to this EXACT measured number, so its bottom edge lands on the same
  // line as QA Performance's bottom edge by construction — not by
  // stretching QA Performance, and not by hand-computed guesswork: the
  // browser's own layout of the left column is the source of truth, so
  // this stays correct even if a Quick Guide panel opens/closes or tile
  // labels wrap differently.
  const leftColRef = useRef<HTMLDivElement>(null);
  const [announcementHeightPx, setAnnouncementHeightPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!isDesktop) {
      setAnnouncementHeightPx(null);
      return;
    }
    const el = leftColRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      setAnnouncementHeightPx(box ? box.blockSize : entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop]);

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
  ];

  // SECONDARY — quality/reference tools, visited less often than the above.
  // QA Dashboard is no longer a tile here (it's still fully reachable — the
  // QA Performance card in Quick Peek below links straight to it via "View
  // QA Dashboard") so this row can match the reference layout's 4 tiles.
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

  /** Shared tile renderer for both Quick Action groups — `compact` is the
   * only thing that differs between Advisory Workspace and Quality &
   * References (icon box size, padding, title weight), per SectionLabel's
   * "same card treatment, only size communicates hierarchy" approach. */
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
        title={comingSoon ? `${mod.title} — coming soon` : `${mod.title} — show quick guide`}
        aria-expanded={comingSoon ? undefined : expanded}
        // Icon-left / text-right row instead of a stacked (icon-on-top)
        // layout — on a wide monitor a 3-across grid gives each tile far
        // more width than a small stacked block needs, which read as a
        // mostly-empty card. A horizontal row naturally uses the tile's
        // full assigned width at every breakpoint instead of only its
        // top-left corner.
        className={`group relative flex items-center gap-3 text-left rounded-xl border transition-all duration-200 min-w-0 ${
          comingSoon ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:-translate-y-0.5"
        } ${
          // Workspace Tools tiles (non-compact) got slightly taller padding
          // so the row reads as more visually weighted against QA
          // Performance/the Announcement Counter below it (whose fixed
          // desktop height was reduced by roughly this same amount — see
          // QaPerformancePeek.tsx) — the two used to feel visually
          // mismatched (short tiles, tall cards below). References stays
          // unchanged (it's still the deliberately more compact tier).
          compact ? "p-[clamp(8px,1.1vh,12px)]" : "p-[clamp(14px,1.8vh,20px)]"
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
        {/* "SOON" badge — top-right corner, doesn't disturb the icon/text
            row's own layout so it works at both tile densities. */}
        {comingSoon && (
          <span
            className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-widest select-none ${
              theme === "dark"
                ? "bg-amber-400/15 text-amber-300 border border-amber-400/30"
                : "bg-amber-100 text-amber-700 border border-amber-300"
            }`}
          >
            Soon
          </span>
        )}
        <div
          className={`rounded-lg border flex items-center justify-center shrink-0 transition-transform duration-200 ${comingSoon ? "" : "group-hover:scale-105"} ${
            compact ? "w-8 h-8" : "w-10 h-10"
          }`}
          style={{
            backgroundColor: `${lightSafe(mod.hex, theme)}1A`,
            borderColor: `${lightSafe(mod.hex, theme)}4D`,
            color: lightSafe(mod.hex, theme),
          }}
        >
          {mod.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={`font-black uppercase tracking-wide truncate ${compact ? "text-[12px]" : "text-[13px]"} ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            {mod.title}
          </h3>
          <p className={`font-semibold leading-snug truncate mt-0.5 ${compact ? "text-[11px]" : "text-[12px]"} ${theme === "dark" ? "text-white/50" : "text-stone-500"}`}>
            {mod.tag}
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
      <ScaleToFit active={isDesktop} className="flex-1 min-h-0">
      <div
        // Section rhythm scales with actual viewport HEIGHT (clamp on vh)
        // instead of a fixed px gap — a tall monitor gets the original
        // comfortable spacing, a shorter browser viewport (real monitor
        // height minus tab strip/bookmarks bar/app header) gets a
        // proportionally tighter one, so the page fits at 100% zoom
        // without relying on the user zooming out. (Below `lg` only — at
        // `lg`+ this whole block is the fixed-width "poster" composition
        // ScaleToFit.tsx scales uniformly to fit, so `flex-1`/`min-h-0`
        // here are inert there — ScaleToFit's own wrapper divs, not this
        // one, participate in App.tsx's real flex chain in that mode.)
        // `w-full max-w-[1900px] mx-auto` (below `lg`) vs `lg:w-[1536px]
        // lg:max-w-none` (at `lg`+): the desktop composition is authored at
        // one fixed reference width — see DESKTOP_CANVAS_WIDTH — rather
        // than reflowing per-viewport, precisely so it can be scaled as one
        // proportional unit instead of each piece resizing independently.
        className={`w-full max-w-[1900px] mx-auto lg:max-w-none font-sans flex flex-col flex-1 min-h-0 gap-[clamp(10px,1.8vh,24px)] pb-[clamp(4px,0.6vh,12px)] ${
          theme === "dark" ? "text-[#FFFFFF]" : "text-stone-900"
        }`}
        style={isDesktop ? { width: DESKTOP_CANVAS_WIDTH } : undefined}
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

        {/* TWO MAIN SECTIONS — left 2/3 (Workspace Tools, References, QA
            Performance) and right 1/3 (Announcements), side by side from
            `lg` up. Below `lg` they stack (left column's 3 pieces, then
            Announcements) — completely unaffected by anything below.
            At `lg`+: QA Performance has a fixed height (see
            QaPerformancePeek.tsx), and the Announcement card's height is
            set to the left column's own measured total height (via
            `leftColRef` below) — so the two cards' bottoms land on exactly
            the same line, by construction, without stretching QA
            Performance itself. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-[clamp(10px,1.8vh,24px)] flex-1 min-h-0 lg:items-start">
          {/* LEFT — 2/3: Workspace Tools, References, QA Performance. */}
          <div ref={leftColRef} className="min-w-0 flex flex-col gap-[clamp(10px,1.8vh,24px)] min-h-0">
            {/* WORKSPACE TOOLS. Responsive: 1 column on a phone-width
                viewport, 2 on a narrow tablet, all 4 side by side from lg up. */}
            {visibleAdvisory.length > 0 && (
              <div className="shrink-0">
                <SectionLabel icon={<Briefcase className="w-4 h-4" />} text="Workspace Tools" hex={lightSafe("#0EA5E9", theme)} size="lg" />
                <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-[clamp(8px,1.2vh,12px)]">
                  {visibleAdvisory.map((mod) => renderTile(mod, false))}
                </div>
              </div>
            )}

            {/* REFERENCES. Same tile pattern, deliberately more compact
                (smaller icon/text) so it reads as a lower-priority tier
                without needing a second, heavier card wrapper. */}
            {visibleQuality.length > 0 && (
              <div className="shrink-0">
                <SectionLabel icon={<Layers className="w-3.5 h-3.5" />} text="References" hex={lightSafe("#64748B", theme)} />
                <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-[clamp(6px,1vh,10px)]">
                  {visibleQuality.map((mod) => renderTile(mod, true))}
                </div>
              </div>
            )}

            {/* QUICK GUIDE — shared accordion panel for whichever tile (from
                either group above) is currently expanded. */}
            {quickGuidePanel && <div className="shrink-0">{quickGuidePanel}</div>}

            {/* ANNOUNCEMENT COUNTER + QA PERFORMANCE — side by side from
                `lg` up (stacked below it). Counter card is a fixed 260px
                at `lg`+ (narrower than the earlier 1fr:2fr split) rather
                than a proportional fraction, so it stays a fixed, modest
                width regardless of how much room QA Performance ends up
                with. QA Performance's own design (alignment/typography/
                spacing/comparison visuals) is completely untouched — only
                its available width changed, same as it already adapts to
                any container width. The Counter card sits at `lg:h-full`,
                stretched by this row's default `items-stretch` to match
                QA Performance's own fixed height at `lg`+
                (QaPerformancePeek.tsx) — QA Performance anchors the row's
                height; the Counter card just fills it, the exact reverse
                of "stretching QA to match something else." Below `lg`,
                both are natural height, stacked. */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-[clamp(10px,1.8vh,24px)] shrink-0">
              <div className="min-w-0">
                <AnnouncementCounterCard
                  theme={theme}
                  allAnnouncements={allAnnouncements}
                  onViewAll={() => setActiveTab("announcement_archive")}
                  onOpenStat={(title, list) => setOpenStat({ title, list })}
                />
              </div>
              <div className="min-w-0">
                <QaPerformancePeek
                  theme={theme}
                  userEmail={currentUser?.email || ""}
                  onOpenQaDashboard={() => setActiveTab("qa_dashboard")}
                />
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
              still lands its bottom edge exactly on QA Performance's. */}
          <div
            className="min-w-0 min-h-0 flex flex-col gap-[clamp(6px,1vh,12px)]"
            style={isDesktop && announcementHeightPx ? { height: announcementHeightPx } : undefined}
          >
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 select-none min-w-0">
                <Megaphone className="w-4 h-4" style={{ color: lightSafe("#FB7185", theme) }} />
                <span
                  className="font-mono uppercase tracking-[0.2em] font-bold text-[13px] truncate"
                  style={{ color: lightSafe("#FB7185", theme) }}
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
      </ScaleToFit>

      {/* Rendered OUTSIDE ScaleToFit deliberately — a modal overlay must
          never inherit the poster composition's `transform: scale()`
          (it would scale the popup itself, and its fixed/centered
          positioning is relative to the real viewport, not the canvas). */}
      {openStat && <AnnouncementStatModal theme={theme} title={openStat.title} announcements={openStat.list} onClose={() => setOpenStat(null)} />}
    </>
  );
}
