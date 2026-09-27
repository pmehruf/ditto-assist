/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Pencil, Trash2, Search, ShieldAlert, Info, MessageSquare, Power } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { SpecialInstructionFormModal } from "./SpecialInstructionFormModal";
import {
  INSTRUCTION_TYPE_OPTIONS,
  INSTRUCTION_TYPE_LABEL,
  EMPTY_SPECIAL_INSTRUCTION_FORM,
  type InstructionType,
  type KbCategoryLite,
  type SpecialInstructionEntry,
  type SpecialInstructionFormState,
} from "./specialInstructionTypes";

/** Override Rule gets the strongest visual treatment of the three — solid
 * fill + icon, not just a colored outline — since it's the only type with
 * real override authority over Product Assist's answers (see
 * specialInstructions.ts's precedence algorithm). */
function instructionTypeBadge(type: InstructionType, dark: boolean) {
  if (type === "override_rule") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wide border whitespace-nowrap ${
          dark ? "bg-red-500/20 text-red-300 border-red-500/40" : "bg-red-600 text-white border-red-700"
        }`}
      >
        <ShieldAlert className="w-3 h-3" />
        Override Rule
      </span>
    );
  }
  if (type === "additional_information") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${
          dark ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"
        }`}
      >
        <Info className="w-3 h-3" />
        Additional Info
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${
        dark ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : "bg-violet-50 text-violet-700 border-violet-200"
      }`}
    >
      <MessageSquare className="w-3 h-3" />
      General
    </span>
  );
}

function statusBadge(isActive: boolean, dark: boolean) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${
        isActive
          ? dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"
          : dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

interface SpecialInstructionsProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  /** Health/Term (2026-09) — which vertical this admin view is currently
   * scoped to, owned by KnowledgeBaseManagementPage's toggle. See
   * special_instructions.domain's schema.ts comment. */
  domain: "Health" | "Term";
}

/**
 * Knowledge Hub -> "Special Instructions" section. Per the feature spec,
 * ONLY Developer/Platform Admin may create/edit/activate-deactivate/delete
 * an instruction (narrower than the Documents tab's Admin+); every tier
 * that can see the Knowledge Hub at all may still view the list, since
 * "understand what instructions are currently active" (spec section 11) is
 * explicitly a shared reference need, not a write permission.
 *
 * This is purely a CRUD + reference UI — the actual precedence/matching
 * logic these rows drive lives server-side in
 * src/server/knowledgeBase/specialInstructions.ts and is invoked from
 * productAssist.ts before any normal retrieval, per SOURCE PRECEDENCE #0.
 */
export function SpecialInstructions({ theme, effectiveTier, currentUser, setChangeLogs, domain }: SpecialInstructionsProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Platform Admin" || effectiveTier === "Developer";

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

  const [categories, setCategories] = useState<KbCategoryLite[]>([]);
  const [entries, setEntries] = useState<SpecialInstructionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [catRes, instrRes] = await Promise.all([
        fetch(`/api/kb/categories?domain=${domain}`),
        fetch(`/api/kb/special-instructions?domain=${domain}`),
      ]);
      const catBody = await catRes.json().catch(() => ({}));
      const instrBody = await instrRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catBody.error || `Failed to load insurers (HTTP ${catRes.status}).`);
      if (!instrRes.ok) throw new Error(instrBody.error || `Failed to load Special Instructions (HTTP ${instrRes.status}).`);
      setCategories(catBody.entries || []);
      setEntries(instrBody.entries || []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load Special Instructions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [domain]);

  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const insurerCategories = useMemo(() => categories.filter(c => c.type === "insurer"), [categories]);

  // ── Search / filter (spec section 11) ────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | InstructionType>("all");
  const [insurerFilter, setInsurerFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (typeFilter !== "all" && e.instructionType !== typeFilter) return false;
      if (statusFilter === "active" && !e.isActive) return false;
      if (statusFilter === "inactive" && e.isActive) return false;
      if (insurerFilter !== "all") {
        if (insurerFilter === "none" ? e.insurerCategoryId !== null : e.insurerCategoryId !== Number(insurerFilter)) return false;
      }
      if (!q) return true;
      const insurerName = e.insurerCategoryId !== null ? categoryById.get(e.insurerCategoryId)?.name ?? "" : "";
      return (
        e.topic.toLowerCase().includes(q) ||
        e.instructionText.toLowerCase().includes(q) ||
        insurerName.toLowerCase().includes(q) ||
        (e.productPlanName || "").toLowerCase().includes(q)
      );
    });
  }, [entries, search, typeFilter, insurerFilter, statusFilter, categoryById]);

  // ── Add/Edit modal ────────────────────────────────────────────────────────
  // The form itself now lives in SpecialInstructionFormModal.tsx (shared
  // with ProductAssistQuotaPage.tsx's Unresolved Queries "Resolve" flow) —
  // this component only owns when it's open and with what initial state.
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<SpecialInstructionFormState>(EMPTY_SPECIAL_INSTRUCTION_FORM);

  const openAdd = () => { setFormInitial(EMPTY_SPECIAL_INSTRUCTION_FORM); setFormOpen(true); };
  const openEdit = (e: SpecialInstructionEntry) => {
    setFormInitial({
      id: e.id,
      topic: e.topic,
      instructionText: e.instructionText,
      instructionType: e.instructionType,
      insurerCategoryId: e.insurerCategoryId !== null ? String(e.insurerCategoryId) : "",
      productPlanName: e.productPlanName || "",
    });
    setFormOpen(true);
  };

  const handleSaved = (entry: SpecialInstructionEntry) => {
    const isEdit = formInitial.id !== null;
    logAction(
      isEdit ? "Special Instruction Edited" : "Special Instruction Created",
      `${isEdit ? "Updated" : "Created"} "${entry.topic}" (${INSTRUCTION_TYPE_LABEL[entry.instructionType]}).`
    );
    setFormOpen(false);
    void load();
  };

  // ── Activate/Deactivate + Delete ─────────────────────────────────────────
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggleActive = async (e: SpecialInstructionEntry) => {
    setBusyId(e.id);
    try {
      const res = await fetch(`/api/kb/special-instructions/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !e.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      logAction(e.isActive ? "Special Instruction Deactivated" : "Special Instruction Activated", `"${e.topic}" is now ${e.isActive ? "inactive" : "active"}.`);
      await load();
    } catch (err: any) {
      window.alert(err.message || "Failed to update this Special Instruction.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteEntry = async (e: SpecialInstructionEntry) => {
    if (!window.confirm(`Delete the "${e.topic}" Special Instruction? This can't be undone.`)) return;
    setBusyId(e.id);
    try {
      const res = await fetch(`/api/kb/special-instructions/${e.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete (HTTP ${res.status}).`);
      logAction("Special Instruction Deleted", `Deleted "${e.topic}".`);
      await load();
    } catch (err: any) {
      window.alert(err.message || "Failed to delete this Special Instruction.");
    } finally {
      setBusyId(null);
    }
  };

  // Cross-app UI consistency pass (2026-08): matches Product Assist's own
  // control language via the shared --input-*/--focus-ring tokens (see
  // CustomSelect.tsx's defaultTriggerClass and
  // KnowledgeBaseResourceManagement.tsx's identical inputClass) instead of
  // a hardcoded per-theme ternary and Tailwind's generic `sky-*` blue.
  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <p className={`text-xs font-semibold max-w-2xl ${dark ? "text-stone-400" : "text-stone-600"}`}>
          Controlled instructions Product Assist checks before consulting the Product Playbook, Policy Wording, or other resources.
          {!canManage && " Read-only — Developer or Platform Admin clearance is required to make changes."}
        </p>
        {canManage && (
          <ClippedButton size="md" onClick={openAdd} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap">
            <Plus className="w-3.5 h-3.5 mr-1.5 inline" />
            Add Special Instruction
          </ClippedButton>
        )}
      </div>

      {/* Toolbar */}
      <div className={`flex flex-wrap items-center gap-2 p-3 rounded-xl border ${cardClass}`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${dark ? "text-stone-500" : "text-stone-400"}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search topic, instruction, insurer, product…"
            className={`${inputClass} pl-8`}
          />
        </div>
        <div className="w-44">
          <CustomSelect
            theme={theme}
            value={typeFilter}
            onChange={v => setTypeFilter(v as any)}
            options={[{ value: "all", label: "All Types" }, ...INSTRUCTION_TYPE_OPTIONS]}
          />
        </div>
        <div className="w-44">
          <CustomSelect
            theme={theme}
            value={insurerFilter}
            onChange={v => setInsurerFilter(v)}
            options={[
              { value: "all", label: "All Insurers" },
              { value: "none", label: "No Insurer (Topic only)" },
              ...insurerCategories.map(c => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </div>
        <div className="w-36">
          <CustomSelect
            theme={theme}
            value={statusFilter}
            onChange={v => setStatusFilter(v as any)}
            options={[{ value: "all", label: "All Status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
          />
        </div>
      </div>

      {loadError && <p className="text-xs font-semibold text-red-500">{loadError}</p>}

      {/* Table */}
      <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={dark ? "bg-white/[0.04]" : "bg-[var(--table-header-bg)]"}>
              <tr>
                {["Topic", "Type", "Insurer", "Product / Plan", "Status", "Last Updated", "Updated By", "Actions"].map(h => (
                  <th key={h} className={`px-3 py-2 font-bold uppercase tracking-wide text-[10px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  {entries.length === 0 ? "No Special Instructions yet." : "No Special Instructions match your search/filters."}
                </td></tr>
              ) : (
                filtered.map(e => (
                  <tr key={e.id} className={`border-t ${dark ? "border-white/[0.06]" : "border-stone-100"} ${!e.isActive ? "opacity-60" : ""}`}>
                    <td className={`px-3 py-2.5 font-bold max-w-[220px] ${dark ? "text-white" : "text-stone-900"}`}>
                      <div className="truncate" title={e.topic}>{e.topic}</div>
                      <div className={`text-[10.5px] font-medium mt-0.5 line-clamp-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>{e.instructionText}</div>
                    </td>
                    <td className="px-3 py-2.5">{instructionTypeBadge(e.instructionType, dark)}</td>
                    <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${dark ? "text-stone-300" : "text-stone-700"}`}>
                      {e.insurerCategoryId !== null ? categoryById.get(e.insurerCategoryId)?.name ?? "—" : <span className={dark ? "text-stone-500" : "text-stone-400"}>Any</span>}
                    </td>
                    <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${dark ? "text-stone-300" : "text-stone-700"}`}>
                      {e.productPlanName || (
                        <span className={dark ? "text-stone-500" : "text-stone-400"}>{e.insurerCategoryId !== null ? "Generic" : "Any"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{statusBadge(e.isActive, dark)}</td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {new Date(e.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap max-w-[160px] truncate ${dark ? "text-stone-400" : "text-stone-500"}`} title={e.updatedBy}>
                      {e.updatedBy}
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(e)}
                            title="Edit"
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(e)}
                            disabled={busyId === e.id}
                            title={e.isActive ? "Deactivate" : "Activate"}
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteEntry(e)}
                            disabled={busyId === e.id}
                            title="Delete"
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 ${dark ? "text-stone-400 hover:text-red-400 hover:bg-red-500/10" : "text-stone-500 hover:text-red-600 hover:bg-red-50"}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className={dark ? "text-stone-600" : "text-stone-300"}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit modal — shared with the Unresolved Queries "Resolve" flow,
          see SpecialInstructionFormModal.tsx's doc comment. */}
      {formOpen && (
        <SpecialInstructionFormModal
          theme={theme}
          domain={domain}
          categories={categories}
          initialForm={formInitial}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
