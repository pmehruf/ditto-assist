/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { realPlanNames } from "../utils/kbPlanNames";
import {
  INSTRUCTION_TYPE_OPTIONS,
  EMPTY_SPECIAL_INSTRUCTION_FORM,
  type InstructionType,
  type KbCategoryLite,
  type SpecialInstructionEntry,
  type SpecialInstructionFormState,
} from "./specialInstructionTypes";

function ModalShell({ theme, onClose, children }: { theme: "light" | "dark"; onClose: () => void; children: ReactNode }) {
  const dark = theme === "dark";
  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} onClick={onClose} />
      <div
        className={`relative w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${
          dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

interface SpecialInstructionFormModalProps {
  theme: "light" | "dark";
  /** Which Product Assist vertical a NEW instruction is created under —
   * ignored on edit (form.id !== null), since domain is set once at
   * creation only and never editable (see special_instructions.domain's
   * schema.ts comment) — same as before this was extracted. */
  domain: "Health" | "Term";
  categories: KbCategoryLite[];
  /** Defaults to a blank "Add" form. Pass a populated state (with `id` set)
   * to open in edit mode, or a partial-blank state with `id: null` to open
   * "Add" pre-filled with a suggested topic/scope (see
   * ProductAssistQuotaPage.tsx's Unresolved Queries "Resolve" action, which
   * prefills topic/insurer/plan from the unresolved question). */
  initialForm?: SpecialInstructionFormState;
  onClose: () => void;
  onSaved: (entry: SpecialInstructionEntry) => void;
}

/**
 * The Add/Edit Special Instruction form, extracted (2026-09) out of
 * SpecialInstructions.tsx so the Unresolved Queries "Resolve" flow
 * (ProductAssistQuotaPage.tsx) can use the LITERAL same form — same fields,
 * same validation, same POST/PATCH /api/kb/special-instructions calls — for
 * closing a Product Assist knowledge gap, rather than a second hand-built
 * copy that could drift out of sync. SpecialInstructions.tsx now renders
 * this component too instead of its own inline modal.
 */
export function SpecialInstructionFormModal({ theme, domain, categories, initialForm, onClose, onSaved }: SpecialInstructionFormModalProps) {
  const dark = theme === "dark";
  const [form, setForm] = useState<SpecialInstructionFormState>(initialForm ?? EMPTY_SPECIAL_INSTRUCTION_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const insurerCategories = useMemo(() => categories.filter(c => c.type === "insurer"), [categories]);

  const planSuggestions = useMemo(() => {
    if (form.insurerCategoryId) {
      const cat = categoryById.get(Number(form.insurerCategoryId));
      return cat ? realPlanNames(cat.planNames) : [];
    }
    // No insurer picked (Topic-only or Topic+Product without Insurer) —
    // suggest across every insurer's roster rather than none at all.
    const all = new Set<string>();
    for (const c of insurerCategories) for (const p of realPlanNames(c.planNames)) all.add(p);
    return Array.from(all);
  }, [form.insurerCategoryId, categoryById, insurerCategories]);

  const submitForm = async () => {
    const topic = form.topic.trim();
    const instructionText = form.instructionText.trim();
    if (!topic) { setSaveError("Topic is required."); return; }
    if (!instructionText) { setSaveError("Description / Instruction is required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = form.id !== null;
      const payload = {
        topic,
        instructionText,
        instructionType: form.instructionType,
        insurerCategoryId: form.insurerCategoryId ? Number(form.insurerCategoryId) : null,
        productPlanName: form.productPlanName.trim() || null,
        ...(isEdit ? {} : { domain }),
      };
      const res = await fetch(isEdit ? `/api/kb/special-instructions/${form.id}` : "/api/kb/special-instructions", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      onSaved(body.entry);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save this Special Instruction. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";

  return (
    <ModalShell theme={theme} onClose={onClose}>
      <div className={`px-5 pt-4 pb-3 border-b flex items-center justify-between ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
          {form.id !== null ? "Edit Special Instruction" : "Add Special Instruction"}
        </h2>
        <button type="button" onClick={onClose} className={dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        {saveError && <p className="text-[11px] font-semibold text-red-500">{saveError}</p>}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Topic <span className="text-red-500">*</span></label>
          <input className={inputClass} value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder='e.g. "Free Period"' autoFocus />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Description / Instruction <span className="text-red-500">*</span></label>
          <textarea
            className={`${inputClass} min-h-[220px] resize-y`}
            value={form.instructionText}
            onChange={e => setForm(f => ({ ...f, instructionText: e.target.value }))}
            placeholder="The instruction Product Assist should follow…"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Instruction Type <span className="text-red-500">*</span></label>
          <CustomSelect theme={theme} value={form.instructionType} onChange={v => setForm(f => ({ ...f, instructionType: v as InstructionType }))} options={INSTRUCTION_TYPE_OPTIONS} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Insurer (optional)</label>
            <CustomSelect
              theme={theme}
              value={form.insurerCategoryId}
              onChange={v => setForm(f => ({ ...f, insurerCategoryId: v, productPlanName: "" }))}
              options={[{ value: "", label: "Any insurer" }, ...insurerCategories.map(c => ({ value: String(c.id), label: c.name }))]}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Product / Plan (optional)</label>
            {form.insurerCategoryId ? (
              <CustomSelect
                theme={theme}
                value={form.productPlanName}
                onChange={v => setForm(f => ({ ...f, productPlanName: v }))}
                options={[{ value: "", label: "Generic (whole insurer, not plan-specific)" }, ...planSuggestions.map(p => ({ value: p, label: p }))]}
              />
            ) : (
              <>
                <input
                  className={inputClass}
                  list="special-instruction-plan-suggestions"
                  value={form.productPlanName}
                  onChange={e => setForm(f => ({ ...f, productPlanName: e.target.value }))}
                  placeholder="e.g. Optima Super Secure"
                />
                <datalist id="special-instruction-plan-suggestions">
                  {planSuggestions.map(p => <option key={p} value={p} />)}
                </datalist>
              </>
            )}
          </div>
        </div>
        <p className={`text-[10.5px] font-medium ${dark ? "text-stone-500" : "text-stone-400"}`}>
          Topic only, Topic+Insurer, Topic+Product, or Topic+Insurer+Product are all supported — the most specific combination present wins when more than one instruction matches the same question. Pick "Generic" for an insurer selected without a specific plan.
        </p>
      </div>
      <div className={`px-5 py-3 border-t flex items-center justify-end gap-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
        <ClippedButton size="md" onClick={onClose} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
          Cancel
        </ClippedButton>
        <ClippedButton size="md" onClick={submitForm} disabled={saving} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
          {saving ? "Saving…" : form.id !== null ? "Save Changes" : "Add"}
        </ClippedButton>
      </div>
    </ModalShell>
  );
}
