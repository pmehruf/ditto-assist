/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResultKind } from "./resultKind";

/**
 * Client side of the admin mapping-change safety backbone (Phase 3B-i, server side:
 * src/server/mappingChange.ts). Use `mappingFetch` instead of `fetch` for any admin
 * write that can change what a lookup returns (PED Library, plans, restrictions,
 * plan-specific mappings).
 *
 * When the server has the impact gate on, it first asks the server for a PREVIEW of
 * the change (the real route logic, rolled back), shows the admin the measured impact
 * and collects the required change-control fields in a dialog, then sends the real
 * request with them. With the gate off it is exactly `fetch`.
 */

export type ImpactTier = "none" | "low" | "elevated" | "high";

export interface PairOutcome {
  resolved: boolean;
  matchType: string | null;
  question: string | null;
  decidedBy: string;
  specific: boolean;
  tier: "P0" | "P1" | "P3" | "NON_AILMENT" | "UNRESOLVED";
  /** Display name chosen on the server from the result type (never from `tier`). */
  kind?: ResultKind;
}

export interface ImpactReport {
  tier: ImpactTier;
  reasons: string[];
  metrics: {
    pairsCompared: number;
    pairsChanged: number;
    termsChanged: number;
    plansAffected: number;
    p0Changed: number;
    resolvedToUnresolved: number;
    specificityLoss: number;
    specificityGain: number;
    questionSwap: number;
    advisorLookupsAffected: number;
    advisorPairsAffected: number;
    transitions: Record<string, number>;
  };
  sample: Array<{ plan: string; term: string; before: PairOutcome; after: PairOutcome }>;
  aiMemory?: { checked: number; withEntry: number; byStatus: Record<string, number>; examples: Array<{ plan: string; term: string; status: string; servedQuestion: string | null }> } | null;
}

export interface MappingChangeRequest {
  description: string;
  tier: ImpactTier;
  reasons: string[];
  impact: ImpactReport | null;
  /** True when the server refused an earlier confirmation because things changed since the preview. */
  stale: boolean;
}

export interface MappingChangeDecision {
  reason: string;
  changeCategory: string;
}

type Opener = (req: MappingChangeRequest) => Promise<MappingChangeDecision | null>;

let opener: Opener | null = null;
export function registerMappingChangeDialog(open: Opener | null): void {
  opener = open;
}

let gateCache: { at: number; on: boolean } | null = null;
async function gateEnabled(): Promise<boolean> {
  if (gateCache && Date.now() - gateCache.at < 60_000) return gateCache.on;
  let on = false;
  try {
    const res = await fetch("/api/mapping-engine");
    if (res.ok) on = !!(await res.json()).impactGate;
  } catch {
    on = false;
  }
  gateCache = { at: Date.now(), on };
  return on;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const CHANGE_CANCELLED = "Cancelled — nothing was saved.";

/** Where a governed save currently is — lets a screen show a real loading state instead of a dimmed button. */
export type MappingSavePhase = "checking" | "confirming" | "saving";

export async function mappingFetch(url: string, init: RequestInit = {}, description = "Mapping change", opts: { testTerms?: string[]; onPhase?: (phase: MappingSavePhase) => void } = {}): Promise<Response> {
  if (!(await gateEnabled()) || !opener) {
    opts.onPhase?.("saving");
    return fetch(url, init);
  }

  const terms = (opts.testTerms ?? []).map((t) => t.trim()).filter(Boolean);
  const termsHeader: Record<string, string> = terms.length ? { "X-Mapping-Test-Terms": encodeURIComponent(JSON.stringify(terms)) } : {};
  const withHeaders = (extra: Record<string, string>): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...termsHeader, ...extra } });

  let stale = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    opts.onPhase?.("checking");
    const previewRes = await fetch(url, withHeaders({ "X-Mapping-Preview": "1" }));
    const preview = await previewRes.json().catch(() => ({}));
    // The route itself rejected the input (validation, not found, permissions): show that, change nothing.
    if (!previewRes.ok) {
      const { preview: _p, ...rest } = preview ?? {};
      return json(previewRes.status, rest);
    }
    // Nothing would change: no confirmation needed.
    // Nothing would change, or no lookup result would (still audited and undoable on the server): no confirmation needed.
    if (preview.tier === "none" || (!preview.impact && preview.changes === 0)) {
      opts.onPhase?.("saving");
      return fetch(url, init);
    }
    opts.onPhase?.("confirming");

    const decision = await opener({ description, tier: preview.tier ?? "low", reasons: preview.reasons ?? [], impact: preview.impact ?? null, stale });
    if (!decision) return json(409, { error: CHANGE_CANCELLED, cancelled: true });

    opts.onPhase?.("saving");
    const applyRes = await fetch(
      url,
      withHeaders({ "X-Mapping-Change": encodeURIComponent(JSON.stringify({ ...decision, confirmHash: preview.impactHash })) })
    );
    if (applyRes.status === 409) {
      const body = await applyRes.clone().json().catch(() => ({}));
      if (body?.code === "impact_confirmation_required") {
        stale = true; // someone changed the mapping since the preview: show the new numbers and ask again
        continue;
      }
    }
    return applyRes;
  }
  return json(409, { error: "The mapping kept changing while you were reviewing it. Nothing was saved — please try again." });
}
