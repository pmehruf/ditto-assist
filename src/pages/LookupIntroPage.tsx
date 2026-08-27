/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type ReactNode } from "react";
import {
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  Clock,
  AlertTriangle,
  ClipboardCheck,
  Briefcase,
  Layers,
} from "lucide-react";
import { QaDashboardIcon, DeclarationMapIcon } from "../components/icons";
import { QaPerformancePeek } from "../components/QaPerformancePeek";
import { HomeAnnouncementCard } from "../components/HomeAnnouncementCard";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { QAAnnouncement } from "../types/announcements";
import { LoggedUser } from "../types/user";

type HomeTabId =
  | "lookup"
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
}

/**
 * Home page — the advisor's *workspace*, not a dashboard for any one
 * module. Three tiers, matching the hierarchy an advisor should read at a
 * glance ("these are my tools" -> "these are reference tools" -> "these are
 * updates/activity"):
 *  1. PRIMARY — Advisory Workspace: the day-to-day tools (Declaration
 *     Assist, Cover Projection Assist, Specific Illness Assist), given
 *     slightly more visual weight than the tier below it.
 *  2. SECONDARY — Quality & References: QA Dashboard, Plan References,
 *     Declaration Map — same tile pattern, deliberately more compact.
 *  3. SUPPORTING — Quick Peek: a compact QA Performance KPI strip paired
 *     with the Announcements carousel (real, single-item content with
 *     auto-rotation — see HomeAnnouncementCard.tsx) in one row.
 *     (Recent Searches was removed from Home — My Activity is still the
 *     dedicated place to browse search history.)
 * Layout is genuinely responsive (CSS Grid/Flex with real breakpoints, no
 * fixed-canvas scaling) — see App.tsx's #main-scrollable-body comment for
 * the matching overflow change this replaces (a fixed-width layout
 * uniformly scaled to fit, which shrank text/click-targets on narrow
 * viewports instead of reflowing them).
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
  hasAccess,
}: LookupIntroPageProps) {
  const firstName = currentUser?.name?.split(" ")[0];
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
  ];

  // SECONDARY — quality/reference tools, visited less often than the above.
  const QUALITY_REFERENCES: QuickActionTile[] = [
    {
      id: "qa_dashboard",
      featureId: "qa_dashboard",
      title: "QA Dashboard",
      tag: "Lead & payments QA scoring",
      icon: <QaDashboardIcon width={16} height={16} color="currentColor" />,
      hex: "#8B5CF6",
      instructions:
        "Review your Lead and Payments QA scores, track how they're trending, and read detailed feedback on flagged calls and chats.",
      ctaLabel: "Open QA Dashboard",
      onOpen: () => setActiveTab("qa_dashboard"),
    },
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
    return (
      <button
        key={mod.id}
        type="button"
        onClick={() => setExpandedTileId((prev) => (prev === mod.id ? null : mod.id))}
        title={`${mod.title} — show quick guide`}
        aria-expanded={expanded}
        // Icon-left / text-right row instead of a stacked (icon-on-top)
        // layout — on a wide monitor a 3-across grid gives each tile far
        // more width than a small stacked block needs, which read as a
        // mostly-empty card. A horizontal row naturally uses the tile's
        // full assigned width at every breakpoint instead of only its
        // top-left corner.
        className={`group relative flex items-center gap-3 text-left rounded-xl border transition-all duration-200 cursor-pointer hover:-translate-y-0.5 min-w-0 ${
          compact ? "p-[clamp(8px,1.1vh,12px)]" : "p-[clamp(10px,1.4vh,14px)]"
        } ${
          expanded
            ? theme === "dark"
              ? "bg-white/[0.06] border-white/[0.24]"
              : "bg-white border-stone-400 shadow-sm"
            : theme === "dark"
            ? "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.16]"
            : "bg-white/60 border-stone-300 hover:bg-white hover:border-stone-400 hover:shadow-sm"
        }`}
      >
        <div
          className={`rounded-lg border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
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
      <div
        // Section rhythm scales with actual viewport HEIGHT (clamp on vh)
        // instead of a fixed px gap — a tall monitor gets the original
        // comfortable spacing, a shorter browser viewport (real monitor
        // height minus tab strip/bookmarks bar/app header) gets a
        // proportionally tighter one, so the page fits at 100% zoom
        // without relying on the user zooming out.
        className={`w-full max-w-[1900px] mx-auto font-sans flex flex-col gap-[clamp(10px,1.8vh,24px)] pb-[clamp(4px,0.6vh,12px)] ${
          theme === "dark" ? "text-[#FFFFFF]" : "text-stone-900"
        }`}
      >
        {/* WORKSPACE HEADER */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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

        {/* PRIMARY — ADVISORY WORKSPACE. The tools used every day, given a
            touch more visual weight than Quality & References below.
            Responsive: 1 column on a phone-width viewport, 2 on a narrow
            tablet, all 3 side by side from sm/md up — never a fixed
            6-column grid that has nowhere to go on a narrow screen. */}
        {visibleAdvisory.length > 0 && (
          <div>
            <SectionLabel icon={<Briefcase className="w-4 h-4" />} text="Advisory Workspace" hex={lightSafe("#0EA5E9", theme)} size="lg" />
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 gap-[clamp(8px,1.2vh,12px)]">
              {visibleAdvisory.map((mod) => renderTile(mod, false))}
            </div>
          </div>
        )}

        {/* SECONDARY — QUALITY & REFERENCES. Same tile pattern, deliberately
            more compact (smaller icon/text) so it reads as a lower-priority
            tier without needing a second, heavier card wrapper. */}
        {visibleQuality.length > 0 && (
          <div>
            <SectionLabel icon={<Layers className="w-3.5 h-3.5" />} text="Quality & References" hex={lightSafe("#64748B", theme)} />
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 gap-[clamp(6px,1vh,10px)]">
              {visibleQuality.map((mod) => renderTile(mod, true))}
            </div>
          </div>
        )}

        {/* QUICK GUIDE — shared accordion panel for whichever tile (from
            either group above) is currently expanded. */}
        {quickGuidePanel}

        {/* SUPPORTING — Quick Peek. QA Performance and Announcements sit in
            ONE grid row — not two cards stacked vertically — so they read
            as "the dashboard's intelligence band" rather than two unrelated
            blocks. QA Performance is now a compact, fixed-content KPI strip
            (see QaPerformancePeek.tsx), so this row uses `items-start`
            instead of the old `items-stretch`: forcing QA Performance to
            match Announcements' height would just reopen the "excessive
            empty space" problem the compact redesign fixes. Both cards
            share a common top edge; their bottom edges are no longer forced
            to match, which is expected now that Announcements (real,
            variable-length content) and QA Performance (fixed KPIs) have
            genuinely different natural heights. Below `lg` they stack (QA
            Performance above Announcements). */}
        <div className="flex flex-col gap-[clamp(6px,1.2vh,16px)]">
          <SectionLabel icon={<Clock className="w-3.5 h-3.5" />} text="Quick Peek" hex={lightSafe("#FB923C", theme)} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-[clamp(6px,1.2vh,16px)] items-start">
            <div className="min-w-0">
              <QaPerformancePeek
                theme={theme}
                userEmail={currentUser?.email || ""}
                onOpenQaDashboard={() => setActiveTab("qa_dashboard")}
              />
            </div>

            <div className="min-w-0">
              <HomeAnnouncementCard
                theme={theme}
                activeAnnouncements={activeAnnouncements}
                noticeIndex={noticeIndex}
                setNoticeIndex={setNoticeIndex}
                slideDirection={slideDirection}
                setSlideDirection={setSlideDirection}
                onViewAll={() => setActiveTab("announcement_archive")}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
