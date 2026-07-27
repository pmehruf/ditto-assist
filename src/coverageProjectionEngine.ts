/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bonus + Restoration simulation engine — Coverage Projection Studio.
// Direct TypeScript port of the standalone Coverage Projection Studio's
// engine.js (validated against 7 insurers' reference illustration sheets;
// 48/48 scenarios, 70/70 unit tests passing as of the last QA cycle). Logic
// is unchanged from that validated source — only types were added.
//
// PLANS holds one entry per real, distinctly-named plan/product (no
// bracketed descriptive text in the name) — e.g. "HDFC Ergo Optima Secure"
// and "HDFC Ergo Optima Secure+" are separate entries, since Secure+ is a
// genuinely different product (Infinite Benefit + built-in unlimited
// restore reload), not just a togglable feature of "Secure". The one
// exception is Care Supreme, whose Cumulative Bonus Super / Booster are true
// optional add-ons on the same base product — that choice is exposed via
// `addonOptions` and resolved with `resolvePlan(id, choices)`.
//
// Resolved plan fields (what `simulate()` consumes):
//   multiplier: { label, factor } | null
//     Secure Benefit tier. `factor` is relative to Base SI, e.g. factor 1 means
//     the tier itself equals 1x Base SI (giving a "2X" total with Base SI).
//   bonusTracks: [{ label, growthPct, capPct, capAbsolute? }]
//     capPct: null = uncapped. capAbsolute (rupees): an extra absolute ceiling
//     on top of capPct (used by Activ One Max/NXT's Rs 3 Cr cap).
//   bonusMode: 'formula' (default) | 'unusedBaseCarryforward'
//     'formula': bonusTracks[i] value each year = min(cap, growthPct% x SI x (year-1)),
//     a pure function of elapsed policy years, unaffected by claims (confirmed:
//     "irrespective of claims made" language for Plus/Infinite Benefit,
//     Cumulative Bonus/Super/Booster, Super Credit).
//     'unusedBaseCarryforward': bonusTracks[0] accumulates the UNUSED portion of
//     Base SI at the end of each year (this is how ReAssure 2.0's Booster+
//     actually works: "if Base SI is not used during a policy year, the unused
//     amount is carried forward as Booster+").
//   restorationType: 'annual' | 'lifetime' | 'always'
//     'annual': resets (un-triggered) at the start of every policy year.
//     'lifetime': triggers once on the first paid claim ever, persists forever
//     after, and refreshes to a full 100% top-up at each subsequent policy
//     year boundary once triggered (like 'always', but starting later).
//     'always': pre-triggered from Year 1, refreshed to full every year.
//   reloadPerClaim: boolean
//     true ("Unlimited"): once triggered, restoration reloads to a full 100%
//     of Base SI before each claim after the triggering one.
//     false ("Once per policy year"): restoration is a single 100%-of-SI top-up
//     that is drawn down (not refilled) by claims for the rest of that trigger
//     scope. This is the DEFAULT, unenhanced behaviour for HDFC Ergo Optima
//     Secure / Optima Super Secure's Plus Benefit variant; attaching the
//     optional "Unlimited Restore Rider" switches it to true. The Infinite
//     Benefit variant already bundles unlimited reload (riderAvailable: false).
//   riderAvailable: boolean — whether the UI should offer the Unlimited Restore
//     Rider toggle for this resolved plan.
//   baseRestorationCap: boolean — Base + Restoration combined cannot pay out
//     more than the original Base SI on a single claim (Optima Secure,
//     Optima Secure+, Optima Super Secure, Care Supreme only).

const CR = 10_000_000; // 1 Crore in rupees

export interface BonusTrack {
  label: string;
  growthPct: number;
  capPct: number | null;
  capAbsolute?: number;
}

export interface Multiplier {
  label: string;
  factor: number;
}

export type RestorationType = "annual" | "lifetime" | "always";
export type BonusMode = "formula" | "unusedBaseCarryforward";
export type AddonKey = "none" | "cbs" | "cbb";

export interface AddonOption {
  label: string;
  growthPct: number;
  capPct: number | null;
}

/** Raw plan family entry, as authored in PLANS. */
export interface PlanDef {
  id: string;
  name: string;
  insurer: string;
  product: string;
  multiplier?: Multiplier | null;
  bonusTracks?: BonusTrack[];
  bonusMode?: BonusMode;
  restorationType: RestorationType;
  restorationLabel: string;
  reloadPerClaim: boolean;
  riderAvailable?: boolean;
  baseRestorationCap?: boolean;
  restorationDisabled?: boolean;
  // Care Supreme only:
  baseBonus?: BonusTrack;
  addonOptions?: Record<AddonKey, AddonOption | null>;
  defaultAddon?: AddonKey;
}

/** Resolved, simulate()-ready plan (output of resolvePlan). */
export interface ResolvedPlan {
  id: string;
  name: string;
  insurer: string;
  product: string;
  multiplier: Multiplier | null;
  bonusTracks: BonusTrack[];
  bonusMode?: BonusMode;
  addonKey?: AddonKey;
  restorationType: RestorationType;
  restorationLabel: string;
  reloadPerClaim: boolean;
  riderAvailable?: boolean;
  baseRestorationCap?: boolean;
  restorationDisabled?: boolean;
}

export const PLANS: PlanDef[] = [
  {
    id: "hdfc_secure",
    name: "HDFC Ergo Optima Secure",
    insurer: "HDFC ERGO",
    product: "Optima Secure",
    multiplier: { label: "Secure Benefit (2X)", factor: 1 },
    bonusTracks: [{ label: "Plus Benefit", growthPct: 50, capPct: 100 }],
    restorationType: "annual",
    restorationLabel: "Automatic Restore Benefit",
    reloadPerClaim: false,
    riderAvailable: true,
    // Base + Restoration combined cannot pay out more than the original Base
    // SI on a single claim -- restoration only fills the gap Base leaves,
    // it doesn't add extra capacity on top of SI. Secure Benefit and Bonus
    // are separate buckets and unaffected by this.
    baseRestorationCap: true,
  },
  {
    id: "hdfc_secure_plus",
    name: "HDFC Ergo Optima Secure+",
    insurer: "HDFC ERGO",
    product: "Optima Secure+",
    multiplier: { label: "Secure Benefit (2X)", factor: 1 },
    bonusTracks: [{ label: "Infinite Benefit", growthPct: 100, capPct: null }],
    restorationType: "annual",
    restorationLabel: "Automatic Restore Benefit",
    reloadPerClaim: true,
    baseRestorationCap: true,
  },
  {
    id: "hdfc_super_secure",
    name: "HDFC Ergo Optima Super Secure",
    insurer: "HDFC ERGO",
    product: "Optima Super Secure",
    multiplier: { label: "Secure Benefit (3X)", factor: 2 },
    bonusTracks: [{ label: "Plus Benefit", growthPct: 50, capPct: 100 }],
    restorationType: "annual",
    restorationLabel: "Automatic Restore Benefit",
    reloadPerClaim: false,
    riderAvailable: true,
    baseRestorationCap: true,
  },
  {
    id: "care_supreme",
    name: "Care Supreme",
    insurer: "Care Health",
    product: "Care Supreme",
    baseBonus: { label: "Cumulative Bonus", growthPct: 50, capPct: 100 },
    addonOptions: {
      none: null,
      cbs: { label: "Cumulative Bonus Super (CBS)", growthPct: 100, capPct: 500 },
      cbb: { label: "Cumulative Bonus Booster (CBB)", growthPct: 100, capPct: null },
    },
    defaultAddon: "cbs",
    restorationType: "annual",
    restorationLabel: "Unlimited Automatic Recharge",
    reloadPerClaim: true,
    baseRestorationCap: true,
  },
  {
    id: "ab_max",
    name: "Aditya Birla Activ One MAX",
    insurer: "Aditya Birla",
    product: "Activ One MAX",
    multiplier: null,
    bonusTracks: [{ label: "Super Credit", growthPct: 100, capPct: 500, capAbsolute: 3 * CR }],
    restorationType: "lifetime",
    restorationLabel: "Super Reload",
    reloadPerClaim: true,
  },
  {
    id: "ab_nxt",
    name: "Aditya Birla Activ One NXT",
    insurer: "Aditya Birla",
    product: "Activ One NXT",
    multiplier: null,
    bonusTracks: [{ label: "Super Credit", growthPct: 100, capPct: 500, capAbsolute: 3 * CR }],
    restorationType: "always",
    restorationLabel: "Super Reload",
    reloadPerClaim: true,
  },
  {
    id: "nb_bronze",
    name: "Niva Bupa ReAssure 2.0 Bronze+",
    insurer: "Niva Bupa",
    product: "ReAssure 2.0 Bronze+",
    multiplier: null,
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 300 }],
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure+ (Forever)",
    reloadPerClaim: true,
  },
  {
    id: "nb_platinum",
    name: "Niva Bupa ReAssure 2.0 Platinum+",
    insurer: "Niva Bupa",
    product: "ReAssure 2.0 Platinum+",
    multiplier: null,
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 500 }],
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure+ (Forever)",
    reloadPerClaim: true,
  },
  {
    id: "nb_titanium",
    name: "Niva Bupa ReAssure 2.0 Titanium+",
    insurer: "Niva Bupa",
    product: "ReAssure 2.0 Titanium+",
    multiplier: null,
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 1000 }],
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure+ (Forever)",
    reloadPerClaim: true,
  },
];

// Turns a plan family + a choice of add-on into a concrete, simulate()-ready
// plan object. `choices`: { addon: 'none'|'cbs'|'cbb' } -- for care_supreme.
// Plans without addonOptions are returned as-is (already simulate-ready).
export function resolvePlan(id: string, choices?: { addon?: AddonKey }): ResolvedPlan | null {
  const opts = choices || {};
  const base = PLANS.find((p) => p.id === id);
  if (!base) return null;

  if (base.addonOptions) {
    // Both CBS and CBB are true add-ons: they sit alongside the base
    // Cumulative Bonus track (a second column), not in place of it. The
    // only difference between them is the cap (CBS: 500%, CBB: uncapped).
    const addonKey = opts.addon || base.defaultAddon || "none";
    const addon = base.addonOptions[addonKey];
    const bonusTracks: BonusTrack[] = addon
      ? [{ ...(base.baseBonus as BonusTrack) }, { label: addon.label, growthPct: addon.growthPct, capPct: addon.capPct }]
      : [{ ...(base.baseBonus as BonusTrack) }];
    return {
      id: base.id,
      name: base.name,
      insurer: base.insurer,
      product: base.product,
      multiplier: null,
      bonusTracks,
      addonKey,
      restorationType: base.restorationType,
      restorationLabel: base.restorationLabel,
      reloadPerClaim: base.reloadPerClaim,
      baseRestorationCap: base.baseRestorationCap,
    };
  }

  return {
    id: base.id,
    name: base.name,
    insurer: base.insurer,
    product: base.product,
    multiplier: base.multiplier ?? null,
    bonusTracks: base.bonusTracks ?? [],
    bonusMode: base.bonusMode,
    restorationType: base.restorationType,
    restorationLabel: base.restorationLabel,
    reloadPerClaim: base.reloadPerClaim,
    riderAvailable: base.riderAvailable,
    baseRestorationCap: base.baseRestorationCap,
    restorationDisabled: base.restorationDisabled,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Format a rupee amount using the Lakh/Crore convention used in the sheet.
export function formatINR(v: number): string {
  if (v === 0) return "0L";
  const neg = v < 0 ? "-" : "";
  v = Math.abs(v);
  if (v >= 10_000_000) return neg + round2(v / 10_000_000) + "Cr";
  if (v >= 100_000) return neg + round2(v / 100_000) + "L";
  return neg + v.toLocaleString("en-IN");
}

function bonusCap(track: BonusTrack, SI: number): number {
  let cap = track.capPct == null ? Infinity : (SI * track.capPct) / 100;
  if (track.capAbsolute != null) cap = Math.min(cap, track.capAbsolute);
  return cap;
}

// Pure elapsed-year formula bonus (default mode): a function of the policy
// year number only, unaffected by claims made in any prior year.
function bonusValuesForYear(plan: ResolvedPlan, SI: number, year: number): number[] {
  return plan.bonusTracks.map((track) => {
    const raw = (SI * track.growthPct * (year - 1)) / 100;
    return Math.min(bonusCap(track, SI), raw);
  });
}

export interface ClaimResult {
  amount: number;
  base: number;
  multiplier: number;
  bonusTracks: number[];
  restoration: number;
  usedFromRestoration: number;
  shortfall: number;
  triggeredThisClaim: boolean;
}

export interface YearState {
  base: number;
  multiplier: number;
  bonusTracks: number[];
  restoration: number;
}

export interface YearResult {
  year: number;
  opening: YearState;
  claims: ClaimResult[];
  closing: YearState;
}

export interface SimulateOptions {
  /** Override the plan's default reload behaviour (used for the "Unlimited Restore Rider" toggle). */
  reloadPerClaim?: boolean;
}

/**
 * Simulate base/bonus/restoration behaviour across `numYears` policy years.
 *
 * @param plan - a resolved plan config (see resolvePlan above)
 * @param SI - sum insured (in rupees)
 * @param numYears
 * @param claimsByYear - map of year -> array of claim amounts (rupees), in the order they occur
 * @param options
 * @returns one entry per year: { year, opening, claims: [...], closing }
 */
export function simulate(
  plan: ResolvedPlan,
  SI: number,
  numYears: number,
  claimsByYear: Record<number, number[]>,
  options?: SimulateOptions
): YearResult[] {
  const opts = options || {};
  const reloadPerClaim = opts.reloadPerClaim != null ? opts.reloadPerClaim : plan.reloadPerClaim;
  const bonusMode = plan.bonusMode || "formula";

  const results: YearResult[] = [];

  // Persistent bonus track values, used only in 'unusedBaseCarryforward' mode.
  let carryforwardBonus: number[] = plan.bonusTracks.map(() => 0);

  let restoration = {
    triggered: plan.restorationType === "always",
    remaining: plan.restorationType === "always" ? SI : 0,
  };

  for (let year = 1; year <= numYears; year++) {
    if (year > 1) {
      if (plan.restorationType === "annual") {
        restoration = { triggered: false, remaining: 0 };
      } else if (plan.restorationType === "always") {
        restoration.remaining = SI;
      } else if (plan.restorationType === "lifetime" && restoration.triggered) {
        // Once triggered, lifetime-type restoration behaves like 'always'
        // from that point on: a fresh 100% top-up at the start of every
        // subsequent policy year (claims within the year still reload it
        // per-claim where applicable; this only affects the opening/idle
        // display for years before the next claim).
        restoration.remaining = SI;
      }
    }

    const bonusValues =
      bonusMode === "unusedBaseCarryforward" ? carryforwardBonus.slice() : bonusValuesForYear(plan, SI, year);

    const opening: YearState = {
      base: SI,
      multiplier: plan.multiplier ? SI * plan.multiplier.factor : 0,
      bonusTracks: bonusValues.slice(),
      restoration: restoration.triggered ? restoration.remaining : 0,
    };

    let base = SI;
    let mult = plan.multiplier ? SI * plan.multiplier.factor : 0;
    let bt = bonusValues.slice();

    const claims = (claimsByYear && claimsByYear[year]) || [];
    const claimResults: ClaimResult[] = [];

    for (const amt of claims) {
      const wasTriggeredBefore = restoration.triggered;

      // Reload rule (only for plans/riders with reloadPerClaim=true): once
      // restoration is active, it tops back up to full nominal value before
      // every claim after the one that triggered it.
      if (!plan.restorationDisabled && wasTriggeredBefore && reloadPerClaim) {
        restoration.remaining = SI;
      }

      let remaining = amt;
      const consume = (avail: number): number => {
        const used = Math.min(avail, remaining);
        remaining -= used;
        return avail - used;
      };

      const baseBeforeClaim = base;
      base = consume(base);
      if (plan.multiplier) mult = consume(mult);
      bt = bt.map((v) => consume(v));

      let usedFromRestoration = 0;
      let shortfall = 0;

      if (plan.restorationDisabled) {
        // Restoration switched off entirely (e.g. to explain Bonus in isolation):
        // any amount beyond Base/Secure/Bonus is simply a shortfall.
        if (remaining > 0) shortfall = remaining;
      } else if (!wasTriggeredBefore) {
        // This claim triggers restoration for FUTURE claims; it cannot draw on it itself.
        // Restoration is always a full 100% of Base SI top-up on trigger.
        restoration.triggered = true;
        restoration.remaining = SI;
        if (remaining > 0) shortfall = remaining;
      } else {
        if (remaining > 0) {
          // Optima Secure/Secure+/Super Secure and Care Supreme cap what
          // Base + Restoration can pay out on a SINGLE claim at the original
          // Base SI -- restoration only tops up the gap Base leaves behind,
          // it doesn't let the combined bucket exceed SI. Secure Benefit and
          // Bonus are separate buckets, already drawn above, and unaffected.
          let restorationAvailable = restoration.remaining;
          if (plan.baseRestorationCap) {
            const allowance = Math.max(0, SI - baseBeforeClaim);
            restorationAvailable = Math.min(restorationAvailable, allowance);
          }
          const used = Math.min(restorationAvailable, remaining);
          restoration.remaining -= used;
          remaining -= used;
          usedFromRestoration = used;
        }
        if (remaining > 0) shortfall = remaining;
      }

      claimResults.push({
        amount: amt,
        base,
        multiplier: mult,
        bonusTracks: bt.slice(),
        restoration: restoration.triggered ? restoration.remaining : 0,
        usedFromRestoration,
        shortfall,
        triggeredThisClaim: !wasTriggeredBefore,
      });
    }

    if (bonusMode === "unusedBaseCarryforward") {
      // Unused Base SI this year is credited to Booster+ at year end, on
      // top of whatever this year's claims already drew the balance down
      // to (bt[i], not the stale pre-claim carryforwardBonus[i]) -- a
      // claim's draw-down must persist, not "heal" at the next credit.
      const unusedBase = base; // remaining, un-consumed Base SI at year end
      carryforwardBonus = carryforwardBonus.map((_, i) => {
        const track = plan.bonusTracks[i];
        return Math.min(bonusCap(track, SI), bt[i] + unusedBase);
      });
    }

    const closing: YearState = {
      base,
      multiplier: mult,
      bonusTracks: bonusMode === "unusedBaseCarryforward" ? carryforwardBonus.slice() : bt.slice(),
      restoration: restoration.triggered ? restoration.remaining : 0,
    };

    results.push({ year, opening, claims: claimResults, closing });
  }

  return results;
}

// For plans where Base + Restoration combined cannot exceed the original
// Base SI on a single claim (baseRestorationCap), the restoration bucket
// may still hold more than what's actually usable given the current Base
// balance. Any "total available/usable" figure must reflect only the
// usable portion -- min(restoration, SI - base) -- not the raw bucket.
export function usableRestoration(restorationValue: number, baseValue: number, SI: number | undefined | null, plan: ResolvedPlan): number {
  if (!plan.baseRestorationCap || SI == null) return restorationValue;
  const allowance = Math.max(0, SI - baseValue);
  return Math.min(restorationValue, allowance);
}

export function totalOf(state: YearState, plan: ResolvedPlan, SI?: number | null): number {
  return (
    state.base +
    (plan.multiplier ? state.multiplier : 0) +
    state.bonusTracks.reduce((a, b) => a + b, 0) +
    usableRestoration(state.restoration, state.base, SI, plan)
  );
}
