/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bonus + Restoration simulation engine — Coverage Projection Studio.
// Direct TypeScript port of the standalone Coverage Projection Studio's
// engine.js (validated against 7 insurers' reference illustration sheets;
// 48/48 scenarios, 70/70 unit tests passing as of the last QA cycle). Logic
// for the ORIGINAL plan set (HDFC Secure/Secure+/Super Secure, Care Supreme,
// Activ One MAX/NXT, Niva Bupa ReAssure 2.0 Bronze+/Platinum+/Titanium+) is
// UNCHANGED from that validated source. Everything below the "NEW PLANS"
// marker is an additive expansion (Care Freedom/Heart/Care/Ultimate, Aditya
// Birla Activ Yuva, Niva Bupa ReAssure 3.0, Niva Bupa Aspire) layered on top
// without touching the original plans' math -- see the accompanying report
// for the full plan matrix, collision analysis and regression results.
//
// PLANS holds one entry per real, distinctly-named plan/product (no
// bracketed descriptive text in the name) — e.g. "HDFC Ergo Optima Secure"
// and "HDFC Ergo Optima Secure+" are separate entries, since Secure+ is a
// genuinely different product (Infinite Benefit + built-in unlimited
// restore reload), not just a togglable feature of "Secure". Care Supreme,
// Care Care and Care Ultimate follow the same "true optional add-on on the
// same base product" pattern via `addonOptions`, resolved with
// `resolvePlan(id, choices)`.
//
// Resolved plan fields (what `simulate()` consumes):
//   multiplier: { label, factor } | null
//     Secure Benefit tier. `factor` is relative to Base SI, e.g. factor 1 means
//     the tier itself equals 1x Base SI (giving a "2X" total with Base SI).
//   bonusTracks: [{ label, growthPct, capPct, capAbsolute? }]
//     capPct: null = uncapped. capAbsolute (rupees): an extra absolute ceiling
//     on top of capPct (used by Activ One Max/NXT's Rs 3 Cr cap).
//   bonusMode: 'formula' (default) | 'unusedBaseCarryforward' | 'clawbackAccrual' | 'loyaltyBoost'
//     Resolved per-track: a track's own `mode` wins if set, else the plan's
//     `bonusMode`, else 'formula' -- almost every plan uses ONE mode across
//     all its tracks (unaffected by this), but Care Ultimate mixes 'formula'
//     (Loyalty/Infinity Bonus) with 'loyaltyBoost' (its separate Loyalty
//     Boost track) on the same plan.
//     'formula': bonusTracks[i] value each year = min(cap, growthPct% x SI x (year-1)),
//     a pure function of elapsed policy years, unaffected by claims (confirmed:
//     "irrespective of claims made" language for Plus/Infinite Benefit,
//     Cumulative Bonus/Super/Booster, Super Credit, Loyalty/Infinity Bonus).
//     'unusedBaseCarryforward': bonusTracks[0] accumulates the UNUSED portion of
//     Base SI at the end of each year (this is how ReAssure 2.0/3.0/Aspire's
//     Booster+ actually works: "if Base SI is not used during a policy year,
//     the unused amount is carried forward as Booster+").
//     'clawbackAccrual': a STATEFUL No Claim Bonus track -- grows by one
//     growthPct-of-SI "unit" at the end of every claim-free policy year (up
//     to capPct), and is clawed back by exactly one unit at the end of any
//     policy year that had at least one claim (e.g. 20% -> 10%, never simply
//     recomputed as year*growthPct%). Used by Care Heart/Care Care's NCB and
//     Care Care's optional NCB Super add-on.
//     'loyaltyBoost': a STATEFUL, ONE-TIME lump sum -- not a recurring
//     annual bonus. Tracks a consecutive-claim-free-year streak; once it
//     reaches `track.requiredClaimFreeYears`, the track is credited exactly
//     once with `growthPct`% of the ORIGINAL Sum Insured (the single `SI`
//     parameter this simulate() run was called with -- this engine has no
//     notion of SI changing mid-run, so "first policy year SI" and "current
//     SI" are the same value throughout). Any claim in a year before that
//     resets the streak to zero. Once granted, the value is never
//     regenerated or topped up again -- it only ever goes down, drawn on by
//     claims through the same generic consumption pipeline as every other
//     bonus track. Used by Care Ultimate's Loyalty Boost.
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
//   restorationClaimRule: 'baseCapped' | 'independentBucket' (explicit alias
//     for the same rule `baseRestorationCap` enforces at runtime -- see below)
//     'baseCapped': Base + Restoration combined cannot pay out more than the
//     original Base SI on a single claim (HDFC Optima Secure/Secure+/Super
//     Secure, Care Supreme, Care Freedom/Heart/Care/Ultimate).
//     'independentBucket': Restoration is a fully independent bucket that can
//     combine with whatever Base is left over, beyond the original SI, with
//     no cap (Aditya Birla Activ One MAX/NXT, all Niva Bupa ReAssure/Aspire
//     plans) -- e.g. ₹4L Base remaining + ₹10L Restoration = ₹14L usable, NOT
//     reduced to ₹6L.
//   baseRestorationCap: boolean — the actual runtime switch simulate()/
//     usableRestoration() read to enforce the rule above. Kept as a plain
//     boolean (unchanged from the original engine) rather than re-deriving it
//     from restorationClaimRule at runtime, so the already-validated math for
//     every existing plan is untouched; restorationClaimRule and
//     baseRestorationCap are simply kept in sync by hand on every PLANS entry.
//   illnessScope: 'anyIllness' | 'differentIllness' (new) — when
//     'differentIllness', restoration can only be drawn by a claim whose
//     illnessGroup differs from the claim that triggered restoration for the
//     current trigger scope (Care Freedom/Heart's "different illness"
//     restoration condition). Absent/'anyIllness' = no restriction (every
//     other plan, including Care Care).
//   calculationModel: 'generic' (default) | 'activYuva' (legacy) — the
//     'activYuva' dedicated-state-machine dispatch existed only for Aditya
//     Birla Activ Yuva, whose corrected calculation logic (Yuva Credit as a
//     capped formula-mode bonus track, Yuva Reload as an 'always'-type,
//     per-claim-reloading, independent-bucket restoration) turned out to fit
//     the generic Base→Bonus→Restoration pipeline exactly like every other
//     plan. No PLANS entry sets 'activYuva' any more; the literal and the
//     field are kept only so this type remains a strict superset of history.

const CR = 10_000_000; // 1 Crore in rupees

export interface BonusTrack {
  label: string;
  growthPct: number;
  capPct: number | null;
  capAbsolute?: number;
  // Per-track mode override. Every existing track relies on the PLAN-level
  // `bonusMode` (see ResolvedPlan) and leaves this unset -- it exists only so
  // a single plan can mix bonus mechanics across its own tracks (Care
  // Ultimate: Loyalty/Infinity Bonus stays 'formula', while its separate
  // Loyalty Boost track needs 'loyaltyBoost'). Falls back to the plan's
  // `bonusMode` (then "formula") when unset.
  mode?: BonusMode;
  // 'loyaltyBoost' mode only: consecutive claim-free policy years required
  // before this track's one-time lump sum is granted (Care Ultimate: 7).
  requiredClaimFreeYears?: number;
}

export interface Multiplier {
  label: string;
  factor: number;
}

export type RestorationType = "annual" | "lifetime" | "always";
export type BonusMode = "formula" | "unusedBaseCarryforward" | "clawbackAccrual" | "loyaltyBoost";
export type AddonKey = "none" | "cbs" | "cbb" | "ncbSuper" | "infinityBonus";
export type RestorationClaimRule = "baseCapped" | "independentBucket";
export type IllnessScope = "anyIllness" | "differentIllness";
export type CalculationModel = "generic" | "activYuva";
export type AspireVariant = "gold" | "diamond" | "platinum" | "titanium";
export type ReAssure2Variant = "bronze" | "platinum" | "titanium";

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
  // Care Supreme / Care Care / Care Ultimate only:
  baseBonus?: BonusTrack;
  addonOptions?: Partial<Record<AddonKey, AddonOption | null>>;
  defaultAddon?: AddonKey;
  // 'stack' (default, unchanged existing behaviour): the chosen add-on rides
  // ALONGSIDE baseBonus as a second bonusTracks[] entry (Care Supreme's
  // CBS/CBB, Care Care's NCB Super, Care Ultimate's Infinity Bonus -- CONFIRMED
  // by the policy's progressive-deduction wording: "Infinity Bonus is OVER AND
  // ABOVE Loyalty/Cumulative Bonus", consumed strictly after it, never in place
  // of it). 'replace': the chosen add-on stands in for baseBonus instead of
  // stacking with it (not currently used by any plan).
  addonCompose?: "stack" | "replace";
  // Bonus tracks that are ALWAYS prepended before whatever baseBonus/addonKey
  // resolves to, regardless of which addon (if any) is chosen -- for plans
  // that have an addon CHOICE plus a separate, always-present stateful track
  // that is consumed BEFORE that choice (Care Ultimate: Loyalty Boost is
  // consumed before Loyalty/Cumulative Bonus and Infinity Bonus, per the
  // policy's confirmed progressive-deduction order: Base SI -> Loyalty Boost
  // -> Cumulative Bonus -> Infinity Bonus -> Restoration). Composition order
  // is bonusTracks array order, which is also consumption order (Base ->
  // bonusTracks[0] -> bonusTracks[1] -> ... -> Restoration) -- see
  // `mode`/`requiredClaimFreeYears` on BonusTrack.
  leadingBonusTracks?: BonusTrack[];
  // Which bonusTracks[] index is the plan's actual named "Bonus" for UI
  // display purposes (column header / legend line) -- defaults to 0 for
  // every plan except Care Ultimate (1, since Loyalty Boost occupies index 0
  // as a leadingBonusTrack). Every OTHER track is displayed under its own
  // label as an add-on (index > primaryBonusIndex) or a special feature
  // (index < primaryBonusIndex). This is a pure display concern -- consumption
  // order is unaffected and always follows array order regardless.
  primaryBonusIndex?: number;
  // New, additive fields (see file header for what each means):
  restorationClaimRule?: RestorationClaimRule;
  illnessScope?: IllnessScope;
  calculationModel?: CalculationModel;
  // Niva Bupa Aspire only: Booster+'s cap depends on BOTH entry age and
  // variant (see getAspireBoosterCap) -- resolvePlan() computes the actual
  // bonusTracks for this plan from `choices.entryAge`/`choices.variant`
  // rather than using a fixed bonusTracks array.
  needsAspireInputs?: boolean;
  // Niva Bupa ReAssure 2.0 only: Bronze+/Platinum+/Titanium+ are the SAME
  // product with different Booster+ caps (300%/500%/1000%) -- previously
  // modelled as three separate PLANS entries (nb_bronze/nb_platinum/
  // nb_titanium), now a single plan with a Variant selector, mirroring
  // Aspire's needsAspireInputs pattern. resolvePlan() computes the actual
  // bonusTracks from `choices.reassure2Variant` (see REASSURE2_BOOSTER_CAP)
  // rather than using a fixed bonusTracks array. No calculation logic
  // changed -- the resolved caps are byte-identical to the three old
  // entries' hardcoded values.
  needsReassure2Variant?: boolean;
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
  primaryBonusIndex?: number;
  restorationType: RestorationType;
  restorationLabel: string;
  reloadPerClaim: boolean;
  riderAvailable?: boolean;
  baseRestorationCap?: boolean;
  restorationDisabled?: boolean;
  restorationClaimRule?: RestorationClaimRule;
  illnessScope?: IllnessScope;
  calculationModel?: CalculationModel;
}

// ---------------------------------------------------------------------------
// Niva Bupa Aspire — Booster+ cap resolver.
//
// Aspire's Booster+ multiple depends on BOTH the customer's entry age and the
// chosen variant (Gold+/Diamond+/Platinum+/Titanium+):
//   Entry age 18-35: Gold+ 3X, Diamond+ 5X, Platinum+ 10X, Titanium+ 10X
//   Entry age 36-45: Gold+ 2X, Diamond+ 3X, Platinum+ 5X,  Titanium+ 5X
//   Entry age 46+:   Gold+ 1X, Diamond+ 2X, Platinum+ 3X,  Titanium+ 3X
// Kept as a standalone, unit-testable pure function (not hard-coded into the
// UI) per the source spec, exactly as it would be looked up in the policy
// wording's age-band table.
// ---------------------------------------------------------------------------
const ASPIRE_BOOSTER_CAP_MATRIX: Record<"young" | "mid" | "senior", Record<AspireVariant, number>> = {
  young: { gold: 3, diamond: 5, platinum: 10, titanium: 10 },
  mid: { gold: 2, diamond: 3, platinum: 5, titanium: 5 },
  senior: { gold: 1, diamond: 2, platinum: 3, titanium: 3 },
};

// Ages below 18 aren't defined by the source policy tables. Rather than
// invent new product mathematics, out-of-range low ages are clamped into the
// youngest ("18-35") band -- documented as a known limitation in the report.
export function getAspireBoosterCap(entryAge: number, variant: AspireVariant): number {
  const band = entryAge <= 35 ? "young" : entryAge <= 45 ? "mid" : "senior";
  return ASPIRE_BOOSTER_CAP_MATRIX[band][variant];
}

// Niva Bupa ReAssure 2.0 -- Booster+ cap by Variant. Byte-identical to the
// three old separate PLANS entries' hardcoded capPct values (300/500/1000);
// only the plan/variant STRUCTURE changed, not these numbers.
const REASSURE2_BOOSTER_CAP: Record<ReAssure2Variant, number> = {
  bronze: 300,
  platinum: 500,
  titanium: 1000,
};

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
    restorationClaimRule: "baseCapped",
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
    restorationClaimRule: "baseCapped",
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
    restorationClaimRule: "baseCapped",
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
    restorationClaimRule: "baseCapped",
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
    restorationClaimRule: "independentBucket",
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
    restorationClaimRule: "independentBucket",
  },
  {
    // Was three separate PLANS entries (nb_bronze/nb_platinum/nb_titanium) --
    // Bronze+/Platinum+/Titanium+ are Variants of ONE plan, not distinct
    // products, so the UI now offers a single "Niva Bupa ReAssure 2.0" plan
    // with a Variant selector (same pattern as Aspire's needsAspireInputs).
    // Every other field (restorationType/Label, reloadPerClaim, bonusMode,
    // restorationClaimRule) was already identical across all three old
    // entries -- only the Booster+ cap differed, and that's exactly what
    // `needsReassure2Variant` + REASSURE2_BOOSTER_CAP now resolve per
    // Variant, with the SAME 300%/500%/1000% values as before.
    id: "nb_reassure2",
    name: "Niva Bupa ReAssure 2.0",
    insurer: "Niva Bupa",
    product: "ReAssure 2.0",
    needsReassure2Variant: true,
    multiplier: null,
    // Placeholder cap -- resolvePlan() overrides this with the Variant's
    // actual cap from REASSURE2_BOOSTER_CAP at resolve time (see
    // needsAspireInputs' identical placeholder-override pattern above).
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 300 }],
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure+ (Forever)",
    reloadPerClaim: true,
    restorationClaimRule: "independentBucket",
  },

  // -------------------------------------------------------------------------
  // NEW PLANS (additive -- none of the above were touched).
  // -------------------------------------------------------------------------

  {
    id: "care_freedom",
    name: "Care Freedom",
    insurer: "Care Health",
    product: "Care Freedom",
    // No bonus track at all for this plan -- sequence is Base -> Restoration.
    restorationType: "annual",
    restorationLabel: "Restore Benefit",
    reloadPerClaim: false, // once per policy year
    baseRestorationCap: true,
    restorationClaimRule: "baseCapped",
    // Restoration only usable by a claim for a DIFFERENT illness than the one
    // that triggered it (see illnessScope docs above); once per policy year.
    illnessScope: "differentIllness",
  },
  {
    id: "care_heart",
    name: "Care Heart",
    insurer: "Care Health",
    product: "Care Heart",
    bonusTracks: [{ label: "No Claim Bonus (NCB)", growthPct: 10, capPct: 50 }],
    bonusMode: "clawbackAccrual",
    restorationType: "annual",
    restorationLabel: "Restore Benefit",
    reloadPerClaim: false,
    baseRestorationCap: true,
    restorationClaimRule: "baseCapped",
    illnessScope: "differentIllness",
  },
  {
    id: "care_care",
    name: "Care Care",
    insurer: "Care Health",
    product: "Care Care",
    baseBonus: { label: "No Claim Bonus (NCB)", growthPct: 10, capPct: 50 },
    addonOptions: {
      none: null,
      ncbSuper: { label: "NCB Super", growthPct: 50, capPct: 100 },
    },
    defaultAddon: "none",
    addonCompose: "stack",
    bonusMode: "clawbackAccrual",
    restorationType: "annual",
    restorationLabel: "Restore Benefit",
    reloadPerClaim: false,
    baseRestorationCap: true,
    restorationClaimRule: "baseCapped",
    // illnessScope intentionally left unset: ANY illness qualifies for
    // restoration on this plan, unlike Care Freedom/Heart.
  },
  {
    id: "care_ultimate",
    name: "Care Ultimate",
    insurer: "Care Health",
    product: "Care Ultimate",
    baseBonus: { label: "Loyalty Bonus", growthPct: 50, capPct: 100 },
    addonOptions: {
      none: null,
      // "Not applicable to Unlimited SI" per the source -- trivially
      // satisfied since Unlimited SI is out of scope and not implemented
      // anywhere in this engine.
      infinityBonus: { label: "Infinity Bonus", growthPct: 100, capPct: null },
    },
    defaultAddon: "none",
    // CONFIRMED by the policy's own progressive-deduction wording: Infinity
    // Bonus is OVER AND ABOVE Loyalty/Cumulative Bonus -- it stacks alongside
    // it as a second bonusTracks[] entry, never replacing it.
    addonCompose: "stack",
    // Loyalty Boost: a one-time lump sum of 100% of the original Base SI,
    // credited after 7 CONSECUTIVE claim-free policy years, available once
    // per policy lifetime -- a genuinely separate benefit from the recurring
    // annual Loyalty Bonus, modelled as its own bonusTracks entry with its
    // own 'loyaltyBoost' mode rather than folded into the Loyalty/Infinity
    // Bonus track. Always present regardless of which of Loyalty/Infinity
    // Bonus is chosen (see `leadingBonusTracks`).
    //
    // CONFIRMED claim order (the policy's own progressive-deduction wording):
    //   Base SI -> Loyalty Boost -> Loyalty/Cumulative Bonus -> Infinity
    //   Bonus -> Restoration (Unlimited Automatic Recharge).
    // Loyalty Boost is consumed BEFORE Loyalty/Cumulative Bonus, so it is a
    // `leadingBonusTrack` (prepended, i.e. bonusTracks[0]) rather than
    // appended after the addon-resolved Bonus track(s).
    leadingBonusTracks: [
      { label: "Loyalty Boost", growthPct: 100, capPct: 100, mode: "loyaltyBoost", requiredClaimFreeYears: 7 },
    ],
    // Loyalty Boost occupies bonusTracks[0] (leading); the plan's actual
    // named "Bonus" (Loyalty/Cumulative Bonus) is bonusTracks[1] -- used only
    // for UI display (column header / legend "Bonus" line), never for
    // consumption order.
    primaryBonusIndex: 1,
    restorationType: "annual",
    // Matches the policy's own name for this mechanism (same as Care
    // Supreme's identical Unlimited Automatic Recharge restoration).
    restorationLabel: "Unlimited Automatic Recharge",
    reloadPerClaim: true, // unlimited restoration
    // CONFIRMED by the source: Base + Restoration combined cannot pay out
    // more than the original Base SI on a single claim (same rule as every
    // other Care Health plan in this file).
    baseRestorationCap: true,
    restorationClaimRule: "baseCapped",
  },
  {
    id: "ab_yuva",
    name: "Aditya Birla Activ Yuva",
    insurer: "Aditya Birla",
    product: "Activ Yuva",
    // Yuva Credit and Yuva Reload are two SEPARATE benefits, not one
    // first-claim state machine:
    //  - Yuva Credit: +100% of Base SI on every continuous renewal
    //    (irrespective of claims in the prior year), up to a 1000%/10X cap.
    //    A pure elapsed-year formula track -- claims never affect it, which
    //    is exactly what bonusMode 'formula' (the default) already gives.
    //  - Yuva Reload: restores 100% of Base SI, pre-triggered from policy
    //    Year 1 (so even the FIRST admissible claim can draw on it, giving
    //    up to 2X Base SI for that claim -- Base + Reload, since Credit is
    //    still 0% in year 1), then reloads to a full 100% before every claim
    //    after that (unlimited). This is restorationType 'always' +
    //    reloadPerClaim, the same mechanic Activ One NXT's Super Reload uses.
    //  - Base + Credit + Reload combine with NO cap at the original Base SI
    //    (restorationClaimRule 'independentBucket'): a large claim consumes
    //    Base, then Credit, then Reload, in that order -- matching the
    //    policy's own worked example (10L Base + 40L Credit + 10L Reload =
    //    60L on a Year-5 claim for a 10L SI policy).
    bonusTracks: [{ label: "Yuva Credit", growthPct: 100, capPct: 1000 }],
    restorationType: "always",
    restorationLabel: "Yuva Reload",
    reloadPerClaim: true,
    restorationClaimRule: "independentBucket",
  },
  {
    id: "nb_reassure3",
    name: "Niva Bupa ReAssure 3.0",
    insurer: "Niva Bupa",
    product: "ReAssure 3.0",
    multiplier: null,
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 1000 }], // max 10X
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure+ Forever",
    reloadPerClaim: true,
    // CRITICAL: independent bucket -- Base + ReAssure+ Forever combine with
    // NO cap at the original Base SI (baseRestorationCap intentionally left
    // unset/false, exactly like ab_max/ab_nxt/nb_reassure2 (Bronze+/Platinum+/Titanium+)).
    restorationClaimRule: "independentBucket",
  },
  {
    id: "nb_aspire",
    name: "Niva Bupa Aspire",
    insurer: "Niva Bupa",
    product: "Aspire",
    needsAspireInputs: true,
    // Placeholder cap -- resolvePlan() overrides this with
    // getAspireBoosterCap(entryAge, variant) at resolve time.
    bonusTracks: [{ label: "Booster+", growthPct: 100, capPct: 300 }],
    bonusMode: "unusedBaseCarryforward",
    restorationType: "lifetime",
    restorationLabel: "ReAssure Forever",
    reloadPerClaim: true,
    restorationClaimRule: "independentBucket",
  },
];

// Turns a plan family + a choice of add-on (and, for Aspire, entry
// age/variant) into a concrete, simulate()-ready plan object.
// `choices.addon`: 'none'|'cbs'|'cbb' (Care Supreme) | 'none'|'ncbSuper'
// (Care Care) | 'none'|'infinityBonus' (Care Ultimate).
// `choices.entryAge`/`choices.variant`: Niva Bupa Aspire only.
// Plans without addonOptions/needsAspireInputs are returned as-is (already
// simulate-ready).
export function resolvePlan(
  id: string,
  choices?: { addon?: AddonKey; entryAge?: number; variant?: AspireVariant; reassure2Variant?: ReAssure2Variant }
): ResolvedPlan | null {
  const opts = choices || {};
  const base = PLANS.find((p) => p.id === id);
  if (!base) return null;

  // Aspire's Booster+ cap depends on BOTH entry age and variant -- resolved
  // as a plain numeric override on the single bonus track, not a structural
  // change to the plan shape, so it composes fine with the plain (non-addon)
  // path below.
  let bonusTracksOverride: BonusTrack[] | undefined;
  if (base.needsAspireInputs) {
    const cap = getAspireBoosterCap(opts.entryAge ?? 18, opts.variant ?? "gold");
    bonusTracksOverride = [{ label: "Booster+", growthPct: 100, capPct: cap * 100 }];
  }
  // ReAssure 2.0's Booster+ cap depends only on the chosen Variant -- same
  // placeholder-override mechanism as Aspire above, just a flat lookup
  // instead of an age x variant matrix.
  if (base.needsReassure2Variant) {
    const cap = REASSURE2_BOOSTER_CAP[opts.reassure2Variant ?? "bronze"];
    bonusTracksOverride = [{ label: "Booster+", growthPct: 100, capPct: cap }];
  }

  if (base.addonOptions) {
    // CBS/CBB (Care Supreme), NCB Super (Care Care) and Infinity Bonus (Care
    // Ultimate) are all true "stack" add-ons: they sit alongside the base
    // bonus track (a second column), not in place of it (see addonCompose
    // docs above). No plan currently uses "replace".
    const addonKey = opts.addon || base.defaultAddon || "none";
    const addon = base.addonOptions[addonKey];
    const compose = base.addonCompose || "stack";
    const primaryTracks: BonusTrack[] =
      compose === "replace"
        ? [addon ? { label: addon.label, growthPct: addon.growthPct, capPct: addon.capPct } : { ...(base.baseBonus as BonusTrack) }]
        : addon
          ? [{ ...(base.baseBonus as BonusTrack) }, { label: addon.label, growthPct: addon.growthPct, capPct: addon.capPct }]
          : [{ ...(base.baseBonus as BonusTrack) }];
    // Always-present tracks (e.g. Care Ultimate's Loyalty Boost) are
    // PREPENDED before the addon-resolved track(s) regardless of which addon
    // was chosen -- see PlanDef.leadingBonusTracks.
    const bonusTracks: BonusTrack[] = [...(base.leadingBonusTracks ?? []).map((t) => ({ ...t })), ...primaryTracks];
    return {
      id: base.id,
      name: base.name,
      insurer: base.insurer,
      product: base.product,
      multiplier: null,
      bonusTracks,
      bonusMode: base.bonusMode,
      addonKey,
      primaryBonusIndex: base.primaryBonusIndex,
      restorationType: base.restorationType,
      restorationLabel: base.restorationLabel,
      reloadPerClaim: base.reloadPerClaim,
      baseRestorationCap: base.baseRestorationCap,
      restorationClaimRule: base.restorationClaimRule,
      illnessScope: base.illnessScope,
      calculationModel: base.calculationModel,
    };
  }

  return {
    id: base.id,
    name: base.name,
    insurer: base.insurer,
    product: base.product,
    multiplier: base.multiplier ?? null,
    bonusTracks: [...(base.leadingBonusTracks ?? []).map((t) => ({ ...t })), ...(bonusTracksOverride ?? base.bonusTracks ?? [])],
    bonusMode: base.bonusMode,
    primaryBonusIndex: base.primaryBonusIndex,
    restorationType: base.restorationType,
    restorationLabel: base.restorationLabel,
    reloadPerClaim: base.reloadPerClaim,
    riderAvailable: base.riderAvailable,
    baseRestorationCap: base.baseRestorationCap,
    restorationDisabled: base.restorationDisabled,
    restorationClaimRule: base.restorationClaimRule,
    illnessScope: base.illnessScope,
    calculationModel: base.calculationModel,
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

// Resolves which BonusMode governs a given track: its own `mode` override if
// set, else the plan's `bonusMode`, else the default 'formula'. Every plan
// except Care Ultimate uses one uniform mode across all of its tracks (their
// tracks never set `mode`), so this is a no-op generalization for them.
function trackMode(plan: ResolvedPlan, track: BonusTrack): BonusMode {
  return track.mode || plan.bonusMode || "formula";
}

function isStatefulMode(mode: BonusMode): boolean {
  return mode === "unusedBaseCarryforward" || mode === "clawbackAccrual" || mode === "loyaltyBoost";
}

// Pure elapsed-year formula value for one track: a function of the policy
// year number only, unaffected by claims made in any prior year.
function formulaValueForTrack(track: BonusTrack, SI: number, year: number): number {
  const raw = (SI * track.growthPct * (year - 1)) / 100;
  return Math.min(bonusCap(track, SI), raw);
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

// A claim can either be a plain rupee amount (every existing test/call site,
// unchanged) or a { amount, illnessGroup } object for plans whose
// restoration rule cares which illness a claim is for (Care Freedom/Care
// Heart). illnessGroup is a lightweight, neutral simulation label ("A" / "B"
// / "C") -- NOT a medical diagnosis mapping -- and is ignored entirely by
// every plan that doesn't set illnessScope: 'differentIllness'.
export interface ClaimInput {
  amount: number;
  illnessGroup?: string;
}
export type RawClaim = number | ClaimInput;

function normalizeClaim(raw: RawClaim): { amount: number; illnessGroup?: string } {
  return typeof raw === "number" ? { amount: raw } : raw;
}

/**
 * Simulate base/bonus/restoration behaviour across `numYears` policy years.
 *
 * @param plan - a resolved plan config (see resolvePlan above)
 * @param SI - sum insured (in rupees)
 * @param numYears
 * @param claimsByYear - map of year -> array of claims, in the order they occur.
 *   Each claim is either a plain rupee amount or a { amount, illnessGroup } object.
 * @param options
 * @returns one entry per year: { year, opening, claims: [...], closing }
 */
export function simulate(
  plan: ResolvedPlan,
  SI: number,
  numYears: number,
  claimsByYear: Record<number, RawClaim[]>,
  options?: SimulateOptions
): YearResult[] {
  return simulateGeneric(plan, SI, numYears, claimsByYear, options);
}

// The original, validated engine (formerly named `simulate`). Handles every
// plan whose math fits the generic Base -> Multiplier -> bonusTracks[] ->
// Restoration consumption pipeline -- which, since Activ Yuva's calculation
// fix, is every plan in this file.
// Additive hooks were layered in on top of the original logic, each a strict
// no-op for every plan/track that doesn't opt in:
//   - bonusMode 'clawbackAccrual' (Care Heart/Care Care's stateful NCB)
//   - bonusMode 'loyaltyBoost' + per-track `mode` override (Care Ultimate's
//     one-time, 7-claim-free-year lump sum, distinct from its recurring
//     annual Loyalty/Infinity Bonus track)
//   - illnessScope 'differentIllness' (Care Freedom/Care Heart's same-illness
//     restoration block)
function simulateGeneric(
  plan: ResolvedPlan,
  SI: number,
  numYears: number,
  claimsByYear: Record<number, RawClaim[]>,
  options?: SimulateOptions
): YearResult[] {
  const opts = options || {};
  const reloadPerClaim = opts.reloadPerClaim != null ? opts.reloadPerClaim : plan.reloadPerClaim;

  const results: YearResult[] = [];

  // Persistent bonus track values, used only for stateful-mode tracks
  // (unusedBaseCarryforward / clawbackAccrual / loyaltyBoost). Indices for
  // 'formula'-mode tracks are never read.
  let persistentBonus: number[] = plan.bonusTracks.map(() => 0);
  // 'loyaltyBoost' mode only: consecutive claim-free year streak + whether
  // the one-time lump sum has already been granted, per track index.
  const loyaltyBoostState: { streak: number; granted: boolean }[] = plan.bonusTracks.map(() => ({
    streak: 0,
    granted: false,
  }));

  let restoration: { triggered: boolean; remaining: number; triggeringIllnessGroup?: string } = {
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

    const bonusValues = plan.bonusTracks.map((track, i) =>
      isStatefulMode(trackMode(plan, track)) ? persistentBonus[i] : formulaValueForTrack(track, SI, year)
    );

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

    for (const raw of claims) {
      const { amount: amt, illnessGroup: claimIllnessGroup } = normalizeClaim(raw);
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
        if (plan.illnessScope === "differentIllness") {
          restoration.triggeringIllnessGroup = claimIllnessGroup;
        }
        if (remaining > 0) shortfall = remaining;
      } else {
        if (remaining > 0) {
          // Optima Secure/Secure+/Super Secure, Care Supreme and Care
          // Freedom/Heart/Care/Ultimate cap what Base + Restoration can pay
          // out on a SINGLE claim at the original Base SI -- restoration
          // only tops up the gap Base leaves behind, it doesn't let the
          // combined bucket exceed SI. Secure Benefit and Bonus are
          // separate buckets, already drawn above, and unaffected.
          let restorationAvailable = restoration.remaining;
          if (
            plan.illnessScope === "differentIllness" &&
            claimIllnessGroup != null &&
            restoration.triggeringIllnessGroup != null &&
            claimIllnessGroup === restoration.triggeringIllnessGroup
          ) {
            // Same illness group as the claim that triggered restoration:
            // blocked for this claim (Care Freedom/Care Heart).
            restorationAvailable = 0;
          }
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

    // Year-end stateful bonus updates, resolved per track (see trackMode).
    // 'formula'-mode tracks need no year-end step at all -- their value is
    // always recomputed fresh from the elapsed-year count at the top of the
    // next year's loop.
    const hadClaimThisYear = claims.length > 0;
    persistentBonus = plan.bonusTracks.map((track, i) => {
      const mode = trackMode(plan, track);
      if (mode === "unusedBaseCarryforward") {
        // Unused Base SI this year is credited at year end, on top of
        // whatever this year's claims already drew the balance down to
        // (bt[i], not the stale pre-claim persistentBonus[i]) -- a claim's
        // draw-down must persist, not "heal" at the next credit.
        const unusedBase = base; // remaining, un-consumed Base SI at year end
        return Math.min(bonusCap(track, SI), bt[i] + unusedBase);
      }
      if (mode === "clawbackAccrual") {
        // Stateful No Claim Bonus: +1 growth-unit (growthPct% of SI) at the
        // end of a claim-free year (up to capPct), or -1 growth-unit (never
        // below zero) at the end of any year that had at least one claim --
        // a flat clawback, not a recomputation from the elapsed-year count.
        const unit = (SI * track.growthPct) / 100;
        return hadClaimThisYear ? Math.max(0, bt[i] - unit) : Math.min(bonusCap(track, SI), bt[i] + unit);
      }
      if (mode === "loyaltyBoost") {
        const state = loyaltyBoostState[i];
        if (state.granted) {
          // One-time lump sum: never regenerated, never topped up again --
          // only ever drawn down by claims (bt[i] already reflects that).
          return bt[i];
        }
        if (hadClaimThisYear) {
          // Any claim breaks the consecutive claim-free streak.
          state.streak = 0;
          return 0;
        }
        state.streak += 1;
        if (state.streak >= (track.requiredClaimFreeYears ?? Infinity)) {
          state.granted = true;
          // Always 100% (or whatever growthPct is configured as) of the
          // ORIGINAL Sum Insured -- the single `SI` this simulate() run was
          // called with, never affected by other tracks' values or later
          // years' figures.
          return (SI * track.growthPct) / 100;
        }
        return 0;
      }
      return persistentBonus[i]; // formula-mode index: unused, left as-is
    });

    const closing: YearState = {
      base,
      multiplier: mult,
      bonusTracks: plan.bonusTracks.map((track, i) => (isStatefulMode(trackMode(plan, track)) ? persistentBonus[i] : bt[i])),
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
// For 'independentBucket' plans (baseRestorationCap unset/false), the raw
// restoration value IS the usable value -- it combines with Base beyond the
// original SI with no cap (Niva Bupa's ReAssure/Aspire family).
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

// ---------------------------------------------------------------------------
// Niva Bupa ReAssure 3.0 -- optional Cash-Bag+ add-on.
//
// A fully INDEPENDENT cashback accumulator, computed entirely outside
// simulate()/simulateGeneric() -- it never draws on, and is never drawn on
// by, Base SI/Booster+/Restoration (or "Lock the Clock", which this engine
// doesn't model at all, same as Unlimited SI -- see the file header). A
// claim year simply earns no renewal credit; it never claws back the
// balance, and nothing about Base/Bonus/Restoration reads or writes it.
// Deliberately a standalone function so enabling it can never alter
// ReAssure 3.0's (or any other plan's) existing calculation logic.
//
// Mechanics (exactly as specified, nothing inferred beyond this):
//   - Year 1 (inception, before any renewal): balance is 0.
//   - First renewal (start of Year 2): +10% of premium -- unconditional,
//     regardless of whether Year 1 had a claim (the spec conditions the
//     5%-per-claim-free-year rule below on being claim-free, but states the
//     first-renewal 10% flatly, with no such condition attached).
//   - Second renewal onwards (start of Year 3+): +5% of premium, but ONLY
//     for a policy year that was claim-free.
//   - Every 3rd CONSECUTIVE claim-free policy year (a streak, reset by any
//     claim year -- the same "consecutive" framing this engine already uses
//     for Care Ultimate's Loyalty Boost / Care Heart's NCB clawback):
//     an additional +10% of the accumulated Cash-Bag+ balance, on top of
//     that year's regular renewal credit.
export interface CashBagPlusYearResult {
  year: number;
  /** Accumulated Cash-Bag+ balance, constant across the policy year (it
   *  only changes at a renewal, never mid-year from a claim). */
  balance: number;
}

export function simulateCashBagPlus(
  premium: number,
  numYears: number,
  claimsByYear: Record<number, RawClaim[]>
): CashBagPlusYearResult[] {
  const results: CashBagPlusYearResult[] = [];
  let balance = 0;
  let claimFreeStreak = 0;

  for (let year = 1; year <= numYears; year++) {
    if (year > 1) {
      const prevYearClaimFree = ((claimsByYear && claimsByYear[year - 1]) || []).length === 0;
      claimFreeStreak = prevYearClaimFree ? claimFreeStreak + 1 : 0;

      let credit = 0;
      if (year === 2) {
        credit = premium * 0.1; // first renewal: unconditional
      } else if (prevYearClaimFree) {
        credit = premium * 0.05; // second renewal onwards: claim-free years only
      }
      balance += credit;

      if (prevYearClaimFree && claimFreeStreak > 0 && claimFreeStreak % 3 === 0) {
        balance += balance * 0.1; // milestone: every 3 consecutive claim-free years
      }
    }
    results.push({ year, balance });
  }

  return results;
}
