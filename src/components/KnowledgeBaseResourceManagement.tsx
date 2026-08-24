/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Plus, Trash2, Upload, ChevronDown, ChevronRight, FileText, RefreshCw, AlertTriangle, CheckCircle2, X, Tag, Link2,
  Search, Filter, Pencil, Folder, ArrowLeftRight,
} from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { INSURER_LOGOS } from "../constants/insurerLogos";
import { getPlanInsurerColor, hexToRgba } from "../utils/planInsurerColors";
import { realPlanNames } from "../utils/kbPlanNames";
import { DittoWordmark } from "./mascots/DittoWordmark";

// Insurer-level accent color, reusing the exact same muted brand colors
// Coverage Projection Studio and the PED result cards already use (see
// planInsurerColors.ts) — that file is keyed by PLAN name, so one
// representative plan per insurer is picked here to resolve the insurer's
// own color; every plan under an insurer maps to the same pair there
// already (e.g. "Aspire" and "Reassure 2.0" both resolve to Niva Bupa's
// teal), so any representative plan gives the correct insurer color.
const INSURER_ACCENT_COLOR: Record<string, { light: string; dark: string }> = {
  "HDFC ERGO": getPlanInsurerColor("Optima Secure"),
  "Care Health": getPlanInsurerColor("Care Supreme"),
  "Aditya Birla": getPlanInsurerColor("Activ One Max"),
  "Niva Bupa": getPlanInsurerColor("Aspire"),
};

interface KbCategory {
  id: number;
  name: string;
  type: "insurer" | "general";
  sortOrder: number;
  planNames: string[];
  disabledPlanNames: string[];
}

type KbDocumentType = "brochure" | "policy_wording" | "prospectus" | "addon" | "other";
type KbResourceStatus = "processing" | "active" | "error" | "archived";

interface KbResource {
  id: number;
  categoryId: number;
  type: "pdf" | "web" | "sheet";
  title: string;
  documentType: KbDocumentType;
  sourceUrl: string | null;
  status: KbResourceStatus;
  chunkCount: number;
  errorMessage: string | null;
  planTags: string[];
  isInsurerLevel: boolean;
  updatedAt: string;
}

// What KIND of document a resource is — Brochure/Policy Wording/Prospectus/
// Add-on, independent of its insurer category and plan tags — see 0034's
// schema comment and queryAssist.ts's SOURCE PRECEDENCE. Kept as ordered
// entries (not an object) so select options match the authority order
// Policy Wording > Prospectus > Brochure the model uses.
const DOCUMENT_TYPE_OPTIONS: { value: KbDocumentType; label: string }[] = [
  { value: "policy_wording", label: "Policy Wording" },
  { value: "prospectus", label: "Prospectus" },
  { value: "brochure", label: "Brochure" },
  { value: "addon", label: "Add-on" },
  { value: "other", label: "Other" },
];
const DOCUMENT_TYPE_LABEL: Record<KbDocumentType, string> = Object.fromEntries(
  DOCUMENT_TYPE_OPTIONS.map(o => [o.value, o.label])
) as Record<KbDocumentType, string>;

// The four document-type tabs shown per insurer (Plans | All Resources |
// <these four>) — matches the authority-order groups queryAssist.ts
// actually reasons about. "Other" isn't a real doc-type tab (it's the
// catch-all default for pre-"clean start" resources — see 0034's schema
// comment) but still shows up inside All Resources and, when a plan has one,
// as its own small "Other" group under that plan.
const DOC_TYPE_TABS: { value: KbDocumentType; tabLabel: string; shortLabel: string }[] = [
  { value: "policy_wording", tabLabel: "Policy Wordings", shortLabel: "PW" },
  { value: "prospectus", tabLabel: "Prospectuses", shortLabel: "PR" },
  { value: "brochure", tabLabel: "Brochures", shortLabel: "BR" },
  { value: "addon", tabLabel: "Add-ons", shortLabel: "Add-on" },
];

type TabKey = "plans" | "all" | KbDocumentType | "insurer_resources";

const STATUS_VALUES: KbResourceStatus[] = ["active", "processing", "error", "archived"];

function documentTypeBadge(documentType: KbDocumentType, dark: boolean) {
  if (documentType === "other") return null;
  const map: Record<Exclude<KbDocumentType, "other">, string> = {
    policy_wording: dark ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" : "bg-indigo-50 text-indigo-700 border-indigo-200",
    prospectus: dark ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" : "bg-cyan-50 text-cyan-700 border-cyan-200",
    brochure: dark ? "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" : "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
    addon: dark ? "bg-orange-500/15 text-orange-300 border-orange-500/30" : "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${map[documentType]}`}>
      {DOCUMENT_TYPE_LABEL[documentType]}
    </span>
  );
}

function statusBadge(status: KbResourceStatus, dark: boolean) {
  const map: Record<KbResourceStatus, string> = {
    active: dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200",
    processing: dark ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200",
    error: dark ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-red-50 text-red-700 border-red-200",
    archived: dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${map[status]}`}>
      {status}
    </span>
  );
}

/** Normalizes a plan name for case/whitespace-insensitive comparison — used
 * both to collapse roster entries that differ only by casing (e.g. an
 * admin-typed "Activ One Max" alongside an older resource tagged "Activ One
 * MAX") and to match a resource's planTags against a plan/variant purely by
 * content, not by exact string identity. This never changes what's stored —
 * only how the Plans tab groups it for display. */
function normalizePlanKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Collapses case/whitespace duplicates in a plan-name list down to one
 * canonical entry each (first-seen casing wins), preserving order. Purely a
 * display-layer merge — the underlying roster/tags on disk are untouched. */
function dedupeCaseInsensitive(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const key = normalizePlanKey(n);
    if (!seen.has(key)) seen.set(key, n);
  }
  return [...seen.values()];
}

/** A resource counts toward a plan/variant if it's tagged with that name
 * (case/whitespace-insensitively) or has no plan tags at all — an untagged
 * resource applies broadly to every plan under its insurer, same retrieval
 * semantics queryAssist.ts already uses, unchanged. Add-on documentType
 * resources never count here regardless of tags — per the KB's design an
 * add-on can genuinely apply to several unrelated plans, so tying it to
 * whichever plan it happens to be tagged with would be misleading; add-ons
 * get their own section instead (see the Add-ons block in the Plans tab).
 * Insurer-level resources (isInsurerLevel) never count here either — they're
 * explicitly not plan-specific and live only in the Insurer Resources tab,
 * so an untagged insurer-level doc must NOT fall into the "applies broadly to
 * every plan" bucket the way a genuinely untagged plan doc does. */
function resourcesForPlanKey(resources: KbResource[], key: string): KbResource[] {
  return resources.filter(
    r =>
      r.documentType !== "addon" &&
      !r.isInsurerLevel &&
      (r.planTags.length === 0 || r.planTags.some(t => normalizePlanKey(t) === key))
  );
}

interface PlanVariant {
  name: string;
  resources: KbResource[];
}
interface PlanFamily {
  rootName: string;
  baseResources: KbResource[];
  variants: PlanVariant[];
}

/** One family per roster entry — deliberately flat, no name-based inference.
 *
 * This used to auto-nest a roster entry under another (e.g. "Optima
 * Secure+" under "Optima Secure") whenever one name was literally the other
 * plus a trailing "+"/space/"-" and their tagged resources weren't byte-
 * identical. That heuristic produced a real, confirmed-wrong grouping for
 * HDFC ERGO specifically: "Optima Secure", "Optima Secure+" and "Optima
 * Super Secure" are three independent products, not a base plan with
 * upgrade tiers, and prefix-matching alone can't tell that apart from a
 * genuine "ReAssure 2.0" -> "ReAssure 2.0 Bronze Plus" style variant — the
 * name shape looks identical in both cases; only real product knowledge
 * distinguishes them. Per Workstream A's own rule ("do not assume similar
 * names = variants... use the actual product/plan identity") and its
 * "database/UI as source of truth, no hidden grouping rules" rule, that
 * inference has been removed rather than special-cased for one insurer —
 * every roster entry now renders as its own independent plan, exactly
 * matching what's actually in the database. If a genuine base -> variant
 * relationship needs its own grouped display again later, it should be an
 * explicit, admin-set relationship (a real, persisted fact), not a name
 * pattern guessed at render time. */
function buildPlanFamilies(planNames: string[], catResources: KbResource[]): PlanFamily[] {
  const dedupedNames = dedupeCaseInsensitive(planNames);
  return dedupedNames.map(name => ({
    rootName: name,
    baseResources: resourcesForPlanKey(catResources, normalizePlanKey(name)),
    variants: [],
  }));
}

/** De-duplicated (by resource id) resource count for a family — a shared
 * untagged resource matches every variant's bucket, so a naive sum would
 * over-count it once per variant it appears under. */
function familyResourceCount(family: PlanFamily): number {
  const ids = new Set<number>();
  for (const r of family.baseResources) ids.add(r.id);
  for (const v of family.variants) for (const r of v.resources) ids.add(r.id);
  return ids.size;
}

function familyDocTypeCounts(family: PlanFamily): Record<KbDocumentType, number> {
  const seen = new Set<number>();
  const all: KbResource[] = [];
  const add = (r: KbResource) => {
    if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
  };
  for (const r of family.baseResources) add(r);
  for (const v of family.variants) for (const r of v.resources) add(r);
  return countByDocType(all);
}

/** True when every resource actually tagged with this plan name is an
 * add-on/rider document — i.e. the roster entry is really an add-on's own
 * product name (e.g. "Limitless", "Unlimited Restore") that got typed into
 * the plan-tag box instead of the generic "Add-on" pseudo-entry, not a real
 * base plan or variant. Left alone (still counted as a real plan) whenever
 * it has zero matched resources or at least one non-addon resource — this
 * is derived purely from the same resource tagging admins already curated,
 * never a hardcoded name list. Mirrors server.ts's identical check used for
 * Product Assist's plan selector. */
function isAddOnOnlyPlanName(planName: string, catResources: KbResource[]): boolean {
  const key = planName.trim().toLowerCase();
  const matched = catResources.filter(r => r.planTags.some(t => t.trim().toLowerCase() === key));
  return matched.length > 0 && matched.every(r => r.documentType === "addon");
}

/** The Plans tab's plan list — the admin-curated roster (category.planNames)
 * plus any plan name actually used as a tag on one of this category's
 * resources but missing from that roster (e.g. a tag typed before the name
 * was added to the roster, or after it was removed). Keeps every tagged
 * resource discoverable under the Plans tab rather than silently orphaned.
 *
 * Excludes an "Add-on"/"Add-ons" pseudo-plan entry (see isAddOnPlanName) —
 * that's a real, useful roster entry for tagging standalone rider documents,
 * but it isn't a plan, so it shouldn't be counted or listed as one here. Its
 * document count gets its own separate display instead (see the "Add-ons"
 * stat next to "N plans"/"M resources"). Also excludes any roster entry
 * that's really an individual add-on's own product name rather than a base
 * plan/variant (see isAddOnOnlyPlanName) — those stay visible only in the
 * Add-ons section below, not counted or listed as a plan.
 *
 * Also excludes a disabled plan name (category.disabledPlanNames) — a
 * genuine, DB-backed enable/disable rather than the roster-removal-based
 * "delete" this used to conflate: removing a name from planNames outright
 * only ever half-worked when resources were still tagged with it (this
 * function would immediately resynthesize it from those tags, making the
 * admin's "delete" look like a no-op) — see removeCategoryPlanName below.
 * A name in disabledPlanNames is intentionally still resolvable elsewhere
 * (e.g. still valid on already-tagged resources) but hidden from this
 * "active plans" list and from Product Assist's plan-scope picker
 * (server.ts's /api/query-assist/categories applies the same filter). */
function planNamesForCategory(category: KbCategory, catResources: KbResource[]): string[] {
  const names = [...category.planNames];
  for (const r of catResources) {
    for (const tag of r.planTags) {
      if (!names.includes(tag)) names.push(tag);
    }
  }
  const disabledLower = new Set(category.disabledPlanNames.map(n => n.toLowerCase()));
  return realPlanNames(names)
    .filter(n => !isAddOnOnlyPlanName(n, catResources))
    .filter(n => !disabledLower.has(n.toLowerCase()));
}

/** Resource count for a disabled plan name — shown in the collapsed
 * "Disabled plans" list so an admin can see at a glance whether re-enabling
 * (or genuinely deleting) makes sense, without expanding anything. */
function disabledPlanResourceCount(name: string, catResources: KbResource[]): number {
  return resourcesForPlanKey(catResources, normalizePlanKey(name)).length;
}

function countByDocType(list: KbResource[]): Record<KbDocumentType, number> {
  const counts: Record<KbDocumentType, number> = { policy_wording: 0, prospectus: 0, brochure: 0, addon: 0, other: 0 };
  for (const r of list) counts[r.documentType]++;
  return counts;
}

interface KnowledgeBaseResourceManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * "Ask the Playbook" Knowledge Base — category + resource admin UI.
 *
 * Hierarchy is Insurer -> Plans -> Resources: each insurer category expands
 * into a Plans view by default (compact rows with per-plan resource counts,
 * expandable into that plan's resources grouped by document type), plus
 * All Resources / Policy Wordings / Prospectuses / Brochures / Add-ons tabs
 * for flat document management. "Plans" here are not a separate DB entity —
 * they're derived from category.planNames (the admin-curated roster) and
 * which resources are tagged with them (see planNamesForCategory/
 * resourceAppliesToPlan above); an untagged resource applies to every plan.
 *
 * Resources can be added two ways: uploading a PDF (extracted, chunked, and
 * embedded server-side via src/server/knowledgeBase/pdfIngest.ts), or
 * pasting a URL — a hosted PDF or an ordinary web article — which
 * webIngest.ts auto-detects and routes through the matching pipeline. Both
 * flows are reached through one "Add Document" modal per insurer. Live
 * Google Sheet ingestion is a separate, already-built flow (the Product
 * Playbook — see ConnectionsPage.tsx).
 */
export function KnowledgeBaseResourceManagement({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseResourceManagementProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Unknown",
        role: effectiveTier,
        actionType,
        planName: "Knowledge Base",
        description,
      },
      ...prev,
    ]);
  };

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [resources, setResources] = useState<KbResource[]>([]);
  // insurerName (lowercased/trimmed) -> plan names, sourced live from
  // /api/plan-configs (the same DB-backed source Plan Management edits) —
  // used only to suggest quick-add tag chips per insurer category; admins
  // can still type any custom tag (insurers sell plans beyond this app's 6
  // deterministic-engine plans, e.g. HDFC ERGO's "my:health Medisure").
  const [plansByInsurer, setPlansByInsurer] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [activeTabByCategory, setActiveTabByCategory] = useState<Record<number, TabKey>>({});
  const [expandedPlanByCategory, setExpandedPlanByCategory] = useState<Record<number, string | null>>({});

  // ── Toolbar: search, insurer filter, status filter ──────────────────────
  const [search, setSearch] = useState("");
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<KbResourceStatus>>(new Set(STATUS_VALUES));
  const toggleStatusFilter = (s: KbResourceStatus) => {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [catRes, resRes, planRes] = await Promise.all([
        fetch("/api/kb/categories"),
        fetch("/api/kb/resources"),
        fetch("/api/plan-configs"),
      ]);
      const catBody = await catRes.json().catch(() => ({}));
      const resBody = await resRes.json().catch(() => ({}));
      const planBody = await planRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catBody.error || `Failed to load categories (HTTP ${catRes.status}).`);
      if (!resRes.ok) throw new Error(resBody.error || `Failed to load resources (HTTP ${resRes.status}).`);
      setCategories(catBody.entries || []);
      setResources(resBody.entries || []);
      const grouped: Record<string, string[]> = {};
      for (const p of (planBody.entries || []) as { planName: string; insurerName?: string }[]) {
        if (!p.insurerName) continue;
        const key = p.insurerName.trim().toLowerCase();
        if (!grouped[key]) grouped[key] = [];
        if (!grouped[key].includes(p.planName)) grouped[key].push(p.planName);
      }
      setPlansByInsurer(grouped);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load the Knowledge Base.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Add insurer/category ────────────────────────────────────────────────
  const [addInsurerOpen, setAddInsurerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] = useState<"insurer" | "general">("insurer");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) { setSaveError("Enter a category name before adding it."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/kb/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: newCategoryType, sortOrder: newCategoryType === "general" ? 999 : 0 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add category (HTTP ${res.status}).`);
      logAction("Knowledge Base Category Added", `Added "${body.category.name}" (${body.category.type}).`);
      setAddInsurerOpen(false);
      setNewCategoryName("");
      setNewCategoryType("insurer");
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to add category. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: KbCategory) => {
    // Deliberately checked against the FULL, unfiltered resources list (not
    // the status/search-filtered view) — the status filter is a display
    // convenience only, and must never let a category with hidden-by-filter
    // resources look empty and get deleted.
    const inCategory = resources.filter(r => r.categoryId === category.id);
    if (inCategory.length > 0) {
      window.alert(`"${category.name}" has ${inCategory.length} resource(s) in it. Delete or move those first.`);
      return;
    }
    if (!window.confirm(`Delete the "${category.name}" category?`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/categories/${category.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete category (HTTP ${res.status}).`);
      logAction("Knowledge Base Category Deleted", `Deleted "${category.name}".`);
      if (expandedCategoryId === category.id) setExpandedCategoryId(null);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete category. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Manage this category's plan-name roster (the suggestion source for
  //    tagging its documents, and the Plans tab's row list) ────────────────
  const [categoryPlanInputById, setCategoryPlanInputById] = useState<Record<number, string>>({});
  const [categoryPlanSavingId, setCategoryPlanSavingId] = useState<number | null>(null);

  const saveCategoryFields = async (category: KbCategory, patch: Partial<Pick<KbCategory, "planNames" | "disabledPlanNames">>) => {
    setCategoryPlanSavingId(category.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update plan names (HTTP ${res.status}).`);
      setCategories(prev => prev.map(c => (c.id === category.id ? body.category : c)));
    } catch (err: any) {
      setSaveError(err.message || "Failed to update plan names. Please try again.");
    } finally {
      setCategoryPlanSavingId(null);
    }
  };

  const addCategoryPlanName = (category: KbCategory, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (category.planNames.some(n => n.toLowerCase() === name.toLowerCase())) {
      setCategoryPlanInputById(prev => ({ ...prev, [category.id]: "" }));
      return;
    }
    const nextNames = [...category.planNames, name];
    // Adding a name that was previously disabled re-enables it in one step.
    const nextDisabled = category.disabledPlanNames.filter(n => n.toLowerCase() !== name.toLowerCase());
    logAction("Knowledge Base Plan Added", `Added plan "${name}" under "${category.name}".`);
    setCategoryPlanInputById(prev => ({ ...prev, [category.id]: "" }));
    saveCategoryFields(category, { planNames: nextNames, disabledPlanNames: nextDisabled });
  };

  /** True delete vs disable, decided by whether any resource in this
   * category is still tagged with this plan name — never a silent no-op
   * either way (see planNamesForCategory's doc comment for why the old
   * behavior looked broken/"can't delete this plan"). Zero resources
   * tagged: genuinely removes the roster entry. One or more tagged:
   * disables the plan instead of a destructive removal — hides it from
   * counts/pickers/Product Assist's scope selector, keeps every resource's
   * tag exactly as-is, fully reversible via "Enable". */
  const removeCategoryPlanName = (category: KbCategory, name: string, catResources: KbResource[]) => {
    const nextNames = category.planNames.filter(n => n.toLowerCase() !== name.toLowerCase());
    const taggedCount = disabledPlanResourceCount(name, catResources);
    if (taggedCount > 0) {
      const nextDisabled = category.disabledPlanNames.some(n => n.toLowerCase() === name.toLowerCase())
        ? category.disabledPlanNames
        : [...category.disabledPlanNames, name];
      logAction(
        "Knowledge Base Plan Disabled",
        `Disabled plan "${name}" under "${category.name}" — ${taggedCount} resource(s) are still tagged with it, so it wasn't deleted.`
      );
      saveCategoryFields(category, { planNames: nextNames, disabledPlanNames: nextDisabled });
      return;
    }
    logAction("Knowledge Base Plan Deleted", `Deleted plan "${name}" from "${category.name}".`);
    saveCategoryFields(category, { planNames: nextNames });
  };

  const enableCategoryPlanName = (category: KbCategory, name: string) => {
    const nextDisabled = category.disabledPlanNames.filter(n => n.toLowerCase() !== name.toLowerCase());
    const nextNames = category.planNames.some(n => n.toLowerCase() === name.toLowerCase())
      ? category.planNames
      : [...category.planNames, name];
    logAction("Knowledge Base Plan Enabled", `Re-enabled plan "${name}" under "${category.name}".`);
    saveCategoryFields(category, { planNames: nextNames, disabledPlanNames: nextDisabled });
  };

  // ── Rename a plan — atomic on the server (roster entry + every tagged
  //    resource's planTags together, see /api/kb/categories/:id/rename-plan)
  //    since a client-only "remove old, add new" would strand every already-
  //    tagged resource under the now-gone old name. ─────────────────────────
  const [renamingPlan, setRenamingPlan] = useState<{ categoryId: number; oldName: string; value: string } | null>(null);
  const [renameSavingId, setRenameSavingId] = useState<number | null>(null);

  const submitRenamePlan = async () => {
    if (!renamingPlan) return;
    const newName = renamingPlan.value.trim();
    if (!newName || newName.toLowerCase() === renamingPlan.oldName.toLowerCase()) {
      setRenamingPlan(null);
      return;
    }
    setRenameSavingId(renamingPlan.categoryId);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/categories/${renamingPlan.categoryId}/rename-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName: renamingPlan.oldName, newName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to rename plan (HTTP ${res.status}).`);
      logAction("Knowledge Base Plan Renamed", `Renamed plan "${renamingPlan.oldName}" to "${newName}".`);
      if (body.warning) setSaveError(body.warning);
      await load(); // rename touches both categories and resources — simplest correct refresh
      setRenamingPlan(null);
    } catch (err: any) {
      setSaveError(err.message || "Failed to rename plan. Please try again.");
    } finally {
      setRenameSavingId(null);
    }
  };

  // ── Add Document (upload PDF or add by URL — a hosted policy-wording PDF,
  //    or an ordinary web article like an insurer's "how to claim" guide;
  //    see webIngest.ts, which auto-detects which of the two a URL is) ─────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addDocModalCategoryId, setAddDocModalCategoryId] = useState<number | null>(null);
  const [uploadTargetCategoryId, setUploadTargetCategoryId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Which document type (Brochure/Policy Wording/Prospectus/Add-on/Other)
  // the NEXT upload or "add by URL" for a given category should be tagged
  // with — set inside the "Add Document" modal, defaulting to "other" per
  // kb_resources.document_type's own column default.
  const [pendingDocTypeByCategory, setPendingDocTypeByCategory] = useState<Record<number, KbDocumentType>>({});
  const pendingDocType = (categoryId: number): KbDocumentType => pendingDocTypeByCategory[categoryId] || "other";

  const triggerUpload = (categoryId: number) => {
    setUploadTargetCategoryId(categoryId);
    setUploadError(null);
    setUploadSuccess(null);
    setAddDocModalCategoryId(null);
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || uploadTargetCategoryId === null) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("categoryId", String(uploadTargetCategoryId));
      formData.append("title", file.name);
      formData.append("documentType", pendingDocType(uploadTargetCategoryId));
      const res = await fetch("/api/kb/resources/upload", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to process "${file.name}" (HTTP ${res.status}).`);
      const category = categories.find(c => c.id === uploadTargetCategoryId);
      logAction("Knowledge Base Document Added", `Uploaded "${file.name}" to "${category?.name || "a category"}" — ${body.chunkCount} chunk(s) embedded.`);
      setUploadSuccess(`"${file.name}" processed — ${body.chunkCount} chunk(s) embedded.`);
      await load();
    } catch (err: any) {
      setUploadError(err.message || `Failed to process "${file.name}".`);
    } finally {
      setUploading(false);
    }
  };

  const [addUrlTitle, setAddUrlTitle] = useState("");
  const [addUrlValue, setAddUrlValue] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [addUrlError, setAddUrlError] = useState<string | null>(null);
  const [addUrlSuccess, setAddUrlSuccess] = useState<string | null>(null);

  const openAddDocument = (categoryId: number) => {
    setAddDocModalCategoryId(categoryId);
    setAddUrlError(null);
    setAddUrlSuccess(null);
    setAddUrlTitle("");
    setAddUrlValue("");
  };

  const submitAddUrl = async () => {
    if (addDocModalCategoryId === null) return;
    const categoryId = addDocModalCategoryId;
    const url = addUrlValue.trim();
    if (!url) { setAddUrlError("Paste a URL before adding it."); return; }
    setAddingUrl(true);
    setAddUrlError(null);
    setAddUrlSuccess(null);
    try {
      const res = await fetch("/api/kb/resources/add-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          categoryId,
          title: addUrlTitle.trim() || undefined,
          documentType: pendingDocType(categoryId),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to process the URL (HTTP ${res.status}).`);
      const category = categories.find(c => c.id === categoryId);
      const kindLabel = body.detectedType === "pdf" ? "PDF" : "web page";
      logAction("Knowledge Base Document Added", `Added ${kindLabel} "${body.resource.title}" (${url}) to "${category?.name || "a category"}" — ${body.chunkCount} chunk(s) embedded.`);
      setAddUrlSuccess(`Added — ${body.chunkCount} chunk(s) embedded from the ${kindLabel}.`);
      setAddUrlTitle("");
      setAddUrlValue("");
      setAddDocModalCategoryId(null);
      await load();
    } catch (err: any) {
      setAddUrlError(err.message || "Failed to add this URL.");
    } finally {
      setAddingUrl(false);
    }
  };

  const [changingDocTypeResourceId, setChangingDocTypeResourceId] = useState<number | null>(null);

  const changeDocumentType = async (resource: KbResource, newType: KbDocumentType) => {
    if (newType === resource.documentType) return;
    setChangingDocTypeResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: newType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update document type (HTTP ${res.status}).`);
      logAction("Knowledge Base Document Type Changed", `Set "${resource.title}" to ${DOCUMENT_TYPE_LABEL[newType]}.`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to update document type. Please try again.");
    } finally {
      setChangingDocTypeResourceId(null);
    }
  };

  const [movingResourceId, setMovingResourceId] = useState<number | null>(null);

  const moveResource = async (resource: KbResource, newCategoryId: number) => {
    if (newCategoryId === resource.categoryId) return;
    const fromName = categories.find(c => c.id === resource.categoryId)?.name || "Unknown";
    const toName = categories.find(c => c.id === newCategoryId)?.name || "Unknown";
    setMovingResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: newCategoryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to move resource (HTTP ${res.status}).`);
      logAction("Knowledge Base Document Moved", `Moved "${resource.title}" from "${fromName}" to "${toName}".`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to move document. Please try again.");
    } finally {
      setMovingResourceId(null);
    }
  };

  // ── Plan tags (multi-plan tagging within an insurer category) ──────────
  const [tagInputByResource, setTagInputByResource] = useState<Record<number, string>>({});
  const [tagSavingResourceId, setTagSavingResourceId] = useState<number | null>(null);

  const saveTags = async (resource: KbResource, nextTags: string[]) => {
    setTagSavingResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTags: nextTags }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update tags (HTTP ${res.status}).`);
      setResources(prev => prev.map(r => (r.id === resource.id ? body.resource : r)));
    } catch (err: any) {
      setSaveError(err.message || "Failed to update plan tags. Please try again.");
    } finally {
      setTagSavingResourceId(null);
    }
  };

  const addPlanTag = (resource: KbResource, rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag) return;
    if (resource.planTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      setTagInputByResource(prev => ({ ...prev, [resource.id]: "" }));
      return;
    }
    const nextTags = [...resource.planTags, tag];
    logAction("Knowledge Base Document Tagged", `Tagged "${resource.title}" with "${tag}".`);
    setTagInputByResource(prev => ({ ...prev, [resource.id]: "" }));
    saveTags(resource, nextTags);
  };

  const removePlanTag = (resource: KbResource, tag: string) => {
    const nextTags = resource.planTags.filter(t => t !== tag);
    logAction("Knowledge Base Document Untagged", `Removed "${tag}" from "${resource.title}".`);
    saveTags(resource, nextTags);
  };

  // ── Insurer Resources — a document that isn't tied to any one plan (claim
  //    process, general claim guidelines, insurer-wide processes). Setting
  //    this also clears any existing plan tags server-side (see the PATCH
  //    /api/kb/resources/:id route) so a resource is never simultaneously
  //    "insurer-level" and "tagged to plan X" — an incoherent state. ───────
  const toggleInsurerLevel = async (resource: KbResource, next: boolean) => {
    setTagSavingResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isInsurerLevel: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update resource (HTTP ${res.status}).`);
      logAction(
        next ? "Knowledge Base Resource Marked Insurer-Level" : "Knowledge Base Resource Unmarked Insurer-Level",
        `"${resource.title}" ${next ? "moved to" : "removed from"} ${categories.find(c => c.id === resource.categoryId)?.name || "its insurer"}'s Insurer Resources.`
      );
      setResources(prev => prev.map(r => (r.id === resource.id ? body.resource : r)));
    } catch (err: any) {
      setSaveError(err.message || "Failed to update resource. Please try again.");
    } finally {
      setTagSavingResourceId(null);
    }
  };

  const deleteResource = async (resource: KbResource) => {
    if (!window.confirm(`Delete "${resource.title}" from the Knowledge Base? This cannot be undone.`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete resource (HTTP ${res.status}).`);
      logAction("Knowledge Base Document Deleted", `Deleted "${resource.title}".`);
      if (editingResourceId === resource.id) setEditingResourceId(null);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete resource. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Resource edit modal (doc type / plan tags / move / delete, all in
  //    one place instead of scattered inline row controls) ────────────────
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null);
  const editingResource = resources.find(r => r.id === editingResourceId) ?? null;
  const editingCategory = editingResource ? categories.find(c => c.id === editingResource.categoryId) ?? null : null;

  // Cross-app UI consistency pass (2026-08): on --input-bg/-border/-text/
  // --focus-ring tokens (the same pair a CustomSelect trigger now uses —
  // see CustomSelect.tsx) instead of a hardcoded per-theme ternary, so a
  // text field and a dropdown trigger read as one control family and this
  // page's inputs pick up the same dark-theme contrast pass automatically.
  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";
  // The per-insurer outer wrapper reads as the "most raised" tier in the
  // light theme's actual elevation ladder (see index.css's --surface/
  // -elevated/-inset/-tint comment) plus a soft card shadow, instead of the
  // flat bg-white every other bordered box here also used — that flatness
  // (insurer card, plan row, and resource row all effectively white-on-white)
  // was the light theme's specific "looks too flat" problem. Dark theme is
  // left exactly as it was; it already reads fine.
  const insurerCardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface border-[var(--border-strong)] shadow-card";

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading Knowledge Base…</div>;
  }

  const searchLower = search.trim().toLowerCase();
  const categoryMatchesSearch = (category: KbCategory, catResources: KbResource[]): boolean => {
    if (!searchLower) return true;
    if (category.name.toLowerCase().includes(searchLower)) return true;
    if (category.planNames.some(p => p.toLowerCase().includes(searchLower))) return true;
    if (catResources.some(r => r.title.toLowerCase().includes(searchLower))) return true;
    return false;
  };
  const resourceMatchesSearch = (r: KbResource) => !searchLower || r.title.toLowerCase().includes(searchLower);

  const visibleCategories = categories.filter(c => {
    if (insurerFilter !== "all" && String(c.id) !== insurerFilter) return false;
    const catResources = resources.filter(r => r.categoryId === c.id);
    return categoryMatchesSearch(c, catResources);
  });

  const insurerFilterOptions = [{ value: "all", label: "All Insurers" }, ...categories.map(c => ({ value: String(c.id), label: c.name }))];

  return (
    <div className="space-y-4 pb-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChosen} />

      {loadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}
      {saveError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
        </div>
      )}
      {uploadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {uploadSuccess}
        </div>
      )}
      {uploading && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-sky-500/10 border-sky-500/30 text-sky-300" : "bg-sky-50 border-sky-200 text-sky-700"}`}>
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" /> Extracting, chunking, and embedding — this can take a minute for a long policy wording PDF.
        </div>
      )}

      {/* Compact "Add Insurer" action, replacing the old always-open, mostly
          empty "Add Category" card — right-aligned directly under the page
          title so it reads as the page's one primary action. */}
      {canManage && (
        <div className="flex justify-end">
          <ClippedButton size="md" onClick={() => setAddInsurerOpen(true)} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Add Insurer
          </ClippedButton>
        </div>
      )}

      {/* Toolbar — search + insurer filter + status filter, all real,
          client-side filters over the already-loaded categories/resources. */}
      <div className={`rounded-xl border p-3 flex flex-col gap-3 ${cardClass}`}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search insurers, plans or documents…"
              className={`${inputClass} pl-8`}
            />
          </div>
          <div className="w-full sm:w-56">
            <CustomSelect theme={theme} value={insurerFilter} onChange={setInsurerFilter} options={insurerFilterOptions} />
          </div>
          <ClippedButton
            size="md"
            title="Filter by document status"
            onClick={() => setFilterPanelOpen(v => !v)}
            className={`px-3 py-2 shrink-0 ${
              filterPanelOpen || statusFilter.size < STATUS_VALUES.length
                ? dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"
                : dark ? "bg-white/[0.06] text-stone-300" : "bg-stone-100 text-stone-600"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
          </ClippedButton>
        </div>
        {filterPanelOpen && (
          <div className={`flex flex-wrap items-center gap-2 pt-2.5 border-t ${dark ? "border-white/[0.06]" : "border-[var(--border)]"}`}>
            <span className="text-[10px] font-bold uppercase tracking-wide text-content-muted">Status</span>
            {STATUS_VALUES.map(s => {
              const active = statusFilter.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-colors cursor-pointer ${
                    active
                      ? dark ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"
                      : dark ? "bg-transparent text-stone-500 border-white/[0.1]" : "bg-transparent text-stone-400 border-stone-200"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {categories.length === 0 && (
          <div className="text-xs font-semibold text-content-muted py-8 text-center">No insurers yet — add one above to start uploading documents.</div>
        )}
        {categories.length > 0 && visibleCategories.length === 0 && (
          <div className="text-xs font-semibold text-content-muted py-8 text-center">No insurers or documents match your search/filters.</div>
        )}
        {visibleCategories.map(category => {
          const catResourcesAll = resources.filter(r => r.categoryId === category.id);
          const catResources = catResourcesAll.filter(r => statusFilter.has(r.status));
          const expanded = expandedCategoryId === category.id;
          const logoSrc = category.type === "insurer" ? INSURER_LOGOS[category.name] : undefined;
          const accent = category.type === "insurer" ? INSURER_ACCENT_COLOR[category.name] : undefined;
          const accentColor = accent ? (dark ? accent.dark : accent.light) : undefined;
          const planNames = category.type === "insurer" ? planNamesForCategory(category, catResources) : [];
          const families = category.type === "insurer" ? buildPlanFamilies(planNames, catResources) : [];
          const docTypeCounts = countByDocType(catResources);
          const activeTab: TabKey = activeTabByCategory[category.id] ?? (category.type === "insurer" ? "plans" : "all");
          const setActiveTab = (tab: TabKey) => setActiveTabByCategory(prev => ({ ...prev, [category.id]: tab }));
          const expandedPlan = expandedPlanByCategory[category.id] ?? null;
          const insurerLevelResources = catResources.filter(r => r.isInsurerLevel);
          const tabs: { key: TabKey; label: string }[] = [
            ...(category.type === "insurer" ? [{ key: "plans" as TabKey, label: "Plans" }] : []),
            ...DOC_TYPE_TABS.map(t => ({ key: t.value as TabKey, label: t.tabLabel })),
            { key: "all", label: "All Resources" },
            ...(category.type === "insurer"
              ? [{ key: "insurer_resources" as TabKey, label: `Insurer Resources${insurerLevelResources.length > 0 ? ` (${insurerLevelResources.length})` : ""}` }]
              : []),
          ];

          return (
            <div
              key={category.id}
              className={`rounded-2xl border overflow-hidden transition-colors ${insurerCardClass}`}
              style={expanded && accentColor ? { borderColor: accentColor, boxShadow: `inset 3px 0 0 0 ${accentColor}` } : undefined}
            >
              <button
                type="button"
                onClick={() => setExpandedCategoryId(expanded ? null : category.id)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-900/[0.025]"}`}
                style={expanded && accentColor ? { backgroundColor: hexToRgba(accentColor, dark ? 0.08 : 0.06) } : undefined}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-content-muted" /> : <ChevronRight className="w-4 h-4 shrink-0 text-content-muted" />}
                  {/* Fixed-width/height box so every insurer's name starts at
                      the exact same x position regardless of that insurer's
                      own logo aspect ratio (they range from ~1.3:1 to
                      ~3.2:1 natively — see insurerLogos.ts). */}
                  <div className="w-9 h-6 shrink-0 flex items-center justify-center">
                    {logoSrc ? (
                      <img src={logoSrc} alt={category.name} className="max-w-full max-h-full object-contain" />
                    ) : category.type === "general" ? (
                      // "Org Constitution" (the renamed "General / Others"
                      // section, spec §3/§4): same visual ROLE insurer logos
                      // occupy for insurer rows, using the app's existing
                      // Ditto wordmark asset rather than a generic folder icon.
                      <DittoWordmark className="max-w-full max-h-full" imgStyle={{ maxHeight: "20px" }} isWhite={dark} />
                    ) : (
                      <Folder className="w-4 h-4 text-content-muted" />
                    )}
                  </div>
                  <span className={`text-sm font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{category.name}</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {category.type === "insurer" && (
                    <span className="text-[10.5px] font-semibold text-content-muted whitespace-nowrap">{families.length} plan{families.length === 1 ? "" : "s"}</span>
                  )}
                  {category.type === "insurer" && docTypeCounts.addon > 0 && (
                    <span className="text-[10.5px] font-semibold text-content-muted whitespace-nowrap">{docTypeCounts.addon} add-on{docTypeCounts.addon === 1 ? "" : "s"}</span>
                  )}
                  <span className="text-[10.5px] font-semibold text-content-muted whitespace-nowrap">{catResourcesAll.length} resource{catResourcesAll.length === 1 ? "" : "s"}</span>
                </div>
              </button>

              {expanded && (
                <div className={`px-4 pb-4 pt-3 border-t ${dark ? "border-white/[0.06]" : "border-[var(--border)]"}`}>
                  {/* Stats row — read-only counts plus the category's two
                      real actions (refresh, add document); delete is a
                      separate, visually distinct destructive action. */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {category.type === "insurer" && <StatPill label={`Plan${families.length === 1 ? "" : "s"}`} value={families.length} dark={dark} />}
                    <StatPill label={`Resource${catResourcesAll.length === 1 ? "" : "s"}`} value={catResourcesAll.length} dark={dark} />
                    {DOC_TYPE_TABS.map(t => (
                      <div key={t.value} className="contents">
                        <StatPill label={t.tabLabel} value={docTypeCounts[t.value]} dark={dark} />
                      </div>
                    ))}
                    <div className="flex-1" />
                    <ClippedButton size="sm" title="Refresh from the database" onClick={load} className={dark ? "bg-white/[0.06] text-stone-300 px-2.5 py-1.5" : "bg-stone-100 text-stone-600 px-2.5 py-1.5"}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </ClippedButton>
                    {canManage && (
                      <>
                        <ClippedButton size="sm" title="Add a document to this insurer" onClick={() => openAddDocument(category.id)} className={dark ? "bg-sky-500/15 text-sky-300 px-2.5 py-1.5" : "bg-sky-50 text-sky-700 px-2.5 py-1.5"}>
                          <Plus className="w-3.5 h-3.5" />
                        </ClippedButton>
                        <ClippedButton size="sm" title="Delete category" onClick={() => deleteCategory(category)} className={dark ? "bg-red-500/15 text-red-300 px-2.5 py-1.5" : "bg-red-50 text-red-700 px-2.5 py-1.5"}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </ClippedButton>
                      </>
                    )}
                  </div>

                  {/* Tab row */}
                  <div className={`flex items-center gap-1 border-b mb-3 overflow-x-auto ${dark ? "border-white/[0.08]" : "border-[var(--border-strong)]"}`}>
                    {tabs.map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setActiveTab(t.key)}
                        className={`px-3 py-2 text-[11px] font-bold whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer ${
                          activeTab === t.key
                            ? dark ? "border-sky-400 text-white" : "border-sky-600 text-stone-900"
                            : dark ? "border-transparent text-stone-500 hover:text-stone-300" : "border-transparent text-stone-400 hover:text-stone-600"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  {activeTab === "plans" && category.type === "insurer" ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <SectionLabel dark={dark}>Plans</SectionLabel>
                        <div className="flex flex-col gap-1.5 mt-2">
                          {families.length === 0 && (
                            <div className="text-[11px] font-semibold text-content-muted py-4 text-center">No plans yet — add one below.</div>
                          )}
                          {families.map(family => {
                            const familyResourcesSearched: PlanFamily = {
                              rootName: family.rootName,
                              baseResources: family.baseResources.filter(resourceMatchesSearch),
                              variants: family.variants.map(v => ({ name: v.name, resources: v.resources.filter(resourceMatchesSearch) })),
                            };
                            const familyExpanded = expandedPlan === family.rootName;
                            const isRenamingThis = renamingPlan?.categoryId === category.id && renamingPlan.oldName === family.rootName;
                            return (
                              <div key={family.rootName} className="contents">
                                {isRenamingThis ? (
                                  <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${dark ? "bg-white/[0.04] border-white/[0.1]" : "bg-white border-stone-300"}`}>
                                    <input
                                      autoFocus
                                      value={renamingPlan.value}
                                      onChange={e => setRenamingPlan(prev => (prev ? { ...prev, value: e.target.value } : prev))}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") { e.preventDefault(); submitRenamePlan(); }
                                        if (e.key === "Escape") setRenamingPlan(null);
                                      }}
                                      disabled={renameSavingId === category.id}
                                      className={`flex-1 min-w-0 px-2 py-1 rounded text-[11px] font-bold border outline-none ${
                                        dark ? "bg-white/[0.04] border-white/[0.1] text-white" : "bg-white border-stone-300 text-stone-900"
                                      }`}
                                    />
                                    <ClippedButton size="sm" onClick={submitRenamePlan} disabled={renameSavingId === category.id} className={dark ? "bg-sky-500/15 text-sky-300 px-2 py-1" : "bg-sky-50 text-sky-700 px-2 py-1"}>
                                      Save
                                    </ClippedButton>
                                    <ClippedButton size="sm" onClick={() => setRenamingPlan(null)} disabled={renameSavingId === category.id} className={dark ? "bg-white/[0.06] text-stone-300 px-2 py-1" : "bg-stone-100 text-stone-600 px-2 py-1"}>
                                      Cancel
                                    </ClippedButton>
                                  </div>
                                ) : (
                                  <PlanFamilyRow
                                    family={familyResourcesSearched}
                                    dark={dark}
                                    expanded={familyExpanded}
                                    onToggle={() => setExpandedPlanByCategory(prev => ({ ...prev, [category.id]: familyExpanded ? null : family.rootName }))}
                                    canManage={canManage}
                                    onEditResource={r => setEditingResourceId(r.id)}
                                    onRenamePlanName={canManage ? (name: string) => setRenamingPlan({ categoryId: category.id, oldName: name, value: name }) : undefined}
                                    onRemovePlanName={canManage ? (name: string) => {
                                      const taggedCount = disabledPlanResourceCount(name, catResources);
                                      const message = taggedCount > 0
                                        ? `"${name}" still has ${taggedCount} resource(s) tagged to it, so it can't be deleted outright. Disable it instead? It'll disappear from the plan list and Product Assist's plan picker, but its tagged resources keep their tag and you can re-enable it any time.`
                                        : `Delete "${name}" from ${category.name}'s plan list? It has no resources tagged to it, so this fully removes the roster entry.`;
                                      if (window.confirm(message)) {
                                        removeCategoryPlanName(category, name, catResources);
                                      }
                                    } : undefined}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {category.disabledPlanNames.length > 0 && (
                        <div>
                          <SectionLabel dark={dark}>Disabled Plans</SectionLabel>
                          <div className="flex flex-col gap-1.5 mt-2">
                            {category.disabledPlanNames.map(name => {
                              const taggedCount = disabledPlanResourceCount(name, catResources);
                              return (
                                <div
                                  key={name}
                                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50 border-stone-200"}`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-[11px] font-bold truncate ${dark ? "text-stone-400" : "text-stone-500"}`}>{name}</span>
                                    <span className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-500 border-stone-200"}`}>
                                      Disabled
                                    </span>
                                    <span className="text-[9.5px] font-semibold text-content-muted whitespace-nowrap">{taggedCount} resource{taggedCount === 1 ? "" : "s"}</span>
                                  </div>
                                  {canManage && (
                                    <ClippedButton
                                      size="sm"
                                      onClick={() => enableCategoryPlanName(category, name)}
                                      disabled={categoryPlanSavingId === category.id}
                                      className={dark ? "bg-emerald-500/15 text-emerald-300 px-2 py-1" : "bg-emerald-50 text-emerald-700 px-2 py-1"}
                                    >
                                      Enable
                                    </ClippedButton>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {canManage && (
                        <div className={`flex flex-wrap items-center gap-1.5 pt-3 border-t ${dark ? "border-white/[0.06]" : "border-[var(--border)]"}`}>
                          <Tag className="w-3 h-3 shrink-0 text-content-muted" />
                          <input
                            value={categoryPlanInputById[category.id] || ""}
                            onChange={e => setCategoryPlanInputById(prev => ({ ...prev, [category.id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Enter") { e.preventDefault(); addCategoryPlanName(category, categoryPlanInputById[category.id] || ""); }
                            }}
                            placeholder="Add plan name…"
                            disabled={categoryPlanSavingId === category.id}
                            className={`w-36 px-2 py-1 rounded text-[10.5px] font-semibold border outline-none ${
                              dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400"
                            }`}
                          />
                          <ClippedButton
                            size="sm"
                            onClick={() => addCategoryPlanName(category, categoryPlanInputById[category.id] || "")}
                            disabled={categoryPlanSavingId === category.id}
                            className={dark ? "bg-white/[0.06] text-stone-300 px-2 py-1" : "bg-stone-100 text-stone-600 px-2 py-1"}
                          >
                            <Plus className="w-3 h-3" />
                          </ClippedButton>
                          {(plansByInsurer[category.name.trim().toLowerCase()] || [])
                            .filter(p => !category.planNames.some(n => n.toLowerCase() === p.toLowerCase()))
                            .map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => addCategoryPlanName(category, s)}
                                disabled={categoryPlanSavingId === category.id}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-semibold border border-dashed cursor-pointer transition-colors ${
                                  dark ? "text-stone-400 border-white/[0.15] hover:bg-white/[0.06]" : "text-stone-500 border-stone-300 hover:bg-stone-100"
                                }`}
                                title={`Quick-add "${s}" (from Plan Management)`}
                              >
                                <Plus className="w-2.5 h-2.5" /> {s}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : activeTab === "insurer_resources" ? (
                    <ResourceListTab
                      resources={catResources.filter(r => r.isInsurerLevel && resourceMatchesSearch(r))}
                      dark={dark}
                      canManage={canManage}
                      showDocTypeBadge
                      showPlanCount={false}
                      onEdit={r => setEditingResourceId(r.id)}
                      emptyLabel="No insurer-level documents yet — mark a document as an Insurer Resource from its edit panel (claim process, general claim guidelines, or any other document that isn't tied to one plan)."
                    />
                  ) : (
                    <ResourceListTab
                      resources={catResources.filter(r => (activeTab === "all" ? true : r.documentType === activeTab) && resourceMatchesSearch(r))}
                      dark={dark}
                      canManage={canManage}
                      showDocTypeBadge={activeTab === "all"}
                      showPlanCount={category.type === "insurer"}
                      onEdit={r => setEditingResourceId(r.id)}
                      emptyLabel={activeTab === "all" ? "No documents yet — use the + button above to add one." : "No documents of this type yet."}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {addInsurerOpen && (
        <AddInsurerModal
          theme={theme}
          name={newCategoryName}
          type={newCategoryType}
          saving={saving}
          error={saveError}
          onChangeName={setNewCategoryName}
          onChangeType={setNewCategoryType}
          onSubmit={addCategory}
          onClose={() => { setAddInsurerOpen(false); setNewCategoryName(""); setSaveError(null); }}
        />
      )}

      {addDocModalCategoryId !== null && (
        <AddDocumentModal
          theme={theme}
          categoryName={categories.find(c => c.id === addDocModalCategoryId)?.name || ""}
          documentType={pendingDocType(addDocModalCategoryId)}
          onChangeDocumentType={v => setPendingDocTypeByCategory(prev => ({ ...prev, [addDocModalCategoryId]: v }))}
          onChooseFile={() => triggerUpload(addDocModalCategoryId)}
          urlValue={addUrlValue}
          onChangeUrlValue={setAddUrlValue}
          titleValue={addUrlTitle}
          onChangeTitleValue={setAddUrlTitle}
          addingUrl={addingUrl}
          urlError={addUrlError}
          urlSuccess={addUrlSuccess}
          onSubmitUrl={submitAddUrl}
          onClose={() => setAddDocModalCategoryId(null)}
        />
      )}

      {editingResource && editingCategory && (
        <ResourceEditModal
          theme={theme}
          resource={editingResource}
          category={editingCategory}
          categories={categories}
          canManage={canManage}
          onClose={() => setEditingResourceId(null)}
          onChangeDocumentType={v => changeDocumentType(editingResource, v)}
          changingDocType={changingDocTypeResourceId === editingResource.id}
          onMove={v => moveResource(editingResource, v)}
          moving={movingResourceId === editingResource.id}
          tagInput={tagInputByResource[editingResource.id] || ""}
          onChangeTagInput={v => setTagInputByResource(prev => ({ ...prev, [editingResource.id]: v }))}
          onAddTag={t => addPlanTag(editingResource, t)}
          onRemoveTag={t => removePlanTag(editingResource, t)}
          tagSaving={tagSavingResourceId === editingResource.id}
          onToggleInsurerLevel={next => toggleInsurerLevel(editingResource, next)}
          onDelete={() => deleteResource(editingResource)}
        />
      )}
    </div>
  );
}

/** Small read-only count chip used in the per-insurer stats row. */
function StatPill({ label, value, dark }: { label: string; value: number; dark: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${dark ? "bg-white/[0.05] text-stone-300" : "bg-stone-100 text-stone-600"}`}>
      <span className={dark ? "text-white" : "text-stone-900"}>{value}</span> {label}
    </span>
  );
}

/** Small uppercase section divider ("Plans" / "Add-ons") — typography-only
 * differentiation, no extra background tier needed for something this
 * lightweight. The "addon" tone reuses the same orange this file already
 * uses for the Add-on document-type badge, so the label and the section it
 * introduces read as the same zone. */
function SectionLabel({ dark, tone, children }: { dark: boolean; tone?: "addon"; children: ReactNode }) {
  const color = tone === "addon" ? (dark ? "text-orange-300" : "text-orange-700") : dark ? "text-stone-400" : "text-content-muted";
  return <div className={`text-[10px] font-black uppercase tracking-wider ${color}`}>{children}</div>;
}

/** One plan family's summary row inside the Plans tab — a "base" plan name
 * (e.g. "Activ One") plus however many of its variants (e.g. "Activ One
 * Max", "Activ One NXT") the roster actually contains, per
 * buildPlanFamilies. A family with no variants renders identically to the
 * old flat per-plan row; one with variants nests them as their own
 * VariantGroup blocks instead of listing every variant as if it were an
 * unrelated plan. */
function PlanFamilyRow({
  family, dark, expanded, onToggle, canManage, onEditResource, onRemovePlanName, onRenamePlanName,
}: {
  family: PlanFamily;
  dark: boolean;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  onEditResource: (r: KbResource) => void;
  onRemovePlanName?: (name: string) => void;
  onRenamePlanName?: (name: string) => void;
}) {
  const hasVariants = family.variants.length > 0;
  const totalCount = familyResourceCount(family);
  const counts = familyDocTypeCounts(family);
  const nothingHere = family.baseResources.length === 0 && family.variants.every(v => v.resources.length === 0);

  return (
    <div className={`rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-surface-elevated border-[var(--border)]"}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-content-muted" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-content-muted" />}
          <FileText className="w-3.5 h-3.5 shrink-0 text-content-muted" />
          <span className={`text-[12.5px] font-bold truncate ${dark ? "text-stone-100" : "text-stone-900"}`}>{family.rootName}</span>
          {hasVariants && (
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${dark ? "bg-white/[0.06] text-stone-400" : "bg-stone-900/[0.05] text-content-muted"}`}>
              {family.variants.length} variant{family.variants.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">{totalCount} resource{totalCount === 1 ? "" : "s"}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {DOC_TYPE_TABS.filter(t => t.value !== "addon").map(t => (
            <span key={t.value} className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${dark ? "bg-white/[0.05] text-stone-400" : "bg-stone-900/[0.05] text-stone-500"}`}>
              {t.shortLabel} {counts[t.value]}
            </span>
          ))}
          {canManage && onRenamePlanName && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRenamePlanName(family.rootName); }}
              title={`Rename "${family.rootName}"`}
              className={`ml-1 p-1 rounded cursor-pointer ${dark ? "text-stone-500 hover:text-sky-400 hover:bg-sky-500/10" : "text-stone-400 hover:text-sky-600 hover:bg-sky-50"}`}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
          {canManage && onRemovePlanName && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemovePlanName(family.rootName); }}
              title={`Remove "${family.rootName}" from the plan list`}
              className={`p-1 rounded cursor-pointer ${dark ? "text-stone-500 hover:text-red-400 hover:bg-red-500/10" : "text-stone-400 hover:text-red-600 hover:bg-red-50"}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </button>
      {expanded && (
        <div className={`px-3 pb-3 pt-1 border-t space-y-2 ${dark ? "border-white/[0.06]" : "border-[var(--border)]"}`}>
          {nothingHere ? (
            <div className="text-[10.5px] font-semibold text-content-muted italic py-2">No resources apply to this plan yet.</div>
          ) : (
            <>
              {family.baseResources.length > 0 && (
                <div>
                  {hasVariants && <div className="text-[9.5px] font-bold uppercase tracking-wide text-content-muted mb-1">Base plan</div>}
                  <ResourceListTab
                    resources={family.baseResources}
                    dark={dark}
                    canManage={canManage}
                    showDocTypeBadge
                    showPlanCount={false}
                    onEdit={onEditResource}
                    compact
                  />
                </div>
              )}
              {family.variants.map(variant => (
                <div key={variant.name} className="contents">
                  <VariantGroup
                    variant={variant}
                    dark={dark}
                    canManage={canManage}
                    onEditResource={onEditResource}
                    onRemove={onRemovePlanName ? () => onRemovePlanName(variant.name) : undefined}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A single variant nested inside its family's expanded row — a visibly
 * "sunken" tier (surface-inset) with a left accent rail, one step deeper
 * than the family container it lives in (surface-elevated). */
function VariantGroup({
  variant, dark, canManage, onEditResource, onRemove,
}: {
  variant: PlanVariant;
  dark: boolean;
  canManage: boolean;
  onEditResource: (r: KbResource) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`rounded-md border border-l-2 px-2.5 py-2 ${
        dark ? "bg-white/[0.015] border-white/[0.05] border-l-white/[0.15]" : "bg-surface-inset border-[var(--border)] border-l-[var(--border-strong)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className={`text-[11px] font-bold truncate ${dark ? "text-stone-200" : "text-stone-800"}`}>{variant.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9.5px] font-semibold text-content-muted whitespace-nowrap">{variant.resources.length} resource{variant.resources.length === 1 ? "" : "s"}</span>
          {canManage && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              title={`Remove "${variant.name}" from the plan list`}
              className={`p-0.5 rounded cursor-pointer ${dark ? "text-stone-500 hover:text-red-400 hover:bg-red-500/10" : "text-stone-400 hover:text-red-600 hover:bg-red-50"}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {variant.resources.length === 0 ? (
        <div className="text-[10px] font-semibold text-content-muted italic py-1">No resources tagged to this variant yet.</div>
      ) : (
        <ResourceListTab
          resources={variant.resources}
          dark={dark}
          canManage={canManage}
          showDocTypeBadge
          showPlanCount={false}
          onEdit={onEditResource}
          compact
        />
      )}
    </div>
  );
}

/** Flat resource list — used by All Resources, each document-type tab, and
 * (in compact mode) each plan's grouped-by-document-type sections. Shows an
 * associated-plan COUNT instead of rendering every plan tag inline; the
 * full tag list lives in the edit modal now. */
function ResourceListTab({
  resources, dark, canManage, showDocTypeBadge, showPlanCount, onEdit, emptyLabel, compact,
}: {
  resources: KbResource[];
  dark: boolean;
  canManage: boolean;
  showDocTypeBadge: boolean;
  showPlanCount: boolean;
  onEdit: (r: KbResource) => void;
  emptyLabel?: string;
  compact?: boolean;
}) {
  if (resources.length === 0) {
    return <div className="text-[11px] font-semibold text-content-muted py-4 text-center">{emptyLabel || "Nothing here yet."}</div>;
  }
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {resources.map(resource => (
        <div key={resource.id} className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-3 ${dark ? "bg-white/[0.02] border-transparent" : "bg-surface border-[var(--border)]"}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-3.5 h-3.5 shrink-0 text-content-muted" />
            <span className={`text-xs font-semibold truncate ${dark ? "text-stone-200" : "text-stone-800"}`} title={resource.title}>{resource.title}</span>
            {statusBadge(resource.status, dark)}
            {showDocTypeBadge && documentTypeBadge(resource.documentType, dark)}
            {/* Ditto FAQ (2026-08): identifies the two supported FAQ
                categories directly on the resource row (spec §5/§21) — a
                live per-category breakdown lives on the Connections page's
                sync-status card (KnowledgeBaseFaqConnection.tsx); these are
                static presence badges, reusing the same badge visual
                language rather than a new UI pattern. */}
            {resource.title === "Ditto FAQ" && (
              <>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${dark ? "bg-sky-500/10 text-sky-300 border-sky-500/25" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                  Health Product FAQs
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${dark ? "bg-violet-500/10 text-violet-300 border-violet-500/25" : "bg-violet-50 text-violet-700 border-violet-200"}`}>
                  Operations Health FAQs
                </span>
              </>
            )}
            {showPlanCount && (
              <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">
                {resource.planTags.length === 0 ? "All plans" : `${resource.planTags.length} plan${resource.planTags.length === 1 ? "" : "s"}`}
              </span>
            )}
            {resource.sourceUrl && /^https?:\/\//i.test(resource.sourceUrl) && (
              <a
                href={resource.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open source document"
                className={`text-[10px] font-semibold underline whitespace-nowrap shrink-0 ${dark ? "text-sky-400 hover:text-sky-300" : "text-sky-600 hover:text-sky-700"}`}
              >
                Open
              </a>
            )}
            {resource.status === "active" && (
              <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">
                {resource.chunkCount} {resource.title === "Ditto FAQ" ? "FAQ records" : "chunks"}
              </span>
            )}
            {resource.status === "error" && resource.errorMessage && (
              <span className="text-[10px] font-semibold text-red-400 truncate" title={resource.errorMessage}>{resource.errorMessage}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onEdit(resource)}
            title={canManage ? "Edit document" : "View document details"}
            className={`shrink-0 p-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Shared modal chrome (overlay + centered card) — mirrors
 * SkillDomainPromptModal.tsx's pattern, the app's existing modal language. */
function ModalShell({ theme, onClose, widthClassName, children }: { theme: "light" | "dark"; onClose: () => void; widthClassName?: string; children: ReactNode }) {
  const dark = theme === "dark";
  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} onClick={onClose} />
      <div className={`relative w-full ${widthClassName || "max-w-md"} rounded-2xl border shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"}`}>
        {children}
      </div>
    </div>
  );
}

function AddInsurerModal({
  theme, name, type, saving, error, onChangeName, onChangeType, onSubmit, onClose,
}: {
  theme: "light" | "dark";
  name: string;
  type: "insurer" | "general";
  saving: boolean;
  error: string | null;
  onChangeName: (v: string) => void;
  onChangeType: (v: "insurer" | "general") => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const dark = theme === "dark";
  // Cross-app UI consistency pass (2026-08): on --input-bg/-border/-text/
  // --focus-ring tokens (the same pair a CustomSelect trigger now uses —
  // see CustomSelect.tsx) instead of a hardcoded per-theme ternary, so a
  // text field and a dropdown trigger read as one control family and this
  // page's inputs pick up the same dark-theme contrast pass automatically.
  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";
  return (
    <ModalShell theme={theme} onClose={onClose}>
      <div className={`px-5 pt-4 pb-3 border-b flex items-center justify-between ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Add Insurer</h2>
        <button type="button" onClick={onClose} className={dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        {error && <p className="text-[11px] font-semibold text-red-500">{error}</p>}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Category name</label>
          <input className={inputClass} value={name} onChange={e => onChangeName(e.target.value)} placeholder='e.g. "Bajaj Allianz" or "General / Others"' autoFocus />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Type</label>
          <CustomSelect theme={theme} value={type} onChange={v => onChangeType(v as "insurer" | "general")} options={[{ value: "insurer", label: "Insurer" }, { value: "general", label: "General / Others" }]} />
        </div>
      </div>
      <div className={`px-5 py-3 border-t flex items-center justify-end gap-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <ClippedButton size="md" onClick={onClose} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
          Cancel
        </ClippedButton>
        <ClippedButton size="md" onClick={onSubmit} disabled={saving} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
          {saving ? "Adding…" : "Add"}
        </ClippedButton>
      </div>
    </ModalShell>
  );
}

function AddDocumentModal({
  theme, categoryName, documentType, onChangeDocumentType, onChooseFile,
  urlValue, onChangeUrlValue, titleValue, onChangeTitleValue, addingUrl, urlError, urlSuccess, onSubmitUrl, onClose,
}: {
  theme: "light" | "dark";
  categoryName: string;
  documentType: KbDocumentType;
  onChangeDocumentType: (v: KbDocumentType) => void;
  onChooseFile: () => void;
  urlValue: string;
  onChangeUrlValue: (v: string) => void;
  titleValue: string;
  onChangeTitleValue: (v: string) => void;
  addingUrl: boolean;
  urlError: string | null;
  urlSuccess: string | null;
  onSubmitUrl: () => void;
  onClose: () => void;
}) {
  const dark = theme === "dark";
  const [mode, setMode] = useState<"upload" | "url">("upload");
  // Cross-app UI consistency pass (2026-08): on --input-bg/-border/-text/
  // --focus-ring tokens (the same pair a CustomSelect trigger now uses —
  // see CustomSelect.tsx) instead of a hardcoded per-theme ternary, so a
  // text field and a dropdown trigger read as one control family and this
  // page's inputs pick up the same dark-theme contrast pass automatically.
  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";
  return (
    <ModalShell theme={theme} onClose={onClose}>
      <div className={`px-5 pt-4 pb-3 border-b flex items-center justify-between ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <div>
          <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Add Document</h2>
          <p className="text-[10.5px] font-semibold text-content-muted mt-0.5">to {categoryName}</p>
        </div>
        <button type="button" onClick={onClose} className={dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Document type</label>
          <CustomSelect theme={theme} value={documentType} onChange={v => onChangeDocumentType(v as KbDocumentType)} options={DOCUMENT_TYPE_OPTIONS} />
        </div>

        <div className={`flex items-center gap-1 rounded-lg p-0.5 ${dark ? "bg-white/[0.04]" : "bg-stone-100"}`}>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`flex-1 py-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
              mode === "upload" ? (dark ? "bg-white/[0.1] text-white" : "bg-white text-stone-900 shadow-sm") : "text-content-muted"
            }`}
          >
            Upload PDF
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`flex-1 py-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
              mode === "url" ? (dark ? "bg-white/[0.1] text-white" : "bg-white text-stone-900 shadow-sm") : "text-content-muted"
            }`}
          >
            Add by URL
          </button>
        </div>

        {mode === "upload" ? (
          <div className="text-center py-4">
            <ClippedButton size="md" onClick={onChooseFile} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider inline-flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Choose PDF…
            </ClippedButton>
            <p className="text-[10.5px] font-semibold text-content-muted mt-2">Extraction, chunking, and embedding happen automatically after you pick a file.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {urlError && <div className={`text-[10.5px] font-semibold px-2.5 py-1.5 rounded ${dark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"}`}>{urlError}</div>}
            {urlSuccess && <div className={`text-[10.5px] font-semibold px-2.5 py-1.5 rounded ${dark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}>{urlSuccess}</div>}
            <div>
              <label className="block text-[9.5px] font-bold uppercase tracking-wide text-content-muted mb-1">URL</label>
              <input value={urlValue} onChange={e => onChangeUrlValue(e.target.value)} placeholder="https://…" disabled={addingUrl} className={inputClass} />
            </div>
            <div>
              <label className="block text-[9.5px] font-bold uppercase tracking-wide text-content-muted mb-1">Title (optional)</label>
              <input value={titleValue} onChange={e => onChangeTitleValue(e.target.value)} placeholder="Defaults to the page's own title" disabled={addingUrl} className={inputClass} />
            </div>
          </div>
        )}
      </div>
      <div className={`px-5 py-3 border-t flex items-center justify-end gap-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <ClippedButton size="md" onClick={onClose} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
          Close
        </ClippedButton>
        {mode === "url" && (
          <ClippedButton size="md" onClick={onSubmitUrl} disabled={addingUrl} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
            {addingUrl ? "Adding…" : "Add"}
          </ClippedButton>
        )}
      </div>
    </ModalShell>
  );
}

function ResourceEditModal({
  theme, resource, category, categories, canManage, onClose,
  onChangeDocumentType, changingDocType, onMove, moving,
  tagInput, onChangeTagInput, onAddTag, onRemoveTag, tagSaving, onToggleInsurerLevel, onDelete,
}: {
  theme: "light" | "dark";
  resource: KbResource;
  category: KbCategory;
  categories: KbCategory[];
  canManage: boolean;
  onClose: () => void;
  onChangeDocumentType: (v: KbDocumentType) => void;
  changingDocType: boolean;
  onMove: (categoryId: number) => void;
  moving: boolean;
  tagInput: string;
  onChangeTagInput: (v: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  tagSaving: boolean;
  onToggleInsurerLevel: (next: boolean) => void;
  onDelete: () => void;
}) {
  const dark = theme === "dark";
  // Disabled plans aren't offered as a quick-add suggestion — tagging a
  // resource with a plan an admin just disabled would immediately undo the
  // point of disabling it (Plans-tab counts would resynthesize it again).
  const disabledLower = new Set(category.disabledPlanNames.map(n => n.toLowerCase()));
  const suggestions = category.planNames
    .filter(p => !resource.planTags.some(t => t.toLowerCase() === p.toLowerCase()))
    .filter(p => !disabledLower.has(p.toLowerCase()));
  return (
    <ModalShell theme={theme} onClose={onClose} widthClassName="max-w-lg">
      <div className={`px-5 pt-4 pb-3 border-b flex items-center justify-between gap-3 ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <div className="min-w-0">
          <h2 className={`text-sm font-bold truncate ${dark ? "text-white" : "text-stone-900"}`} title={resource.title}>{resource.title}</h2>
          <div className="flex items-center gap-1.5 mt-1">
            {statusBadge(resource.status, dark)}
            {documentTypeBadge(resource.documentType, dark)}
            {resource.status === "active" && <span className="text-[10px] font-semibold text-content-muted">{resource.chunkCount} chunks</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} className={`shrink-0 ${dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}`}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {resource.status === "error" && resource.errorMessage && (
          <div className={`text-[11px] font-semibold px-2.5 py-1.5 rounded ${dark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"}`}>{resource.errorMessage}</div>
        )}
        {resource.sourceUrl && /^https?:\/\//i.test(resource.sourceUrl) && (
          <a href={resource.sourceUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-[11px] font-semibold underline ${dark ? "text-sky-400 hover:text-sky-300" : "text-sky-600 hover:text-sky-700"}`}>
            <Link2 className="w-3 h-3" /> Open source document
          </a>
        )}

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Document type</label>
          <CustomSelect theme={theme} value={resource.documentType} onChange={v => onChangeDocumentType(v as KbDocumentType)} options={DOCUMENT_TYPE_OPTIONS} disabled={!canManage || changingDocType} />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1 flex items-center gap-1"><ArrowLeftRight className="w-3 h-3" /> Category</label>
          <CustomSelect
            theme={theme}
            value={String(resource.categoryId)}
            onChange={v => onMove(Number(v))}
            options={categories.map(c => ({ value: String(c.id), label: c.name }))}
            disabled={!canManage || moving}
          />
        </div>

        {category.type === "insurer" && (
          <div>
            <label className={`flex items-center gap-2 text-[10.5px] font-semibold cursor-pointer ${dark ? "text-stone-300" : "text-stone-700"} ${!canManage ? "opacity-60 cursor-not-allowed" : ""}`}>
              <input
                type="checkbox"
                checked={resource.isInsurerLevel}
                onChange={e => onToggleInsurerLevel(e.target.checked)}
                disabled={!canManage || tagSaving}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              Insurer Resource (not tied to any one plan — claim process, general guidelines, company-wide docs)
            </label>
          </div>
        )}

        {category.type === "insurer" && !resource.isInsurerLevel && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1.5 flex items-center gap-1"><Tag className="w-3 h-3" /> Plans</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {resource.planTags.length === 0 && (
                <span className="text-[10.5px] font-semibold text-content-muted italic">No plan tags — applies to all {category.name} plans</span>
              )}
              {resource.planTags.map(tag => (
                <span key={tag} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[10.5px] font-bold border ${dark ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                  {tag}
                  {canManage && (
                    <button type="button" onClick={() => onRemoveTag(tag)} disabled={tagSaving} className="hover:opacity-70 cursor-pointer" title={`Remove "${tag}"`}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <input
                  value={tagInput}
                  onChange={e => onChangeTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAddTag(tagInput); } }}
                  placeholder="Add plan tag…"
                  disabled={tagSaving}
                  className={`w-32 px-1.5 py-1 rounded text-[10.5px] font-semibold border outline-none ${
                    dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400"
                  }`}
                />
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onAddTag(s)}
                    disabled={tagSaving}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-dashed cursor-pointer transition-colors ${
                      dark ? "text-stone-400 border-white/[0.15] hover:bg-white/[0.06]" : "text-stone-500 border-stone-300 hover:bg-stone-100"
                    }`}
                    title={`Quick-add "${s}"`}
                  >
                    <Plus className="w-2.5 h-2.5" /> {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {canManage && (
        <div className={`px-5 py-3 border-t flex items-center justify-between gap-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
          <ClippedButton size="md" onClick={onDelete} className={dark ? "bg-red-500/15 text-red-300 px-3 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5" : "bg-red-50 text-red-700 px-3 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5"}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </ClippedButton>
          <ClippedButton size="md" onClick={onClose} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
            Done
          </ClippedButton>
        </div>
      )}
    </ModalShell>
  );
}
