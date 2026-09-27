/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Porting Assist — waiting-period carry-forward calculation engine.
//
// Entirely deterministic and input-driven (see Porting Assist's product
// spec): no AI/LLM calls, no medical classification of PED conditions (a
// condition is only ever a free-text label carried through verbatim — this
// file never inspects the TEXT of a condition, only the advisor-entered
// declaration year/flag attached to it), and no mid-term/day-level date
// arithmetic — every cover change and every PED declaration is pinned to a
// POLICY YEAR (a renewal boundary), never a calendar date. Policy Inception
// Date is used only to LABEL policy years with a calendar year for display;
// it never enters a calculation.
//
// COVER-TRANCHE MODEL (the core of this file): the advisor enters one total
// cover amount per policy year. Reading that sequence year over year, any
// INCREASE in cover creates a new "tranche" of money dated to the year it
// first appeared — the original amount keeps its own, earlier vintage. A
// DECREASE (not covered by the product spec's own examples, but handled
// defensively so the engine never throws on it) gives up the MOST RECENTLY
// added tranche(s) first, LIFO, on the reasoning that older money is more
// "vested" and the newest addition is the first thing a reduction would
// plausibly represent giving up.
//
// BONUS: deliberately has no waiting-period clock of its own (product
// requirement — see "IMPORTANT: DO NOT MISINTERPRET BONUS" in the spec).
// It is modelled as simply enlarging the MOST RECENT real cover tranche by
// its own amount, so it inherits that tranche's own vintage rather than
// being fabricated a vintage of its own. This is a deliberate design choice
// documented here because the product spec's own worked examples (bonus
// fully/partially covering a porting enhancement) never combine bonus with
// more than one pre-existing tranche, so they don't by themselves settle
// which tranche bonus should attach to — attaching it to the newest tranche
// is the more conservative of the two plausible readings (it can never
// overstate how long the bonus-extended money has actually been around).
//
// PED (pre-existing disease) WAITING PERIOD: computed once per declared PED
// group, from the policy year it was declared through to the current policy
// year — completely independent of which cover tranche it's checked
// against (the product spec's own worked example gives the identical
// remaining-years figure for a 3-year-old tranche and a 1-year-old tranche
// alike). That single remaining-years figure applies to any cover that has
// SOME carry-forward-eligible history at all (any real or bonus-extended
// tranche); the portion of porting cover beyond that capacity has zero
// prior history of any kind and always gets a fresh 3-year PED clock,
// declared or not.

export const INITIAL_WAITING_PERIOD_DAYS = 30;
export const SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS = 2;
export const PED_WAITING_PERIOD_YEARS = 3;

export interface CoverHistoryEntry {
  policyYear: number;
  coverAmount: number;
}

export interface CoverTranche {
  amount: number;
  /** The policy year this tranche first appeared in. */
  sinceYear: number;
  /** Policy years held as of the LATEST policy year in coverHistory — not
   * yet adjusted for any individual member's own join year. */
  heldYears: number;
}

export type WaitingPeriodStatus = "completed" | "partial" | "fresh";

/** One priced slice of the porting cover amount, carrying one uniform
 * waiting-period status. `sinceYear: null` marks the portion of porting
 * cover that exceeds every eligible tranche's capacity — brand new money
 * with no prior policy history of any kind. */
export interface TranchePortion {
  amount: number;
  sinceYear: number | null;
  heldYears: number;
  initialCompleted: boolean;
  specificIllnessRemainingYears: number;
  specificIllnessCompleted: boolean;
}

export interface PedGroupInput {
  id: string;
  /** Free-text, comma-separated condition list — never inspected, only
   * carried through verbatim (see NO MEDICAL VALIDATION in the spec). */
  conditions: string;
  /** false = treated identically to an Undeclared PED: fresh 3-year clock,
   * no declaration year needed. */
  declared: boolean;
  declaredSinceInception: boolean;
  /** Required when declared && !declaredSinceInception. Must fall within
   * the owning member's own [memberSinceYear, policyYears] range. */
  declaredYear: number | null;
}

export interface PedResult {
  id: string;
  conditions: string;
  declaredLabel: string;
  declared: boolean;
  servedYears: number;
  remainingYears: number;
  completed: boolean;
}

export interface MemberInput {
  id: string;
  /** Resolved display label — e.g. "Self", "Spouse", or the advisor's own
   * custom text when "Other" was picked. */
  relationship: string;
  /** The policy year this member joined. 1 = same as policy inception. */
  memberSinceYear: number;
  hasPeds: boolean;
  pedGroups: PedGroupInput[];
  /** Free-text condition labels from the separate "Undeclared PEDs"
   * section — always a fresh 3-year clock, no declaration year at all. */
  undeclaredPedConditions: string[];
}

export interface MemberResult {
  id: string;
  relationship: string;
  memberSinceYear: number;
  /** Ordered oldest-history-first, ending with the fresh portion (if any). */
  tranches: TranchePortion[];
  carryForwardAmount: number;
  freshAmount: number;
  initialStatus: WaitingPeriodStatus;
  specificIllnessStatus: WaitingPeriodStatus;
  pedResults: PedResult[];
  pedStatus: WaitingPeriodStatus | "none";
}

export interface PortingAssistInput {
  coverHistory: CoverHistoryEntry[];
  availableBonus: number;
  portingCoverAmount: number;
  members: MemberInput[];
}

export interface PortingAssistResult {
  policyYears: number;
  currentCoverAmount: number;
  eligibleCarryForwardCapacity: number;
  /** min(eligibleCarryForwardCapacity, portingCoverAmount) */
  totalCarryForwardAmount: number;
  totalFreshAmount: number;
  /** Owner-level tranche breakdown (no member-specific join-year capping) —
   * drives the policy-level "Waiting-Period Carry-Forward" summary. */
  ownerTranches: TranchePortion[];
  members: MemberResult[];
}

/** Reshapes a plain per-year cover total sequence into cover tranches, each
 * dated to the policy year its own amount first appeared. See this file's
 * module comment for the increase/decrease handling rules. */
export function deriveCoverTranches(coverHistory: CoverHistoryEntry[]): CoverTranche[] {
  const sorted = [...coverHistory].sort((a, b) => a.policyYear - b.policyYear);
  const policyYears = sorted.length;
  const tranches: { amount: number; sinceYear: number }[] = [];
  let runningTotal = 0;

  for (const entry of sorted) {
    const target = Math.max(0, entry.coverAmount);
    if (target > runningTotal + 1e-9) {
      tranches.push({ amount: target - runningTotal, sinceYear: entry.policyYear });
    } else if (target < runningTotal - 1e-9) {
      let toRemove = runningTotal - target;
      while (toRemove > 1e-9 && tranches.length > 0) {
        const last = tranches[tranches.length - 1];
        if (last.amount <= toRemove + 1e-9) {
          toRemove -= last.amount;
          tranches.pop();
        } else {
          last.amount -= toRemove;
          toRemove = 0;
        }
      }
    }
    runningTotal = target;
  }

  return tranches.map((t) => ({ ...t, heldYears: policyYears - t.sinceYear + 1 }));
}

/** Bonus has no waiting-period clock of its own — it simply enlarges the
 * most recently added real tranche by its own amount (see module comment).
 * A bonus amount with no existing cover at all to attach to contributes
 * nothing (there is no history for it to inherit). */
export function mergeBonusIntoTranches(tranches: CoverTranche[], availableBonus: number): CoverTranche[] {
  const bonus = Math.max(0, availableBonus);
  if (bonus <= 0 || tranches.length === 0) return tranches;
  const copy = tranches.map((t) => ({ ...t }));
  const last = copy[copy.length - 1];
  copy[copy.length - 1] = { ...last, amount: last.amount + bonus };
  return copy;
}

/** Re-dates every tranche relative to one member's own join year: a tranche
 * that already existed before the member joined is capped to the member's
 * own tenure; a tranche created after the member joined keeps its own
 * (unchanged) vintage, since the member was already present for it. */
export function computeEffectiveTranchesForMember(
  tranches: CoverTranche[],
  policyYears: number,
  memberSinceYear: number
): CoverTranche[] {
  return tranches.map((t) => {
    const effSinceYear = Math.max(t.sinceYear, memberSinceYear);
    return { amount: t.amount, sinceYear: effSinceYear, heldYears: Math.max(0, policyYears - effSinceYear + 1) };
  });
}

/** Allocates a porting cover amount across tranches oldest-first (so the
 * best-seasoned money is credited first), then reports any leftover porting
 * amount beyond every tranche's combined capacity as one fresh, no-history
 * portion. */
export function allocatePortingCover(tranches: CoverTranche[], portingCoverAmount: number): TranchePortion[] {
  let remaining = Math.max(0, portingCoverAmount);
  const portions: TranchePortion[] = [];

  for (const t of tranches) {
    if (remaining <= 1e-9) break;
    const alloc = Math.min(t.amount, remaining);
    if (alloc > 1e-9) {
      portions.push({
        amount: alloc,
        sinceYear: t.sinceYear,
        heldYears: t.heldYears,
        initialCompleted: true, // every real/bonus-extended tranche has existed >=1 full policy year
        specificIllnessRemainingYears: Math.max(0, SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS - t.heldYears),
        specificIllnessCompleted: t.heldYears >= SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS,
      });
      remaining -= alloc;
    }
  }

  if (remaining > 1e-9) {
    portions.push({
      amount: remaining,
      sinceYear: null,
      heldYears: 0,
      initialCompleted: false,
      specificIllnessRemainingYears: SPECIFIC_ILLNESS_WAITING_PERIOD_YEARS,
      specificIllnessCompleted: false,
    });
  }

  return portions;
}

/** A declared PED group's waiting-period clock runs from its own declared
 * policy year through to the current policy year — never from the main
 * policy's own inception date (see PED WAITING PERIOD in the spec).
 *
 * The two declaration paths use deliberately different formulas, pinned
 * down from the product spec's own worked numbers (3-year policy):
 *   - "Declared at inception" -> 3 years served (0 remaining, completed).
 *   - "Declared in Year 2"    -> 1 year served (2 remaining).
 *   - "Declared in Year 3"    -> 0 years served (3 remaining).
 * A cover tranche dated to policy year X has held years = N - X + 1 (the
 * year it first appeared already counts fully towards it — see
 * deriveCoverTranches). A PED behaves that same inclusive way ONLY when
 * declared at inception (present from before Year 1 even starts, so all N
 * years count). An EXPLICITLY chosen declaration year is a disclosure made
 * AT that year's renewal — the waiting period clock starts running from
 * that renewal, so year X itself is the renewal boundary, not a served
 * year, and only the (N - X) full years after it count: servedYears = N -
 * declaredYear, one less than the inclusive formula. The UI only offers
 * declaredYear starting the year AFTER a member's own join year — "at
 * inception" is the one, unambiguous way to represent that member's own
 * first policy year. */
export function computePedGroupResult(group: PedGroupInput, policyYears: number, memberSinceYear: number): PedResult {
  if (!group.declared) {
    return {
      id: group.id,
      conditions: group.conditions,
      declaredLabel: "Undeclared",
      declared: false,
      servedYears: 0,
      remainingYears: PED_WAITING_PERIOD_YEARS,
      completed: false,
    };
  }

  let servedYears: number;
  let declaredLabel: string;
  if (group.declaredSinceInception) {
    servedYears = Math.max(0, policyYears - memberSinceYear + 1);
    declaredLabel = "Declared at inception";
  } else {
    const declaredYear = group.declaredYear ?? memberSinceYear;
    servedYears = Math.max(0, policyYears - declaredYear);
    declaredLabel = `Declared in Year ${declaredYear}`;
  }

  const remainingYears = Math.max(0, PED_WAITING_PERIOD_YEARS - servedYears);
  return {
    id: group.id,
    conditions: group.conditions,
    declaredLabel,
    declared: true,
    servedYears,
    remainingYears,
    completed: remainingYears === 0,
  };
}

/** An Undeclared PEDs section entry — always a fresh, full 3-year clock; no
 * declaration year is ever asked for or used (see UNDECLARED PEDs). */
export function computeUndeclaredPedResult(id: string, conditions: string): PedResult {
  return {
    id,
    conditions,
    declaredLabel: "Undeclared",
    declared: false,
    servedYears: 0,
    remainingYears: PED_WAITING_PERIOD_YEARS,
    completed: false,
  };
}

/** Summarizes a set of tranche portions into one of the three states the
 * product spec calls for (Completed / Partially remaining / Fresh) for a
 * given waiting-period category. */
export function aggregateTrancheStatus(
  portions: TranchePortion[],
  field: "initial" | "specificIllness"
): WaitingPeriodStatus {
  if (portions.length === 0) return "fresh";
  const completedFlags = portions.map((p) => (field === "initial" ? p.initialCompleted : p.specificIllnessCompleted));
  if (completedFlags.every((c) => c)) return "completed";
  if (completedFlags.every((c) => !c)) return "fresh";
  return "partial";
}

/** Same three-state summary, applied across every PED result for one
 * member. "none" is a 4th, PED-specific case (the member declared no PEDs
 * at all, so there is nothing to summarize). */
export function aggregatePedStatus(pedResults: PedResult[]): WaitingPeriodStatus | "none" {
  if (pedResults.length === 0) return "none";
  if (pedResults.every((p) => p.completed)) return "completed";
  if (pedResults.every((p) => p.servedYears === 0)) return "fresh";
  return "partial";
}

function calculateMemberResult(
  member: MemberInput,
  ownerTranchesWithBonus: CoverTranche[],
  policyYears: number,
  portingCoverAmount: number
): MemberResult {
  const effectiveTranches = computeEffectiveTranchesForMember(ownerTranchesWithBonus, policyYears, member.memberSinceYear);
  const tranches = allocatePortingCover(effectiveTranches, portingCoverAmount);
  const carryForwardAmount = tranches.filter((t) => t.sinceYear !== null).reduce((sum, t) => sum + t.amount, 0);
  const freshAmount = tranches.filter((t) => t.sinceYear === null).reduce((sum, t) => sum + t.amount, 0);

  const pedResults: PedResult[] = member.hasPeds
    ? [
        ...member.pedGroups.map((g) => computePedGroupResult(g, policyYears, member.memberSinceYear)),
        ...member.undeclaredPedConditions
          .filter((c) => c.trim().length > 0)
          .map((c, i) => computeUndeclaredPedResult(`${member.id}-undeclared-${i}`, c)),
      ]
    : [];

  return {
    id: member.id,
    relationship: member.relationship,
    memberSinceYear: member.memberSinceYear,
    tranches,
    carryForwardAmount,
    freshAmount,
    initialStatus: aggregateTrancheStatus(tranches, "initial"),
    specificIllnessStatus: aggregateTrancheStatus(tranches, "specificIllness"),
    pedResults,
    pedStatus: aggregatePedStatus(pedResults),
  };
}

/** Top-level entry point — pure function, deterministic: the same input
 * always produces the same output (see CALCULATION ARCHITECTURE in the
 * spec). No AI/LLM calls, no fuzzy matching, no medical reasoning. */
export function calculatePortingAssist(input: PortingAssistInput): PortingAssistResult {
  const policyYears = input.coverHistory.length;
  const ownerTranches = deriveCoverTranches(input.coverHistory);
  const ownerTranchesWithBonus = mergeBonusIntoTranches(ownerTranches, input.availableBonus);
  const currentCoverAmount = ownerTranches.reduce((sum, t) => sum + t.amount, 0);
  const eligibleCarryForwardCapacity = ownerTranchesWithBonus.reduce((sum, t) => sum + t.amount, 0);

  const ownerPortions = allocatePortingCover(ownerTranchesWithBonus, input.portingCoverAmount);
  const totalCarryForwardAmount = ownerPortions.filter((t) => t.sinceYear !== null).reduce((s, t) => s + t.amount, 0);
  const totalFreshAmount = ownerPortions.filter((t) => t.sinceYear === null).reduce((s, t) => s + t.amount, 0);

  const members = input.members.map((m) =>
    calculateMemberResult(m, ownerTranchesWithBonus, policyYears, input.portingCoverAmount)
  );

  return {
    policyYears,
    currentCoverAmount,
    eligibleCarryForwardCapacity,
    totalCarryForwardAmount,
    totalFreshAmount,
    ownerTranches: ownerPortions,
    members,
  };
}

/** A member result stripped of its own identity fields, for equality
 * comparison — two members "have the same result" when everything BUT who
 * they are matches. */
type ComparableMemberResult = Omit<MemberResult, "id" | "relationship" | "memberSinceYear"> & { memberSinceYear: number };

function toComparable(m: MemberResult): ComparableMemberResult {
  const { id: _id, relationship: _relationship, ...rest } = m;
  return rest;
}

export interface ConsolidatedMemberGroup {
  memberIds: string[];
  relationships: string[];
  result: MemberResult;
}

/** Groups members whose full calculated result is identical, so the UI can
 * say "Self and Spouse: same waiting-period status" instead of repeating
 * identical detail twice (see FAMILY OUTPUT in the spec). Order-preserving:
 * groups appear in the order their first member appears in `members`. */
export function groupMembersByIdenticalResult(members: MemberResult[]): ConsolidatedMemberGroup[] {
  const groups: { key: string; group: ConsolidatedMemberGroup }[] = [];
  for (const member of members) {
    const key = JSON.stringify(toComparable(member));
    const existing = groups.find((g) => g.key === key);
    if (existing) {
      existing.group.memberIds.push(member.id);
      existing.group.relationships.push(member.relationship);
    } else {
      groups.push({ key, group: { memberIds: [member.id], relationships: [member.relationship], result: member } });
    }
  }
  return groups.map((g) => g.group);
}

/** Full Indian-numbering rupee format for the results view, e.g. 2000000 ->
 * "20,00,000". Deliberately full figures, not Lakh/Crore-abbreviated —
 * Porting Assist's own reference layout shows amounts this way, unlike
 * Cover Projection Assist's formatINR (Lakh/Crore short form). */
export function formatRupees(amount: number): string {
  return Math.round(amount).toLocaleString("en-IN");
}

/** Basic, non-medical input validation (see VALIDATION in the spec) — only
 * structural checks, never anything about whether a condition is really a
 * PED. Returns a flat list of human-readable error messages; empty means
 * valid. */
export function validatePortingAssistInput(input: PortingAssistInput): string[] {
  const errors: string[] = [];
  const policyYears = input.coverHistory.length;

  if (policyYears < 1) errors.push("Enter at least one policy year of cover history.");
  for (const entry of input.coverHistory) {
    if (!Number.isFinite(entry.coverAmount) || entry.coverAmount < 0) {
      errors.push(`Enter a valid cover amount for Year ${entry.policyYear}.`);
    }
  }
  if (!Number.isFinite(input.availableBonus) || input.availableBonus < 0) {
    errors.push("Enter a valid available bonus amount (0 or more).");
  }
  if (!Number.isFinite(input.portingCoverAmount) || input.portingCoverAmount <= 0) {
    errors.push("Enter a valid porting cover amount.");
  }
  if (input.members.length === 0) {
    errors.push("Add at least one member.");
  }

  for (const member of input.members) {
    if (member.memberSinceYear < 1 || member.memberSinceYear > policyYears) {
      errors.push(`${member.relationship || "A member"}'s "Member Since" year must fall within the policy's ${policyYears}-year history.`);
    }
    if (member.hasPeds) {
      for (const group of member.pedGroups) {
        if (!group.conditions.trim()) {
          errors.push(`${member.relationship || "A member"} has a PED group with no condition entered.`);
        }
        if (group.declared && !group.declaredSinceInception) {
          if (group.declaredYear === null) {
            errors.push(`${member.relationship || "A member"} has a declared PED with no declaration year selected.`);
          } else if (group.declaredYear <= member.memberSinceYear || group.declaredYear > policyYears) {
            errors.push(
              `${member.relationship || "A member"}'s PED declaration year must fall after when they joined (Year ${member.memberSinceYear}) and no later than the current policy year (Year ${policyYears}) — use "Declared since inception" for their own first policy year.`
            );
          }
        }
      }
    }
  }

  return errors;
}
