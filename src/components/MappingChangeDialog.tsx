/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { registerMappingChangeDialog, type MappingChangeDecision, type MappingChangeRequest, type PairOutcome } from "../utils/mappingFetch";

const CATEGORIES = ["New synonym", "New canonical condition", "Dictionary update", "Regex update", "Shield update", "New category", "Plan override", "Fallback update", "Regression fix"];

const TIER_LABEL: Record<string, string> = { P0: "Direct Match", P1: "Category Match", P3: "Fallback (Others)", NON_AILMENT: "Not a condition", UNRESOLVED: "Sent to the AI step" };

const outcomeText = (o: PairOutcome) => (o.question ? `${TIER_LABEL[o.tier] ?? o.tier}: ${o.question}` : TIER_LABEL[o.tier] ?? o.tier);

const TIER_TEXT: Record<string, { label: string; light: string; dark: string }> = {
  low: { label: "Low impact", light: "bg-emerald-100 text-emerald-800", dark: "bg-emerald-900/40 text-emerald-300" },
  elevated: { label: "Elevated impact", light: "bg-amber-100 text-amber-800", dark: "bg-amber-900/40 text-amber-300" },
  high: { label: "High impact", light: "bg-red-100 text-red-800", dark: "bg-red-900/40 text-red-300" },
  none: { label: "No impact", light: "bg-slate-100 text-slate-700", dark: "bg-slate-800 text-slate-300" },
};

interface Pending {
  req: MappingChangeRequest;
  resolve: (d: MappingChangeDecision | null) => void;
}

/** Mount once near the app root. Shows the impact of an admin mapping change and collects the change-control fields. */
export function MappingChangeDialogHost({ theme }: { theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [bdChoice, setBdChoice] = useState<"none" | "approved">("none");
  const [approver, setApprover] = useState("");
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    registerMappingChangeDialog(
      (req) =>
        new Promise((resolve) => {
          setReason("");
          setReviewed(false);
          setPending({ req, resolve });
        })
    );
    return () => registerMappingChangeDialog(null);
  }, []);

  if (!pending) return null;
  const { req } = pending;
  const m = req.impact?.metrics;
  const needsReview = req.tier === "elevated" || req.tier === "high";
  const bd = bdChoice === "none" ? "none" : `approved: ${approver.trim()}`;
  const valid = reason.trim().length >= 8 && !!category && (bdChoice === "none" || approver.trim().length > 0) && (!needsReview || reviewed);
  const close = (d: MappingChangeDecision | null) => {
    pending.resolve(d);
    setPending(null);
  };
  const tier = TIER_TEXT[req.tier] ?? TIER_TEXT.low;
  const field = `w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`;
  const muted = dark ? "text-slate-400" : "text-slate-500";

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-label="Review mapping change">
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 ${dark ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-bold">Review before saving</h2>
            <p className={`text-sm ${muted}`}>{req.description}</p>
          </div>
          <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${dark ? tier.dark : tier.light}`}>{tier.label}</span>
        </div>

        {req.stale && (
          <p className={`mb-3 text-sm rounded-lg p-3 ${dark ? "bg-amber-900/30 text-amber-200" : "bg-amber-50 text-amber-800"}`}>
            The mapping changed while you were reviewing. These are the updated numbers — please review again.
          </p>
        )}

        {m && (
          <div className="mb-4 space-y-2 text-sm">
            <p>
              <strong>{m.pairsChanged}</strong> lookup{m.pairsChanged === 1 ? "" : "s"} would change (<strong>{m.termsChanged}</strong> condition{m.termsChanged === 1 ? "" : "s"} across <strong>{m.plansAffected}</strong> plan
              {m.plansAffected === 1 ? "" : "s"}).{" "}
              {m.advisorLookupsAffected > 0 ? (
                <>
                  Advisors made <strong>{m.advisorLookupsAffected}</strong> lookups of these in the last 90 days.
                </>
              ) : (
                <>No advisor searched these in the last 90 days.</>
              )}
            </p>
            {req.reasons.length > 0 && (
              <ul className={`list-disc pl-5 ${dark ? "text-amber-200" : "text-amber-800"}`}>
                {req.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {req.impact?.aiMemory && req.impact.aiMemory.checked > 0 && (
              <p className={`rounded-lg p-3 text-xs ${dark ? "bg-slate-700 text-slate-200" : "bg-slate-50 text-slate-700"}`}>
                {m.resolvedToUnresolved} lookup{m.resolvedToUnresolved === 1 ? "" : "s"} would stop being answered by the rules. Of the {req.impact.aiMemory.checked} checked, <strong>{req.impact.aiMemory.withEntry}</strong> already have an AI Memory entry
                {Object.keys(req.impact.aiMemory.byStatus).length > 0 && <> ({Object.entries(req.impact.aiMemory.byStatus).map(([k, v]) => `${v} ${k}`).join(", ")})</>}: advisors would be served that saved answer
                {req.impact.aiMemory.withEntry < req.impact.aiMemory.checked ? "; the rest would be sent to the AI step" : ""}. A rejected entry shows the Others question with a manual-review note.
              </p>
            )}
            {req.impact && req.impact.sample.length > 0 && (
              <div className={`rounded-lg border overflow-hidden ${dark ? "border-slate-600" : "border-slate-200"}`}>
                <div className={`px-3 py-1.5 text-xs font-semibold ${dark ? "bg-slate-700" : "bg-slate-50"}`}>
                  Most significant changes{m.pairsChanged > req.impact.sample.length ? ` (${req.impact.sample.length} of ${m.pairsChanged})` : ""}
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-slate-200/60">
                  {req.impact.sample.map((s, i) => (
                    <li key={i} className="px-3 py-2 text-xs">
                      <div className="font-semibold">
                        {s.term} <span className={`font-normal ${muted}`}>· {s.plan}</span>
                      </div>
                      <div className={muted}>Now: {outcomeText(s.before)}</div>
                      <div>After: {outcomeText(s.after)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-sm font-semibold">
            Reason for this change
            <textarea className={`${field} mt-1 font-normal`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" />
          </label>
          <label className="block text-sm font-semibold">
            Change category
            <select className={`${field} mt-1 font-normal`} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose…</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <fieldset className="text-sm">
            <legend className="font-semibold">Business-Decision check</legend>
            <label className="flex items-center gap-2 mt-1">
              <input type="radio" checked={bdChoice === "none"} onChange={() => setBdChoice("none")} /> No business decision is involved (no change to which question applies in a way the owners haven't approved)
            </label>
            <label className="flex items-center gap-2 mt-1">
              <input type="radio" checked={bdChoice === "approved"} onChange={() => setBdChoice("approved")} /> A business decision is involved and was approved by:
            </label>
            {bdChoice === "approved" && <input className={`${field} mt-1`} value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Name / reference" />}
          </fieldset>
          {needsReview && (
            <label className="flex items-start gap-2 text-sm font-semibold">
              <input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              <span>I have reviewed the lookups above and confirm this change.</span>
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={`px-4 py-2 rounded-lg text-sm font-semibold ${dark ? "bg-slate-700 hover:bg-slate-600" : "bg-slate-100 hover:bg-slate-200"}`} onClick={() => close(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => close({ reason: reason.trim(), changeCategory: category, businessDecision: bd })}
          >
            Save change
          </button>
        </div>
      </div>
    </div>
  );
}
