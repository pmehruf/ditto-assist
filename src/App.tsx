/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  LogOut,
  Sun,
  Moon,
  User,
  ArrowLeft,
  PanelLeftOpen,
  PanelLeftClose,
  Clock,
  Flag,
  History,
  Home,
  Megaphone,
  Link2,
  Pencil,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  LayoutDashboard,
  FileText,
  FileSpreadsheet,
  ListChecks,
  HelpCircle,
  CreditCard,
  BookOpen,
  DollarSign,
  Stethoscope,
  Flame,
  ShieldAlert,
  ShieldCheck,
  ClipboardCheck,
  Newspaper,
  Search,
  TrendingUp,
  Database,
  ToolCase,
  Award,
  Library,
  Settings,
  ShieldUser,
  Terminal
} from "lucide-react";

import {
  PLANS,
  getPlanConfig,
  TOP_PED_DICTIONARY,
  MatchOutput,
  guessCategoryMap
} from "./types.js";

import {
  matchSpecificIllness,
  normalizePlanName,
  MASTER_ILLNESSES,
  matchesPhrase,
} from "./specificIllnessEngine";

import {
  classifyDeterministic,
  finalizeOutput,
  sanitizeOutput,
  applyPostGuards
} from "./engine.js";

import { SCRIPT_DICTIONARY } from "./constants/scriptDictionary";
import { DEFAULT_FEATURE_PERMISSIONS } from "./constants/featurePermissions";
import { AuditLogEntry, ReportedIssue, QAAnnouncement, ExternalResource } from "./types/announcements";
import { LoggedUser, UserProfile } from "./types/user";
import { DraftPlan, DbPlanConfigEntry } from "./types/plans";
import { FeaturePermission } from "./types/permissions";
import { ChangeLogEntry } from "./types/changeLog";
import { DeclarationMapIcon, QaDashboardIcon, ProductAssistIcon } from "./components/icons";
import { GridTexture } from "./components/GridTexture";
import { CustomSelect } from "./components/CustomSelect";
import { PrimaryCtaButton } from "./components/PrimaryCtaButton";
import { AdvisorTagCheckboxes } from "./components/AdvisorTagCheckboxes";
import { TactIdInput } from "./components/TactIdInput";
import { DittoWordmark } from "./components/mascots/DittoWordmark";
import { AnnouncementAckModal } from "./components/AnnouncementAckModal";
import { SkillDomainPromptModal } from "./components/SkillDomainPromptModal";
import { MascotWithFallback } from "./components/mascots/MascotWithFallback";
import { usePersistentState } from "./hooks/usePersistentState";
import { downloadCSV } from "./utils/csvExport";
import { ErrorBoundary, TabLoadingFallback } from "./components/ErrorBoundary";

// ─────────────────────────────────────────────
// Lazy-loaded tab pages (Phase 2: Performance)
// ─────────────────────────────────────────────
// Each tab's page component is its own code-split chunk, fetched only when
// the user actually navigates to that tab. This keeps the initial bundle
// limited to the app shell + whichever tab is active on first paint
// ("lookup", which loads eagerly below since it's the default landing tab).
// All nine are named exports, so each lazy() call resolves the named export
// into the { default } shape React.lazy requires.
const LookupIntroPage = lazy(() =>
  import("./pages/LookupIntroPage").then((m) => ({ default: m.LookupIntroPage }))
);
const LookupPage = lazy(() =>
  import("./pages/LookupPage").then((m) => ({ default: m.LookupPage }))
);
const ResourcesPage = lazy(() =>
  import("./pages/ResourcesPage").then((m) => ({ default: m.ResourcesPage }))
);
const CoverageProjectionStudioPage = lazy(() =>
  import("./pages/CoverageProjectionStudioPage").then((m) => ({ default: m.CoverageProjectionStudioPage }))
);
const SpecificIllnessCheckPage = lazy(() =>
  import("./pages/SpecificIllnessCheckPage").then((m) => ({ default: m.SpecificIllnessCheckPage }))
);
const QaDashboardPage = lazy(() =>
  import("./pages/QaDashboardPage").then((m) => ({ default: m.QaDashboardPage }))
);
const ProfileAccessPage = lazy(() =>
  import("./pages/ProfileAccessPage").then((m) => ({ default: m.ProfileAccessPage }))
);
const MyActivityPage = lazy(() =>
  import("./pages/MyActivityPage").then((m) => ({ default: m.MyActivityPage }))
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((m) => ({ default: m.AuditPage }))
);
const AdvisoryZonePage = lazy(() =>
  import("./pages/AdvisoryZonePage").then((m) => ({ default: m.AdvisoryZonePage }))
);
const AnnouncementArchivePage = lazy(() =>
  import("./pages/AnnouncementArchivePage").then((m) => ({ default: m.AnnouncementArchivePage }))
);
const OwnerControlsPage = lazy(() =>
  import("./pages/OwnerControlsPage").then((m) => ({ default: m.OwnerControlsPage }))
);
const AnnouncementLogPage = lazy(() =>
  import("./pages/AnnouncementLogPage").then((m) => ({ default: m.AnnouncementLogPage }))
);
const FlaggedResponsesPage = lazy(() =>
  import("./pages/FlaggedResponsesPage").then((m) => ({ default: m.FlaggedResponsesPage }))
);
const PlanManagementPage = lazy(() =>
  import("./pages/PlanManagementPage").then((m) => ({ default: m.PlanManagementPage }))
);
const PedSuggestionsPage = lazy(() =>
  import("./pages/PedSuggestionsPage").then((m) => ({ default: m.PedSuggestionsPage }))
);
const SmokeTestPage = lazy(() =>
  import("./pages/SmokeTestPage").then((m) => ({ default: m.SmokeTestPage }))
);
const KnowledgeBaseManagementPage = lazy(() =>
  import("./pages/KnowledgeBaseManagementPage").then((m) => ({ default: m.KnowledgeBaseManagementPage }))
);
const QueryAssistPage = lazy(() =>
  import("./pages/QueryAssistPage").then((m) => ({ default: m.QueryAssistPage }))
);

/** Picks a suitable icon for a Quick Access resource based on keywords in its
 * title (dashboard, checklist, FAQ, Bliss CC medical-condition alert, DWT
 * Updates medical-condition digest, credit card, updates, SOP/guide/
 * playbook, Ditto Link), falling back to a generic link icon for anything
 * else. */
function getResourceIcon(title: string) {
  const t = title.toLowerCase();
  if (/\bdashboard\b/.test(t)) return LayoutDashboard;
  if (/\bchecklist\b/.test(t)) return ListChecks;
  if (/\bfaq\b/.test(t)) return HelpCircle;
  if (/\bbliss cc\b/.test(t)) return AlertTriangle;
  if (/\bcc\b|credit card/.test(t)) return CreditCard;
  if (/\bdwt updates\b/.test(t)) return Stethoscope;
  if (/\bupdates?\b/.test(t)) return RefreshCw;
  if (/\bplaybook\b/.test(t)) return BookOpen;
  if (/\bsop\b|\bguide\b/.test(t)) return FileText;
  if (/\bditto\b.*\blink\b/.test(t)) return DollarSign;
  return Link2;
}

/** Every icon an admin can explicitly assign to a Quick Access resource via
 * the picker in the add/edit form, plus the lookup used to resolve a
 * resource's stored `icon` name (e.g. "DollarSign") back to its component.
 * Keep this in sync with the icons imported at the top of this file. */
const RESOURCE_ICON_OPTIONS: { name: string; label: string; Icon: typeof Link2 }[] = [
  { name: "Link2", label: "Generic Link", Icon: Link2 },
  { name: "LayoutDashboard", label: "Dashboard", Icon: LayoutDashboard },
  { name: "ListChecks", label: "Checklist", Icon: ListChecks },
  { name: "HelpCircle", label: "FAQ", Icon: HelpCircle },
  { name: "CreditCard", label: "Credit Card", Icon: CreditCard },
  { name: "DollarSign", label: "Payment / Dollar", Icon: DollarSign },
  { name: "RefreshCw", label: "Updates", Icon: RefreshCw },
  { name: "BookOpen", label: "Playbook / Guide", Icon: BookOpen },
  { name: "FileText", label: "SOP / Document", Icon: FileText },
  { name: "AlertTriangle", label: "Alert", Icon: AlertTriangle },
  { name: "Stethoscope", label: "Medical", Icon: Stethoscope },
];
const RESOURCE_ICON_MAP: Record<string, typeof Link2> = Object.fromEntries(
  RESOURCE_ICON_OPTIONS.map(({ name, Icon }) => [name, Icon])
);

/** Resolves a resource's icon: an explicit admin choice (resource.icon)
 * wins if it's a recognized name, otherwise falls back to the keyword-based
 * guess from getResourceIcon so existing/unset resources keep working. */
/**
 * Features that are Developer-only as a matter of code, not configuration.
 *
 * These bypass the featurePermissions registry entirely (see hasAccess).
 * Nothing an Admin can edit — and no stale localStorage permission list —
 * can grant access to anything in this set.
 */
const DEVELOPER_ONLY_FEATURES = new Set(["owner_controls"]);

function resolveResourceIcon(resource: { title: string; icon?: string }) {
  if (resource.icon && RESOURCE_ICON_MAP[resource.icon]) return RESOURCE_ICON_MAP[resource.icon];
  return getResourceIcon(resource.title);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"lookup" | "audit" | "profile_access" | "resources" | "active_questions" | "my_activity" | "qa_announcement_log" | "flagged_responses" | "plan_scope" | "ped_suggestions" | "smoke_test" | "advisory_zone" | "announcement_archive" | "coverage_projection" | "specific_illness_check" | "query_assist" | "qa_dashboard" | "owner_controls" | "knowledge_base">("lookup");
  // NOTE (audit fix, see Production_Readiness_Audit.md Finding 3): this used
  // to be a hardcoded 4-item seed, persisted to (and re-read from) this
  // browser's own localStorage — so an Admin publishing a new announcement
  // was only ever visible on the browser they published it from. GET
  // /api/announcements (server.ts, backed by the announcements table) is
  // now the shared source of truth: every signed-in user fetches the same
  // list on login, and every create/edit/delete round-trips through the
  // API (see QAAnnouncementForm.tsx and AnnouncementLogPage.tsx).
  const [qaAnnouncements, setQaAnnouncements] = useState<QAAnnouncement[]>([]);

  // Set by the Workspace's "Open Today's Announcements" CTA just before it
  // switches to the announcement_archive tab, so that page opens already
  // filtered to whatever's effective on that date instead of the normal
  // browse-everything view. Empty string = no pending filter (normal open
  // via the sidebar/nav behaves exactly as before).
  const [announcementEffectiveDateFilter, setAnnouncementEffectiveDateFilter] = useState<string>("");
  const openAnnouncementsForDate = (date: string) => {
    setAnnouncementEffectiveDateFilter(date);
    setActiveTab("announcement_archive");
  };

  // Developer-hidden pages (feature ids). Fetched for every signed-in user
  // because the nav needs it; only the Developer can change it. See hasAccess()
  // — the Developer short-circuit runs before this is consulted.
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);
  const [, setAnnouncementsLoadError] = useState<string | null>(null);

  const mapAnnouncementRow = (row: any): QAAnnouncement => ({
    id: String(row.id),
    announcement: row.announcement,
    effectiveDate: row.effectiveDate ?? undefined,
    category: row.category,
    addedBy: row.addedBy,
    rating: row.rating ?? undefined,
    type: row.type ?? "QA Announcement",
    validTillDate: row.validTillDate ?? undefined,
    title: row.title ?? undefined,
    from: row.fromTeam ?? undefined,
    announcementDate: row.announcementDate ?? undefined,
    team: row.team === "Term" ? "Term" : "Health",
  });

  const fetchPageVisibility = async () => {
    try {
      const res = await fetch("/api/page-visibility");
      // Guard against the SPA fallback answering with 200 + HTML when the
      // route is missing (stale server). Fail open — nothing hidden — but
      // don't pretend an HTML page was a valid empty result set.
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return;
      const body = await res.json().catch(() => ({}));
      setHiddenPages((body.entries || []).filter((e: any) => e.hidden).map((e: any) => e.featureId));
    } catch (_) {
      // Never block the app on this — worst case nothing is hidden.
    }
  };

  const fetchAnnouncements = async () => {
    try {
      const res = await fetch("/api/announcements");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load announcements (HTTP ${res.status}).`);
      setQaAnnouncements((body.entries || []).map(mapAnnouncementRow));
      setAnnouncementsLoadError(null);
    } catch (err: unknown) {
      setAnnouncementsLoadError(err instanceof Error ? err.message : "Could not load announcements from the server.");
    }
  };
  // The effect that actually calls fetchAnnouncements() lives further down,
  // right after `currentUser` is declared (it depends on currentUser, which
  // isn't in scope yet at this point in the component body).

  // Mandatory read-and-acknowledge queue (oldest first). Non-empty renders
  // the blocking AnnouncementAckModal over the entire app. The server
  // decides eligibility (see /api/announcements/unacknowledged): only
  // announcements posted after the feature shipped AND after this user
  // joined, still valid, and not yet acked by them. Fails open on any
  // fetch error — a flaky network must never lock everyone out.
  const [unackedAnnouncements, setUnackedAnnouncements] = useState<QAAnnouncement[]>([]);

  const fetchUnackedAnnouncements = async () => {
    try {
      const res = await fetch("/api/announcements/unacknowledged");
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return;
      const body = await res.json().catch(() => ({}));
      setUnackedAnnouncements((body.entries || []).map(mapAnnouncementRow));
    } catch (_) {
      // Fail open — see comment above.
    }
  };

  const handleAcknowledgeAnnouncement = (id: string) => {
    // Optimistic: advance the modal immediately; the POST records it. If the
    // POST fails, the next app open simply shows the announcement again —
    // safe in the direction that matters (an ack can be re-done; a lockout
    // caused by waiting on a failed request can't be escaped).
    setUnackedAnnouncements(prev => prev.filter(a => a.id !== id));
    fetch(`/api/announcements/${id}/acknowledge`, { method: "POST" }).catch((err) => {
      console.error("Failed to record announcement acknowledgement:", err);
    });
  };

  // Keeps `usersList` (the small, app-wide directory cache — see its
  // declaration above) reasonably fresh for consumers that need to resolve
  // OTHER advisors' name/TACT ID from an email, e.g. AuditPage's Activity
  // Log ("Modification History"/"User Activity" sub-tabs) — search_history
  // and change_logs rows only store the actor's email. This used to happen
  // as a side effect of ProfileAccessManagement.tsx fetching the full
  // directory on its own mount; now that that admin table is
  // server-paginated (25/page) instead of loading everything, this is the
  // one place that still does a one-time full fetch of the (typically small,
  // org-staff-sized) `users` table. GET /api/users is Admin/Developer-only
  // server-side, so this silently no-ops for a General-tier caller — same
  // fail-open pattern as fetchPageVisibility below.
  const fetchUsersList = async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      if (Array.isArray(body.users)) {
        setUsersList(body.users);
      }
    } catch (_) {
      // Never block the app on this — worst case name/TACT-ID resolution
      // falls back to whatever's already cached.
    }
  };

  // External resource links (Payment SOP, QA Dashboard, etc.) shown in the
  // Workspace Controls drawer's Resources section — readable by every
  // signed-in user, writable by Admin/Developer only (enforced server-side).
  const [externalResources, setExternalResources] = useState<ExternalResource[]>([]);
  const [externalResourcesLoadError, setExternalResourcesLoadError] = useState<string | null>(null);

  const mapExternalResourceRow = (row: any): ExternalResource => ({
    id: String(row.id),
    title: row.title,
    url: row.url,
    addedBy: row.addedBy,
    createdAt: row.createdAt ?? undefined,
    icon: row.icon ?? undefined,
  });

  const fetchExternalResources = async () => {
    try {
      const res = await fetch("/api/external-resources");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load resource links (HTTP ${res.status}).`);
      setExternalResources((body.entries || []).map(mapExternalResourceRow));
      setExternalResourcesLoadError(null);
    } catch (err: unknown) {
      setExternalResourcesLoadError(err instanceof Error ? err.message : "Could not load resource links from the server.");
    }
  };

  // DB-backed plan declaration questionnaires (Plan Management page). This
  // is the *live* source of truth for new/edited plans — /api/match reads
  // from the same table server-side. Readable by every signed-in user
  // (needed for the plan picker + matching to work for General tier too);
  // writes gated to Admin/Developer both here and server-side.
  const [dbPlanConfigs, setDbPlanConfigs] = useState<DbPlanConfigEntry[]>([]);
  const [dbPlanConfigsLoadError, setDbPlanConfigsLoadError] = useState<string | null>(null);

  const mapPlanConfigRow = (row: any): DbPlanConfigEntry => ({
    planName: row.planName,
    insurerName: row.insurerName,
    questions: row.questions || [],
    categoryMap: row.categoryMap || {},
    anyOther: row.anyOther,
    hasUmbrella: !!row.hasUmbrella,
    umbrellaQuestions: row.umbrellaQuestions || [],
    // Was missing entirely — every fetch of the plan list (page load,
    // manual refresh) silently wiped specificIllnesses back to empty for
    // any plan relying solely on this DB field (Aspire, Reassure 2.0: no
    // hardcoded SPECIFIC_ILLNESSES fallback to mask the gap, unlike the
    // original 4 plans). saveSpecificIllnessesForPlan's own savedRow
    // mapper already included this field correctly, which is why it only
    // ever looked broken after a reload/refetch, not right after saving.
    specificIllnesses: row.specificIllnesses || [],
    overrides: row.overrides || undefined,
    addedBy: row.addedBy,
  });

  const fetchPlanConfigs = async () => {
    try {
      const res = await fetch("/api/plan-configs");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load plans (HTTP ${res.status}).`);
      setDbPlanConfigs((body.entries || []).map(mapPlanConfigRow));
      setDbPlanConfigsLoadError(null);
    } catch (err: unknown) {
      setDbPlanConfigsLoadError(err instanceof Error ? err.message : "Could not load plans from the server.");
    }
  };

  // Refreshes the Lookup page's autocomplete dropdown from the NEW
  // ped_repository/ped_aliases schema (cutover, 2026-07-29) — visible
  // aliases only, per PED_REPOSITORY_GOVERNANCE.md's 3-layer model (hidden/
  // normalization-only aliases still match on the Lookup page's actual
  // search, they just never appear as a suggested term). `dynamicSuggestions`'s
  // useState initializer below computes the same list client-side from
  // TOP_PED_DICTIONARY/SCRIPT_DICTIONARY as a bootstrap fallback, so this
  // only overwrites it once the DB actually has rows — before that
  // migration has run in a given environment, or if this fetch fails, the
  // dropdown keeps working off the built-in list.
  const fetchPedSuggestions = async () => {
    try {
      const res = await fetch("/api/ped-repository/autocomplete");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load PED suggestions (HTTP ${res.status}).`);
      const terms = (body.entries || [])
        .map((row: any) => row.term)
        .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0);
      if (terms.length > 0) {
        // setDynamicSuggestions is declared later in this component (see the
        // dynamicSuggestions useState below), but fetchPedSuggestions is only
        // ever invoked from inside a useEffect (after mount), by which point
        // every hook in this render has already initialized. No temporal-dead-
        // zone risk in practice.
        // eslint-disable-next-line react-hooks/immutability
        setDynamicSuggestions(terms);
      }
    } catch (err: unknown) {
      console.error("Failed to load PED suggestions from the server — keeping the built-in dropdown list:", err);
    }
  };

  // Add/edit/delete state for the Resources section of the Workspace
  // Controls drawer (Admin/Developer only — enforced server-side too).
  const [newResourceTitle, setNewResourceTitle] = useState("");
  const [newResourceUrl, setNewResourceUrl] = useState("");
  // "" = auto (keyword-guessed from title); anything else is an explicit
  // lucide-react icon name from RESOURCE_ICON_OPTIONS below.
  const [newResourceIcon, setNewResourceIcon] = useState("");
  const [isAddingResource, setIsAddingResource] = useState(false);
  const [resourceFormError, setResourceFormError] = useState<string | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [editResourceTitle, setEditResourceTitle] = useState("");
  const [editResourceUrl, setEditResourceUrl] = useState("");
  const [editResourceIcon, setEditResourceIcon] = useState("");
  // Off by default — Admin/Developer see a plain link list just like everyone
  // else until they explicitly opt into managing entries via the "Manage
  // Resources" toggle in the drawer.
  const [isManagingResources, setIsManagingResources] = useState(false);

  const handleAddResource = async () => {
    if (!newResourceTitle.trim() || !newResourceUrl.trim()) {
      setResourceFormError("Title and URL are required.");
      return;
    }
    setIsAddingResource(true);
    setResourceFormError(null);
    try {
      const res = await fetch("/api/external-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newResourceTitle.trim(), url: newResourceUrl.trim(), icon: newResourceIcon }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add this resource link (HTTP ${res.status}).`);
      setExternalResources(prev => [mapExternalResourceRow(body.entry), ...prev]);
      setNewResourceTitle("");
      setNewResourceUrl("");
      setNewResourceIcon("");
    } catch (err: unknown) {
      setResourceFormError(err instanceof Error ? err.message : "Failed to add this resource link.");
    } finally {
      setIsAddingResource(false);
    }
  };

  const startEditingResource = (resource: ExternalResource) => {
    setEditingResourceId(resource.id);
    setEditResourceTitle(resource.title);
    setEditResourceUrl(resource.url);
    setEditResourceIcon(resource.icon || "");
    setResourceFormError(null);
  };

  const handleUpdateResource = async (id: string) => {
    if (!editResourceTitle.trim() || !editResourceUrl.trim()) {
      setResourceFormError("Title and URL are required.");
      return;
    }
    try {
      const res = await fetch(`/api/external-resources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editResourceTitle.trim(), url: editResourceUrl.trim(), icon: editResourceIcon }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this resource link (HTTP ${res.status}).`);
      const updated = mapExternalResourceRow(body.entry);
      setExternalResources(prev => prev.map(r => (r.id === id ? updated : r)));
      setEditingResourceId(null);
    } catch (err: unknown) {
      setResourceFormError(err instanceof Error ? err.message : "Failed to update this resource link.");
    }
  };

  const handleDeleteResource = (id: string, title: string) => {
    setConfirmActionLabel(`Delete resource link "${title}"`);
    setOnConfirmAction(() => async () => {
      try {
        const res = await fetch(`/api/external-resources/${id}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to delete this resource link (HTTP ${res.status}).`);
        setExternalResources(prev => prev.filter(r => r.id !== id));
      } catch (err: unknown) {
        setResourceFormError(err instanceof Error ? err.message : "Failed to delete this resource link.");
      }
    });
    setIsConfirmModalOpen(true);
  };

  // Swaps a resource link with its up/down neighbor in the displayed order,
  // then persists the FULL new ordering (every id, in order) to the server —
  // updated optimistically so the move feels instant, reverted by
  // re-fetching if the save fails.
  const handleMoveResource = async (id: string, direction: "up" | "down") => {
    const currentIndex = externalResources.findIndex((r) => r.id === id);
    if (currentIndex === -1) return;
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= externalResources.length) return;

    const reordered = [...externalResources];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setExternalResources(reordered);

    try {
      const res = await fetch("/api/external-resources/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((r) => Number(r.id)) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save the new order (HTTP ${res.status}).`);
      setExternalResources((body.entries || []).map(mapExternalResourceRow));
    } catch (err: unknown) {
      setResourceFormError(err instanceof Error ? err.message : "Failed to save the new order.");
      fetchExternalResources();
    }
  };

  // Which announcements advisors see on the Lookup page.
  //
  // Selection is driven by ANNOUNCEMENT DATE (the "Posted" date): newest
  // first. QA and General announcements are now capped SEPARATELY (5 QA + 3
  // General, each independently) rather than sharing one pool of 10 — so a
  // burst of QA announcements can no longer crowd General announcements out
  // of rotation entirely (or vice versa). This replaced an older
  // Effective-Date rule that kept a *minimum* of 5 by back-filling expired
  // items, which could resurface outdated announcements as though they were
  // current.
  const MAX_QA_ANNOUNCEMENTS = 5;
  const MAX_GENERAL_ANNOUNCEMENTS = 3;
  const activeAnnouncements = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Sort key: announcement (posted) date. Falls back to effectiveDate for
    // legacy rows saved before the announcement-date field existed, then to 0
    // so an undated row sinks below every dated one instead of floating.
    const getPostedTime = (item: QAAnnouncement) => {
      const raw = item.announcementDate || item.effectiveDate;
      if (!raw) return 0;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return 0;
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };

    // Retained rule: a General announcement past its Valid Till Date is
    // expired and drops out regardless of how recently it was posted.
    // QA announcements have no expiry field and are governed purely by the
    // recency cap below.
    const unexpiredAnnouncements = qaAnnouncements.filter(item => {
      if (item.type === "General Announcement" && item.validTillDate) {
        const tillDate = new Date(item.validTillDate);
        tillDate.setHours(0, 0, 0, 0);
        if (today.getTime() >= tillDate.getTime()) return false;
      }
      return true;
    });

    const sortByPostedDesc = (a: QAAnnouncement, b: QAAnnouncement) => getPostedTime(b) - getPostedTime(a);

    // Missing `type` defaults to QA (matches the "QA Announcement" fallback
    // used elsewhere, e.g. LookupPage's `item.type || "QA Announcement"`).
    const qaOnly = unexpiredAnnouncements.filter(item => item.type === "General Announcement" ? false : true);
    const generalOnly = unexpiredAnnouncements.filter(item => item.type === "General Announcement");

    const cappedQa = [...qaOnly].sort(sortByPostedDesc).slice(0, MAX_QA_ANNOUNCEMENTS);
    const cappedGeneral = [...generalOnly].sort(sortByPostedDesc).slice(0, MAX_GENERAL_ANNOUNCEMENTS);

    // Re-merge and re-sort so the carousel still steps through both types
    // newest-first overall, rather than all QA then all General.
    return [...cappedQa, ...cappedGeneral].sort(sortByPostedDesc);
  }, [qaAnnouncements]);

  const [noticeIndex, setNoticeIndex] = useState<number>(0);
  const [slideDirection, setSlideDirection] = useState<"right-to-left" | "left-to-right">("right-to-left");

  useEffect(() => {
    if (activeAnnouncements.length <= 1) return;
    const currentText = activeAnnouncements[noticeIndex % activeAnnouncements.length]?.announcement || "";
    // Give 5 seconds base + 50ms per character for dynamic reading pace
    const dynamicDelay = Math.max(5000, currentText.length * 50);
    
    const timer = setTimeout(() => {
      setSlideDirection("right-to-left");
      setNoticeIndex((prev) => (prev + 1) % activeAnnouncements.length);
    }, dynamicDelay);
    
    return () => clearTimeout(timer);
  }, [noticeIndex, activeAnnouncements]);

  // Scroll to the top when switching views/pages or loading the application
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    const scrollContainer = document.getElementById("main-scrollable-body");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [activeTab]);

  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isMobileWindow, setIsMobileWindow] = useState<boolean>(typeof window !== "undefined" ? window.innerWidth < 768 : false);

  // Sidebar information architecture — functional groupings (see the
  // renderSidebarContent expanded nav below). Advisor Workspace is the only
  // section open by default (the advisor's daily-use tools); every other
  // section starts collapsed and auto-expands the moment the advisor is on
  // a page that belongs to it, so a direct link/refresh into e.g. Plan
  // Management always lands with that section visibly open.
  type SidebarSectionKey = "advisorWorkspace" | "quality" | "reference" | "appOpsControls" | "administration" | "developer";
  const SIDEBAR_SECTION_TABS: Record<SidebarSectionKey, typeof activeTab[]> = {
    advisorWorkspace: ["lookup", "coverage_projection", "specific_illness_check", "query_assist"],
    quality: ["qa_dashboard"],
    reference: ["advisory_zone", "announcement_archive", "resources"],
    appOpsControls: ["qa_announcement_log", "ped_suggestions", "knowledge_base", "plan_scope"],
    administration: ["profile_access", "audit", "flagged_responses", "smoke_test"],
    developer: ["owner_controls"],
  };
  const [openSections, setOpenSections] = useState<Record<SidebarSectionKey, boolean>>({
    advisorWorkspace: true,
    quality: false,
    reference: false,
    appOpsControls: false,
    administration: false,
    developer: false,
  });
  const toggleSidebarSection = (key: SidebarSectionKey) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };
  useEffect(() => {
    const owningSection = (Object.keys(SIDEBAR_SECTION_TABS) as SidebarSectionKey[]).find(key =>
      SIDEBAR_SECTION_TABS[key].includes(activeTab)
    );
    if (owningSection) {
      setOpenSections(prev => (prev[owningSection] ? prev : { ...prev, [owningSection]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Collapsed-rail group flyout — the collapsed sidebar shows one icon per
  // functional group (not per page); clicking a group icon opens a small
  // floating panel listing that group's pages, anchored to the icon that
  // was clicked (same positioning approach as the profile card's dropdown
  // below). Closed automatically on navigation and whenever the sidebar
  // state changes out from under it (expands, or the window becomes
  // mobile-width) so it never lingers pointing at an unmounted icon.
  const [openGroupFlyout, setOpenGroupFlyout] = useState<SidebarSectionKey | null>(null);
  const [groupFlyoutPos, setGroupFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    setOpenGroupFlyout(null);
  }, [activeTab, isMenuOpen, isMobileWindow]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileWindow(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState<boolean>(false);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [profileMenuPos, setProfileMenuPos] = useState<{ bottom: number; left: number } | null>(null);

  // My Activity Section Navigation View States
  const [myActivitySearch, setMyActivitySearch] = useState<string>("");
  const [myActivityPlanFilter, setMyActivityPlanFilter] = useState<string>("All");
  const [myActivityStartDate, setMyActivityStartDate] = useState<string>("");
  const [myActivityEndDate, setMyActivityEndDate] = useState<string>("");
  const [expandedLogIndex, setExpandedLogIndex] = useState<string | null>(null);

  // Active Login State — the source of truth is the real server session (an
  // httpOnly cookie set by /api/auth/google/callback after a verified
  // @joinditto.in Google sign-in), checked on mount via GET /api/auth/session
  // below. There is no localStorage fallback anymore: an expired/missing
  // server session always means logged out.
  const [currentUser, setCurrentUser] = useState<LoggedUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Users Database (mocking production directory)
  const [usersList, setUsersList] = usePersistentState<UserProfile[]>("ditto_users_list", () => {
    return [
      { email: "mehruf.p@joinditto.in", name: "Mehruf P", tactId: "TACT-101", tier: "Developer", status: "Active" },
      { email: "rebecca.s@joinditto.in", name: "Rebecca S", tactId: "TACT-102", tier: "Admin", status: "Active" },
      { email: "shashank@joinditto.in", name: "Shashank J", tactId: "TACT-103", tier: "General", status: "Active" }
    ];
  });

  // Keep the logged-in user's profile fields in sync if their entry in
  // usersList changes elsewhere (persistence for usersList itself is handled
  // by the usePersistentState hook above).
  useEffect(() => {
    if (currentUser) {
      const match = usersList.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
      if (match) {
        if (match.name !== currentUser.name || match.tactId !== currentUser.tactId || match.tier !== currentUser.tier) {
          const updatedUser = { ...currentUser, name: match.name, tactId: match.tactId, tier: match.tier };
          setCurrentUser(updatedUser);
        }
      }
    }
  }, [usersList, currentUser]);

  // Fetch announcements from the server once someone is actually signed in
  // (covers both the normal session-restore path and completing first-time
  // setup). See fetchAnnouncements' declaration above for why this used to
  // be a hardcoded/localStorage seed instead.
  useEffect(() => {
    if (currentUser) {
      fetchAnnouncements();
      fetchUnackedAnnouncements();
      fetchExternalResources();
      fetchPlanConfigs();
      fetchPedSuggestions();
      fetchPageVisibility();
      fetchUsersList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);

  // Accessibility: trap keyboard focus within an open drawer; Escape closes; restore focus on close.
  useEffect(() => {
    const drawerId = isMenuOpen ? "left-nav-drawer" : isRightSidebarOpen ? "right-controls-drawer" : null;
    if (!drawerId) return;
    const closeDrawer = isMenuOpen ? () => setIsMenuOpen(false) : () => setIsRightSidebarOpen(false);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const getFocusable = (): HTMLElement[] => {
      const container = document.getElementById(drawerId);
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    };
    const focusTimer = setTimeout(() => {
      const focusables = getFocusable();
      if (focusables.length) focusables[0].focus();
    }, 60);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (!items.length) return;
      const container = document.getElementById(drawerId);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey) {
        if (active === first || !container?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [isMenuOpen, isRightSidebarOpen]);

  // Draft plans submitted for approval
  const [draftPlans] = usePersistentState<DraftPlan[]>(
    "ditto_draft_plans",
    () => [
      {
        name: "Activ One Safeguard [DRAFT]",
        submittedBy: "Rebecca S",
        submittedAt: "2026-06-02",
        status: "Pending Approval",
        questions: [
          "Are you suffering from any chronic kidney disease?",
          "Have you had any history of organ transplantation?",
          "Any other congenital or endocrine disease?"
        ]
      },
      {
        name: "Care Elite Protect [DRAFT]",
        submittedBy: "Shashank J",
        submittedAt: "2026-06-03",
        status: "Pending Approval",
        questions: [
          "Do you have any active psychiatric or nervous disorders?",
          "History of bypass surgeries or major heart ailments?",
          "Any other non-disclosed ailments?"
        ]
      }
    ],
    {
      deserialize: (raw) => {
        const parsed = JSON.parse(raw) as DraftPlan[];
        const seen = new Set<string>();
        return parsed.filter(d => {
          if (!d || !d.name || seen.has(d.name)) return false;
          seen.add(d.name);
          return true;
        });
      },
    }
  );

  // Production plans list (persisted dynamically)
  const [productionPlans, setProductionPlans] = usePersistentState<string[]>(
    "ditto_production_plans",
    () => PLANS
  );

  // Keep the plan picker's live plan-name list inclusive of anything added
  // via the Plan Management page — productionPlans already feeds the
  // dropdown everywhere else in the app, so this just folds DB-added names
  // into that existing list rather than introducing a second list to sync.
  //
  // Also folds in any newly-hardcoded entries from types.ts's PLANS array
  // (e.g. when a new built-in plan like Niva Bupa's "Aspire" is added to the
  // codebase). productionPlans is a usePersistentState value seeded from
  // PLANS only the very first time a browser ever loads the app — for any
  // returning user, its localStorage value already exists and the PLANS
  // initializer never runs again, so without this reconciliation a plan
  // added to PLANS post-launch would silently never appear in an existing
  // user's plan picker.
  useEffect(() => {
    setProductionPlans(prev => {
      const names = new Set(prev);
      let changed = false;
      PLANS.forEach(planName => {
        if (!names.has(planName)) {
          names.add(planName);
          changed = true;
        }
      });
      dbPlanConfigs.forEach(row => {
        if (!names.has(row.planName)) {
          names.add(row.planName);
          changed = true;
        }
      });
      return changed ? Array.from(names) : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbPlanConfigs]);

  // Master Change Log State ("Modification History" sub-tab under Audit).
  //
  // NOTE (audit fix, see Production_Readiness_Audit.md Finding 3): this used
  // to be persisted only to this browser's own localStorage, so an Developer
  // triaging a flagged issue (or an Admin editing an announcement) never
  // showed up in the modification history seen by anyone else — the audit
  // trail wasn't actually a trail. GET/POST /api/change-logs (backed by the
  // change_logs table) is now the shared source of truth. `setChangeLogs`
  // below is a drop-in replacement for the old useState setter — every
  // existing call site across the app (ProfileAccessManagement,
  // FlaggedResponsesPage, QAAnnouncementForm, AnnouncementLogPage, etc.)
  // already calls it as `setChangeLogs(prev => [newEntry, ...prev])`, so
  // wrapping the setter here to also POST any newly-added entry means none
  // of those call sites need to change.
  const [changeLogs, setChangeLogsRaw] = useState<ChangeLogEntry[]>([]);

  // changeLogsRef mirrors `changeLogs` synchronously (state updates aren't
  // visible until the next render, but setChangeLogs below needs the *current*
  // value the instant it's called). It's also what makes setChangeLogs safe
  // under StrictMode: the POST side effect below runs as a plain statement in
  // this wrapper function, not inside the function passed to setChangeLogsRaw
  // — React only double-invokes the latter (to catch impure updaters), so
  // putting the fetch there was firing every change-log entry twice.
  const changeLogsRef = useRef<ChangeLogEntry[]>([]);
  useEffect(() => {
    changeLogsRef.current = changeLogs;
  }, [changeLogs]);

  const setChangeLogs: React.Dispatch<React.SetStateAction<ChangeLogEntry[]>> = (update) => {
    const prev = changeLogsRef.current;
    const next = typeof update === "function"
      ? (update as (p: ChangeLogEntry[]) => ChangeLogEntry[])(prev)
      : update;

    changeLogsRef.current = next;
    setChangeLogsRaw(next);

    const prevIds = new Set(prev.map(e => e.id));
    next.filter(e => !prevIds.has(e.id)).forEach(entry => {
      fetch("/api/change-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: entry.actionType,
          planName: entry.planName,
          description: entry.description,
          snapshot: entry.snapshot,
        }),
      }).catch((err) => {
        console.error("Failed to persist change log entry on the server:", err);
      });
    });
  };

  // Activity Log States
  const [auditSubTab, setAuditSubTab] = useState<"user" | "modification">("user");
  const [historySearch, setHistorySearch] = useState("");
  const [historyActionFilter, setHistoryActionFilter] = useState("All");

  // Master Question tags map (keeps legacy lists compatible but tags them elegantly)
  const [planQuestionsState] = useState<Record<string, Array<{ text: string, tag: "Specific" | "Umbrella" | "Catch-all" }>>>((() => {
    // Always re-derive base plan questions from getPlanConfig() as the live source of truth.
    // This prevents stale localStorage data from overriding the correct question lists.
    const base = getPlanConfig();
    const res: Record<string, Array<{ text: string, tag: "Specific" | "Umbrella" | "Catch-all" }>> = {};

    Object.keys(base).forEach(planName => {
      const config = base[planName];
      const combinedQuestions = [...config.questions];
      if (config.hasUmbrella) {
        combinedQuestions.push(...config.umbrellaQuestions);
      }

      res[planName] = combinedQuestions.map(qText => {
        let tag: "Specific" | "Umbrella" | "Catch-all" = "Specific";
        const normQ = qText.toLowerCase().trim();
        const normAnyOther = config.anyOther ? config.anyOther.toLowerCase().trim() : "";
        const normUmbrellas = (config.umbrellaQuestions || []).map(uq => uq.toLowerCase().trim());

        if (normUmbrellas.includes(normQ)) {
          tag = "Umbrella";
        } else if (normQ === normAnyOther) {
          tag = "Catch-all";
        }
        return { text: qText, tag };
      });
    });

    // Restore user-created DRAFT plans from localStorage (not present in base config).
    try {
      const saved = localStorage.getItem("ditto_plan_questions_state");
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(planName => {
          if (!base[planName]) {
            res[planName] = parsed[planName];
          }
        });
      }
    } catch (_) {}

    if (!res["Activ One Safeguard [DRAFT]"]) {
      res["Activ One Safeguard [DRAFT]"] = [
        { text: "Are you suffering from any chronic kidney disease?", tag: "Specific" },
        { text: "Have you had any history of organ transplantation?", tag: "Specific" },
        { text: "Any other congenital or endocrine disease?", tag: "Catch-all" }
      ];
    }
    if (!res["Care Elite Protect [DRAFT]"]) {
      res["Care Elite Protect [DRAFT]"] = [
        { text: "Do you have any active psychiatric or nervous disorders?", tag: "Specific" },
        { text: "History of bypass surgeries or major heart ailments?", tag: "Specific" },
        { text: "Any other non-disclosed ailments?", tag: "Catch-all" }
      ];
    }

    return res;
  }));

  useEffect(() => {
    try {
      localStorage.setItem("ditto_plan_questions_state", JSON.stringify(planQuestionsState));
    } catch (_) {}
  }, [planQuestionsState]);

  // NOTE (audit fix, see Production_Readiness_Audit.md Findings 1 & 6): this
  // used to hardcode a single Developer email as a bypass and silently defaulted
  // every other signed-in user to "General" tier regardless of what the
  // user directory actually said — meaning even a real Admin never got
  // Admin-level `effectiveTier` unless they were the hardcoded email or
  // used the simulated-role feature. `currentUser.tier` is already the
  // correct, server-resolved tier (set from the /api/users-backed directory
  // when the session bootstraps below, and kept in sync by the effect that
  // watches `usersList`) — trust it instead of re-deriving tier from a
  // client-side special case.
  //
  // (The client-side "Preview As" role simulation this used to layer on top
  // of baseUserTier was removed from the UI — effectiveTier is now always
  // the advisor's real, server-resolved tier.)
  const baseUserTier: "General" | "Admin" | "Developer" = currentUser?.tier ?? "General";
  const effectiveTier = baseUserTier;

  // NOTE: this used to eagerly bulk-fetch the ENTIRE change_logs table on
  // every login for Admin/Developer (GET /api/change-logs, no limit) purely
  // so the Modification History table had data to render. AuditPage.tsx now
  // self-fetches its own server-side paginated page of change_logs directly
  // (see its internal fetch effect), so that preload is gone — `changeLogs`
  // state above still exists and starts empty; it's populated incrementally
  // by `setChangeLogs` below whenever THIS session logs a new action (the
  // POST side-effect that every `setChangeLogs(prev => [entry, ...prev])`
  // call site across the app relies on), never by a bulk read.

  // Feature permissions — nothing in the app currently writes to a saved
  // override (no admin UI ever calls a setter here), so this used to go
  // through usePersistentState anyway, which meant a browser's very first
  // page load permanently froze a JSON snapshot of DEFAULT_FEATURE_PERMISSIONS
  // in localStorage. Any later fix to that source file (e.g. correcting
  // Smoke Test to Admin-only) would silently never reach a browser that had
  // already cached the old, wrong entry. Reading the constant directly
  // guarantees every browser always reflects the current shipped tiers.
  const featurePermissions = DEFAULT_FEATURE_PERMISSIONS;

  // Unified dynamic hasAccess governance function
  const hasAccess = (featureId: string, actionType: "Viewer" | "Editor"): boolean => {
    const isRealDeveloper = currentUser?.tier === "Developer";

    // ── OWNER-ONLY HARD GATE ────────────────────────────────────────────
    // Decided in code, NOT via the featurePermissions registry, and it
    // returns before every other branch below.
    //
    // Why it can't go through the registry: `featurePermissions` is
    // localStorage-backed (usePersistentState), so any browser that saved
    // its permission list before a new feature id existed will not contain
    // that id — and the `if (!perm) return true` fallback further down then
    // grants it to EVERYONE. That is exactly how Developer Controls briefly
    // became visible to Admin/General users. Anything that must never be
    // reachable by a lower tier belongs in this list, not in the registry.
    if (DEVELOPER_ONLY_FEATURES.has(featureId)) {
      // True for a real Developer even while previewing a lower tier via
      // "View As" — otherwise hiding a page mid-preview could leave them
      // with no route back to these toggles.
      return isRealDeveloper;
    }

    const tier = effectiveTier;

    // Developer-hidden page — checked BEFORE the tier grants below so it applies
    // uniformly. A real Developer not simulating another tier is exempt; a real
    // Developer who IS simulating sees exactly what that tier sees, so "View As"
    // stays an honest preview of the hiding they just configured.
    if (hiddenPages.includes(featureId) && !(isRealDeveloper && tier === "Developer")) {
      return false;
    }

    if (tier === "Developer") return true;

    // Resolve against the saved registry first, then fall back to the
    // shipped defaults.
    //
    // That second lookup matters: the saved list lives in localStorage and
    // goes stale the moment a new page is added, so without it every newly
    // shipped feature would hit the default-open branch below and be granted
    // to every tier on any browser with an older saved list. Falling through
    // to DEFAULT_FEATURE_PERMISSIONS means a new page is governed by the
    // tiers it actually shipped with.
    const perm =
      featurePermissions.find(p => p.id === featureId) ||
      DEFAULT_FEATURE_PERMISSIONS.find(p => p.id === featureId);

    // Genuinely unknown to both — not a page we ship. Kept open so
    // non-page permission checks don't hard-fail.
    if (!perm) return true;

    const level = tier === "Admin" ? perm.adminAccess : perm.generalAccess;
    if (level === "Editor") return true;
    if (level === "Viewer") return actionType === "Viewer";
    return false;
  };

  // EVICTION GUARD — if the page the user is currently on becomes
  // inaccessible (typically because the Developer just hid it), bounce them
  // Home. Without this the nav button disappears but the tab body keeps
  // rendering, because the route blocks below key off activeTab alone.
  //
  // Cannot strand a real Developer: hasAccess() always grants them
  // "owner_controls", so the Developer Controls page stays reachable even if the
  // guard bounces them out of a page they hid while previewing via "View As".
  useEffect(() => {
    if (activeTab === "lookup") return;
    if (!hasAccess(activeTab, "Viewer")) {
      setActiveTab("lookup");
      setShowIntro(true);
    }
  }, [hiddenPages, activeTab, currentUser, effectiveTier]);

  // Destructive-action confirmation state.
  //
  // NOTE (audit fix, see Production_Readiness_Audit.md Finding 2): this used
  // to be an "Developer Passcode" gate — a 4-digit code stored in localStorage
  // (defaulting to the literal string "1234") and compared to the user's
  // input entirely in the browser. That provided no real access control:
  // anyone could read the correct value out of localStorage, or simply
  // invoke the stored `onConfirm` callback from devtools. The actual
  // authorization check has always been (and remains) the `hasAccess(...)`
  // tier check below — the passcode step added a false sense of security on
  // top of it without adding any real one. This keeps the "are you sure,
  // this is permanent" confirmation UX (still useful against accidental
  // clicks) but is honest about what it is: a confirmation, not a
  // credential check. Real enforcement for these actions happens server-side
  // once they're wired to authenticated API routes (audit Finding 3).
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
  const [onConfirmAction, setOnConfirmAction] = useState<(() => void) | null>(null);
  const [confirmActionLabel, setConfirmActionLabel] = useState<string>("");

  const confirmDestructiveAction = (actionDescription: string, onConfirm: () => void) => {
    if (!hasAccess("clear_activity", "Editor")) {
      alert(`Forbidden: Clearance Tier is ${effectiveTier}. This destructive operation requires additional permissions or higher clearance.`);
      return;
    }
    setOnConfirmAction(() => onConfirm);
    setConfirmActionLabel(actionDescription);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmDestructiveAction = () => {
    setIsConfirmModalOpen(false);
    if (onConfirmAction) {
      onConfirmAction();
    }
  };

  // Plan Configurations dynamically expanded with promoted and draft plans!
  const planConfigs = useMemo(() => {
    const base = getPlanConfig();
    
    // Merge all production plans (including base and promoted ones) using latest planQuestionsState
    productionPlans.forEach(name => {
      const qState = planQuestionsState[name];
      if (qState) {
        const specifics = qState.filter(q => q.tag === "Specific").map(q => q.text);
        const umbrellas = qState.filter(q => q.tag === "Umbrella").map(q => q.text);
        const catchAllOpt = qState.find(q => q.tag === "Catch-all")?.text || "Other Medical Conditions";

        base[name] = {
          ...base[name],
          questions: [...specifics, catchAllOpt],
          anyOther: catchAllOpt,
          hasUmbrella: umbrellas.length > 0,
          umbrellaQuestions: umbrellas,
          categoryMap: base[name]?.categoryMap || guessCategoryMap(specifics)
        };
      }
    });

    // Merge active draft plans
    draftPlans.forEach(draft => {
      const questionsWithTags = planQuestionsState[draft.name] || draft.questions.map(q => {
        let tag: "Specific" | "Umbrella" | "Catch-all" = "Specific";
        if (q.toLowerCase().includes("other") || q.toLowerCase().includes("any other")) tag = "Catch-all";
        return { text: q, tag };
      });

      const specifics = questionsWithTags.filter(q => q.tag === "Specific").map(q => q.text);
      const umbrellas = questionsWithTags.filter(q => q.tag === "Umbrella").map(q => q.text);
      const catchAllOpt = questionsWithTags.find(q => q.tag === "Catch-all")?.text || "Other Medical Conditions";

      base[draft.name] = {
        questions: [...specifics, catchAllOpt],
        anyOther: catchAllOpt,
        hasUmbrella: umbrellas.length > 0,
        umbrellaQuestions: umbrellas,
        categoryMap: guessCategoryMap(specifics)
      };
    });

    // DB-authored plans (Plan Management page) are the live source of
    // truth and win over anything derived above — this mirrors exactly
    // what /api/match does server-side (see dbRowToPlanConfig in
    // server.ts), so what an advisor sees in the picker/lookup always
    // matches what the server will actually classify against.
    dbPlanConfigs.forEach(row => {
      const specifics = row.questions.filter(q => q.tag !== "Umbrella").map(q => q.text);
      base[row.planName] = {
        questions: specifics,
        anyOther: row.anyOther,
        hasUmbrella: row.hasUmbrella,
        umbrellaQuestions: row.umbrellaQuestions,
        categoryMap: row.categoryMap,
        overrides: row.overrides,
      };
    });

    return base;
  }, [draftPlans, productionPlans, planQuestionsState, dbPlanConfigs]);

  // Theme support — dark default, toggleable dark mode, persistently saved
  const [theme, setTheme] = usePersistentState<"light" | "dark">(
    "ditto_crm_theme",
    () => "dark",
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === "light" || raw === "dark" ? raw : "dark"),
    }
  );
  const isDark = theme === "dark";
  const toggleTheme = React.useCallback(() => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  }, []);
  // Sync dark class on <html> whenever theme changes
  React.useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // First time layout / profile complete flow states
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState<boolean>(false);
  const [tempSsoEmail, setTempSsoEmail] = useState<string>("");
  const [tempSsoName, setTempSsoName] = useState<string>("");
  const [tempTactId, setTempTactId] = useState<string>("");
  // Skill Domain — which insurance line(s) this new hire handles (Health
  // and/or Term). Optional at signup; feeds users.tags (see
  // drizzle/0026_advisor_tags.sql) and can be changed later by an
  // Admin/Developer in User Management.
  const [tempTags, setTempTags] = useState<string[]>([]);
  // Post-login nudge (NOT first-time setup) for an already-provisioned user
  // whose tags are still empty — set by the session-hydration effect below
  // whenever GET /api/me returns a user with no tags. Dismissible; reappears
  // next login if skipped, since nothing is written until they save.
  const [showSkillDomainPrompt, setShowSkillDomainPrompt] = useState<boolean>(false);

  // Verify the real Google session on mount and hydrate currentUser.
  //
  // NOTE (audit fix, see Production_Readiness_Audit.md Findings 1 & 9): this
  // used to resolve tier by looking the identity up in the local `usersList`
  // state, which is seeded with a hardcoded default and only ever refreshed
  // from the server when someone happened to open the Profile Access tab.
  // A newly-provisioned (or newly re-tiered) user's very first login on a
  // fresh browser would resolve against that stale/local copy instead of
  // the real directory — e.g. a brand-new hire added by an Developer on a
  // different machine would incorrectly land in the first-time-setup flow.
  // GET /api/me (server.ts) returns the caller's own, server-authoritative
  // directory record, resolved from their verified session email — every
  // login now goes through that instead of a client-cached lookup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        const identity = data?.user as { email: string; name: string; picture?: string } | null;
        if (!identity || cancelled) return;

        const meRes = await fetch("/api/me");
        const meData = meRes.ok ? await meRes.json().catch(() => null) : null;
        const existingUser = meData?.user as UserProfile | null | undefined;

        if (existingUser && existingUser.status === "Active") {
          setCurrentUser({
            email: existingUser.email,
            name: existingUser.name,
            tactId: existingUser.tactId,
            tier: existingUser.tier,
            avatarUrl: identity.picture
          });
          // Keep the local directory cache in sync with the one confirmed-
          // current record we just fetched, so the "keep currentUser in
          // sync with usersList" effect below doesn't clobber this with a
          // stale cached entry.
          setUsersList(prev => {
            const idx = prev.findIndex(u => u.email.toLowerCase() === existingUser.email.toLowerCase());
            if (idx === -1) return [...prev, existingUser];
            if (prev[idx].tier === existingUser.tier && prev[idx].name === existingUser.name && prev[idx].tactId === existingUser.tactId) {
              return prev;
            }
            const next = [...prev];
            next[idx] = existingUser;
            return next;
          });
          // Ask on next login: an already-provisioned user with no Skill
          // Domain tags yet gets the dismissible prompt (SkillDomainPromptModal)
          // instead of the first-time-setup flow, which is only for brand-new
          // accounts GET /api/me doesn't find at all (the `else` branch below).
          if (!existingUser.tags || existingUser.tags.length === 0) {
            setShowSkillDomainPrompt(true);
          }
          setShowIntro(true);
          setActiveTab("lookup");
        } else if (existingUser) {
          // A directory record exists but status isn't "Active" — this
          // means an Developer has Disabled the account (this used to also
          // catch "Pending First Login", which no longer exists as a
          // status). Don't route this into first-time-setup: that flow
          // would just 409 anyway (the server refuses to re-provision an
          // email that's already in the directory), so it'd surface as a
          // confusing error instead of a clear "you're logged in with
          // Google but this account is deactivated" outcome. Leaving
          // currentUser unset here falls through to the normal login
          // screen.
        } else {
          setTempSsoEmail(identity.email);
          setTempSsoName(identity.name);
          setTempTactId("");
          setIsFirstTimeSetup(true);
        }
      } catch (_) {
        // Network/parse error reaching the session endpoint: fall back to the login screen.
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enforce role permission constraints dynamically using active permissions matrix
  useEffect(() => {
    if (currentUser) {
      if (!hasAccess(activeTab, "Viewer")) {
        // Fallback sequentially to ensure user isn't stuck on a forbidden tab
        const priorityTabs = ["lookup", "my_activity", "resources", "audit", "profile_access", "flagged_responses"] as const;
        const available = priorityTabs.find(tab => hasAccess(tab, "Viewer")) || "lookup";
        setActiveTab(available);
      }
    }
  }, [currentUser, activeTab, featurePermissions, effectiveTier]);

  // Authentication State
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);

  // Search History tracking (as requested by user)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>("");
  const [auditPlanFilter, setAuditPlanFilter] = useState<string>("All");
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>("All");
  const [auditTypeFilter, setAuditTypeFilter] = useState<string>("All");
  const [auditStartDate, setAuditStartDate] = useState<string>("");
  const [auditEndDate, setAuditEndDate] = useState<string>("");

  // (filteredAuditLogs / auditChartData used to be computed here; both moved
  // into src/pages/AuditPage.tsx, Phase 1.3, since they were only ever
  // consumed by the audit tab.)

  // ==========================================
  // VIEW 1: DECLARATION ASSISTANT STATE
  // ==========================================
  const SPECIFIC_ILLNESSES: Record<string, Array<{ category?: string; illness: string }>> = {
    "Activ Fit Preferred": [
      { category: "Eye", illness: "Cataract" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Eye", illness: "Refractive Error Correction" },
      { category: "Ear Nose Throat", illness: "Sinusitis" },
      { category: "Ear Nose Throat", illness: "Rhinitis" },
      { category: "Ear Nose Throat", illness: "Tonsillitis & Adenitis" },
      { category: "Ear Nose Throat", illness: "Tympanitis & Non Traumatic Perforation" },
      { category: "Ear Nose Throat", illness: "Deviated Nasal Septum" },
      { category: "Ear Nose Throat", illness: "Otitis Media" },
      { category: "Ear Nose Throat", illness: "Adenoiditis" },
      { category: "Ear Nose Throat", illness: "Mastoiditis" },
      { category: "Ear Nose Throat", illness: "Cholesteatoma" },
      { category: "Gynecology", illness: "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system" },
      { category: "Gynecology", illness: "Polycystic Ovarian Disease" },
      { category: "Gynecology", illness: "Uterine Prolapse" },
      { category: "Gynecology", illness: "Fibroids (Fibromyoma)" },
      { category: "Gynecology", illness: "Breast lumps (excluding Malignant)" },
      { category: "Gynecology", illness: "Dysfunctional Uterine Bleeding (DUB)" },
      { category: "Gynecology", illness: "Endometriosis" },
      { category: "Gynecology", illness: "Menorrhagia" },
      { category: "Gynecology", illness: "Pelvic Inflammatory Disease" },
      { category: "Orthopedic / Rheumatological", illness: "Gout" },
      { category: "Orthopedic / Rheumatological", illness: "Rheumatism, Rheumatoid Arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Non infective arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoarthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoporosis" },
      { category: "Orthopedic / Rheumatological", illness: "Prolapse of the intervertebral disc" },
      { category: "Orthopedic / Rheumatological", illness: "Spondilosis, Spondioarthritis, Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Ankylosing Spondilitis / Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Psoriatic Arthritis / Arthropathy" },
      { category: "Orthopedic / Rheumatological", illness: "Internal Derangement of Knee / Ligament or Tendon or Meniscus" },
      { category: "Orthopedic / Rheumatological", illness: "Joint Replacement Surgery" },
      { category: "Orthopedic / Rheumatological", illness: "Non Specific Arthritis" },
      { category: "Gastroenterology", illness: "Stone in Gall Bladder, Bile duct & other parts of Biliary System" },
      { category: "Gastroenterology", illness: "Cholecystitis" },
      { category: "Gastroenterology", illness: "Pancreatitis" },
      { category: "Gastroenterology", illness: "Fissure, Fistula in ano, hemorrhoids (piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess" },
      { category: "Gastroenterology", illness: "Rectal Prolapse" },
      { category: "Gastroenterology", illness: "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis" },
      { category: "Gastroenterology", illness: "Gastro Esophageal Reflux Disease (GERD)" },
      { category: "Gastroenterology", illness: "Cirrhosis" },
      { category: "Gastroenterology", illness: "Chronic Appendicitis" },
      { category: "Gastroenterology", illness: "Appendicular lump, Appendicular abscess" },
      { category: "Urogenital", illness: "Stones in Urinary system (Stone in the Kidney, Ureter, Urinary Bladder)" },
      { category: "Urogenital", illness: "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)" },
      { category: "Urogenital", illness: "Hernia, Hydrocele" },
      { category: "Urogenital", illness: "Varicocoele / Spermatocoele" },
      { category: "Skin", illness: "Skin tumour (unless malignant)" },
      { category: "Skin", illness: "All skin diseases" },
      { category: "General Surgery", illness: "Any swelling, tumour, cyst, nodule, ulcer, polyp Mass , Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (unless malignant)" },
      { category: "General Surgery", illness: "Varicose veins, Varicose ulcers" }
    ],
    "Optima Secure": [
      { category: "Gastrointestinal", illness: "Pancreatitis" },
      { category: "Gastrointestinal", illness: "Diseases of gall bladder including cholecystitis" },
      { category: "Gastrointestinal", illness: "All forms of Cirrhosis" },
      { category: "Gastrointestinal", illness: "Perineal Abscesses" },
      { category: "Gastrointestinal", illness: "Cholecystectomy" },
      { category: "Gastrointestinal", illness: "Gastro Esophageal Reflux Disorder (GERD)" },
      { category: "Gastrointestinal", illness: "Perianal Abscesses" },
      { category: "Gastrointestinal", illness: "Ulcer and erosion of stomach and duodenum" },
      { category: "Gastrointestinal", illness: "Fissure/fistula in anus, Haemorrhoids including Gout and rheumatism" },
      { category: "Gastrointestinal", illness: "Rectal Prolapse" },
      { category: "Eye", illness: "Cataract and other disorders of lens and Retina" },
      { category: "Eye", illness: "Retinal detachment" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Orthopedic & Joints", illness: "Osteoarthritis and osteoporosis" },
      { category: "Orthopedic & Joints", illness: "Joint replacement surgeries" },
      { category: "Orthopedic & Joints", illness: "Ligament, Tendon and Meniscal tear" },
      { category: "Orthopedic & Joints", illness: "Non infective Arthritis" },
      { category: "Orthopedic & Joints", illness: "Surgery for prolapsed inter vertebral disc" },
      { category: "Gynecology & Gyne-Surgery", illness: "Fibroids (fibromyoma)" },
      { category: "Gynecology & Gyne-Surgery", illness: "Prolapsed Uterus" },
      { category: "Gynecology & Gyne-Surgery", illness: "Endometriosis" },
      { category: "Gynecology & Gyne-Surgery", illness: "Polycystic ovarian diseases" },
      { category: "Gynecology & Gyne-Surgery", illness: "Dilatation and curettage (D&C)" },
      { category: "Gynecology & Gyne-Surgery", illness: "Myomectomy for fibroids" },
      { category: "Gynecology & Gyne-Surgery", illness: "Hysterectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Tympanoplasty, Mastoidectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal concha resection" },
      { category: "Ear Nose Throat (ENT)", illness: "Sinusitis, Rhinitis" },
      { category: "Ear Nose Throat (ENT)", illness: "Tonsillitis" },
      { category: "Ear Nose Throat (ENT)", illness: "Adenoidectomy, tonsillectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal polypectomy" },
      { category: "Ear Nose Throat (ENT)", illness: "Surgery for Nasal septum deviation" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Surgery of Genito urinary system unless necessitated by Malignancy" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Surgery on prostate" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Benign Hyperplasia of Prostate" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Hernia" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Calculus diseases of Urogenital system e.g. Kidneystone, Urinary Bladder Stone" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Hydrocele/Rectocele" },
      { category: "Urogenital (Urinary & Prostate)", illness: "Varicocele" },
      { category: "Vascular & Skin", illness: "Surgery for varicose veins and varicose ulcers" },
      { category: "Vascular & Skin", illness: "Skin tumors" },
      { category: "Vascular & Skin", illness: "Pilonidal sinus" },
      { category: "Vascular & Skin", illness: "Benign tumors, cysts, nodules, polyps including breast lumps" },
      { category: "Vascular & Skin", illness: "Surgery for Perianal Abscesses" },
      { category: "Vascular & Skin", illness: "Fissurectomy, Haemorrhoidectomy, Fistulectomy, ENT surgeries" }
    ],
    "Care Supreme": [
      { category: "Orthopedic", illness: "Arthritis (if non-infective)" },
      { category: "Orthopedic", illness: "Rheumatism" },
      { category: "Orthopedic", illness: "Arthroscopic Knee Surgeries/ ACL Reconstruction/ Meniscal and Ligament Repair" },
      { category: "Orthopedic", illness: "Osteoarthritis and Osteoporosis" },
      { category: "Orthopedic", illness: "Spinal Disorders" },
      { category: "Orthopedic", illness: "Joint Replacement Surgery" },
      { category: "Urogenital & Hernia", illness: "Benign Prostatic Hypertrophy" },
      { category: "Urogenital & Hernia", illness: "Surgery of Genito-urinary system unless necessitated by malignancy" },
      { category: "Urogenital & Hernia", illness: "All types of Hernia & Hydrocele" },
      { category: "Urogenital & Hernia", illness: "Kidney Stone/ Ureteric Stone/ Lithotripsy/ Gall Bladder Stone" },
      { category: "Ear Nose Throat (ENT)", illness: "Nasal Septum Deviation, Sinusitis and realted disorders" },
      { category: "Ear Nose Throat (ENT)", illness: "Surgical treatments for Benign ear, nose and throat (ENT) disorders and surgeries (including but not limited to Adenoidectomy, Mastoidectomy, Tonsillectomy and Tympanoplasty)" },
      { category: "Tumours & Skin", illness: "Internal tumours, skin tumours, cysts, nodules, polyps including breast lumps (each of any kind) unless malignant" },
      { category: "Eye", illness: "Cataract" },
      { category: "Gastrointestinal", illness: "Fissure/Fistula in anus, Hemorrhoids/ Piles, Pilonidal Sinus, Gastric and Duodenal Ulcers" },
      { category: "Gastrointestinal", illness: "Varicose veins and varicose ulcers" },
      { category: "Neurology", illness: "Parkinson's or Alzheimer's disease or Dimentia" },
      { category: "Neurology", illness: "Gout" },
      { category: "Gynecology & Gyne-Surgery", illness: "Diatation and Curettage" },
      { category: "Gynecology & Gyne-Surgery", illness: "Hysterectomy for menorrhagia or Fibromyoma or prolapse of uterus unless necessitated by malignancy" },
      { category: "Gynecology & Gyne-Surgery", illness: "Myomectomy for fibroids" }
    ],
    "Activ One Max": [
      { category: "Eye", illness: "Cataract" },
      { category: "Eye", illness: "Glaucoma" },
      { category: "Eye", illness: "Refractive Error Correction" },
      { category: "Ear Nose Throat", illness: "Sinusitis" },
      { category: "Ear Nose Throat", illness: "Rhinitis" },
      { category: "Ear Nose Throat", illness: "Tonsillitis & Adenitis" },
      { category: "Ear Nose Throat", illness: "Tympanitis & Non Traumatic Perforation" },
      { category: "Ear Nose Throat", illness: "Deviated Nasal Septum" },
      { category: "Ear Nose Throat", illness: "Otitis Media" },
      { category: "Ear Nose Throat", illness: "Adenoiditis" },
      { category: "Ear Nose Throat", illness: "Mastoiditis" },
      { category: "Ear Nose Throat", illness: "Cholesteatoma" },
      { category: "Gynecology", illness: "All Cysts, Mass, Swelling, Lump, Granulomas, Polyps, Fibroids & Benign Tumour of the female genito urinary system" },
      { category: "Gynecology", illness: "Polycystic Ovarian Disease" },
      { category: "Gynecology", illness: "Uterine Prolapse" },
      { category: "Gynecology", illness: "Fibroids (Fibromyoma)" },
      { category: "Gynecology", illness: "Breast lumps (excluding Malignant)" },
      { category: "Gynecology", illness: "Dysfunctional Uterine Bleeding (DUB)" },
      { category: "Gynecology", illness: "Endometriosis" },
      { category: "Gynecology", illness: "Menorrhagia" },
      { category: "Gynecology", illness: "Pelvic Inflammatory Disease" },
      { category: "Orthopedic / Rheumatological", illness: "Gout" },
      { category: "Orthopedic / Rheumatological", illness: "Rheumatism, Rheumatoid Arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Non infective arthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoarthritis" },
      { category: "Orthopedic / Rheumatological", illness: "Osteoporosis" },
      { category: "Orthopedic / Rheumatological", illness: "Prolapse of the intervertebral disc" },
      { category: "Orthopedic / Rheumatological", illness: "Spondilosis, Spondioarthritis, Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Ankylosing Spondilitis / Spondylopathies" },
      { category: "Orthopedic / Rheumatological", illness: "Psoriatic Arthritis / Arthropathy" },
      { category: "Orthopedic / Rheumatological", illness: "Internal Derangement of Knee / Ligament or Tendon / Meniscus Tear" },
      { category: "Orthopedic / Rheumatological", illness: "Joint Replacement Surgery" },
      { category: "Orthopedic / Rheumatological", illness: "Non Specific Arthritis" },
      { category: "Gastroenterology", illness: "Stone in Gall Bladder, Bile duct & other parts of Biliary System" },
      { category: "Gastroenterology", illness: "Cholecystitis" },
      { category: "Gastroenterology", illness: "Pancreatitis" },
      { category: "Gastroenterology", illness: "Fissure, Fistula in Ano, Hemorrhoids (Piles), Pilonidal Sinus, Ano-rectal & Perianal Abscess" },
      { category: "Gastroenterology", illness: "Rectal Prolapse" },
      { category: "Gastroenterology", illness: "Gastric or Duodenal Erosions or Ulcers + Gastritis & Duodenitis & Colitis" },
      { category: "Gastroenterology", illness: "Gastro Esophageal Reflux Disease (GERD)" },
      { category: "Gastroenterology", illness: "Cirrhosis" },
      { category: "Gastroenterology", illness: "Chronic Appendicitis" },
      { category: "Gastroenterology", illness: "Appendicular Lump, Appendicular Abscess" },
      { category: "Urogenital", illness: "Stones in Urinary System (Stone in the Kidney, Ureter, Urinary Bladder)" },
      { category: "Urogenital", illness: "Benign Hypertrophy / Enlargement of Prostate (BHP / BEP)" },
      { category: "Urogenital", illness: "Hernia, Hydrocele" },
      { category: "Urogenital", illness: "Varicocoele / Spermatocoele" },
      { category: "Skin & General", illness: "Skin Tumour (unless malignant)" },
      { category: "Skin & General", illness: "All Skin Diseases" },
      { category: "Skin & General", illness: "Any Swelling, Tumour, Cyst, Nodule, Ulcer, Polyp Mass, Swelling, Lump, Granulomas, Benign Tumour anywhere in the body (Unless Malignant)" },
      { category: "Skin & General", illness: "Varicose Veins, Varicose Ulcers" }
    ]
  };

  // Folds each plan's DB-managed Specific Illness List (Plan Management
  // wizard) into the same dict shape the Quick Reference sidebar
  // (SpecificIllnessLedgerCard) already reads, so illnesses an admin adds
  // there show up in that panel too — not just in the result-card tag from
  // checkIllnessInPlanSpecificList below. Additive per plan, same as the
  // matching logic: DB entries are appended after, never replacing, a
  // built-in plan's existing hardcoded list.
  const effectiveSpecificIllnessesDict = useMemo(() => {
    const merged: Record<string, Array<{ category?: string; illness: string }>> = { ...SPECIFIC_ILLNESSES };
    dbPlanConfigs.forEach(cfg => {
      if (cfg.specificIllnesses && cfg.specificIllnesses.length > 0) {
        merged[cfg.planName] = [...(merged[cfg.planName] || []), ...cfg.specificIllnesses];
      }
    });

    // Plans with neither a curated SPECIFIC_ILLNESSES entry above nor a
    // saved DB list yet (Aspire, Reassure 2.0 today) still have a full
    // schedule sitting in MASTER_ILLNESSES's plan_schedules — the exact
    // same source the Specific Illness Manager (SpecificIllnessLedger.tsx's
    // handleSelectManagePlan) already previews to an admin before they
    // explicitly click Save. Without this fallback, that preview creates
    // the impression a plan's list "exists" while this dict — and the
    // Quick Reference / Specific Illness List panel on the Results page
    // that reads it — stays empty until someone happens to open the
    // Manager and Save to formalize it into the DB. Only fills the gap: a
    // plan that already has a real curated or DB-saved list is left alone.
    const planNamesWithSchedules = new Set<string>();
    MASTER_ILLNESSES.forEach(def => {
      Object.keys(def.plan_schedules).forEach(name => planNamesWithSchedules.add(name));
    });
    planNamesWithSchedules.forEach(planName => {
      if (merged[planName] && merged[planName].length > 0) return;
      const derived = MASTER_ILLNESSES
        .filter(def => Boolean(def.plan_schedules[planName]))
        .map(def => ({ category: def.category as string, illness: def.parent_illness }));
      if (derived.length > 0) merged[planName] = derived;
    });

    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbPlanConfigs]);

  const checkIllnessInPlanSpecificList = (pedText: string, plan: string) => {
    if (!plan) return null;

    // 1. Admin-managed Specific Illness List for this exact plan (Plan
    // Management wizard, DB-backed via plan_configs.specificIllnesses) —
    // checked first so illnesses an admin explicitly added always take
    // priority. Reuses matchesPhrase — the same whole-word/phrase matcher
    // the legacy engine below uses — just scoped to this plan's own
    // entries instead of the fixed MASTER_ILLNESSES catalog.
    const dbConfig = dbPlanConfigs.find(cfg => cfg.planName === plan);
    if (dbConfig?.specificIllnesses?.length) {
      const dbMatch = dbConfig.specificIllnesses.find(entry => matchesPhrase(pedText, entry.illness));
      if (dbMatch) {
        return { category: dbMatch.category || "General", illness: dbMatch.illness };
      }
    }

    // 2. Legacy hardcoded engine — additive fallback, not replaced by step
    // 1, so the 4 original plans (Optima Secure, Care Supreme, Activ One
    // Max, Activ Fit Preferred) keep matching against their existing
    // specific illness schedule even after being edited in the wizard,
    // since editing declaration questions there doesn't require
    // re-entering their pre-existing specific illness list.
    const matches = matchSpecificIllness(pedText);
    const normalized = normalizePlanName(plan);
    const match = matches.find(m => m.match_type !== "no_match" && m.plans_applicable.includes(normalized));
    if (match) {
      // Find the master illness definition to get the category
      const targetDef = MASTER_ILLNESSES.find(mi => mi.parent_illness === match.matched_listed_illness);
      return {
        category: targetDef ? targetDef.category : "General",
        illness: match.matched_listed_illness || "Specific Illness"
      };
    }
    return null;
  };

  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [illnessSearchQuery, setIllnessSearchQuery] = useState<string>("");
  const [pedInput, setPedInput] = useState<string>("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(-1);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>(() => {
    // Categories that exist in TOP_PED_DICTIONARY purely so the deterministic
    // engine can special-case them (see engine.ts categoryKey handling for
    // "lifestyle" / "natural_life_stage") — they are habits or administrative
    // "no disease" entries, not PEDs, so they should never show up as
    // selectable suggestions even though they must stay in the dictionary
    // for classification to keep working.
    const NON_SUGGESTIBLE_CATEGORIES = new Set(["lifestyle", "natural_life_stage"]);

    // A handful of terms that are pure alternate spellings of one single
    // clinical word (not distinct colloquial phrasings worth keeping, unlike
    // e.g. "high bp" vs "hypertension" vs "hyperlipidimia" which are genuinely
    // different ways an advisor might search and stay in the list). Only the
    // single canonical spelling is kept in the dropdown; the dictionary
    // entries for the others are untouched so the engine still matches them
    // if an advisor types the variant spelling directly.
    const SUGGESTION_EXCLUSIONS = new Set([
      "gynaecomastia",
      "gynocomastia",
      "gyneacomastia",
    ]);

    const pedDictionarySuggestible = Object.entries(TOP_PED_DICTIONARY)
      .filter(([, category]) => !NON_SUGGESTIBLE_CATEGORIES.has(category))
      .map(([term]) => term);

    const combined = [
      ...SCRIPT_DICTIONARY,
      ...pedDictionarySuggestible,
      "dvt",
      "deep vein thrombosis",
      "pulmonary embolism",
      "thromboembolism",
      "gangrene",
      "essential tremor",
      "bell's palsy",
      "trigeminal neuralgia",
      "rheumatoid arthritis",
      "ankylosing spondylitis",
      "sarcoidosis",
      "carpal tunnel",
      "plantar fasciitis"
    ];

    // Case-insensitive de-dupe (first occurrence wins) — this is what
    // collapses things like "COPD" (scriptDictionary.ts) and "copd"
    // (TOP_PED_DICTIONARY) down to a single entry, before case-correction
    // below decides the final display form.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const raw of combined) {
      const item = raw.trim();
      if (!item) continue;
      const key = item.toLowerCase();
      if (seen.has(key) || SUGGESTION_EXCLUSIONS.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    // A handful of terms whose punctuation/format doesn't fit clean word-by-word
    // capitalization — corrected as exact overrides rather than parsed.
    const EXACT_OVERRIDES: Record<string, string> = {
      "covid.19": "COVID-19",
    };

    // Standard medical acronyms/abbreviations that should always render in
    // full capitals (or their conventional mixed case) no matter where they
    // fall in the term — this is what turns "pcod" / "cad" into "PCOD" / "CAD".
    const ACRONYM_MAP: Record<string, string> = {
      gdm: "GDM", pcl: "PCL", lscs: "LSCS", tkr: "TKR", thr: "THR", cmv: "CMV",
      mvp: "MVP", chf: "CHF", afib: "AFib", vt: "VT", vf: "VF", sss: "SSS",
      av: "AV", lbbb: "LBBB", rbbb: "RBBB", hcm: "HCM", mi: "MI", cad: "CAD",
      ihd: "IHD", cabg: "CABG", ptca: "PTCA", icd: "ICD", rhd: "RHD",
      copd: "COPD", ild: "ILD", osa: "OSA", cva: "CVA", tia: "TIA", ms: "MS",
      mnd: "MND", gbs: "GBS", gad: "GAD", ocd: "OCD", adhd: "ADHD",
      ptsd: "PTSD", ibs: "IBS", ibd: "IBD", gerd: "GERD", gord: "GORD",
      apd: "APD", ckd: "CKD", esrd: "ESRD", uti: "UTI", aki: "AKI",
      bph: "BPH", pcos: "PCOS", pcod: "PCOD", ivf: "IVF", ra: "RA",
      avn: "AVN", cah: "CAH", siadh: "SIADH", hcc: "HCC", rcc: "RCC",
      nsclc: "NSCLC", dcis: "DCIS", lcis: "LCIS", cml: "CML", cll: "CLL",
      aml: "AML", all: "ALL", nhl: "NHL", dns: "DNS", sob: "SOB",
      tsh: "TSH", hb: "Hb", gbm: "GBM", asd: "ASD", vsd: "VSD",
      g6pd: "G6PD", dka: "DKA", niddm: "NIDDM", iddm: "IDDM", igt: "IGT",
      ifg: "IFG", hba1c: "HbA1c", tmt: "TMT", pih: "PIH", dvt: "DVT",
      std: "STD", hpv: "HPV", hiv: "HIV", aids: "AIDS", mctd: "MCTD",
      sma: "SMA", "h.": "H.",
    };

    // Named ("eponymous") conditions — capitalized regardless of position in
    // the phrase, since these are proper nouns (e.g. "non hodgkin lymphoma").
    // Note: eponyms that are always the first word of their term (Parkinson's,
    // Alzheimer's, Cushing's, Raynaud, Marfan, etc.) don't need an entry here —
    // the sentence-case rule below already capitalizes the first word.
    const EPONYM_MAP: Record<string, string> = {
      hodgkin: "Hodgkin", barre: "Barre", marie: "Marie", tooth: "Tooth",
      danlos: "Danlos", willebrand: "Willebrand",
    };

    const toDisplayCase = (term: string): string => {
      const lowerWhole = term.toLowerCase();
      if (EXACT_OVERRIDES[lowerWhole]) return EXACT_OVERRIDES[lowerWhole];

      return term
        .split(" ")
        .map((word, idx) => {
          if (!word) return word;
          const lower = word.toLowerCase();
          const bare = lower.replace(/[^a-z0-9']/g, "");
          if (ACRONYM_MAP[lower]) return ACRONYM_MAP[lower];
          if (ACRONYM_MAP[bare]) return ACRONYM_MAP[bare];
          if (EPONYM_MAP[lower]) return EPONYM_MAP[lower];
          if (idx === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          return word.toLowerCase();
        })
        .join(" ");
    };

    // Final safety pass: case-correction can occasionally make two distinct
    // source strings converge on the same display text — de-dupe once more.
    const finalSeen = new Set<string>();
    const final: string[] = [];
    for (const item of deduped.map(toDisplayCase)) {
      const key = item.toLowerCase();
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      final.push(item);
    }
    return final.sort();
  });
  const [, setUserAdvisoryToggle] = useState<boolean | null>(null);
  const [, setAdvisoryHasBeenExpanded] = useState<boolean>(false);
  const [resultsFocusMode, setResultsFocusMode] = useState<boolean>(false);

  const [lookupPeds, setLookupPeds] = useState<string[]>([]);
  const [lookupResults, setLookupResults] = useState<Array<{
    ped: string;
    result: MatchOutput;
    source: string;
  }>>([]);
  const [isLookupLoading, setIsLookupLoading] = useState<boolean>(false);
  const isResultsActive = (resultsFocusMode && lookupResults.length > 0) || isLookupLoading;

  // Reported Mismatch Issues (Flagged Responses).
  //
  // NOTE (audit fix, see Production_Readiness_Audit.md Finding 3): this used
  // to be a hardcoded seed persisted to this browser's own localStorage —
  // so a flagged report only ever existed in the reporting advisor's own
  // browser, and an Developer's resolve/ignore/delete only ever updated their
  // own browser too. FlaggedResponsesPage now fetches GET /api/flagged-issues
  // (backed by the flagged_issues table) on mount, and every create (below)
  // /resolve/ignore/delete (FlaggedResponsesPage.tsx) round-trips through
  // the server.
  const [reportedIssues, setReportedIssues] = useState<ReportedIssue[]>([]);

  const [reportingItem, setReportingItem] = useState<{
    planName: string;
    pedInput: string;
    mappedQuestion: string;
    matchType: string;
    source: string;
    explanation: string;
  } | null>(null);

  const [reportingNotes, setReportingNotes] = useState<string>("");
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [reportingError, setReportingError] = useState<string | null>(null);
  const [reportedIssuesFilter, setReportedIssuesFilter] = useState<string>("All Open"); // All Open, Pending, Urgent, Resolved, Ignored, All
  const [ownerResolutionNotes, setOwnerResolutionNotes] = useState<Record<string, string>>({});
  
  // Custom non-blocking confirmation states to avoid iframe-blocked confirm Window dialogs
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);

  const pedInputRef = useRef<HTMLInputElement>(null);

  // (Persistence for `theme` is handled by the usePersistentState hook above;
  // the <html> "dark" class is kept in sync by the effect near isDark's
  // declaration, so this used to be a duplicate of both.)

  // `auditLogs` state below is no longer bulk-hydrated: AuditPage.tsx's User
  // Activity sub-tab and MyActivityPage.tsx now each self-fetch their own
  // server-side paginated/searched/filtered/sorted page of search_history
  // directly (GET /api/search-history?paginated=1&...), instead of reading
  // this array. `auditLogs`/`setAuditLogs` and `mapSearchHistoryRow` remain
  // only because `saveAuditLog` below still optimistically prepends the
  // just-recorded lookup to it — that local echo isn't read anywhere
  // anymore either, but is harmless to leave (bounded at 400 entries) and
  // touching `saveAuditLog`, called from the live match flow, is out of
  // scope for a pagination change.
  const mapSearchHistoryRow = (row: any): AuditLogEntry => ({
    timestamp: row.timestamp,
    userEmail: row.userEmail,
    planName: row.planName,
    pedInput: row.pedInput,
    matchedQuestion: row.matchedQuestion,
    matchType: row.matchType,
    source: row.source,
    explanation: row.explanation,
  });

  const saveAuditLog = (ped: string, plan: string, result: MatchOutput, source: string) => {
    // Fire-and-forget: this is telemetry, not something that should block
    // the advisor from seeing their match result if the write fails. The
    // local list is reconciled with the server's canonical row on success;
    // a failure is logged but otherwise silent to avoid interrupting the
    // lookup flow (the underlying match itself already succeeded).
    fetch("/api/search-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planName: plan,
        pedInput: ped,
        matchedQuestion: result.matched_question,
        matchType: result.match_type,
        source: source || "Deterministic Engine",
        explanation: result.explanation,
      }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setAuditLogs(prev => [mapSearchHistoryRow(body.entry), ...prev].slice(0, 400));
      })
      .catch((err) => {
        console.error("Failed to record search history entry on the server:", err);
      });
  };

  // Redirects to the real, server-side Google OAuth flow (src/server/auth/).
  // Domain restriction to @joinditto.in is enforced server-side on the
  // callback -- this client only kicks off the redirect.
  const handleGoogleSSO = () => {
    setLoginError(null);
    window.location.href = "/api/auth/google/login";
  };

  const handleProfileCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const nameClean = tempSsoName.trim();
    const tactClean = tempTactId.trim();

    if (!nameClean || !tactClean) {
      setLoginError("Full Name and TACT ID are mandatory fields to active your portal account.");
      return;
    }

    setLoginLoading(true);

    // Identity (email/name) is already server-verified via the real Google
    // session. POST /api/me/first-time-setup (server.ts) is what actually
    // provisions this person into the shared, server-side directory —
    // always at "General" tier; an Developer promotes people afterward via User
    // Management. (Audit fix, see Production_Readiness_Audit.md Finding 9:
    // this used to only ever write to the completing browser's own
    // localStorage, so the new user never appeared in the real directory
    // and had to "complete setup" again on every new device.)
    try {
      const res = await fetch("/api/me/first-time-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameClean, tactId: tactClean, tags: tempTags }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to complete setup (HTTP ${res.status}).`);
      }

      const newUserProfile: UserProfile = body.user;

      setUsersList(prev => {
        const filtered = prev.filter(u => u.email.toLowerCase() !== newUserProfile.email.toLowerCase());
        return [...filtered, newUserProfile];
      });

      const sessionUser: LoggedUser = {
        email: newUserProfile.email,
        name: newUserProfile.name,
        tactId: newUserProfile.tactId,
        tier: newUserProfile.tier
      };

      setCurrentUser(sessionUser);
      setShowIntro(true);
      setActiveTab("lookup");

      // Clear setup
      setIsFirstTimeSetup(false);
      setTempSsoEmail("");
      setTempSsoName("");
      setTempTactId("");
      setTempTags([]);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Failed to complete setup. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  // Save from the post-login Skill Domain prompt (SkillDomainPromptModal) —
  // self-service, PATCH /api/me/tags only ever touches the caller's own row.
  const handleSaveSkillDomain = async (tags: string[]) => {
    const res = await fetch("/api/me/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
    const saved: UserProfile = body.user;
    setUsersList(prev => prev.map(u => (u.email.toLowerCase() === saved.email.toLowerCase() ? saved : u)));
    setShowSkillDomainPrompt(false);
  };

  // Dismiss without saving — tags stay empty, so the prompt reappears next login.
  const handleSkipSkillDomain = () => {
    setShowSkillDomainPrompt(false);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setShowIntro(true);
    // Clear the real server session cookie too. Fire-and-forget: even if
    // this fails, the client-side state is already cleared.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  };

  // Daily 12 AM auto-logout — schedules a timeout to fire at the next midnight
  useEffect(() => {
    const scheduleNextMidnightReset = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const msUntilMidnight = midnight.getTime() - now.getTime();
      return setTimeout(() => {
        handleLogout();
        scheduleNextMidnightReset();
      }, msUntilMidnight);
    };
    const timerId = scheduleNextMidnightReset();
    return () => clearTimeout(timerId);
  }, []);

  // ==========================================
  // DECLARATION ASSISTANT: MULTI-PED EVALUATION
  // ==========================================
  const executeLookupAll = async (peds: string[], plan: string) => {
    if (peds.length === 0) {
      setLookupResults([]);
      return;
    }
    
    // Set loading
    setIsLookupLoading(true);
    const tempResults: Array<{ ped: string; result: MatchOutput; source: string }> = [];
    const config = planConfigs[plan];

    for (const ped of peds) {
      const trimmedPed = ped.trim();
      if (!trimmedPed) continue;

      // Deterministic classification locally
      const clientMatch = classifyDeterministic(trimmedPed, plan, config);
      if (clientMatch) {
        const sanitized = sanitizeOutput(clientMatch, trimmedPed, config);
        const guarded = applyPostGuards(sanitized, trimmedPed, plan, config);
        const finalRes = finalizeOutput(guarded, trimmedPed, config, config.questions);
        
        tempResults.push({
          ped: trimmedPed,
          result: finalRes,
          source: "Deterministic Underwriting Rule"
        });
        saveAuditLog(trimmedPed, plan, finalRes, "Deterministic Underwriting Rule");
      } else {
        // Fetch from API
        try {
          const response = await fetch("/api/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planName: plan, ped: trimmedPed })
          });
          const data = await response.json();
          tempResults.push({
            ped: trimmedPed,
            result: data,
            source: data.source || "Clinical Guidance System AI"
          });
          saveAuditLog(trimmedPed, plan, data, data.source || "Clinical Guidance System AI");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          const fallbackResult: MatchOutput = {
            ped_input: trimmedPed,
            match_type: "FALLBACK" as const,
            matched_question: config.anyOther,
            explanation: `Underwriting API offline. System safely routed entry as other conditions: ${message}`
          };
          tempResults.push({
            ped: trimmedPed,
            result: fallbackResult,
            source: "Disaster Recovery Local Rules"
          });
          saveAuditLog(trimmedPed, plan, fallbackResult, "Disaster Recovery Local Rules");
        }
      }
    }

    setLookupResults(tempResults);
    setIsLookupLoading(false);
    setResultsFocusMode(true);
  };

  const handleClearLookupFields = () => {
    setPedInput("");
    setLookupPeds([]);
    setLookupResults([]);
    setResultsFocusMode(false);
    setUserAdvisoryToggle(null);
    setAdvisoryHasBeenExpanded(false);
  };

  const handleMapAnotherPed = () => {
    setPedInput("");
    setResultsFocusMode(false);
    setTimeout(() => {
      const element = document.getElementById("ped-input");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setTimeout(() => {
        if (pedInputRef.current) {
          pedInputRef.current.focus();
        }
      }, 200);
    }, 100);
  };

  const handleAddLookupPed = (pedText: string) => {
    const trimmed = pedText.trim();
    if (!trimmed) return;
    if (!lookupPeds.includes(trimmed)) {
      setLookupPeds([...lookupPeds, trimmed]);
    }
    setPedInput("");
    
    // Auto refocus inside input field without exiting cursor
    setTimeout(() => {
      if (pedInputRef.current) {
        pedInputRef.current.focus();
      }
    }, 0);
  };

  // Clear lookup results if lookupPeds has no items left
  useEffect(() => {
    if (lookupPeds.length === 0) {
      setLookupResults([]);
    }
  }, [lookupPeds.length]);

  // Automatically scroll the first matched row into view when a match is found
  useEffect(() => {
    if (activeTab === "lookup" && lookupResults.length > 0 && !isLookupLoading) {
      setTimeout(() => {
        const firstMatchedRow = document.querySelector(".matched-question-row");
        if (firstMatchedRow) {
          firstMatchedRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 150);
    }
  }, [lookupResults, activeTab, isLookupLoading]);

  // CSV Export Utility — moved to utils/csvExport.ts so components can
  // import it directly; kept as a bound local name here since it's still
  // threaded down as a prop to a couple of pages (e.g. AuditPage).

  // Verifying the real Google session with the server — avoid flashing the
  // login screen (or the app) before we know the answer.
  if (authChecking) {
    return (
      <div className={`h-screen w-full flex items-center justify-center ${
        isDark ? "bg-[#001322] text-[#F5F7FA]" : "bg-[#F1F6FB] text-stone-900"
      }`}>
        <RefreshCw className={`w-6 h-6 animate-spin ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
      </div>
    );
  }

  // Render Login state if not authenticated
  if (!currentUser) {
    // Two-column layout: CSS Grid (not a fixed w-3/5 + flex-1 split) so both
    // columns scale proportionally with the viewport instead of freezing at
    // a fixed fraction. The hero column's share of the grid widens at
    // successive breakpoints (60/40 on laptops → ~62/38 at 2xl → ~67/33
    // past ~1800px) so large monitors get more hero real estate instead of
    // dumping the surplus into blank space — see the matching
    // clamp()-based inner max-widths below, which is what actually lets the
    // hero content use that extra column width rather than staying capped
    // at its old fixed-px size.
    return (
      <div className={`h-screen max-h-screen flex flex-col md:grid md:grid-cols-[3fr_2fr] 2xl:grid-cols-[8fr_5fr] min-[1800px]:grid-cols-[2fr_1fr] font-sans relative overflow-hidden w-full transition-all duration-500 ${
        isDark
          ? "bg-[#001322] text-[#F5F7FA]"
          : "bg-[#F1F6FB] text-stone-900"
      }`}>
        {/* Modern, Simple, and Futuristic Ambient Background */}
        <div
          className={`absolute inset-0 pointer-events-none z-0 select-none transition-all duration-500 ${
            isDark ? "opacity-55" : "opacity-[0.35]"
          }`}
          style={{
            backgroundImage: isDark
              ? `url("/assets/.aistudio/background-pattern-dark.svg")`
              : `url("/assets/.aistudio/background-pattern-light.svg")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Optimized grid / texture overlay based on theme to prevent moire and maintain premium feel */}
        <GridTexture theme={theme} />

        {/* LEFT SIDE: Neural Policy Network Graphic & Atmosphere — width now
            comes purely from the parent grid column (see grid-cols above),
            not a hardcoded w-3/5; padding uses a vw-scaled clamp() instead
            of a two-step p-8/lg:p-12 breakpoint jump. */}
        <div className="hidden md:flex relative overflow-hidden bg-transparent p-[clamp(24px,3vw,56px)] flex-col justify-between transition-colors duration-500">
          {/* Subtle animated mesh background */}
          <div className="absolute inset-0 z-0 pointer-events-none opacity-85 animate-fade-in">
            <div className={`absolute top-[10%] left-[10%] w-[350px] h-[350px] rounded-full blur-[120px] animate-pulse ${isDark ? "bg-blue-500/6" : "bg-blue-500/10"}`} style={{ animationDuration: "8s" }} />
            <div className={`absolute bottom-[20%] right-[10%] w-[400px] h-[400px] rounded-full blur-[140px] animate-pulse ${isDark ? "bg-blue-400/5" : "bg-blue-400/8"}`} style={{ animationDuration: "12s" }} />
          </div>

          {/* Logo & Brand Header */}
          <div className="z-10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center p-1.5 shadow-lg shadow-blue-500/15">
              <Sparkles className="w-5 h-5 text-white animate-spin" style={{ animationDuration: "15s" }} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <DittoWordmark className="text-lg" isWhite={isDark} />
              </div>
            </div>
          </div>

          {/* Core Info & Graphic Mesh — max-width and vertical rhythm are
              now clamp()-based (viewport-scaled) instead of a fixed
              max-w-[1000px]/space-y-8, so this block actually grows to use
              the wider hero column on large monitors instead of freezing at
              its old laptop-sized cap and leaving the rest of the column
              empty. */}
          <div className="z-10 my-auto max-w-[clamp(560px,52vw,1400px)] space-y-[clamp(20px,3vh,40px)] relative">
            <div className="space-y-[clamp(12px,1.8vh,24px)]">
              <div className="flex items-center gap-2 select-none">
                <div className="w-8 h-0.5" style={{ backgroundColor: "var(--accent)" }} />
                <span className="font-black uppercase tracking-widest" style={{ color: "var(--accent)", fontSize: "15px" }}>
                  AI-POWERED ADVISORY SUITE
                </span>
              </div>
              <h1
                className="font-black tracking-wider leading-[1.0] uppercase select-none font-sans flex flex-col gap-1 text-left"
              >
                <span
                  className="bg-clip-text text-transparent bg-gradient-to-r"
                  style={{
                    width: "clamp(480px, 46vw, 1200px)",
                    maxWidth: "100%",
                    fontSize: "76px",
                    display: "block",
                    backgroundImage: "var(--gradient-heading)"
                  }}
                >
                  DITTO ASSIST
                </span>
                <span
                  className="bg-clip-text text-transparent bg-gradient-to-r"
                  style={{
                    width: "clamp(480px, 46vw, 1200px)",
                    maxWidth: "100%",
                    fontSize: "38px",
                    display: "block",
                    backgroundImage: "var(--gradient-accent)"
                  }}
                >
                  THE INTELLIGENT ADVISOR HUB.
                </span>
              </h1>
              <p
                className={`text-sm font-medium leading-relaxed ${isDark ? "text-slate-300" : "text-stone-600"}`}
                style={{
                  width: "clamp(420px, 40vw, 900px)",
                  maxWidth: "100%"
                }}
              >
                An intelligent advisor hub that brings together AI assistance, operational tools, policy references, coverage projections, QA insights, announcements, and team resources—helping every advisor work faster and with greater confidence.
              </p>
            </div>

            {/* Platform stats — real figures (PED Repository: 1,153 PEDs
                synced, 6 plans). Health Plans / AI / Medical Conditions icons
                are the user-supplied glow-art PNGs, background-removed and
                recolored (assets/.aistudio/icon-*-clean.png — HSV
                saturation/value thresholding to isolate each icon's line art
                from its glow, flattened to a flat color, verified at the
                actual ~40px render size on both themes before wiring in).
                Medical Conditions specifically failed this test repeatedly
                while extracted as a hollow outline (spikes/dots or
                glow-blurred strokes collapsed into a blob at 40px) — the fix
                was extracting the germ's solid filled silhouette (body +
                spikes as one shape, not a line) with the glow discarded
                entirely; that reads clearly at true size. PED Lookups /
                Month is a composed lucide icon (Search + TrendingUp badge)
                — its source PNG had no recoverable line detail at all (a
                uniform soft gradient, no crisp edge anywhere). Value text is
                deliberately left uncolored (plain ink) per instruction —
                only the icon carries each stat's color. */}
            {/* gap/pt use clamp() so the metrics row breathes more on wide
                monitors instead of staying pinned to a fixed gap-8 cap. */}
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-[clamp(16px,2vw,32px)] pt-[clamp(12px,2vh,24px)] border-t ${isDark ? "border-slate-800" : "border-stone-300"}`}>
              {[
                {
                  icon: (
                    <span className="relative flex items-center justify-center w-full h-full">
                      <TrendingUp className="w-6 h-6 lg:w-7 lg:h-7" />
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border" style={{ backgroundColor: "#0EA5E9", borderColor: isDark ? "#001322" : "#F1F6FB" }}>
                        <Search className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </span>
                    </span>
                  ),
                  value: "2,800+",
                  label: "PED Lookups / Month",
                  hex: "#0EA5E9",
                },
                {
                  icon: <img src="/assets/.aistudio/icon-medical-clean.png" alt="" className="w-9 h-9 lg:w-10 lg:h-10 object-contain" />,
                  value: "1100+",
                  label: "Medical Conditions on Sync",
                  hex: "#DC2626",
                },
                {
                  icon: <img src="/assets/.aistudio/icon-health-plan-clean.png" alt="" className="w-9 h-9 lg:w-10 lg:h-10 object-contain" />,
                  value: "6",
                  label: "Active Health Plans",
                  hex: "#22C55E",
                },
                {
                  icon: <img src="/assets/.aistudio/icon-ai-clean.png" alt="" className="w-9 h-9 lg:w-10 lg:h-10 object-contain" />,
                  value: "AI Powered",
                  label: "Gemini Intelligence",
                  hex: "#22D3EE",
                },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-3.5">
                  <div
                    className="w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${stat.hex}1A`, borderColor: `${stat.hex}4D`, color: stat.hex }}
                  >
                    {stat.icon}
                  </div>
                  <div className="min-w-0">
                    {/* Primary value: darker slate (#1E293B) in light theme for
                        stronger contrast/hierarchy vs. the label below; dark
                        theme keeps a bright white since #1E293B would be
                        nearly invisible on the near-black card background. */}
                    <div
                      className="text-xl lg:text-2xl font-black font-mono leading-tight"
                      style={{ color: isDark ? "#F8FAFC" : "#1E293B" }}
                    >
                      {stat.value}
                    </div>
                    {/* Secondary label: muted slate (#64748B) at a lighter
                        weight than before so it recedes behind the value. */}
                    <div
                      className="text-[10px] font-semibold tracking-wide leading-tight"
                      style={{ color: "#64748B" }}
                    >
                      {stat.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer of left side */}
          <div className={`z-10 flex items-center justify-between font-bold font-mono uppercase tracking-wider ${isDark ? "text-slate-500" : "text-stone-550"}`} style={{ fontSize: "10px" }}>
            <span className="flex items-center gap-1.5">
              ADVISOR PRODUCTIVITY PLATFORM
              <ShieldCheck className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* RIGHT SIDE: Authentication Container (Glass Panel) — width comes
            from the parent grid column; padding is now a vw-scaled clamp()
            instead of a fixed p-6/md:p-8/lg:p-10 step. */}
        <div className="flex flex-col justify-between p-[clamp(24px,3vw,48px)] relative bg-transparent transition-colors duration-500 overflow-y-auto">
          {/* Subtle responsive background blobs for mobile */}
          <div className="md:hidden absolute inset-0 z-0 pointer-events-none opacity-25">
            <div className={`absolute top-1/4 left-1/4 w-80 h-80 rounded-full blur-[100px] ${isDark ? "bg-blue-500/5" : "bg-blue-500/10"}`} />
            <div className={`absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-[100px] ${isDark ? "bg-cyan-500/5" : "bg-sky-500/10"}`} />
          </div>

          {/* Core Navigation Top Bar */}
          <div className="flex items-center justify-end z-10 w-full mb-8">
            {/* Premium Theme Switch Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center shadow-sm select-none ${
                isDark 
                  ? "bg-[#03101a]/95 border-white/[0.08] text-slate-250 hover:text-white hover:border-blue-500/40 hover:bg-slate-900/50" 
                  : "bg-white border-stone-200 text-stone-705 hover:bg-stone-50 hover:text-stone-900"
              }`}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
            </button>
          </div>

          {/* max-width is now a clamp() instead of a flat max-w-md, so the
              card grows slightly on large/ultra-wide monitors (per the
              "slightly increase login card width on large screens"
              requirement) rather than staying pinned to its laptop size
              while empty space grows around it. */}
          <div className="my-auto w-full max-w-[clamp(28rem,34vw,38rem)] mx-auto z-10 py-[clamp(12px,2vh,24px)]">
            <AnimatePresence mode="wait">
              {isFirstTimeSetup ? (
                <motion.div
                  key="first-time-setup"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className={`rounded-3xl p-8 shadow-xl border flex flex-col gap-6 text-left transition-all duration-300 ${
                    isDark 
                      ? "bg-[#03101a]/95 border-white/[0.08] shadow-black/40 text-slate-100" 
                      : "bg-white border-stone-200 shadow-stone-200/50 text-stone-900"
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm ${
                        isDark ? "bg-slate-900 border-blue-900/50" : "bg-blue-50 border-blue-200"
                      }`}>
                        <User className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                      </div>
                      <h2 className={`text-sm font-black uppercase tracking-widest font-mono ${isDark ? "text-white" : "text-stone-900"}`}>
                        Create Workforce Profile
                      </h2>
                    </div>
                    <p className={`text-xs leading-relaxed font-semibold pt-1 ${isDark ? "text-slate-300" : "text-stone-600"}`}>
                      First-time workspace verification detected. Complete your profile credentials to construct your permanent security card.
                    </p>
                  </div>

                  <div className={`border rounded-2xl px-4 py-3.5 text-xs tracking-tight flex items-center justify-between font-bold font-mono ${
                    isDark 
                      ? "bg-blue-955/20 border-blue-900/40 text-blue-300" 
                      : "bg-blue-50/50 border-blue-100 text-blue-700"
                  }`}>
                    <span className="truncate">Email: {tempSsoEmail}</span>
                    <span className="text-[9px] bg-blue-900 text-white px-2 py-0.5 rounded-full border border-cyan-500 font-extrabold select-none">GSuite Verified</span>
                  </div>

                  {loginError && (
                    <div className={`border p-4 rounded-2xl text-xs leading-normal font-bold flex items-start gap-2.5 ${
                      isDark 
                        ? "bg-red-950/20 border-red-900/30 text-red-300" 
                        : "bg-red-50 border-red-200 text-red-600"
                    }`}>
                      <AlertTriangle className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
                      <span>{loginError}</span>
                    </div>
                  )}

                  <form onSubmit={handleProfileCompletion} className="space-y-5">
                    <div className="space-y-2">
                      <label className={`block text-[10px] font-black uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={tempSsoName}
                        onChange={(e) => {
                          setTempSsoName(e.target.value);
                          setLoginError(null);
                        }}
                        placeholder="e.g. Shashank J"
                        className={`w-full px-4 py-3 rounded-2xl border outline-none text-xs transition-all font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${
                          isDark 
                            ? "bg-[#102236] border-[#1e3e5c] text-white placeholder:text-slate-500" 
                            : "bg-stone-50 border-stone-200 text-stone-900 placeholder:text-stone-400 font-bold"
                        }`}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className={`block text-[10px] font-black uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        TACT ID (Workforce Registration)
                      </label>
                      <TactIdInput
                        theme={theme}
                        value={tempTactId}
                        onChange={(val) => {
                          setTempTactId(val);
                          setLoginError(null);
                        }}
                        placeholder="e.g. 128"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className={`block text-[10px] font-black uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        Skill Domain <span className="normal-case font-medium opacity-60">(optional)</span>
                      </label>
                      <p className={`text-[10.5px] leading-snug font-semibold ${isDark ? "text-slate-400" : "text-stone-500"}`}>
                        Which insurance line(s) do you handle? Select either, both, or leave blank — an Admin can set this for you later.
                      </p>
                      <AdvisorTagCheckboxes
                        theme={theme}
                        value={tempTags}
                        onChange={setTempTags}
                        size="md"
                      />
                    </div>

                    <PrimaryCtaButton
                      theme={theme}
                      type="submit"
                      disabled={loginLoading}
                      className="w-full !flex items-center justify-center gap-2 mt-3"
                    >
                      {loginLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-current" />
                      ) : (
                        <span>ACTIVATE PROFILE & LOG IN</span>
                      )}
                    </PrimaryCtaButton>
                  </form>

                  <button
                    type="button"
                    onClick={() => {
                      setIsFirstTimeSetup(false);
                      setTempSsoEmail("");
                      setTempSsoName("");
                      setTempTactId("");
                      setTempTags([]);
                      setLoginError(null);
                    }}
                    className={`w-full text-center text-[10px] font-black tracking-widest uppercase mt-1 cursor-pointer select-none ${
                      isDark ? "text-slate-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Cancel SSO
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="secure-login"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className={`rounded-3xl p-6 md:p-8 shadow-xl border flex flex-col items-start text-left gap-6 transition-all duration-300 w-full ${
                    isDark 
                      ? "bg-[#03101a]/95 border-white/[0.08] shadow-black/40 text-slate-100" 
                      : "bg-white border-stone-200 shadow-stone-200/50 text-stone-900"
                  }`}
                >
                  <div className="flex flex-col items-start text-left w-full">
                    <MascotWithFallback 
                      src="/assets/.aistudio/thumbs-up-mascot.png" 
                      alt="Thumbs up Mascot" 
                      className="w-16 h-16 object-contain mb-3 animate-fade-in"
                      type="doctor"
                    />
                    
                    <div className="flex items-center gap-2 mb-2 select-none">
                      <div className="w-6 h-0.5" style={{ backgroundColor: "var(--accent)" }} />
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--accent)" }}>
                        SECURE ACCESS
                      </span>
                    </div>

                    <h2 className={`text-2xl font-black uppercase tracking-wider ${isDark ? "text-white" : "text-stone-900"}`}>
                      Ready When You Are
                    </h2>
                    <p className={`text-xs leading-relaxed font-semibold mt-2 ${isDark ? "text-[#9CA3AF]" : "text-stone-650"}`}>
                      Sign in with your @joinditto.in account to access your advisor workspace, productivity tools, and operational resources.
                    </p>
                  </div>

                  {loginError && (
                    <div className={`border p-4 rounded-2xl text-xs leading-normal font-bold flex items-start gap-2.5 w-full text-left ${
                      isDark 
                        ? "bg-red-950/20 border-red-900/30 text-red-300" 
                        : "bg-red-50 border-red-200 text-red-600"
                    }`}>
                      <AlertTriangle className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${isDark ? "text-red-400" : "text-red-500"}`} />
                      <span>{loginError}</span>
                    </div>
                  )}

                  <button
                    onClick={handleGoogleSSO}
                    disabled={loginLoading}
                    className={`w-full py-4 text-xs font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm active:scale-98 select-none ${
                      isDark 
                        ? "bg-white text-stone-950 hover:bg-stone-150" 
                        : "bg-stone-900 text-white hover:bg-stone-800"
                    }`}
                  >
                    {loginLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    ) : (
                      <>
                        <svg className="w-4.5 h-4.5 animate-pulse" viewBox="0 0 24 24">
                          <path
                            fill="#ea4335"
                            d="M5.266 9.765A7.077 7.077 0 0112 4.909c1.69 0 3.218.6 4.418 1.582l3.51-3.51C17.642 1.09 14.974 0 12 0 7.354 0 3.307 2.67 1.242 6.551l4.024 3.214z"
                          />
                          <path
                            fill="#4285f4"
                            d="M23.49 12.273c0-.818-.073-1.609-.208-2.373H12v4.5h6.464a5.534 5.534 0 01-2.4 3.627l3.75 2.91c2.19-2.023 3.476-5 3.476-8.664z"
                          />
                          <path
                            fill="#fbbc05"
                            d="M5.266 14.235A7.086 7.086 0 014.909 12c0-.791.132-1.55.357-2.261L1.242 6.551A11.936 11.936 0 000 12c0 2.002.49 3.89 1.348 5.561l3.918-3.326z"
                          />
                          <path
                            fill="#34a853"
                            d="M12 24c3.24 0 5.958-1.077 7.942-2.923l-3.75-2.91c-1.037.695-2.368 1.109-4.192 1.109-3.224 0-5.951-2.173-6.924-5.1l-4.024 3.214C3.307 21.33 7.354 24 12 24z"
                          />
                        </svg>
                        <span>SIGN IN WITH GOOGLE</span>
                      </>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer of right side */}
          <div className={`z-10 flex justify-end text-[11px] font-bold font-mono uppercase tracking-wider ${isDark ? "text-slate-500" : "text-stone-550"} mt-4 md:mt-0`}>
            <span>©BLISS GUIDES . DITTO</span>
          </div>
        </div>

      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Shared sidebar navigation model — Zone -> Functional Group -> Page.
  // This is the single source of truth both the expanded sidebar (full
  // hierarchy, below) and the collapsed rail (group icons + flyout child
  // access, further down) render from, so the two states can never drift
  // into separate/inconsistent navigation systems — only the presentation
  // differs between the two render paths. My Activity is deliberately NOT
  // part of this model (see its own ungrouped rendering below); Home isn't
  // either (it's reached via the branding block / header wordmark).
  interface NavPage {
    tab: typeof activeTab;
    label: string;
    Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    visible: boolean;
    /** Extra inline style merged onto the icon — currently only Declaration
     * Map's faux-bold drop-shadow (its thin route-line SVG reads lighter
     * than the stroke-based icons at this size). */
    iconStyle?: React.CSSProperties;
    /** Tailwind color class for the icon given whether this page is active.
     * Every page is the same blue except Smoke Test, which turns orange
     * when active (its sandbox/danger cue). */
    iconColorClass: (isActive: boolean) => string;
    isActive: boolean;
    onSelect: () => void;
    /** Small badge rendered next to the label (expanded list only) — e.g.
     * Developer Controls' hidden-pages count. */
    badge?: React.ReactNode;
    /** Small pinging dot on the icon itself — currently just Flagged
     * Responses' pending-issue indicator. */
    hasAlertDot?: boolean;
  }
  interface NavGroup {
    key: SidebarSectionKey;
    label: string;
    GroupIcon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    pages: NavPage[];
  }
  interface NavZone {
    key: "advisor" | "admin" | "developer";
    label: string;
    groups: NavGroup[];
  }

  const navPage = (
    tab: typeof activeTab,
    label: string,
    Icon: NavPage["Icon"],
    tier: "Viewer" | "Editor",
    extra: {
      iconStyle?: React.CSSProperties;
      iconColorClass?: NavPage["iconColorClass"];
      isActive?: boolean;
      onSelect?: () => void;
      badge?: React.ReactNode;
      hasAlertDot?: boolean;
    } = {}
  ): NavPage => ({
    tab,
    label,
    Icon,
    visible: hasAccess(tab, tier),
    iconStyle: extra.iconStyle,
    iconColorClass: extra.iconColorClass ?? (() => "text-blue-300"),
    isActive: extra.isActive ?? activeTab === tab,
    onSelect: extra.onSelect ?? (() => setActiveTab(tab)),
    badge: extra.badge,
    hasAlertDot: extra.hasAlertDot,
  });

  const navZonesRaw: NavZone[] = [
    {
      key: "advisor",
      label: "Advisor Zone",
      groups: [
        {
          key: "advisorWorkspace",
          label: "Advisor Workspace",
          GroupIcon: ToolCase,
          pages: [
            navPage("lookup", "Declaration Assistant", Sparkles, "Viewer", {
              isActive: activeTab === "lookup" && !showIntro,
              onSelect: () => { setActiveTab("lookup"); setShowIntro(false); },
            }),
            navPage("coverage_projection", "Cover projection", FileSpreadsheet, "Viewer"),
            navPage("specific_illness_check", "Specific Illness Check", ClipboardCheck, "Viewer"),
            navPage("query_assist", "Product Assist", ProductAssistIcon, "Editor"),
          ],
        },
        {
          key: "quality",
          label: "Quality",
          GroupIcon: Award,
          pages: [navPage("qa_dashboard", "QA Dashboard", QaDashboardIcon, "Viewer")],
        },
        {
          key: "reference",
          label: "Reference",
          GroupIcon: Library,
          pages: [
            navPage("advisory_zone", "Plan Reference", BookOpen, "Viewer"),
            navPage("announcement_archive", "Announcements", Newspaper, "Viewer"),
            navPage("resources", "Declaration Map", DeclarationMapIcon, "Viewer", {
              iconStyle: { filter: "drop-shadow(0 0 0.4px currentColor)" },
            }),
          ],
        },
      ],
    },
    {
      key: "admin",
      label: "Admin Zone",
      groups: [
        {
          key: "appOpsControls",
          label: "App Ops Controls",
          GroupIcon: Settings,
          pages: [
            navPage("qa_announcement_log", "Announcement Manager", Megaphone, "Viewer"),
            navPage("ped_suggestions", "PED Repository", Stethoscope, "Viewer"),
            navPage("knowledge_base", "Knowledge Base", Database, "Viewer"),
            navPage("plan_scope", "Plan Management", FileText, "Viewer"),
          ],
        },
        {
          key: "administration",
          label: "Administration",
          GroupIcon: ShieldUser,
          pages: [
            navPage("profile_access", "User Management", User, "Viewer"),
            navPage("audit", "Activity Log", Clock, "Viewer"),
            navPage("flagged_responses", "Flagged Responses", Flag, "Viewer", {
              hasAlertDot: reportedIssues.filter(issue => issue.status === "Pending" || issue.status === "Urgent").length > 0,
            }),
            navPage("smoke_test", "Smoke Test", Flame, "Viewer", {
              iconColorClass: isActive => (isActive ? "text-[#E08D4B]" : "text-blue-300"),
            }),
          ],
        },
      ],
    },
    {
      key: "developer",
      label: "Developer Zone",
      groups: [
        {
          key: "developer",
          label: "Developer",
          GroupIcon: Terminal,
          pages: [
            navPage("owner_controls", "Developer Controls", ShieldAlert, "Viewer", {
              badge:
                hiddenPages.length > 0 ? (
                  <span className="ml-auto text-[9px] font-black px-1.5 py-[1px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {hiddenPages.length}
                  </span>
                ) : undefined,
            }),
          ],
        },
      ],
    },
  ];
  // Drop pages the current user can't see, then drop groups/zones left with
  // nothing in them — the same visibility guards the old flat per-item
  // `hasAccess(...) && (...)` checks used to apply, just computed once here
  // instead of re-checked at every render site.
  const navZones: NavZone[] = navZonesRaw
    .map(zone => ({ ...zone, groups: zone.groups.map(g => ({ ...g, pages: g.pages.filter(p => p.visible) })).filter(g => g.pages.length > 0) }))
    .filter(zone => zone.groups.length > 0);

  /** Renders one clickable page row — shared verbatim between the expanded
   * sidebar's group content and the collapsed rail's group flyout, so the
   * two are guaranteed to expose exactly the same pages with exactly the
   * same active/badge/alert treatment. */
  const renderNavPageRow = (page: NavPage, afterSelect: () => void) => (
    <button
      key={page.tab}
      onClick={() => { page.onSelect(); afterSelect(); }}
      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
        page.isActive
          ? page.tab === "smoke_test"
            ? "border-l-[#E08D4B] bg-[rgba(224,141,75,0.10)] text-white font-bold"
            : "border-l-blue-600 bg-white/[0.06] text-white font-bold"
          : "border-l-transparent text-[#C4CDD8] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
      } rounded-r-lg border-y-transparent border-r-transparent`}
    >
      <span className="relative shrink-0 flex items-center justify-center">
        <page.Icon className={`w-4 h-4 shrink-0 ${page.iconColorClass(page.isActive)}`} style={page.iconStyle} />
        {page.hasAlertDot && (
          <span className="absolute -top-1 -right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
          </span>
        )}
      </span>
      <span>{page.label}</span>
      {page.badge}
    </button>
  );

  const renderSidebarContent = (isMobile: boolean = false) => {
    return (
      <div className={`h-full flex flex-col text-[#F5F7FA] ${
        theme === "dark" ? "bg-[#03101a]" : "bg-[var(--sidebar-bg)]"
      }`}>
        {/* Header */}
        <div
          className={`p-5 border-b border-white/[0.08] flex items-center justify-between ${
            theme === "dark" ? "bg-[#03101a]" : "bg-[var(--sidebar-bg)]"
          }`}
        >
          {/* Branding block doubles as the Home entry point — clicking the
              logo/name/tagline navigates Home, same action as the header
              wordmark. min-w-0 lets the text column shrink instead of
              overflowing; the tagline no longer truncates (see below), so
              it wraps onto a second line instead of being clipped. */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("lookup");
              setShowIntro(true);
              if (isMobile) setIsMenuOpen(false);
            }}
            className="flex items-center gap-2.5 min-w-0 text-left bg-transparent border-0 p-0 m-0 cursor-pointer hover:opacity-85 transition-opacity focus:outline-none select-none"
            title="Home (Go to Compliance & Policy Mapping Engine)"
            aria-label="Go to home — Ditto Assist"
          >
            {/* .png, not favicon.svg — the SVG just wraps one giant embedded
                base64 PNG, which some browsers fail to rasterize inside an
                <img> (shows the broken-image icon) even though the file
                itself decodes to a perfectly valid image. The plain PNG
                sidesteps that entirely. */}
            <img
              src="/assets/favicon-180.png"
              alt=""
              className="w-8 h-8 rounded-md shrink-0 object-contain"
            />
            <div className="flex flex-col min-w-0">
              {/* Explicit "text-white" (not the var(--sidebar-bg)-adjacent hex
                  this used to carry) so the title stays fully opaque white
                  against the sidebar's locked dark-navy chrome in BOTH themes
                  — it was reading as a barely-visible gray smudge in Light
                  theme. Sidebar bg is intentionally dark-navy in both themes
                  (see index.css's --sidebar-bg "LOCKED VALUE" note). */}
              <span className="text-xs font-bold uppercase tracking-wider text-white truncate">Ditto Assist</span>
              {/* No "truncate" here (was clipping mid-word) — the tagline is
                  short enough to wrap onto two lines at this column width
                  without needing a wider branding block. */}
              <span className="text-[10px] font-medium text-[#C4CDD8] leading-snug whitespace-normal break-words">A Powerful Suite of Advisory Tools</span>
            </div>
          </button>
          <button
            onClick={() => setIsMenuOpen(false)}
            className="p-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/5 text-[#C4CDD8] hover:text-[#F5F7FA]"
            title="Collapse Menu"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* Categories / Navigation items */}
        <div role="navigation" aria-label="Workspace navigation" className="flex-grow p-4 space-y-1.5 overflow-y-auto">
          {/* Zone -> Functional Group -> Page, driven entirely by the
              shared navZones model above (see its comment) — the collapsed
              rail's group-icon + flyout rendering further down reads from
              the exact same model, so the two states can't drift apart.
              Each zone is a static (non-collapsible) label; each group
              inside it is its own collapse/expand toggle that auto-opens
              the moment the advisor is on one of its pages. Home isn't
              here — it's reached via the branding block above and the
              header wordmark. */}
          {navZones.map((zone, zoneIdx) => (
            <React.Fragment key={zone.key}>
              {zoneIdx > 0 && (
                <div style={{ borderColor: "rgba(255,255,255,0.12)" }} className="border-t-2 my-4 opacity-70" />
              )}
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest px-2 mb-2 text-white/80">
                  {zone.label}
                </span>
                <div className="space-y-4">
                  {zone.groups.map(group => (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => toggleSidebarSection(group.key)}
                        className="w-full flex items-center justify-between px-3 mb-2 text-[10px] font-bold tracking-wider text-[#C4CDD8] hover:text-[#F5F7FA] transition-colors cursor-pointer"
                        aria-expanded={openSections[group.key]}
                      >
                        <span>{group.label}</span>
                        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${openSections[group.key] ? "" : "-rotate-90"}`} />
                      </button>
                      {openSections[group.key] && (
                        <div className="space-y-1.5 mb-1 pl-2">
                          {group.pages.map(page => renderNavPageRow(page, () => { if (isMobile) setIsMenuOpen(false); }))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* My Activity — deliberately left ungrouped (no section of
                  its own) per standing instruction: it's being redesigned
                  separately as part of Declaration Assistant search
                  history, so it isn't assigned to any functional group
                  here. Kept in its original relative position (end of the
                  Advisor Zone block) purely so existing bookmarks/links to
                  it keep working. */}
              {zone.key === "advisor" && hasAccess("my_activity", "Viewer") && (
                <div className="mt-4">
                  <button
                    onClick={() => {
                      setActiveTab("my_activity");
                      if (isMobile) setIsMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 ${
                      activeTab === "my_activity"
                        ? "border-l-blue-600 bg-white/[0.06] text-white font-bold"
                        : "border-l-transparent text-[#C4CDD8] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium"
                    } rounded-r-lg border-y-transparent border-r-transparent`}
                  >
                    <History className="w-4 h-4 shrink-0 text-blue-300" />
                    <span>My Activity</span>
                  </button>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Bottom Profile Tab — DP picture + name, tab-styled to match the
            nav buttons above it. Previously this whole footer only existed
            in the collapsed rail (icon-only) state, so the profile
            avatar/credentials trigger disappeared the moment the sidebar
            was expanded. Shares profileButtonRef/profileOpen/
            profileMenuPos with the collapsed rail's own avatar button
            (see the collapsed branch below) — safe because the two are
            never mounted at the same time. */}
        <div className="mt-auto p-3 border-t border-white/[0.08] shrink-0">
          <button
            ref={profileButtonRef}
            onClick={() => {
              if (!profileOpen && profileButtonRef.current) {
                const rect = profileButtonRef.current.getBoundingClientRect();
                const bottom = Math.max(12, window.innerHeight - rect.bottom);
                setProfileMenuPos({ bottom, left: rect.right + 8 });
              }
              setProfileOpen(!profileOpen);
              if (isMobile) setIsMenuOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-3 transition-all cursor-pointer border-l-2 border-l-transparent text-[#C4CDD8] hover:bg-stone-800/15 hover:text-[#F5F7FA] font-medium rounded-r-lg border-y-transparent border-r-transparent"
            title="View user credentials & active profile details"
          >
            <span
              className="w-4 h-4 shrink-0 rounded-full overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: "#206147", borderColor: "#b9b97a", borderStyle: "solid", borderWidth: "1px" }}
            >
              {currentUser?.avatarUrl || currentUser?.photoUrl ? (
                <img
                  src={currentUser.avatarUrl || currentUser.photoUrl}
                  alt={currentUser.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-[8px] font-bold uppercase text-white">
                  {currentUser?.name?.charAt(0) || "M"}
                </span>
              )}
            </span>
            <span className="truncate">{currentUser?.name || "Advisor"}</span>
          </button>
        </div>
      </div>
    );
  };

  // Active Main UI App
  return (
    <div className={`h-screen font-sans flex flex-row antialiased relative ${
      isDark 
        ? "bg-[#001322] text-slate-100" 
        : "bg-[#F1F6FB] text-stone-900"
    } w-full overflow-hidden`}>

      {/* EXPANDABLE LEFT SIDEBAR WITH MOTION WIDTH ANIMATION */}
      <motion.aside 
        animate={{ width: isMenuOpen ? 260 : (isMobileWindow ? 0 : 60) }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`${isMobileWindow ? "absolute left-0 top-0 h-full shadow-2xl" : "relative h-full"} flex flex-col shrink-0 z-50 overflow-hidden ${
          activeTab === "smoke_test"
            ? "bg-[#060606] border-r border-[rgba(224,141,75,0.12)]"
            : isDark ? "bg-[#03101a] border-r border-white/[0.08]" : "bg-[var(--sidebar-bg)] border-r border-white/[0.08]"
        }`}
      >
        {isMenuOpen ? (
          <div className="w-full h-full flex flex-col overflow-hidden">
            {renderSidebarContent(false)}
          </div>
        ) : (
          <div
            style={{
              borderRadius: "0px",
              backgroundColor: activeTab === "smoke_test" ? "#060606" : !isDark ? "var(--sidebar-bg)" : undefined,
            }}
            className="w-full h-full flex flex-col items-center py-6 gap-3 overflow-hidden"
          >
            {/* Click to expand button */}
            <button 
              onClick={() => setIsMenuOpen(true)}
              className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center cursor-pointer transition-all ${
                "hover:bg-white/5"
              }`}
              title="Expand Navigation Menu"
            >
              <PanelLeftOpen className="w-5 h-5" style={{ color: "#9a9c9e" }} />
            </button>

            <div className="w-10 border-b border-white/[0.08] my-1 shrink-0" />

            {/* Collapsed Menu Items of Active Tools */}
            <div
              style={{
                paddingLeft: "5px",
                paddingRight: "5px",
                borderRadius: "0px",
                backgroundColor: activeTab === "smoke_test" ? "#060606" : !isDark ? "var(--sidebar-bg)" : undefined,
              }}
              className="flex flex-col gap-2.5 w-full flex-grow min-h-0 overflow-y-auto py-2 items-center no-scrollbar"
            >
              {/* Collapsed rail shows one icon per functional GROUP (not
                  per page) — driven by the same navZones model the
                  expanded sidebar uses, so the two can't drift apart. A
                  thin rule still separates groups within a zone; a thick
                  rule still marks each zone boundary, same divider
                  language the rail already used. Clicking a group icon
                  opens a floating flyout (portal, below) listing that
                  group's pages — it never auto-navigates to one child. No
                  standalone Home icon — Home is reached via the branding
                  block / header wordmark, same as the expanded sidebar. */}
              {navZones.map((zone, zoneIdx) => (
                <React.Fragment key={zone.key}>
                  {zoneIdx > 0 && (
                    <div className="w-10 border-t-2 border-white/[0.12] my-1 opacity-70 shrink-0" />
                  )}
                  {zone.groups.map((group, groupIdx) => {
                    const isGroupActive = group.pages.some(page => page.isActive);
                    const hasAlert = group.pages.some(page => page.hasAlertDot) || (group.key === "developer" && hiddenPages.length > 0);
                    return (
                      <React.Fragment key={group.key}>
                        {groupIdx > 0 && (
                          <div className="w-6 border-t border-white/[0.08] my-1 opacity-50 shrink-0" />
                        )}
                        <button
                          onClick={e => {
                            if (openGroupFlyout === group.key) {
                              setOpenGroupFlyout(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            setGroupFlyoutPos({ top: rect.top, left: rect.right + 8 });
                            setOpenGroupFlyout(group.key);
                          }}
                          className={`relative w-10 h-10 rounded-xl shrink-0 flex items-center justify-center cursor-pointer transition-all ${
                            isGroupActive || openGroupFlyout === group.key
                              ? "bg-white/[0.08] border border-white/[0.14]"
                              : "hover:bg-white/5"
                          }`}
                          style={{ color: isGroupActive ? (theme === "dark" ? "var(--accent)" : "#00D3F3") : (theme === "dark" ? "var(--text-muted)" : "#90A6C4") }}
                          title={group.label}
                          aria-haspopup="true"
                          aria-expanded={openGroupFlyout === group.key}
                        >
                          <group.GroupIcon style={{ width: "18px", height: "18px" }} />
                          {hasAlert && (
                            <span className="absolute top-1 right-1 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                            </span>
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}

              {/* My Activity — ungrouped (see the expanded sidebar's note on
                  why this has no section of its own); its own thin divider
                  just sets it apart as a standalone icon rather than
                  implying membership in the Reference group above it. */}
              {hasAccess("my_activity", "Viewer") && (
                <div className="w-6 border-t border-white/[0.08] my-1 opacity-50 shrink-0" />
              )}

              {hasAccess("my_activity", "Viewer") && (
                <button
                  onClick={() => setActiveTab("my_activity")}
                  className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center cursor-pointer transition-all ${
                    activeTab === "my_activity"
                      ? "bg-white/[0.08] border border-white/[0.14]"
                      : "hover:bg-white/5"
                  }`}
                  style={{ color: activeTab === "my_activity" ? (theme === "dark" ? "var(--accent)" : "#00D3F3") : (theme === "dark" ? "var(--text-muted)" : "#90A6C4") }}
                  title="My Activity"
                >
                  <History style={{ width: "18px", height: "18px" }} />
                </button>
              )}
            </div>

            {/* Bottom Profile Action */}
            <div 
              style={{ borderWidth: "0px", paddingTop: "0px" }}
              className="relative mt-auto pt-4 border-t border-white/[0.05] w-full flex justify-center shrink-0"
            >
              <button
                ref={profileButtonRef}
                onClick={() => {
                  if (!profileOpen && profileButtonRef.current) {
                    const rect = profileButtonRef.current.getBoundingClientRect();
                    // Anchor the card's bottom edge to the button's bottom edge so it
                    // grows upward — the button sits at the very bottom of the sidebar,
                    // so growing downward (from rect.top) pushed the card off-screen.
                    const bottom = Math.max(12, window.innerHeight - rect.bottom);
                    setProfileMenuPos({ bottom, left: rect.right + 8 });
                  }
                  setProfileOpen(!profileOpen);
                }}
                className="rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 overflow-hidden bg-[#20C4C7]"
                style={{ width: "28px", height: "28px", backgroundColor: "#206147", borderColor: "#b9b97a", borderStyle: "solid", borderWidth: "1px" }}
                title="View user credentials & active profile details"
              >
                {currentUser?.avatarUrl || currentUser?.photoUrl ? (
                  <img
                    src={currentUser.avatarUrl || currentUser.photoUrl}
                    alt={currentUser.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="font-bold text-xs uppercase text-white">
                    {currentUser?.name?.charAt(0) || "M"}
                  </div>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.aside>

      {/* Shared user-credentials dropdown card — a portal, so it renders
          regardless of which sidebar state (expanded/collapsed) is
          currently mounted. Both the collapsed rail's avatar circle and the
          expanded sidebar's "profile tab" (see renderSidebarContent) share
          the same profileButtonRef/profileOpen/profileMenuPos state to
          trigger this; they're never mounted at the same time (one lives in
          the isMenuOpen branch, the other in the collapsed branch), so
          sharing the ref is safe. */}
      {createPortal(
        <AnimatePresence>
          {profileOpen && profileMenuPos && (
            <>
              <div
                className="fixed inset-0 z-[9998] cursor-default"
                onClick={() => setProfileOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, x: 10, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                style={{
                  bottom: profileMenuPos.bottom,
                  left: profileMenuPos.left,
                  maxHeight: "calc(100vh - 24px)",
                  overflowY: "auto",
                }}
                className={`fixed w-64 rounded-lg border shadow-xl z-[9999] p-4 font-sans text-left ${
                  theme === "dark"
                    ? "bg-[#12151A] border-[#252A34] text-white shadow-black/80"
                    : "bg-white border-stone-200 text-stone-900 shadow-stone-300"
                }`}
              >
              <div className="space-y-3">
                <div className="border-b pb-2 border-dashed border-stone-700/50 dark:border-stone-200/50">
                  <p className="text-xs font-bold leading-tight">
                    {currentUser?.name}
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className={`flex flex-col p-1.5 rounded ${theme === "dark" ? "bg-stone-900/60" : "bg-stone-50"}`}>
                    <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Email ID:</span>
                    <span className="font-mono text-[10.5px] truncate mt-0.5">{currentUser?.email || "advisor@joinditto.in"}</span>
                  </div>

                  <div className={`flex flex-col p-1.5 rounded ${theme === "dark" ? "bg-stone-900/60" : "bg-stone-50"}`}>
                    <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">TACT ID:</span>
                    <span className="font-mono text-[10.5px] truncate mt-0.5">{currentUser?.tactId || "—"}</span>
                  </div>

                  <div className={`flex justify-between items-center p-1.5 rounded ${theme === "dark" ? "bg-stone-900/60" : "bg-stone-50"}`}>
                    <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Access Level:</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider ${
                      currentUser?.tier === "Developer"
                        ? "bg-red-500/10 text-red-500"
                        : currentUser?.tier === "Admin"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-blue-500/10 text-blue-600 dark:text-sky-400"
                    }`}>
                      {currentUser?.tier || "General"}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-stone-700/50 dark:border-stone-250">
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      handleLogout();
                    }}
                    className="w-full py-2 px-3 border border-red-500/20 hover:border-red-500 bg-red-500/5 hover:bg-red-500/10 text-xs font-bold text-red-500 rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Collapsed-rail group flyout — a portal, so it floats above
          everything regardless of the sidebar's scroll position. Lists the
          clicked group's child pages via the same renderNavPageRow used by
          the expanded sidebar, so a group icon never auto-navigates to one
          arbitrary child — the advisor always picks from the full list.
          Positioned off the clicked button's own rect (see the collapsed
          rail's onClick above), same anchoring approach as the profile
          card portal above. */}
      {createPortal(
        <AnimatePresence>
          {openGroupFlyout && groupFlyoutPos && (() => {
            const activeGroup = navZones.flatMap(z => z.groups).find(g => g.key === openGroupFlyout);
            if (!activeGroup) return null;
            return (
              <>
                <div
                  className="fixed inset-0 z-[9998] cursor-default"
                  onClick={() => setOpenGroupFlyout(null)}
                />
                <motion.div
                  initial={{ opacity: 0, x: 10, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    top: groupFlyoutPos.top,
                    left: groupFlyoutPos.left,
                    maxHeight: "calc(100vh - 24px)",
                    overflowY: "auto",
                  }}
                  className={`fixed w-56 rounded-lg border shadow-xl z-[9999] p-2 font-sans text-left ${
                    theme === "dark"
                      ? "bg-[#12151A] border-[#252A34] text-white shadow-black/80"
                      : "bg-white border-stone-200 text-stone-900 shadow-stone-300"
                  }`}
                >
                  <div className={`px-2 pt-1 pb-2 mb-1 border-b border-dashed ${theme === "dark" ? "border-white/10" : "border-stone-200"}`}>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${theme === "dark" ? "text-white/50" : "text-stone-400"}`}>
                      {activeGroup.label}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {activeGroup.pages.map(page => renderNavPageRow(page, () => setOpenGroupFlyout(null)))}
                  </div>
                </motion.div>
              </>
            );
          })()}
        </AnimatePresence>,
        document.body
      )}

      {/* MAIN APPLICATION CONTENT AREA */}
      <div className="flex-grow flex flex-col min-w-0 h-full overflow-hidden relative">
      {/* Modern, Simple, and Futuristic Ambient Background (Combining premium organic digital waves and soft light/dark glow) */}
      {/*
        SMOKE TEST EXCEPTION — this tab is intentionally off-theme (ember on
        black, not the app's navy). Previously SmokeTestPage.tsx tried to
        cover this up from the inside with its own full-bleed background,
        but that div only fills <main>'s padded, width-constrained,
        content-hugging box — it can't reach the space beyond the content's
        own height, or the app's shared blue glow blobs below, which live
        here at the shell level. Wherever the page content is shorter than
        the viewport, or narrower than this shell, the app's navy pattern
        showed through underneath. Swapping the SOURCE of this shell-level
        layer for the smoke-test tab (rather than trying to paper over it
        from inside the page) means there is no navy left anywhere behind
        the page, at any viewport size or content height. */}
      {activeTab === "smoke_test" ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none z-0 select-none"
          style={{
            backgroundColor: "#070707",
            // Artwork dimmed ~35-40% below its own dark overlay so the
            // matte-black surfaces read as dominant and the flame/smoke/gear
            // art is atmosphere, not foreground.
            backgroundImage:
              `linear-gradient(rgba(7,7,7,0.73), rgba(7,7,7,0.88)), url("/assets/smoketest_page.png")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : (
        <>
      <div
        className={`absolute inset-0 pointer-events-none z-0 select-none transition-all duration-500 ${
          isDark ? "opacity-55" : "opacity-[0.50]"
        }`}
        style={{
          backgroundImage: isDark
            ? `url("/assets/.aistudio/background-pattern-dark.svg")`
            : `url("/assets/.aistudio/background-pattern-light.svg")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Dynamic Animated Mesh System (Background Atmosphere for BOTH dark and light modes, preserving original branding) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none">
        {/* Top-left glow */}
        <div className={`absolute top-[-15%] left-[-15%] w-[60%] h-[60%] rounded-full blur-[100px] sm:blur-[120px] md:blur-[150px] animate-pulse ${
          isDark ? "bg-blue-600/12 opacity-[0.35]" : "bg-blue-400/18 opacity-[0.22]"
        }`} style={{ animationDuration: "14s" }} />
        {/* Bottom-right glow */}
        <div className={`absolute bottom-[-15%] right-[-15%] w-[70%] h-[70%] rounded-full blur-[110px] sm:blur-[130px] md:blur-[180px] animate-pulse ${
          isDark ? "bg-[#3B82F6]/10 opacity-[0.35]" : "bg-[#2563EB]/14 opacity-[0.20]"
        }`} style={{ animationDuration: "20s" }} />
      </div>
        </>
      )}

      {/* Sitewide grid/scanline texture — sits behind ALL tab content (z-0),
          edge-to-edge with the app shell, so every page reads consistently
          with the Login/Home grid identity without needing a separate boxed
          instance per section (a bounded overlay reads as a "card" the moment
          it's clipped). Opaque cards (Announcement, Mapping Results, etc.)
          naturally occlude it since they paint on top; transparent areas
          (like the Mapping Engine's input section) show it as their backdrop. */}
      {/* SMOKE TEST EXCEPTION (same reasoning as the background block above):
          this shell-level texture ran on the live app theme unconditionally,
          so switching to light theme while on the Smoke Test tab swapped in
          the light variant's blue-tinted scanlines behind the page's
          intentionally-always-dark ember surface — forcing "dark" here
          keeps it identical to how it renders in dark theme. */}
      <GridTexture theme={activeTab === "smoke_test" ? "dark" : theme} zIndexClassName="z-0" />

      <a href="#main-content" className="skip-to-content">Skip to main content</a> {/* HEADER BAR: Frosted floating glass compliance console bar */}
      <div className="p-4 pb-0 shrink-0 select-none relative z-40 w-full lg:w-[99%] xl:w-[98%] max-w-[var(--container-shell)] mx-auto">
        <header className={`rounded-2xl border transition-all duration-300 ${
          activeTab === "smoke_test"
            ? "border-[rgba(224,141,75,0.12)] bg-[rgba(8,8,8,0.90)] backdrop-blur-md text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:border-[rgba(224,141,75,0.40)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
            : theme === "dark"
            ? "border-white/[0.08] bg-[#03101a] text-white shadow-[0_8px_32px_rgba(0,0,0,0.55)] hover:border-white/[0.12]"
            : "border-white/[0.08] bg-[var(--header-bg)] text-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-white/[0.12]"
        }`}>
          <div className="w-full flex items-center justify-between relative gap-4" style={{ backgroundColor: activeTab === "smoke_test" ? "transparent" : "var(--header-bg)", height: "54px", borderRadius: "16px", borderColor: "transparent", borderStyle: "none", borderWidth: "0px", paddingLeft: "20px", paddingRight: "20px", marginLeft: "0px", marginRight: "0px", marginTop: "-5px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }}>
          
          {/* Back/Home arrow — restored per explicit request; a prior pass
              had removed this as functionally redundant with the wordmark
              button below (both just go Home), but its absence read as a
              missing navigation affordance rather than an intentional
              simplification, so it's back. Same action as the wordmark.
              Hidden specifically on the Home page itself (lookup+showIntro)
              since there it has nowhere meaningful left to go back to. */}
          <div className="flex items-center gap-3.5 shrink-0 z-10">
            {!(activeTab === "lookup" && showIntro) && (
              <button
                onClick={() => {
                  setActiveTab("lookup");
                  setShowIntro(true);
                }}
                className="p-1.5 -mr-1 rounded transition-all cursor-pointer hover:bg-white/10"
                title="Back to Home"
                aria-label="Go back to home"
              >
                <ArrowLeft className="w-4 h-4 text-white/70" aria-hidden="true" style={{ width: "18px", height: "18px" }} />
              </button>
            )}
            <button
              onClick={() => {
                setActiveTab("lookup");
                setShowIntro(true);
              }}
              className="text-left cursor-pointer hover:opacity-85 transition-opacity focus:outline-none select-none"
              title="Home (Go to Compliance & Policy Mapping Engine)" aria-label="Go to home — Ditto Assist"
            >
              <div className="flex items-center gap-2">
                <DittoWordmark className="text-lg" isWhite style={{ backgroundColor: "transparent" }} imgStyle={{ marginLeft: "-6px", marginBottom: "5px", width: "55px", height: "20px", paddingLeft: "0px" }} />
              </div>
            </button>
          </div>

          {/* TAB CONTROLS (Page Context Breadcrumb) - Absolutely Centered on Desktop */}
          <div className="md:absolute md:left-1/2 md:-translate-x-1/2 flex items-center gap-2 z-10 pointer-events-auto">
            {(() => {
              if (activeTab === "lookup" && showIntro) {
                return (
                  <button
                    onClick={() => setIsMenuOpen(prev => !prev)}
                    style={{
                      backgroundColor: "transparent",
                      borderColor: "transparent",
                      color: "#ffffff",
                      borderWidth: "0px",
                      boxShadow: "none",
                      borderRadius: "12px"
                    }}
                    className="title-badge-btn px-6 py-2 justify-center text-xs sm:text-sm font-black uppercase tracking-widest border-0 duration-300 transition-all flex items-center gap-2.5 cursor-pointer whitespace-nowrap active:scale-95 hover:scale-[1.02]"
                    title="Current workspace tab view"
                  >
                    <Home className="title-badge-icon w-4 h-4 shrink-0 text-cyan-400" style={{ color: "#fafafa", paddingRight: "0px", marginRight: "-6px", width: "15px", height: "15px", marginBottom: "2px", marginTop: "1px" }} />
                    <span style={{ fontSize: "13px", color: "#f9f9fc", paddingTop: "0px", paddingBottom: "0px", lineHeight: "13px", marginLeft: "2px", marginTop: "1px" }} className="title-badge-text font-sans font-black uppercase tracking-wider">
                      Home
                    </span>
                  </button>
                );
              }
              const tabMeta = {
                lookup: { label: "Declaration Assistant", icon: <Sparkles className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                my_activity: { label: "My Activity", icon: <History className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                resources: { label: "Declaration Map", icon: <DeclarationMapIcon color="currentColor" className="w-4.5 h-4.5 shrink-0 text-cyan-400" style={{ filter: "drop-shadow(0 0 0.4px currentColor)" }} /> },
                audit: { label: "Activity Log", icon: <Clock className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                flagged_responses: { label: "Flagged Responses", icon: <Flag className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                profile_access: { label: "User Management", icon: <User className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                qa_announcement_log: { label: "Announcement Manager", icon: <Megaphone className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                plan_scope: { label: "Plan Management", icon: <FileText className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                advisory_zone: { label: "Plan Reference", icon: <BookOpen className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                announcement_archive: { label: "Announcements", icon: <Newspaper className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                coverage_projection: { label: "Coverage Projection Studio", icon: <FileSpreadsheet className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                specific_illness_check: { label: "Specific Illness Check", icon: <ClipboardCheck className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                query_assist: { label: "Product Assist", icon: <ProductAssistIcon className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                qa_dashboard: { label: "QA Dashboard", icon: <QaDashboardIcon className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                ped_suggestions: { label: "PED Repository", icon: <Stethoscope className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                knowledge_base: { label: "Knowledge Base", icon: <Database className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                smoke_test: { label: "Smoke Test", icon: <Flame className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> },
                owner_controls: { label: "Developer Controls", icon: <ShieldAlert className="w-4.5 h-4.5 shrink-0 text-cyan-400" /> }
              };
              const meta = tabMeta[activeTab] || tabMeta.lookup;
              return (
                <button
                  onClick={() => setIsMenuOpen(prev => !prev)}
                  style={{
                    backgroundColor: "transparent",
                    borderColor: "transparent",
                    color: "#ffffff",
                    borderWidth: "0px",
                    boxShadow: "none"
                  }}
                  className="title-badge-btn px-6 py-2 justify-center text-xs sm:text-sm font-black uppercase tracking-widest border-0 duration-300 transition-all flex items-center gap-2.5 cursor-pointer whitespace-nowrap active:scale-95 hover:scale-[1.02]"
                  title="Current workspace tab view"
                >
                  {/* Merge (not replace) className/style onto the icon —
                      cloneElement's second argument overwrites both props
                      wholesale by default. That was harmless for every
                      lucide SVG icon here (their sizing comes from SVG
                      width/height attributes, not this style object), but it
                      silently wiped out the CSS-mask icon's own style
                      (backgroundColor + mask-image), which is ALL inline
                      style with nothing else to fall back on — that's why
                      Coverage Projection Studio's badge icon wasn't
                      rendering. Spreading the icon's own className/style
                      first keeps that intact while these badge-specific
                      overrides (size, color, margins) still win where they
                      overlap. */}
                  {React.cloneElement(meta.icon, {
                    className: `title-badge-icon w-4.5 h-4.5 shrink-0 text-cyan-400 ${(meta.icon.props as { className?: string }).className || ""}`,
                    style: { ...(meta.icon.props as { style?: React.CSSProperties }).style, color: "#fafafa", borderColor: "transparent", paddingRight: "0px", marginRight: "-6px", width: "15px", height: "15px", marginBottom: "2px", marginTop: "1px" }
                  })}
                  <span
                    style={{ fontSize: "13px", color: "#f9f9fc", paddingTop: "0px", paddingBottom: "0px", lineHeight: "13px", marginLeft: "2px", marginTop: "1px" }}
                    className="title-badge-text font-sans font-black uppercase tracking-wider"
                  >
                    {meta.label}
                  </span>
                </button>
              );
            })()}
          </div>

          {/* ACTIVE USER INFO & HEADER NAVIGATION CONTROLS */}
          <div className="flex items-center gap-2.5 shrink-0 z-10">
            {/* Theme Toggle & Direct Log Out */}
            <div 
              className="flex items-center justify-center gap-1.5 p-1" 
              style={{
                backgroundColor: "transparent",
                borderColor: "transparent"
              }}
            >
                {/* Quick Access drawer trigger — open to every signed-in
                    user now that the drawer includes the Resources link
                    list (readable by everyone). The View As simulator
                    stays gated to Developer/Admin, tucked in the footer. */}
                <button
                  onClick={(e) => {
                    setIsRightSidebarOpen(true);
                    e.currentTarget.blur();
                  }}
                  className="p-1.5 rounded transition-all cursor-pointer inline-flex items-center justify-center"
                  title="Quick Access"
                  aria-label="Open quick access panel"
                >
                  {/* Sun/Moon/LogOut are lucide SVGs at a 20px box, but
                      lucide's 24x24 viewBox reserves ~2px of internal
                      padding on every edge, so their actual ink is only
                      ~83% of that box. This PNG's artwork (like the prior
                      accessible.png) fills its canvas edge-to-edge with no
                      such padding, so matching the literal 20px box would
                      make it read heavier/larger than its siblings —
                      sized to 17px to match their visual (ink) weight
                      instead of their box size. Button stays inline-flex +
                      items-center/justify-center so the masked span (a
                      display:inline-block box whose default baseline sits
                      at its own bottom edge) is truly centered rather than
                      relying on baseline alignment. */}
                  <span
                    aria-hidden="true"
                    style={{
                      width: "17px",
                      height: "17px",
                      backgroundColor: "#00D3F3",
                      WebkitMaskImage: "url(/assets/.aistudio/portal-enter.png)",
                      maskImage: "url(/assets/.aistudio/portal-enter.png)",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                </button>

                {/* Dark / Light theme toggle */}
                <button
                  onClick={(e) => {
                    toggleTheme();
                    e.currentTarget.blur();
                  }}
                  className="p-1.5 rounded transition-all cursor-pointer"
                  title={theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={theme === "dark"}
                >
                  {theme === "dark"
                    ? <Sun className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#ffb700" }} />
                    : <Moon className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#93c5fd" }} />
                  }
                </button>

                {/* Direct Logout (Request 2) */}
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    handleLogout();
                  }}
                  className="p-1.5 rounded transition-all cursor-pointer text-red-500 hover:text-red-400"
                  title="Direct Logout"
                  aria-label="Direct logout"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" style={{ width: "20px", height: "20px", color: "#9a9c9e" }} />
                </button>
              </div>
            </div>
          </div>
        </header>
    </div>

      {/* RIGHT CONTROLS DRAWER PANEL */}
      <AnimatePresence>
        {isRightSidebarOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRightSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs cursor-pointer"
            />

            {/* Drawer Container */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              id="right-controls-drawer" role="dialog" aria-modal="true" aria-label="Quick access"
              // Mirrors the left sidebar's chrome and type scale exactly
              // (see renderSidebarContent above) rather than its own
              // one-off card styling — same bg, same header block, same
              // text-[10px]/text-xs sizes, same #F5F7FA/#C4CDD8 text
              // colors and blue-300 icon accent, same flat (unboxed)
              // nav-row treatment for list items.
              className={`fixed top-0 right-0 h-full w-80 border-l z-54 shadow-2xl flex flex-col font-sans text-left text-[#F5F7FA] ${
                theme === "dark" ? "bg-[#03101a]" : "bg-[var(--sidebar-bg)]"
              } border-white/[0.08]`}
            >
              {/* Header — identical structure to the sidebar's own header */}
              <div
                className={`p-5 border-b border-white/[0.08] flex items-center justify-between ${
                  theme === "dark" ? "bg-[#03101a]" : "bg-[var(--sidebar-bg)]"
                }`}
              >
                <div className="flex flex-col">
                  {/* Inline color (not just the text-[#F5F7FA] class) since a
                      global CSS sweep rule elsewhere in the app has, more
                      than once, silently overridden a bracket color class on
                      an uppercase heading like this one — inline style always
                      wins over any class-based rule, so this is immune to it
                      regardless of which rule it turns out to be. */}
                  <span style={{ color: "#F5F7FA" }} className="text-xs font-bold uppercase tracking-wider">Quick Access</span>
                  <span style={{ color: "#C4CDD8" }} className="text-[10px] font-medium">Resources &amp; Preview Controls</span>
                </div>
                <button
                  onClick={() => setIsRightSidebarOpen(false)}
                  className="p-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/5 text-[#C4CDD8] hover:text-[#F5F7FA]"
                  title="Close panel"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Controls Stack: Resources (View As lives in the footer) */}
              <div className="flex-grow p-4 space-y-1.5 overflow-y-auto">

                {/* Resources — external link list (Payment SOP, QA Dashboard,
                    etc.). Visible/clickable for every signed-in user by
                    default, same as everyone else. Admin/Developer get a
                    "Manage Resources" toggle that reveals add/edit/delete
                    controls on demand instead of showing them by default. */}
                <div className="flex items-center justify-between px-2 mb-2">
                  <span className="block text-[10px] font-bold tracking-wider text-[#C4CDD8]">
                    Resources
                  </span>
                  {(currentUser?.tier === "Developer" || currentUser?.tier === "Admin") && (
                    <button
                      onClick={() => {
                        setIsManagingResources((prev) => !prev);
                        setEditingResourceId(null);
                        setResourceFormError(null);
                      }}
                      className={`flex items-center gap-1 text-[10px] font-bold tracking-wide cursor-pointer transition-colors ${
                        isManagingResources ? "text-blue-300" : "text-[#C4CDD8] hover:text-[#F5F7FA]"
                      }`}
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      {isManagingResources ? "Done" : "Manage Resources"}
                    </button>
                  )}
                </div>

                {externalResourcesLoadError && (
                  <p className="text-[10px] font-semibold text-red-400 px-2">{externalResourcesLoadError}</p>
                )}
                {externalResources.length === 0 && !externalResourcesLoadError && (
                  <p className="text-xs text-[#C4CDD8] italic px-3 py-2">No resource links added yet.</p>
                )}
                {externalResources.map((resource, resIdx) => {
                  const ResourceIcon = resolveResourceIcon(resource);
                  return (
                  <div key={resource.id}>
                    {editingResourceId === resource.id ? (
                      <div className="p-2 rounded-md border border-white/[0.08] bg-white/[0.03] space-y-1.5 mx-0.5">
                        <input
                          type="text"
                          value={editResourceTitle}
                          onChange={(e) => setEditResourceTitle(e.target.value)}
                          placeholder="Title"
                          className="w-full text-xs p-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20"
                        />
                        <input
                          type="text"
                          value={editResourceUrl}
                          onChange={(e) => setEditResourceUrl(e.target.value)}
                          placeholder="https://..."
                          className="w-full text-xs p-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20"
                        />
                        <div className="space-y-1">
                          <span className="block text-[9px] font-bold uppercase tracking-wider text-[#8B98AC]">Icon</span>
                          <div className="flex items-center gap-2">
                            <div className="shrink-0 w-7 h-7 rounded-md border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
                              {(() => {
                                const PreviewIcon = editResourceIcon
                                  ? RESOURCE_ICON_MAP[editResourceIcon] || getResourceIcon(editResourceTitle)
                                  : getResourceIcon(editResourceTitle);
                                return <PreviewIcon className="w-3.5 h-3.5 text-blue-300" />;
                              })()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <CustomSelect
                                theme="dark"
                                value={editResourceIcon}
                                onChange={setEditResourceIcon}
                                placeholder="Auto (guess from title)"
                                triggerClassName="w-full flex items-center justify-between gap-1 text-xs pl-1.5 pr-6 py-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20 cursor-pointer relative"
                                options={RESOURCE_ICON_OPTIONS.map(({ name, label }) => ({ value: name, label }))}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-0.5">
                          <button
                            onClick={() => setEditingResourceId(null)}
                            className="text-[10px] font-bold uppercase text-[#C4CDD8] hover:text-[#F5F7FA] cursor-pointer px-1.5 py-1"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleUpdateResource(resource.id)}
                            className="text-[10px] font-bold uppercase text-blue-300 hover:text-blue-200 cursor-pointer px-1.5 py-1"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`w-full flex items-center justify-between gap-1.5 px-3 py-2 text-xs font-medium transition-all border-l-2 border-l-transparent text-[#C4CDD8] hover:bg-stone-800/15 hover:text-[#F5F7FA] rounded-r-lg border-y-transparent border-r-transparent`}
                      >
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 min-w-0 hover:text-[#F5F7FA] transition-colors"
                          title={resource.url}
                        >
                          <ResourceIcon className="w-4 h-4 shrink-0 text-blue-300" />
                          <span className="truncate">{resource.title}</span>
                        </a>
                        {isManagingResources && (currentUser?.tier === "Developer" || currentUser?.tier === "Admin") && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => handleMoveResource(resource.id, "up")}
                              disabled={resIdx === 0}
                              className="p-1 rounded hover:bg-white/10 text-[#C4CDD8] hover:text-[#F5F7FA] cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              title="Move up"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleMoveResource(resource.id, "down")}
                              disabled={resIdx === externalResources.length - 1}
                              className="p-1 rounded hover:bg-white/10 text-[#C4CDD8] hover:text-[#F5F7FA] cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                              title="Move down"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => startEditingResource(resource)}
                              className="p-1 rounded hover:bg-white/10 text-[#C4CDD8] hover:text-[#F5F7FA] cursor-pointer"
                              title="Edit resource link"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteResource(resource.id, resource.title)}
                              className="p-1 rounded hover:bg-white/10 text-[#C4CDD8] hover:text-red-400 cursor-pointer"
                              title="Delete resource link"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}

                {isManagingResources && (currentUser?.tier === "Developer" || currentUser?.tier === "Admin") && (
                  <div className="pt-2 mt-2 border-t border-white/[0.08] space-y-1.5 px-0.5">
                    {resourceFormError && (
                      <p className="text-[10px] font-semibold text-red-400">{resourceFormError}</p>
                    )}
                    <input
                      type="text"
                      value={newResourceTitle}
                      onChange={(e) => setNewResourceTitle(e.target.value)}
                      placeholder="Title (e.g. Payment SOP)"
                      className="w-full text-xs p-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20"
                    />
                    <input
                      type="text"
                      value={newResourceUrl}
                      onChange={(e) => setNewResourceUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full text-xs p-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20"
                    />
                    <div className="space-y-1">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-[#8B98AC]">Icon</span>
                      <div className="flex items-center gap-2">
                        <div className="shrink-0 w-7 h-7 rounded-md border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
                          {(() => {
                            const PreviewIcon = newResourceIcon
                              ? RESOURCE_ICON_MAP[newResourceIcon] || getResourceIcon(newResourceTitle)
                              : getResourceIcon(newResourceTitle);
                            return <PreviewIcon className="w-3.5 h-3.5 text-blue-300" />;
                          })()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <CustomSelect
                            theme="dark"
                            value={newResourceIcon}
                            onChange={setNewResourceIcon}
                            placeholder="Auto (guess from title)"
                            triggerClassName="w-full flex items-center justify-between gap-1 text-xs pl-1.5 pr-6 py-1.5 rounded border outline-none bg-transparent border-white/[0.08] text-[#F5F7FA] focus:border-white/20 cursor-pointer relative"
                            options={RESOURCE_ICON_OPTIONS.map(({ name, label }) => ({ value: name, label }))}
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleAddResource}
                      disabled={isAddingResource}
                      className="w-full py-1.5 px-3 text-xs font-medium rounded-md border transition-all cursor-pointer flex items-center justify-center gap-1.5 bg-transparent border-white/[0.08] text-[#C4CDD8] hover:border-white/20 hover:text-[#F5F7FA] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-300" />
                      <span>{isAddingResource ? "Adding..." : "Add Resource Link"}</span>
                    </button>
                  </div>
                )}

              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* SCROLLABLE BODY AREA */}
      <div
        id="main-scrollable-body"
        className={`flex-grow flex flex-col min-w-0 bg-transparent relative z-10 ${
          activeTab === "lookup" && showIntro
            ? "overflow-hidden min-h-0"
            : (activeTab === "lookup" && !showIntro) || activeTab === "qa_announcement_log" || activeTab === "query_assist"
            ? "lg:overflow-hidden overflow-y-auto"
            : "overflow-y-auto"
        }`}
      >
        {/* BODY WRAPPER with centering content constraint */}
        <main 
          id="main-content" 
          tabIndex={-1} 
          style={{ color: "var(--text-primary)", marginTop: showIntro && activeTab === "lookup" ? "2px" : "6px", marginBottom: showIntro && activeTab === "lookup" ? "2px" : "12px" }}
          className={`flex-grow w-full p-3 sm:p-4 bg-transparent outline-none ${
            showIntro && activeTab === "lookup"
              ? "lg:p-3 xl:p-4 pt-1 sm:pt-1.5 flex flex-col justify-start min-h-0"
              : (!showIntro && activeTab === "lookup") || activeTab === "qa_announcement_log" || activeTab === "query_assist"
              ? "lg:p-5 pt-1.5 sm:pt-2 lg:flex lg:flex-col lg:min-h-0"
              : "lg:p-5 pt-1.5 sm:pt-2"
          }`}
        >
          {/* Expanded premium layout container, reducing margin distance to human-optimal minimums */}
          <div className={`w-full lg:w-[98%] xl:w-[96%] max-w-[var(--container-content)] mx-auto ${
            showIntro && activeTab === "lookup"
              ? "flex-grow flex flex-col min-h-0"
              : (!showIntro && activeTab === "lookup") || activeTab === "qa_announcement_log" || activeTab === "query_assist"
              ? "lg:flex-grow lg:flex lg:flex-col lg:min-h-0"
              : ""
          }`}>
        <AnimatePresence mode="wait">
          {/* TAB 1: INTRO PAGE / ONBOARDING */}
          {activeTab === "lookup" && showIntro && (
            <motion.div
              key="intro"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ width: "100%", maxWidth: "100%", marginTop: "2px", marginBottom: "2px" }}
              className="py-1 sm:py-2 space-y-2 flex-grow flex flex-col justify-start min-h-0"
            >
              <ErrorBoundary theme={theme} label="Declaration Assistant">
                <Suspense fallback={<TabLoadingFallback theme={theme} />}>
                  <LookupIntroPage
                    theme={theme}
                    currentUser={currentUser}
                    setShowIntro={setShowIntro}
                    setActiveTab={setActiveTab}
                    activeAnnouncements={activeAnnouncements}
                    allAnnouncements={qaAnnouncements}
                    onOpenAnnouncementsForDate={openAnnouncementsForDate}
                    hasAccess={hasAccess}
                  />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}
          {/* TAB 1: DITTO ASSIST (ACTIVE SCREEN) */}
          {activeTab === "lookup" && !showIntro && (
            <motion.div
              key="lookup"
              initial={{ opacity: 0, x: "100vw" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "100vw" }}
              transition={{ 
                type: "tween", 
                duration: 0.55, 
                ease: [0.25, 1, 0.5, 1] // Fluid high-speed deceleration
              }}
              style={{
                width: "100%",
                maxWidth: "1400px",
                paddingLeft: "30px",
                paddingRight: "30px",
                paddingTop: "0px",
                paddingBottom: "0px",
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: "0px",
                marginBottom: "10px"
              }}
              className="flex flex-col gap-4 lg:flex-1 lg:min-h-0"
            >
              <ErrorBoundary theme={theme} label="Declaration Assistant">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <LookupPage
                theme={theme}
                isResultsActive={isResultsActive}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
                productionPlans={productionPlans}
                pedInput={pedInput}
                setPedInput={setPedInput}
                pedInputRef={pedInputRef}
                activeSuggestionIndex={activeSuggestionIndex}
                setActiveSuggestionIndex={setActiveSuggestionIndex}
                dynamicSuggestions={dynamicSuggestions}
                lookupPeds={lookupPeds}
                setLookupPeds={setLookupPeds}
                handleAddLookupPed={handleAddLookupPed}
                isLookupLoading={isLookupLoading}
                lookupResults={lookupResults}
                executeLookupAll={executeLookupAll}
                handleClearLookupFields={handleClearLookupFields}
                handleMapAnotherPed={handleMapAnotherPed}
                setReportingItem={setReportingItem}
                setReportingNotes={setReportingNotes}
                illnessSearchQuery={illnessSearchQuery}
                setIllnessSearchQuery={setIllnessSearchQuery}
                specificIllnessesDict={effectiveSpecificIllnessesDict}
                planConfigs={planConfigs}
                checkIllnessInPlanSpecificList={checkIllnessInPlanSpecificList}
                setActiveTab={setActiveTab}
                activeAnnouncements={activeAnnouncements}
                noticeIndex={noticeIndex}
                setNoticeIndex={setNoticeIndex}
                slideDirection={slideDirection}
                setSlideDirection={setSlideDirection}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 1B: ADVISOR QUERY AUDIT TRAIL VIEW (content extracted to src/pages/AuditPage.tsx, Phase 1.3) */}
          {activeTab === "audit" && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Activity Log">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AuditPage
                theme={theme}
                auditSubTab={auditSubTab}
                setAuditSubTab={setAuditSubTab}
                auditSearch={auditSearch}
                setAuditSearch={setAuditSearch}
                auditPlanFilter={auditPlanFilter}
                setAuditPlanFilter={setAuditPlanFilter}
                auditStatusFilter={auditStatusFilter}
                setAuditStatusFilter={setAuditStatusFilter}
                auditTypeFilter={auditTypeFilter}
                setAuditTypeFilter={setAuditTypeFilter}
                auditStartDate={auditStartDate}
                setAuditStartDate={setAuditStartDate}
                auditEndDate={auditEndDate}
                setAuditEndDate={setAuditEndDate}
                downloadCSV={downloadCSV}
                historySearch={historySearch}
                setHistorySearch={setHistorySearch}
                historyActionFilter={historyActionFilter}
                setHistoryActionFilter={setHistoryActionFilter}
                usersList={usersList}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 1D: MY ACTIVITY INTERACTIVE VIEW (content extracted to src/pages/MyActivityPage.tsx, Phase 1.3) */}
          {activeTab === "my_activity" && (
            <motion.div
              key="my_activity"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              <ErrorBoundary theme={theme} label="My Activity">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <MyActivityPage
                currentUser={currentUser}
                theme={theme}
                myActivitySearch={myActivitySearch}
                setMyActivitySearch={setMyActivitySearch}
                myActivityPlanFilter={myActivityPlanFilter}
                setMyActivityPlanFilter={setMyActivityPlanFilter}
                myActivityStartDate={myActivityStartDate}
                setMyActivityStartDate={setMyActivityStartDate}
                myActivityEndDate={myActivityEndDate}
                setMyActivityEndDate={setMyActivityEndDate}
                expandedLogIndex={expandedLogIndex}
                setExpandedLogIndex={setExpandedLogIndex}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 1C: DECLARATION MAP INTERACTIVE VIEW (content extracted to src/pages/ResourcesPage.tsx, Phase 1.3) */}
          {activeTab === "resources" && (
            <motion.div
              key="resources"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Declaration Map">
                <Suspense fallback={<TabLoadingFallback theme={theme} />}>
                  <ResourcesPage theme={theme} />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB: USER DIRECTORY (server-backed org user list; Developer can edit) */}
          {activeTab === "profile_access" && currentUser && (
            <motion.div
              key="profile_access"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="User Management">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <ProfileAccessPage
                theme={theme}
                usersList={usersList}
                setUsersList={setUsersList}
                effectiveTier={effectiveTier}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* ADVISORY ZONE — read-only plan reference, visible to every tier
              (Advisory Zone vs Admin Zone distinction; see
              featurePermissions.ts). */}
          {activeTab === "advisory_zone" && (
            <motion.div
              key="advisory_zone"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0"
            >
              <ErrorBoundary theme={theme} label="Advisory Zone">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AdvisoryZonePage
                theme={theme}
                productionPlans={productionPlans}
                planConfigs={planConfigs}
                specificIllnessesDict={effectiveSpecificIllnessesDict}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* ANNOUNCEMENTS ARCHIVE — full searchable/filterable history of
              every posted announcement, visible to every tier (same
              Advisory Zone visibility as Plan Reference above it in the
              nav; see featurePermissions.ts's "announcement_archive"). */}
          {activeTab === "announcement_archive" && (
            <motion.div
              key="announcement_archive"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0"
            >
              <ErrorBoundary theme={theme} label="Announcements Archive">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AnnouncementArchivePage theme={theme} initialEffectiveDate={announcementEffectiveDateFilter} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* COVERAGE PROJECTION STUDIO — read-only Base Cover / Bonus /
              Restoration Benefit calculator, visible to every tier (same
              Advisor Zone visibility as Plan Reference; see
              featurePermissions.ts). Gated by the app's own login like every
              other tab here — no separate auth of its own. */}
          {activeTab === "coverage_projection" && (
            <motion.div
              key="coverage_projection"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Coverage Projection Studio">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <CoverageProjectionStudioPage theme={theme} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* SPECIFIC ILLNESS CHECK — read-only, general-user-facing surface
              over the same matchSpecificIllness() logic the Admin Zone's
              Specific Illness Ledger sandbox uses (see
              SpecificIllnessCheckPage.tsx). Visible to every tier (same
              Advisory Zone visibility as Coverage Projection Studio above;
              see featurePermissions.ts). */}
          {activeTab === "specific_illness_check" && (
            <motion.div
              key="specific_illness_check"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="Specific Illness Check">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <SpecificIllnessCheckPage theme={theme} dynamicSuggestions={dynamicSuggestions} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* QUERY ASSIST — advisor chat over the Knowledge Base's per-insurer
              documents and announcements, grounded answers only (see
              QueryAssistPage.tsx / src/server/knowledgeBase/queryAssist.ts).
              Visible to every tier, same as lookup/resources above. */}
          {activeTab === "query_assist" && (
            <motion.div
              key="query_assist"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0"
            >
              <ErrorBoundary theme={theme} label="Product Assist">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <QueryAssistPage theme={theme} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* QA DASHBOARD — read-only advisor QA scorecard, native port of
              the standalone Apps Script "Advisor QA Dashboard" (Google
              Sheets source of truth). Visible to every tier (see
              featurePermissions.ts); the page's own Admin/Guide/Mentor/
              Advisor role logic decides what each signed-in person sees. */}
          {activeTab === "qa_dashboard" && (
            <motion.div
              key="qa_dashboard"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <ErrorBoundary theme={theme} label="QA Dashboard">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <QaDashboardPage theme={theme} />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* OWNER CONTROLS — page visibility switch. Reachable only by the
              Developer (featurePermissions marks General/Admin as "None"). */}
          {activeTab === "owner_controls" && (
            <motion.div
              key="owner_controls"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Developer Controls">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <OwnerControlsPage
                theme={theme}
                hiddenPages={hiddenPages}
                setHiddenPages={setHiddenPages}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 6: QA ANNOUNCEMENT LOG PANEL (content extracted to src/pages/AnnouncementLogPage.tsx, Phase 1.3) */}
          {activeTab === "qa_announcement_log" && (
            <motion.div
              key="qa_announcement_log"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0"
            >
              <ErrorBoundary theme={theme} label="QA Announcement Log">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <AnnouncementLogPage
                theme={theme}
                qaAnnouncements={qaAnnouncements}
                setQaAnnouncements={setQaAnnouncements}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
                editingAnnouncementId={editingAnnouncementId}
                setEditingAnnouncementId={setEditingAnnouncementId}
                deletingAnnouncementId={deletingAnnouncementId}
                setDeletingAnnouncementId={setDeletingAnnouncementId}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}


          {/* TAB 7: FLAGGED RESPONSES (MAPPING MISMATCHES) PANEL (content extracted to src/pages/FlaggedResponsesPage.tsx, Phase 1.3) */}
          {activeTab === "flagged_responses" && (
            <motion.div
              key="flagged_responses"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Flagged Responses">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <FlaggedResponsesPage
                theme={theme}
                reportedIssues={reportedIssues}
                setReportedIssues={setReportedIssues}
                reportedIssuesFilter={reportedIssuesFilter}
                setReportedIssuesFilter={setReportedIssuesFilter}
                ownerResolutionNotes={ownerResolutionNotes}
                setOwnerResolutionNotes={setOwnerResolutionNotes}
                effectiveTier={effectiveTier}
                confirmDestructiveAction={confirmDestructiveAction}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 8: PLAN MANAGEMENT — add/edit insurance plan declaration
              questionnaires and their category-to-question mapping. This is
              the finished version of what used to be dead draftPlans/
              planQuestionsState/productionPlans scaffolding: it's now backed
              by Postgres (plan_configs table) and read directly by
              /api/match server-side, so a plan added here is immediately
              usable for real matching. */}
          {activeTab === "plan_scope" && (
            <motion.div
              key="plan_scope"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Plan Management">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <PlanManagementPage
                theme={theme}
                effectiveTier={effectiveTier}
                dbPlanConfigs={dbPlanConfigs}
                setDbPlanConfigs={setDbPlanConfigs}
                dbPlanConfigsLoadError={dbPlanConfigsLoadError}
                fetchPlanConfigs={fetchPlanConfigs}
                confirmDestructiveAction={confirmDestructiveAction}
                setChangeLogs={setChangeLogs}
                currentUser={currentUser}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 9: PED SUGGESTIONS — admin management UI for the
              ped_suggestions table (Lookup page autocomplete dropdown
              source list). Deliberately separate from the PED matching
              engine (TOP_PED_DICTIONARY in types.ts); see
              PedSuggestionsManagement.tsx for the full explanation. */}
          {activeTab === "ped_suggestions" && (
            <motion.div
              key="ped_suggestions"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="PED Repository">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <PedSuggestionsPage
                theme={theme}
                effectiveTier={effectiveTier}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 9b: KNOWLEDGE BASE — admin management UI for "Ask the
              Playbook": per-insurer/general PDF document categories plus a
              dated announcement override channel. See
              KnowledgeBaseManagementPage.tsx for the full explanation. */}
          {activeTab === "knowledge_base" && (
            <motion.div
              key="knowledge_base"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Knowledge Base">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <KnowledgeBaseManagementPage
                theme={theme}
                effectiveTier={effectiveTier}
                currentUser={currentUser}
                setChangeLogs={setChangeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

          {/* TAB 10: SMOKE TEST — runs the deterministic mapping engine
              against a curated baseline of common PEDs (plus any
              Admin/Developer-added custom entries) for one plan at a time, to
              catch classification regressions without needing a real
              advisor lookup. See SmokeTestPage.tsx for the full
              explanation. */}
          {activeTab === "smoke_test" && (
            <motion.div
              key="smoke_test"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-6 text-left"
            >
              <ErrorBoundary theme={theme} label="Smoke Test">
              <Suspense fallback={<TabLoadingFallback theme={theme} />}>
              <SmokeTestPage
                theme={theme}
                effectiveTier={effectiveTier}
                currentUser={currentUser}
                productionPlans={productionPlans}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
                setChangeLogs={setChangeLogs}
              />
              </Suspense>
              </ErrorBoundary>
            </motion.div>
          )}

        </AnimatePresence>
          </div> {/* CLOSES centering wrapper */}
        </main>
      </div> {/* CLOSES flex-grow flex flex-col min-w-0 overflow-y-auto */}

      {/* Compact elegant Launcher Info Bar — a shrink-0 sibling of the
          scrollable body (not nested inside it), so it always stays pinned
          to the bottom of the viewport instead of trailing after short
          pages or scrolling away on long ones. Shown on every tab, not
          just the lookup intro. Wrapped in the same centering/padding
          classes as <main> so it lines up edge-to-edge with the page
          content exactly like the original design did. */}
      <div className="shrink-0 relative z-10 w-full p-3 sm:p-4 lg:p-5 pt-0 sm:pt-0 lg:pt-0">
        <div className="w-full lg:w-[98%] xl:w-[96%] max-w-[var(--container-content)] mx-auto">
          <div
            style={{ borderColor: !isDark && activeTab !== "smoke_test" ? "#707a80" : undefined }}
            className={`pt-2.5 border-t flex justify-between items-center text-[10px] font-mono tracking-widest uppercase select-none w-full ${
              /* SMOKE TEST EXCEPTION (same reasoning as the GridTexture/backdrop
                 fixes above): this footer is shell-level and renders on every
                 tab, but it reacted to the live theme unconditionally — so
                 switching to light theme while on Smoke Test swapped in text
                 colors meant for a light page background, making the footer
                 nearly invisible against the page's intentionally-always-dark
                 backdrop. Force the dark-theme values whenever Smoke Test is active. */
              theme === "dark" || activeTab === "smoke_test"
                ? "border-[#252A34]/40 text-slate-400"
                : "font-extrabold text-stone-600"
            }`}
          >
            <div className="flex items-center gap-1.5 select-none">
              <span>ADVISOR PRODUCTIVITY PLATFORM</span>
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <span style={{ color: !isDark && activeTab !== "smoke_test" ? "#57534d" : "#90a1b9", fontWeight: !isDark && activeTab !== "smoke_test" ? "bold" : "normal", fontSize: "10px" }} className="font-normal">©BLISS GUIDES.DITTO</span>
          </div>
        </div>
      </div>

      {/* Global Mismatch Reporting Modal */}
      <AnimatePresence>
        {reportingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className={`w-full max-w-lg p-6 rounded-2xl border shadow-2xl text-left ${
                theme === "dark" ? "bg-[#0b1427] border-[#1c3258] text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            >
              <div className="flex justify-between items-center pb-3 border-b border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2 min-w-0">
                  <Flag className="w-4 h-4 text-red-500 animate-pulse shrink-0" />
                  <h3 className="text-xs font-black uppercase tracking-wider truncate">
                    Flag "{reportingItem.pedInput}"
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReportingItem(null)}
                  className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <XCircle className="w-5 h-5 font-bold" />
                </button>
              </div>

              <div className="py-4 text-left">
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-450 font-sans mb-1.5">
                  Reason for Flagging <span className="text-red-500 font-bold">*</span>
                </label>
                <textarea
                  required
                  autoFocus
                  rows={4}
                  value={reportingNotes}
                  placeholder="Explain what's wrong with this mapping..."
                  onChange={(e) => setReportingNotes(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border outline-none bg-stone-50 border-stone-250 dark:bg-stone-950 dark:border-stone-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 font-semibold"
                />
              </div>

              {reportingError && (
                <p className="text-[11px] font-bold text-red-500 pt-1">{reportingError}</p>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => {
                    setReportingItem(null);
                    setReportingNotes("");
                    setReportingError(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-stone-400 hover:text-[#111827] dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <PrimaryCtaButton
                  theme={theme}
                  variant="danger"
                  disabled={!reportingNotes.trim() || isSubmittingReport}
                  onClick={async () => {
                    if (!reportingNotes.trim() || !reportingItem || isSubmittingReport) return;
                    setIsSubmittingReport(true);
                    setReportingError(null);
                    // NOTE (audit fix, see Production_Readiness_Audit.md
                    // Finding 3): this now round-trips through the server
                    // (flagged_issues table) instead of only ever being
                    // written to this browser's own localStorage — identity
                    // fields (userEmail/userName/userTactId) are filled in
                    // server-side from the verified session, never trusted
                    // from the client.
                    try {
                      const res = await fetch("/api/flagged-issues", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          planName: reportingItem.planName,
                          pedInput: reportingItem.pedInput,
                          matchedQuestion: reportingItem.mappedQuestion,
                          matchType: reportingItem.matchType,
                          source: reportingItem.source,
                          explanation: reportingItem.explanation,
                          issueNotes: reportingNotes,
                        }),
                      });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(body.error || `Failed to submit report (HTTP ${res.status}).`);

                      const row = body.entry;
                      const newIssue: ReportedIssue = {
                        id: String(row.id),
                        timestamp: row.timestamp,
                        userEmail: row.userEmail,
                        userName: row.userName,
                        userTactId: row.userTactId,
                        planName: row.planName,
                        pedInput: row.pedInput,
                        matchedQuestion: row.matchedQuestion,
                        matchType: row.matchType,
                        source: row.source,
                        explanation: row.explanation,
                        issueNotes: row.issueNotes,
                        status: row.status,
                        ownerNotes: row.ownerNotes ?? undefined,
                        resolvedAt: row.resolvedAt ?? undefined,
                      };
                      setReportedIssues(prev => [newIssue, ...prev]);
                      setReportingItem(null);
                      setReportingNotes("");
                    } catch (err: unknown) {
                      setReportingError(err instanceof Error ? err.message : "Failed to submit this report. Please try again.");
                    } finally {
                      setIsSubmittingReport(false);
                    }
                  }}
                >
                  {isSubmittingReport ? "Submitting..." : "Submit Report"}
                </PrimaryCtaButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mandatory read-and-acknowledge overlay — blocks ALL app usage (it
          sits above every other layer, z-[200]) until the signed-in user has
          marked every applicable new announcement as read, one at a time.
          Eligibility is decided server-side; see fetchUnackedAnnouncements. */}
      {currentUser && unackedAnnouncements.length > 0 && (
        <AnnouncementAckModal
          theme={theme}
          announcements={unackedAnnouncements}
          onAcknowledge={handleAcknowledgeAnnouncement}
        />
      )}

      {/* Dismissible nudge (z-[190], below the blocking ack overlay above) for
          an already-provisioned user with no Skill Domain tags yet — only
          shown once any mandatory announcement ack is out of the way. */}
      {currentUser && showSkillDomainPrompt && unackedAnnouncements.length === 0 && (
        <SkillDomainPromptModal
          theme={theme}
          onSave={handleSaveSkillDomain}
          onSkip={handleSkipSkillDomain}
        />
      )}

      {/* Destructive-action confirmation modal (see confirmDestructiveAction above for why this
          is a plain confirmation and not a passcode/credential check). */}
      <AnimatePresence>
        {isConfirmModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className={`w-full max-w-sm p-6 rounded-2xl border shadow-2xl text-left ${
                theme === "dark" ? "bg-[#0b1427] border-[#1c3258] text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            >
              <div className="flex justify-between items-center pb-3 border-b border-stone-200 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <h3 className="text-xs font-black uppercase tracking-wider">Confirm Destructive Action</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer"
                >
                  <XCircle className="w-5 h-5 font-bold" />
                </button>
              </div>

              <div className="space-y-2 py-4 text-left">
                <p className="text-xs font-semibold text-stone-500 dark:text-stone-400 leading-relaxed">
                  {confirmActionLabel || "This is a destructive action."} This cannot be undone — are you sure you want to continue?
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-stone-400 hover:text-[#111827] dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={handleConfirmDestructiveAction}
                  className="px-5 py-2.5 text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-md active:scale-97 cursor-pointer"
                >
                  Confirm & Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
