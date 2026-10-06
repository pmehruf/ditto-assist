/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import type { MatchOutput } from "../types";
import { getLookupResultInfo } from "../utils/matchTier";
import { describeCategoryChain } from "../utils/categoryChainText";
import { useCategoryLabels } from "../utils/categoryLabels";

/**
 * "Why this result" (Phase 3B-i) — shows staff which stage of the routing engine decided a lookup, and the
 * dictionary / category reasoning behind it, straight from the result's `decision_trace`. Read-only, additive:
 * it never changes a result. Shown only to staff tiers (the server tells the client via /api/mapping-engine).
 */

let accessCache: Promise<boolean> | null = null;
function loadAccess(): Promise<boolean> {
  accessCache ??= fetch("/api/mapping-engine")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => !!j?.canViewTrace)
    .catch(() => false);
  return accessCache;
}

function useCanViewTrace(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    loadAccess().then((v) => live && setCan(v));
    return () => {
      live = false;
    };
  }, []);
  return can;
}

const SOURCE_TEXT: Record<string, string> = {
  ped_category: "the PED's Primary category",
  category_chain: "a Fallback category (the Primary has no declaration question on this plan)",
  alias_override: "a category set on this alias (it replaces the PED's Primary category)",
  fallback_category: "this alias's last-resort category (nothing else gave an answer)",
  not_routed: "not used (matching is turned off for this alias)",
  none: "no category (the text is not a known condition)",
};

function describeStage(decidedBy: string): string {
  if (decidedBy === "unresolved") return "None of the defined mapping rules decided this, so it goes to a saved AI answer or to the AI.";
  if (decidedBy === "primitive.plan_override") return "A plan-specific mapping set for this plan.";
  if (decidedBy === "primitive.p0_wording") return "The condition is exactly one of the items listed in this plan's own question.";
  if (decidedBy === "primitive.plan_decision") return "The condition's category was matched to this plan's question.";
  if (decidedBy.startsWith("plan_rule.")) return "A rule that applies to this plan only.";
  if (decidedBy.startsWith("family.")) return "A disease-group rule (it recognises a group of related conditions).";
  if (decidedBy.startsWith("shield.")) return "A safety check (it stops a risky condition being filed under the wrong question).";
  if (decidedBy.startsWith("generic.")) return "A last safety check (symptoms, test findings or one-off events).";
  if (decidedBy.startsWith("dict.")) return "A rule applied to the condition's category.";
  if (decidedBy.startsWith("firewall.") || decidedBy.startsWith("lifestage.") || decidedBy.startsWith("life_stage.")) return "The not-a-disease check (normal life stages such as pregnancy).";
  return "A built-in step.";
}

export function DecisionTracePanel({ result, dark }: { result: MatchOutput; dark: boolean }) {
  const can = useCanViewTrace();
  const label = useCategoryLabels();
  const [open, setOpen] = useState(false);
  const t = result.decision_trace;
  if (!can || !t) return null;
  const tier = getLookupResultInfo(result.match_type, (result as { source?: string }).source, { ped: result.ped_input, question: result.matched_question });
  const muted = dark ? "#94a3b8" : "#64748b";
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2 text-[11.5px] leading-snug">
      <span style={{ color: muted }} className="w-28 shrink-0">{label}</span>
      <span className="font-medium break-words min-w-0">{value}</span>
    </div>
  );
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[11px] font-semibold underline decoration-dotted underline-offset-2" style={{ color: muted }}>
        {open ? "Hide" : "Why this result"}
      </button>
      {open && (
        <div className={`mt-1.5 rounded-lg border p-2.5 space-y-1 ${dark ? "border-slate-600 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}>
          {row("Result", tier.label + (tier.role ? ` — ${tier.role.toLowerCase()}` : ""))}
          {row("Decided by", describeStage(t.decidedBy))}
          {t.postGuard && row("Then adjusted by", <code>{t.postGuard}</code>)}
          {t.dictionary && (
            <>
              {row("Matched text", t.dictionary.alias || "—")}
              {row("Category from", SOURCE_TEXT[t.dictionary.source] ?? t.dictionary.source)}
              {row("Primary category", label(t.dictionary.pedCategory))}
              {t.dictionary.categoryOverride && row("Set on this alias", label(t.dictionary.categoryOverride))}
              {row("Category used", label(t.dictionary.effectiveCategory))}
              {t.dictionary.chain && row("Primary and Fallbacks", <>{describeCategoryChain(t.dictionary.chain, label).map((l) => <div key={l}>{l}</div>)}</>)}
            </>
          )}
          {row("Mapping version", `${t.snapshotVersion ?? "—"}${t.instance ? ` · server ${t.instance}` : ""}`)}
        </div>
      )}
    </div>
  );
}
