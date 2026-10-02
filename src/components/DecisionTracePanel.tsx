/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import type { MatchOutput } from "../types";
import { getMatchTierInfo } from "../utils/matchTier";
import { describeCategoryChain } from "../utils/categoryChainText";

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
  ped_category: "the PED's own category",
  category_chain: "a Fallback category (the Primary has no declaration question on this plan)",
  alias_override: "a category set on this alias (overrides the PED's)",
  fallback_category: "the alias's last-resort category (nothing else resolved)",
  not_routed: "not used for routing (alias has routing turned off)",
  none: "no dictionary entry",
};

function describeStage(decidedBy: string): string {
  if (decidedBy === "unresolved") return "No built-in rule decided this — it goes to AI Memory / the AI step.";
  if (decidedBy === "primitive.plan_override") return "A plan-specific PED mapping set by an admin for this plan.";
  if (decidedBy === "primitive.p0_wording") return "The condition is exactly a fragment of this plan's own question wording.";
  if (decidedBy === "primitive.plan_decision") return "The dictionary category was looked up in this plan's category map.";
  if (decidedBy.startsWith("family.")) return "A condition-family rule (e.g. diabetes, hypertension).";
  if (decidedBy.startsWith("shield.")) return "A safety shield (a term that must not be mapped by keyword).";
  if (decidedBy.startsWith("lifestage.") || decidedBy.startsWith("life_stage.")) return "A natural life-stage rule (e.g. pregnancy-related).";
  return "A routing rule.";
}

export function DecisionTracePanel({ result, dark }: { result: MatchOutput; dark: boolean }) {
  const can = useCanViewTrace();
  const [open, setOpen] = useState(false);
  const t = result.decision_trace;
  if (!can || !t) return null;
  const tier = getMatchTierInfo(result.match_type);
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
          {row("Match level", tier.levelLabel)}
          {row("Decided by", <><code>{t.decidedBy}</code> — {describeStage(t.decidedBy)}</>)}
          {t.postGuard && row("Post-guard", t.postGuard)}
          {t.dictionary && (
            <>
              {row("Dictionary alias", t.dictionary.alias || "—")}
              {row("Category from", SOURCE_TEXT[t.dictionary.source] ?? t.dictionary.source)}
              {row("PED category", t.dictionary.pedCategory ?? "none")}
              {t.dictionary.categoryOverride && row("Alias override", t.dictionary.categoryOverride)}
              {row("Category used", t.dictionary.effectiveCategory ?? "none")}
              {t.dictionary.chain && row("Primary and Fallbacks", <>{describeCategoryChain(t.dictionary.chain).map((l) => <div key={l}>{l}</div>)}</>)}
            </>
          )}
          {row("Mapping version", `${t.snapshotVersion ?? "—"}${t.instance ? ` · server ${t.instance}` : ""}`)}
        </div>
      )}
    </div>
  );
}
