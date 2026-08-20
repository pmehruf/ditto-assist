/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  Lightbulb,
  Flag,
  MousePointerClick,
  Megaphone,
  ArrowUpRight,
  Clock,
  Search,
  AlertTriangle,
  CheckCircle2,
  Zap,
  ShieldCheck,
  ClipboardCheck,
} from "lucide-react";
import { QaDashboardIcon, DeclarationMapIcon } from "../components/icons";
import { QaPerformancePeek } from "../components/QaPerformancePeek";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { AnnouncementStatModal } from "../components/AnnouncementStatModal";
import { ScaleToFit } from "../components/ScaleToFit";
import { QAAnnouncement, AuditLogEntry } from "../types/announcements";
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
  activeAnnouncements: QAAnnouncement[];
  // Full, uncapped announcement list (App.tsx's qaAnnouncements) — used only
  // for the weekly stats (new / went live / going live today) below the
  // Announcements card's preview, since activeAnnouncements is capped to 8.
  allAnnouncements: QAAnnouncement[];
  // Opens the Announcements archive pre-filtered to a specific effective
  // date — used by "Open Today's Announcements".
  onOpenAnnouncementsForDate: (date: string) => void;
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDateOnly(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
};
function lightSafe(hex: string, theme: "light" | "dark"): string {
  if (theme === "dark") return hex;
  return ACCENT_LIGHT_MODE[hex] ?? hex;
}

const QUICK_TIPS: Array<{ icon: ReactNode; text: string; hex: string }> = [
  {
    icon: <Lightbulb className="w-4 h-4" />,
    text: "Use the dropdown suggestions when searching — it cuts down PED spelling mismatches.",
    hex: "#FACC15",
  },
  {
    icon: <MousePointerClick className="w-4 h-4" />,
    text: "Queue multiple conditions before running the engine — they're all mapped in one pass.",
    hex: "#2DD4BF",
  },
  {
    icon: <Flag className="w-4 h-4" />,
    text: "Spot an incorrect mapping? Flag it straight from your results — so the same mistake doesn't get repeated for another person.",
    hex: "#F87171",
  },
  {
    icon: <ShieldCheck className="w-4 h-4" />,
    text: "Results may not be accurate in every case — this tool supports your judgement, it doesn't replace it. Always verify before disclosing.",
    hex: "#34D399",
  },
];

/**
 * A small uppercase-tracked label used above every section, so the page
 * reads as a set of clearly-titled modules rather than one continuous
 * surface — the same visual device the Quick Tips strip already used.
 */
function SectionLabel({ icon, text, hex }: { icon: ReactNode; text: string; hex: string }) {
  return (
    <div className="flex items-center gap-2 select-none mb-3">
      <span style={{ color: hex }}>{icon}</span>
      <span
        style={{ color: hex }}
        className="font-mono uppercase tracking-[0.2em] text-[12px] font-bold"
      >
        {text}
      </span>
    </div>
  );
}

/**
 * Home page — the advisor's *workspace*, not a dashboard for any one
 * module. Two tiers:
 *  1. PRIMARY — Quick Actions: every tool in the platform (Declaration
 *     Assistant, Coverage Projection Studio, QA Dashboard, Plan References,
 *     Declaration Map, My Activity) as uniform, equally-weighted tiles. QA
 *     Dashboard gets no special treatment here — it's one tile among six.
 *  2. SECONDARY — Quick Peek, two rows under one section label:
 *     - Row 1: QA Performance as the hero (wide, leading column — real
 *       day-to-day signal) beside Recent Searches as a compact, self-sized
 *       companion (narrow column, latest 3 only, visibly smaller — that's
 *       the de-emphasis, not just a smaller number of rows).
 *     - Row 2: Announcements and Quick Tips as two standard, equal-height
 *       cards, so neither leaves a slab of unused space and neither needs
 *       its own full-width strip.
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
  allAnnouncements,
  onOpenAnnouncementsForDate,
  hasAccess,
}: LookupIntroPageProps) {
  const firstName = currentUser?.name?.split(" ")[0];
  // Every Quick Action tile expands the same inline panel below the grid
  // instead of navigating immediately — clicking a tile shows a short blurb
  // + a CTA that does the actual navigating. Accordion-style: one tile's
  // panel open at a time, keyed by id (not a boolean) so switching tiles
  // swaps the content instead of stacking multiple panels.
  const [expandedTileId, setExpandedTileId] = useState<string | null>(null);

  const ALL_QUICK_ACTIONS: Array<{
    id: string;
    featureId: string;
    title: string;
    tag: string;
    icon: ReactNode;
    hex: string;
    instructions: string;
    ctaLabel: string;
    onOpen: () => void;
  }> = [
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
      title: "Coverage Projection",
      tag: "Base, bonus & restoration cover",
      icon: <FileSpreadsheet className="w-[18px] h-[18px]" />,
      hex: "#22C55E",
      instructions:
        "Enter the plan and premium details to project Base Cover, Bonus accrual, and Restoration Benefit growth across the policy term.",
      ctaLabel: "Open Coverage Projection Studio",
      onOpen: () => setActiveTab("coverage_projection"),
    },
    {
      id: "specific_illness_check",
      featureId: "specific_illness_check",
      title: "Specific Illness Check",
      tag: "2-year waiting period lookup",
      icon: <ClipboardCheck className="w-[18px] h-[18px]" />,
      hex: "#14B8A6",
      instructions:
        "Check whether a declared medical condition carries a 2-year specific illness waiting period, and see exactly how it's mapped under each plan.",
      ctaLabel: "Open Specific Illness Check",
      onOpen: () => setActiveTab("specific_illness_check"),
    },
    {
      id: "qa_dashboard",
      featureId: "qa_dashboard",
      title: "QA Dashboard",
      tag: "Lead & payments QA scoring",
      icon: <QaDashboardIcon width={18} height={18} color="currentColor" />,
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
      icon: <BookOpen className="w-[18px] h-[18px]" />,
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
      icon: <DeclarationMapIcon width={18} height={18} color="currentColor" />,
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
  const QUICK_ACTIONS = ALL_QUICK_ACTIONS.filter(
    (mod) => mod.id === "lookup" || hasAccess(mod.featureId, "Viewer")
  );

  const expandedTile = QUICK_ACTIONS.find((mod) => mod.id === expandedTileId) || null;

  // Recent Declaration Searches + Recently Used Plans — real data from the
  // same /api/search-history endpoint My Activity uses, latest 5 entries.
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);

  useEffect(() => {
    const userEmail = currentUser?.email || "";
    if (!userEmail) {
      setEntriesLoading(false);
      return;
    }
    let cancelled = false;
    setEntriesLoading(true);
    const params = new URLSearchParams({
      paginated: "1",
      userEmail,
      page: "1",
      pageSize: "5",
      sortBy: "timestamp",
      sortDir: "desc",
    });
    fetch(`/api/search-history?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setEntries(body.entries || []);
      })
      .catch((err) => console.error("Failed to load recent searches:", err))
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.email]);

  // Weekly Announcements stats — from the full (uncapped) list, not the
  // carousel's top-8 activeAnnouncements, so these counts are accurate even
  // when more than 8 announcements exist.
  const todayStr = fmtDateOnly(new Date());
  const { newThisWeekList, wentLiveThisWeekList, liveToday } = useMemo(() => {
    const today = parseDateOnly(todayStr)!;
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const newList: QAAnnouncement[] = [];
    const wentLiveList: QAAnnouncement[] = [];
    const liveTodayList: QAAnnouncement[] = [];
    for (const a of allAnnouncements) {
      const posted = parseDateOnly(a.announcementDate);
      if (posted && posted >= weekAgo && posted <= today) newList.push(a);
      const effective = parseDateOnly(a.effectiveDate);
      if (effective && effective >= weekAgo && effective <= today) wentLiveList.push(a);
      if (a.effectiveDate === todayStr) liveTodayList.push(a);
    }
    return { newThisWeekList: newList, wentLiveThisWeekList: wentLiveList, liveToday: liveTodayList };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnnouncements, todayStr]);

  // Which stat tile's popup (if any) is open — holds the tile's label +
  // the exact filtered list it represents, so AnnouncementStatModal never
  // has to re-derive the filter itself.
  const [openStat, setOpenStat] = useState<{ title: string; list: QAAnnouncement[] } | null>(null);

  // Quick Tips — one featured tip at a time instead of all 4 at once (see
  // the Quick Tips card below), auto-advancing so every tip still gets seen
  // over time without asking the reader to take in 4 blocks of text at a
  // glance. Paused implicitly whenever the tab isn't visible would be nice
  // but isn't worth the extra complexity for a low-stakes rotating tip.
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % QUICK_TIPS.length), 7000);
    return () => clearInterval(id);
  }, []);

  const cardClass = `rounded-2xl border p-5 flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const cardHeader = (label: string, icon: ReactNode, onOpen: () => void, hex: string) => {
    const resolvedHex = lightSafe(hex, theme);
    return (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2 select-none min-w-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${resolvedHex}1A`, color: resolvedHex }}
        >
          {icon}
        </div>
        <span className={`text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={`flex items-center gap-0.5 text-[12px] font-bold uppercase tracking-wide cursor-pointer transition-colors shrink-0 ${
          theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
        }`}
      >
        View all
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
    );
  };

  return (
    <>
    <ScaleToFit baseWidth={1440} className="flex-grow">
    <div
      className={`w-full font-sans flex flex-col gap-6 pb-3 ${
        theme === "dark" ? "text-[#FFFFFF]" : "text-stone-900"
      }`}
    >
        {/* WORKSPACE HEADER */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <div className="w-6 h-0.5 flex-shrink-0 self-center" style={{ backgroundColor: "var(--accent)" }} />
            <h1
              className={`font-black tracking-tight truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}
              style={{ fontSize: "26px" }}
            >
              {getGreeting()}{firstName ? `, ${firstName}` : ""}.
            </h1>
          </div>
        </div>

        {/* PRIMARY — QUICK ACTIONS. Every tool in the platform, uniform
            weight — Declaration Assistant and QA Dashboard are just two
            tiles among six, not the page's focus. One fixed 6-column
            layout, no per-viewport reflow — ScaleToFit (see below) scales
            this whole canonical design uniformly to whatever screen it's
            on instead of rewrapping columns. */}
        <div>
          {/* Sky-400 (#38BDF8) is too pale against the light theme's
              background — deepen it in light mode only, same treatment as
              the other section labels; dark mode is untouched. */}
          <SectionLabel icon={<Sparkles className="w-4 h-4" />} text="Quick Actions" hex={lightSafe("#38BDF8", theme)} />
          <div className="grid grid-cols-6 gap-3">
            {QUICK_ACTIONS.map((mod) => {
              const expanded = expandedTileId === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setExpandedTileId((prev) => (prev === mod.id ? null : mod.id))}
                  title={`${mod.title} — show quick guide`}
                  aria-expanded={expanded}
                  className={`group relative text-left rounded-xl border p-3.5 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 ${
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
                    className="w-9 h-9 rounded-lg border flex items-center justify-center mb-2.5 transition-transform duration-200 group-hover:scale-105"
                    style={{
                      backgroundColor: `${lightSafe(mod.hex, theme)}1A`,
                      borderColor: `${lightSafe(mod.hex, theme)}4D`,
                      color: lightSafe(mod.hex, theme),
                    }}
                  >
                    {mod.icon}
                  </div>
                  <h3 className={`font-black text-[13px] uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                    {mod.title}
                  </h3>
                  <p className={`text-[12px] font-semibold leading-snug truncate mt-0.5 ${theme === "dark" ? "text-white/50" : "text-stone-500"}`}>
                    {mod.tag}
                  </p>
                </button>
              );
            })}
          </div>

          {/* QUICK GUIDE — expands inline below the grid when any tile is
              clicked, instead of navigating immediately. One shared panel
              (not one per tile) whose content swaps to match whichever tile
              is active — presented as a contextual strip (left accent bar
              in that tile's own icon colour), not another card, so it reads
              as guidance belonging to the tile above it. Pure-CSS grid-rows
              height animation — no extra motion dependency needed just for
              this collapse/expand. */}
          <div className={`grid transition-all duration-300 ease-out ${expandedTile ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"}`}>
            <div className="overflow-hidden">
              {expandedTile && (
                <div
                  className="rounded-xl border-l-[3px] pl-4 pr-4 py-3.5 flex flex-row items-center gap-5"
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
                  <PrimaryCtaButton theme={theme} onClick={expandedTile.onOpen} className="shrink-0 self-center">
                    {expandedTile.ctaLabel}
                  </PrimaryCtaButton>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECONDARY — Quick Peek, two rows instead of one flat row of
            equal-weight cards. Row 1 puts QA Performance forward as the
            hero (2fr of a 2fr/1fr split, leading position) with Recent
            Searches trimmed down to a compact, self-sized companion — real
            day-to-day signal (a rating trend) outranks a short list of past
            searches, so the layout should say so instead of treating them
            as equals. Row 2 pairs Announcements with Quick Tips (moved up
            from its old full-width strip at the page bottom) as two
            standard, equal-height cards, closing the gap that used to open
            up under a full-width tips band nobody needed that much room
            for. Same cards, same per-card visual design throughout — only
            their relative size and position changed. */}
        <div className="flex flex-col gap-4">
          {/* Orange-400 (#FB923C) is too pale against the light theme's
              background — deepen it in light mode only; dark mode is
              untouched. */}
          <SectionLabel icon={<Clock className="w-4 h-4" />} text="Quick Peek" hex={lightSafe("#FB923C", theme)} />

          {/* ROW 1 — QA Performance (hero) + Recent Searches (compact). */}
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            {/* QA PERFORMANCE PEEK — replaces "Recently Used Plans", which
                didn't add day-to-day value. A glanceable, role-scoped rating
                widget (own score for an Advisor, team for a Guide/Mentor,
                company-wide for an Admin) — see QaPerformancePeek.tsx for
                why this isn't a miniature QA Dashboard. Leading, wide column
                is what makes this the page's hero card — the component
                itself is untouched. */}
            <QaPerformancePeek
              theme={theme}
              userEmail={currentUser?.email || ""}
              onOpenQaDashboard={() => setActiveTab("qa_dashboard")}
            />

            {/* RECENT DECLARATION SEARCHES — compact: narrow column, only
                the latest 3, `self-start` so it sits at its own natural
                (shorter) height next to the taller hero rather than
                stretching to match it. A visibly smaller card is the point —
                it reads as lower-priority at a glance, not just in theory. */}
            <div className={`${cardClass} self-start`}>
              {cardHeader("Recent Searches", <Clock className="w-4 h-4" />, () => setActiveTab("my_activity"), "#FB923C")}
              {entriesLoading ? (
                <div className="space-y-2.5 animate-pulse">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`h-9 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <div className={`flex flex-col items-center justify-center text-center py-4 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                  <Search className="w-5 h-5 opacity-50" />
                  <span className="text-[13px] font-medium">No searches yet — your recent lookups will show up here.</span>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-dashed" style={{ borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(168,162,158,0.35)" }}>
                  {entries.slice(0, 3).map((entry, idx) => (
                    <button
                      type="button"
                      key={`${entry.timestamp}-${idx}`}
                      onClick={() => setActiveTab("my_activity")}
                      className={`flex items-center justify-between gap-3 py-1.5 text-left cursor-pointer transition-colors rounded-lg -mx-1 px-1 ${
                        theme === "dark" ? "hover:bg-white/[0.03]" : "hover:bg-stone-100/60"
                      }`}
                      title="Open in My Activity"
                    >
                      {/* Condition name is the one thing worth scanning for
                          here, so it's the only bold/high-contrast text in
                          the row; plan name and timestamp both step down in
                          weight and contrast to read as clearly secondary
                          rather than competing with it. */}
                      <div className="min-w-0 flex-1">
                        <div className={`text-[14px] font-extrabold tracking-tight truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                          {entry.pedInput}
                        </div>
                        <div className={`text-[11.5px] font-normal truncate ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                          {entry.planName || "—"}
                        </div>
                      </div>
                      <span className={`text-[11px] font-normal shrink-0 ${theme === "dark" ? "text-stone-600" : "text-stone-400"}`}>
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ROW 2 — Announcements + Quick Tips, standard equal-width,
              equal-height cards (default grid stretch, no self-start). */}
          <div className="grid grid-cols-2 gap-4">
            {/* ANNOUNCEMENTS — a pure numerical overview, not a text preview.
                Each stat is its own reactive tile: click it and it opens a
                popup (AnnouncementStatModal) listing exactly the
                announcements behind that number — New / Went Live / Live
                Today — instead of a static excerpt that either duplicated
                the archive or left a lot of dead space when there was
                nothing to preview.
                `content-center` on the tile row: stretched to match Quick
                Tips' height (same row), so the tiles center as a compact
                group rather than each one stretching individually. */}
            <div
              className={cardClass}
              style={
                liveToday.length > 0
                  ? { borderColor: theme === "dark" ? "rgba(34,211,238,0.35)" : "rgba(7,84,183,0.3)" }
                  : undefined
              }
            >
              {cardHeader("Announcements", <Megaphone className="w-4 h-4" />, () => setActiveTab("announcement_archive"), "#FB7185")}

              <div className="grid grid-cols-3 gap-2 flex-1 content-center">
                {(
                  [
                    {
                      label: "New",
                      sub: "This Week",
                      value: newThisWeekList.length,
                      list: newThisWeekList,
                      title: "New This Week",
                      icon: <Sparkles className="w-4 h-4" />,
                      color: theme === "dark" ? "#60A5FA" : "#2563EB",
                    },
                    {
                      label: "Went Live",
                      sub: "This Week",
                      value: wentLiveThisWeekList.length,
                      list: wentLiveThisWeekList,
                      title: "Went Live This Week",
                      icon: <CheckCircle2 className="w-4 h-4" />,
                      color: theme === "dark" ? "#34D399" : "#059669",
                    },
                    {
                      label: "Live",
                      sub: "Today",
                      value: liveToday.length,
                      list: liveToday,
                      title: "Live Today",
                      icon: <Zap className="w-4 h-4" />,
                      color: theme === "dark" ? "#22D3EE" : "#0754b7",
                    },
                  ] as const
                ).map((stat) => (
                  <button
                    key={stat.label}
                    type="button"
                    onClick={() => setOpenStat({ title: stat.title, list: [...stat.list] })}
                    title={`View ${stat.title.toLowerCase()}`}
                    className={`relative w-full flex flex-col items-center justify-center gap-1 rounded-xl border py-2.5 px-1.5 text-center cursor-pointer transition-all duration-200 hover:-translate-y-0.5 ${
                      theme === "dark"
                        ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.16]"
                        : "border-stone-200 bg-stone-50/70 hover:bg-white hover:border-stone-300 hover:shadow-sm"
                    }`}
                  >
                    {stat.label === "Live" && stat.value > 0 && (
                      <span className="absolute top-2 right-2 flex w-1.5 h-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ backgroundColor: stat.color }} />
                        <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ backgroundColor: stat.color }} />
                      </span>
                    )}
                    <span style={{ color: stat.color }}>{stat.icon}</span>
                    {/* Bumped 26px -> 29px: the metric value is the one
                        number worth reading in this tile, so it should
                        out-weigh its own label more clearly than before. */}
                    <span className="text-[29px] font-black font-mono leading-none" style={{ color: stat.value > 0 ? stat.color : theme === "dark" ? "#F8FAFC" : "#1E293B" }}>
                      {stat.value}
                    </span>
                    <span className={`text-[11px] font-bold uppercase tracking-wide leading-tight ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                      {stat.label}
                      <br />
                      {stat.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* QUICK TIPS — moved here from a full-width strip at the very
                bottom of the page, now a standard card matching
                Announcements' size. Shows ONE tip at a time (was all 4 in a
                2x2 grid) — that grid still felt visually dense for a
                low-priority widget, so it's now a single featured tip that
                auto-advances every 7s (see the `tipIndex` state above),
                with small dots to jump to any tip directly. The tip block
                is centered in the space above the dots (`flex-1 items-
                center`), and the dots are pinned to the card's bottom edge
                (`mt-auto`) — so they land at a fixed, predictable spot
                regardless of how many lines a given tip wraps to. */}
            <div className={cardClass}>
              {/* Pale yellow (#FACC15) reads fine on the dark card but
                  nearly disappears on the light theme's white/60 card —
                  swap to a deeper amber in light mode only; dark mode is
                  untouched. */}
              <SectionLabel
                icon={<Lightbulb className="w-4 h-4" />}
                text="Quick Tips · Declaration Assist"
                hex={lightSafe("#FACC15", theme)}
              />
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 flex items-center mt-2">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={tipIndex}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="flex items-start gap-2.5 w-full"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: `${lightSafe(QUICK_TIPS[tipIndex].hex, theme)}1A`,
                          color: lightSafe(QUICK_TIPS[tipIndex].hex, theme),
                        }}
                      >
                        {QUICK_TIPS[tipIndex].icon}
                      </div>
                      <p className={`text-[13.5px] leading-relaxed font-medium text-pretty ${theme === "dark" ? "text-white/65" : "text-stone-600"}`}>
                        {QUICK_TIPS[tipIndex].text}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-center gap-1.5 mt-auto pt-3">
                  {QUICK_TIPS.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setTipIndex(idx)}
                      aria-label={`Show tip ${idx + 1} of ${QUICK_TIPS.length}`}
                      className={`h-1 rounded-full transition-all duration-200 cursor-pointer ${idx === tipIndex ? "w-4" : "w-1"} ${
                        idx === tipIndex
                          ? theme === "dark"
                            ? "bg-[#FACC15]/80"
                            : "bg-[#B45309]"
                          : theme === "dark"
                          ? "bg-white/10 hover:bg-white/20"
                          : "bg-stone-250 hover:bg-stone-300"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
    </ScaleToFit>
    {openStat && (
      <AnnouncementStatModal theme={theme} title={openStat.title} announcements={openStat.list} onClose={() => setOpenStat(null)} />
    )}
    </>
  );
}
