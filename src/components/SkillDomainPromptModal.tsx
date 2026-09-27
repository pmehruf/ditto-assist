/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Compass } from "lucide-react";
import { AdvisorTagCheckboxes } from "./AdvisorTagCheckboxes";
import { ClippedButton } from "./ClippedButton";

/**
 * Post-login prompt for an already-provisioned user whose Skill Domain tags
 * are still empty (unassigned) — asks them to pick Health, Term, or both.
 * Shown once per login (App.tsx's session-hydration path checks
 * `existingUser.tags` and sets this up) for every such user until they
 * actually save a selection; "Remind me later" just dismisses THIS
 * session's prompt without writing anything, so it reappears next login.
 *
 * Deliberately NOT a blocking overlay like AnnouncementAckModal — an
 * unassigned tag set is a request for information, not a compliance gate,
 * so the app stays fully usable underneath and a dismiss is always available.
 */
export function SkillDomainPromptModal({
  theme,
  onSave,
  onSkip,
}: {
  theme: "light" | "dark";
  /** Persists the selection via PATCH /api/me/tags; the parent closes the
   * modal and updates local state once this resolves. */
  onSave: (tags: string[]) => Promise<void>;
  /** Dismiss without saving — reappears next login since tags stay empty. */
  onSkip: () => void;
}) {
  const dark = theme === "dark";
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (tags.length === 0) {
      setError("Select at least one, or choose \"Remind me later\".");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your Skill Domain"
    >
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} />

      <div
        className={`relative w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
          dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        <div className={`px-5 pt-4 pb-3 border-b ${dark ? "border-stone-800" : "border-stone-200"}`}>
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 shrink-0" style={{ color: dark ? "#00D3F3" : "#4673a9" }} />
            <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              Choose Your Skill Domain
            </h2>
          </div>
          <p className={`text-xs font-semibold mt-1 ${dark ? "text-stone-400" : "text-stone-600"}`}>
            Which insurance line(s) do you handle? This decides which announcements you see.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <AdvisorTagCheckboxes theme={theme} value={tags} onChange={setTags} size="md" />
          {error && (
            <p className="text-[11px] font-semibold text-red-500">{error}</p>
          )}
        </div>

        <div className={`px-5 py-3 border-t flex items-center justify-between gap-3 ${
          dark ? "border-stone-800" : "border-stone-200"
        }`}>
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className={`text-[11px] font-bold uppercase tracking-wider cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
              dark ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
            }`}
          >
            Remind me later
          </button>
          {/* Shared --action-navy token (2026-09) instead of the old
              bg-sky-600 family — the `disabled` prop below already gives
              ClippedButton its own dimmed/not-allowed look while saving. */}
          <ClippedButton
            type="button"
            disabled={saving}
            onClick={handleSave}
            cornerBg={dark ? "#12151A" : "#ffffff"}
            variant="action"
            className="px-4 py-2 text-[11px] font-black uppercase tracking-wider"
          >
            {saving ? "Saving…" : "Save"}
          </ClippedButton>
        </div>
      </div>
    </div>
  );
}
