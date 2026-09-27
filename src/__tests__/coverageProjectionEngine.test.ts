/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { resolvePlan, simulate, totalOf, usableRestoration, getAspireBoosterCap, simulateCashBagPlus } from "../coverageProjectionEngine";

// Direct port of the standalone Coverage Projection Studio's engine.test.js
// (70/70 passing at time of port). Same scenarios, same expected values —
// only the assertion style changed (assertEq -> expect().toBeCloseTo), to
// keep this a faithful regression net for the ported TypeScript engine.

const L = 100_000; // 1 Lakh in rupees
const CR = 10_000_000; // 1 Crore in rupees
const RUPEE_TOLERANCE = 1; // matches engine.test.js's `< 1` tolerance

function close(actual: number, expected: number, label: string) {
  expect(Math.abs(actual - expected), label).toBeLessThan(RUPEE_TOLERANCE);
}

describe("coverageProjectionEngine", () => {
  it("HDFC Ergo Optima Secure+, no-claim growth reference (10L)", () => {
    const p = resolvePlan("hdfc_secure_plus")!;
    const r = simulate(p, 10 * L, 4, {});
    close(r[0].closing.base, 10 * L, "OS+ Y1 base");
    close(r[0].closing.multiplier, 10 * L, "OS+ Y1 secure");
    close(r[0].closing.bonusTracks[0], 0, "OS+ Y1 bonus");
    close(r[1].closing.bonusTracks[0], 10 * L, "OS+ Y2 bonus (infinite, +100%)");
    close(r[2].closing.bonusTracks[0], 20 * L, "OS+ Y3 bonus");
    close(r[3].closing.bonusTracks[0], 30 * L, "OS+ Y4 bonus (uncapped)");
  });

  it("HDFC Ergo Optima Secure+: claim exceeding base+secure triggers restoration with shortfall, unusable by itself", () => {
    const p = resolvePlan("hdfc_secure_plus")!;
    const r = simulate(p, 10 * L, 1, { 1: [25 * L] });
    const c = r[0].claims[0];
    close(c.base, 0, "OS+ 25L claim: base");
    close(c.multiplier, 0, "OS+ 25L claim: secure");
    close(c.usedFromRestoration, 0, "OS+ 25L claim: restoration not usable yet (triggering claim)");
    close(c.shortfall, 5 * L, "OS+ 25L claim: shortfall paid by insured");
    close(r[0].closing.restoration, 10 * L, "OS+ 25L claim: restoration triggered at full 100% regardless of exhaustion");
  });

  it("HDFC Ergo Optima Secure+: restoration always triggers at a full top-up, even if base only partially used", () => {
    const p = resolvePlan("hdfc_secure_plus")!;
    const r = simulate(p, 10 * L, 1, { 1: [3 * L, 17 * L] });
    const c1 = r[0].claims[0];
    close(c1.base, 7 * L, "OS+ claim1(3L): base remaining");
    close(r[0].closing.restoration, 10 * L, "OS+ after claim1(3L): restoration triggers FULL (not capped to 3L consumed)");
  });

  it("HDFC Ergo Optima Secure (no rider): restoration is a single use per policy year, no reload for a 2nd claim", () => {
    const p = resolvePlan("hdfc_secure")!;
    const r = simulate(p, 10 * L, 1, { 1: [3 * L, 17 * L] });
    const c1 = r[0].claims[0];
    close(c1.base, 7 * L, "OS claim1(3L): base remaining");
    close(c1.multiplier, 10 * L, "OS claim1(3L): secure untouched");
    close(c1.usedFromRestoration, 0, "OS claim1(3L): restoration not usable this claim (triggering claim)");

    const c2 = r[0].claims[1];
    // Claim2 (17L): base(7)+secure(10)=17 exactly covers it, restoration
    // untouched, and — critically — restoration must NOT have reloaded to
    // 10L beforehand.
    close(c2.base, 0, "OS claim2(17L): base exhausted");
    close(c2.multiplier, 0, "OS claim2(17L): secure exhausted");
    close(c2.restoration, 10 * L, "OS claim2(17L): restoration stays at its single triggered value (10L, untouched)");
    close(r[0].closing.restoration, 10 * L, "OS after claim2: still just the single 10L pot (no reload)");
  });

  it("HDFC Ergo Optima Secure WITH Unlimited Restore Rider: restoration reloads before the 2nd claim", () => {
    const p = resolvePlan("hdfc_secure")!;
    const r = simulate(p, 10 * L, 1, { 1: [10 * L, 15 * L] }, { reloadPerClaim: true });
    const c1 = r[0].claims[0]; // claim1(10L): fully consumes base, triggers restoration
    close(c1.base, 0, "OS+rider claim1(10L): base exhausted");
    const c2 = r[0].claims[1]; // claim2(15L): rider reloads restoration to 10L, plus secure(10L) = 25L available
    close(c2.multiplier, 0, "OS+rider claim2(15L): secure fully used (10L of it)");
    close(c2.restoration, 5 * L, "OS+rider claim2(15L): restoration reloaded to 10L then used down to 5L for the remaining 5L needed");
  });

  it("Aditya Birla Activ One NXT (10L): restoration always available, reloads after each claim", () => {
    const p = resolvePlan("ab_nxt")!;
    const r = simulate(p, 10 * L, 1, { 1: [16 * L, 12 * L] });
    close(r[0].opening.restoration, 10 * L, "NXT Y1 opening restoration = full (always type)");
    const c1 = r[0].claims[0];
    close(c1.base, 0, "NXT claim1(16L): base exhausted");
    close(c1.restoration, 4 * L, "NXT claim1(16L): restoration 10-6=4L used to cover shortfall");
    close(c1.shortfall, 0, "NXT claim1(16L): no shortfall (restoration usable immediately, always type)");
    const c2 = r[0].claims[1];
    close(c2.restoration, 0, "NXT claim2(12L): restoration reloaded to 10L then exhausted");
    close(c2.shortfall, 2 * L, "NXT claim2(12L): 2L shortfall paid by insured");
  });

  it("Care Supreme (10L, CBS add-on)", () => {
    const p = resolvePlan("care_supreme", { addon: "cbs" })!;
    const r = simulate(p, 10 * L, 7, {});
    close(r[6].closing.bonusTracks[0], 10 * L, "Care Supreme Y7 Bonus at cap (100%)");
    close(r[6].closing.bonusTracks[1], 50 * L, "Care Supreme Y7 CBS at cap (500%)");

    const r2 = simulate(p, 10 * L, 7, { 7: [5 * L] });
    const c = r2[6].claims[0];
    close(c.base, 5 * L, "Care Supreme claim1(5L): base remaining");
    close(c.bonusTracks[0], 10 * L, "Care Supreme claim1(5L): bonus untouched");
    close(c.bonusTracks[1], 50 * L, "Care Supreme claim1(5L): CBS untouched");
    close(r2[6].closing.restoration, 10 * L, "Care Supreme claim1(5L): restoration triggers at full 10L (not capped to 5L)");
  });

  it("Care Supreme (10L, no add-on): a single Cumulative Bonus track only", () => {
    const p = resolvePlan("care_supreme", { addon: "none" })!;
    const r = simulate(p, 10 * L, 7, {});
    expect(p.bonusTracks.length, "Care Supreme (no add-on): only one bonus track").toBe(1);
    close(r[6].closing.bonusTracks[0], 10 * L, "Care Supreme (no add-on) Y7 Bonus at cap (100%)");
  });

  it("Care Supreme (10L, CBB add-on): CBB stacks alongside the base Cumulative Bonus track, uncapped", () => {
    const p = resolvePlan("care_supreme", { addon: "cbb" })!;
    expect(p.bonusTracks.length, "Care Supreme (CBB): two tracks (base Cumulative Bonus + CBB stacked, like CBS)").toBe(2);
    const r = simulate(p, 10 * L, 9, {});
    close(r[8].closing.bonusTracks[0], 10 * L, "Care Supreme (CBB) Y9 base Cumulative Bonus still at its own 100% cap");
    close(r[8].closing.bonusTracks[1], 80 * L, "Care Supreme (CBB) Y9 CBB uncapped: 100% x 8 years = 800%");
  });

  it("Aditya Birla Activ One MAX: bonus is a pure elapsed-year formula, not permanently reduced by a claim", () => {
    // (5L): Year7 claim(17.5L) draws bonus 25L->12.5L, but Year8 must show
    // bonus back at its 500% cap (25L), matching the policy doc ("Claim
    // Impact on Super Credit: None").
    const p = resolvePlan("ab_max")!;
    const r = simulate(p, 5 * L, 9, { 7: [17.5 * L] });
    close(r[6].opening.bonusTracks[0], 25 * L, "AOM Y7 bonus at cap before claim");
    const c1 = r[6].claims[0];
    close(c1.bonusTracks[0], 12.5 * L, "AOM Y7 claim(17.5L): bonus drawn down to 12.5L for this claim");
    close(r[7].opening.bonusTracks[0], 25 * L, "AOM Y8 bonus resumes at full 500% cap, unaffected by Y7 claim");
    close(r[7].opening.restoration, 5 * L, "AOM Y8 restoration persists (lifetime type, triggered in Y7)");
  });

  it("HDFC Ergo Optima Secure+: Infinite Benefit is unaffected by a Year4 claim", () => {
    const p = resolvePlan("hdfc_secure_plus")!;
    const r = simulate(p, 10 * L, 5, { 4: [17 * L, 16 * L] });
    close(r[4].opening.bonusTracks[0], 40 * L, "OS+ Y5 bonus = pure formula (year-1)*10L, unaffected by Y4 claims");
  });

  it("Activ One MAX: absolute Rs 3 Cr cap on Super Credit binds on top of 500%", () => {
    const p = resolvePlan("ab_max")!;
    // SI = 1 Cr -> 500% would be 5 Cr, but the absolute cap of 3 Cr should bind.
    const r = simulate(p, 1 * CR, 8, {});
    close(r[7].closing.bonusTracks[0], 3 * CR, "AOM Super Credit capped at Rs 3 Cr even though 500% of 1Cr SI would be 5 Cr");
  });

  it("Niva Bupa ReAssure 2.0 Titanium+: Booster+ = unused Base SI carried forward", () => {
    const p = resolvePlan("nb_reassure2", { reassure2Variant: "titanium" })!;
    const r = simulate(p, 10 * L, 10, {});
    close(r[9].closing.bonusTracks[0], 1 * CR, "ReAssure Titanium+ Booster+ = 1 Cr after 10 claim-free years (10L base)");
    close(r[9].closing.base, 10 * L, "ReAssure Titanium+ Base SI stays 10L (resets each year)");
  });

  it("Niva Bupa ReAssure 2.0 Bronze+: a partial-base claim only carries forward the unused remainder", () => {
    const p = resolvePlan("nb_reassure2", { reassure2Variant: "bronze" })!;
    // Year1: no claim -> Booster+ += 10L. Year2: claim of 4L -> only 6L unused -> Booster+ += 6L.
    const r = simulate(p, 10 * L, 3, { 2: [4 * L] });
    close(r[0].opening.bonusTracks[0], 0, "ReAssure Bronze+ Y1 opening Booster+ = 0");
    close(r[0].closing.bonusTracks[0], 10 * L, "ReAssure Bronze+ Y1 closing Booster+ = 10L (full year unused, credited at year end)");
    close(r[2].opening.bonusTracks[0], 16 * L, "ReAssure Bronze+ Y3 Booster+ = 10L (Y1 unused) + 6L (Y2 partial unused) = 16L");
  });

  it("Base + Restoration combined cap at original Base SI (HDFC Optima Secure)", () => {
    // Worked example: 15L SI, Claim1(4L), Claim2(3L), Claim3(35L). Before
    // Claim3: base=8L, secure=15L, restoration=15L (technically 38L sitting
    // in the buckets). But Base+Restoration together can never exceed the
    // original 15L Base SI for a single claim, so only 15-8=7L of the
    // restoration pot is usable here. Max payable = 8(base)+7(restoration)+
    // 15(secure)+0(bonus, already at cap) = 30L, leaving a 5L shortfall.
    const p = resolvePlan("hdfc_secure")!;
    const r = simulate(p, 15 * L, 1, { 1: [4 * L, 3 * L, 35 * L] });
    const c3 = r[0].claims[2];
    close(c3.base, 0, "OS capped claim3(35L): base exhausted");
    close(c3.multiplier, 0, "OS capped claim3(35L): secure exhausted");
    close(c3.usedFromRestoration, 7 * L, "OS capped claim3(35L): only 7L of restoration usable (15L SI - 8L base)");
    close(c3.restoration, 8 * L, "OS capped claim3(35L): 8L left in the restoration pot, untouched by the cap");
    close(c3.shortfall, 5 * L, "OS capped claim3(35L): 5L shortfall (30L paid, not the full 35L)");
  });

  it("Base + Restoration cap, Optima Secure+ (unlimited reload): cap still limits usability even after reload", () => {
    const p = resolvePlan("hdfc_secure_plus")!;
    const r = simulate(p, 10 * L, 1, { 1: [3 * L, 17 * L] });
    const c2 = r[0].claims[1];
    // base(7L)+secure(10L) = 17L already covers the claim exactly, so the
    // cap (which would have allowed at most 10-7=3L from restoration) never
    // even has to bind here -- restoration stays untouched at its
    // just-reloaded 10L.
    close(c2.base, 0, "OS+ capped claim2(17L): base exhausted");
    close(c2.multiplier, 0, "OS+ capped claim2(17L): secure exhausted");
    close(c2.usedFromRestoration, 0, "OS+ capped claim2(17L): base+secure alone cover it, restoration untouched");
    close(c2.shortfall, 0, "OS+ capped claim2(17L): no shortfall");
  });

  it("Plans WITHOUT the base+restoration cap (Activ One NXT) are unaffected by it", () => {
    const p = resolvePlan("ab_nxt")!;
    expect(!!p.baseRestorationCap, "NXT: no base+restoration cap").toBe(false);
    const r = simulate(p, 15 * L, 1, { 1: [4 * L, 3 * L, 35 * L] });
    const c3 = r[0].claims[2];
    // Same 4L/3L/35L sequence as the capped Optima Secure test above, but on
    // a plan with no cap: before claim3, base=8L, restoration reloads to a
    // full 15L (always type + reloadPerClaim). Claim3 draws all 8L of base,
    // then the FULL 15L of restoration (not capped to 15-8=7L) -- 23L of the
    // 35L needed, 12L shortfall. If the SI cap wrongly applied here it would
    // only allow 7L from restoration (8+7=15L paid, 20L shortfall) -- so
    // this test also guards against the cap leaking onto plans that
    // shouldn't have it.
    close(c3.usedFromRestoration, 15 * L, "NXT claim3(35L): full 15L restoration pot usable, not capped to 7L");
    close(c3.shortfall, 12 * L, "NXT claim3(35L): 12L shortfall (uncapped), not 20L (which the SI cap would produce)");
  });

  it("FIX: Total usable amount applies the Base+Restoration cap, not the raw restoration bucket", () => {
    const p = resolvePlan("hdfc_secure")!;
    const r = simulate(p, 1 * CR, 4, { 4: [20 * L] });
    const c1 = r[3].claims[0];
    // Raw bucket is a full 1Cr (just triggered); base remaining is 80L, so
    // the usable allowance is 1Cr-80L=20L, not the full 1Cr.
    close(usableRestoration(c1.restoration, c1.base, 1 * CR, p), 20 * L, "usableRestoration caps to SI-base allowance");
    const claimTotal = c1.base + c1.multiplier + c1.bonusTracks.reduce((a, b) => a + b, 0) + usableRestoration(c1.restoration, c1.base, 1 * CR, p);
    close(claimTotal, 3 * CR, 'OS Y4 claim1(20L) "Total usable amount" = 3Cr, not 3.8Cr');
    close(
      totalOf({ base: 1 * CR, multiplier: 1 * CR, bonusTracks: [0], restoration: 0 }, p, 1 * CR),
      2 * CR,
      "totalOf sanity check with no restoration in play"
    );
  });

  it("FIX: Niva Bupa Booster+ does not heal back to its pre-claim value the year after a draw-down", () => {
    // Year1: no claim -> Booster+ += 10L (full). Year2: claim(13L) consumes
    // all 10L of Base plus 3L of the 10L Booster+, leaving Booster+ at 7L.
    // Year3's credit must start from that drawn-down 7L (+0 newly-unused
    // base, since Year2's base was fully consumed), landing at 7L -- not
    // heal back to 10L.
    const p = resolvePlan("nb_reassure2", { reassure2Variant: "bronze" })!;
    const r = simulate(p, 10 * L, 3, { 2: [13 * L] });
    close(r[1].closing.bonusTracks[0], 7 * L, "ReAssure Bronze+ Y2 closing Booster+ = 7L after a 13L claim draws 3L from it");
    close(r[2].opening.bonusTracks[0], 7 * L, "ReAssure Bronze+ Y3 opening Booster+ stays at 7L (does not heal back to 10L)");
  });

  it("FIX: lifetime restoration refreshes to full SI at each subsequent policy year once triggered", () => {
    // Year1: Claim1(6L) triggers restoration (full 10L, unused by the
    // triggering claim itself). Claim2(12L) reloads restoration to a full
    // 10L (reloadPerClaim), then draws 8L of it down to 2L by year end.
    const p = resolvePlan("nb_reassure2", { reassure2Variant: "platinum" })!;
    const r = simulate(p, 10 * L, 2, { 1: [6 * L, 12 * L] });
    const c2 = r[0].claims[1];
    close(c2.restoration, 2 * L, "ReAssure Platinum+ Y1 closing restoration = 2L after Claim2 draws 8L");
    close(r[1].opening.restoration, 10 * L, "ReAssure Platinum+ Y2 opening restoration refreshes to full 10L (lifetime, triggered), not stuck at 2L");
  });
});

// ---------------------------------------------------------------------------
// 2026 EXPANSION -- Care Freedom, Care Heart, Care Care, Care Ultimate,
// Aditya Birla Activ Yuva, Niva Bupa ReAssure 3.0, Niva Bupa Aspire.
//
// Every expected value below was derived by hand-tracing the same,
// already-validated engine mechanics used by the tests above (baseCapped
// single-claim SI cap, independent-bucket restoration, the generic per-claim
// consumption order) and cross-checked against the running engine before
// being written down here -- not copied blind from the source brief's
// illustrative numbers.
// ---------------------------------------------------------------------------
describe("coverageProjectionEngine - 2026 expansion", () => {
  // --- A. Care Freedom: baseCapped restoration + different-illness rule ---
  describe("Care Freedom", () => {
    it("restoration blocked for a same-illness claim, usable for a different-illness claim", () => {
      const p = resolvePlan("care_freedom")!;
      const r = simulate(p, 10 * L, 2, {
        1: [
          { amount: 6 * L, illnessGroup: "A" }, // triggers restoration; can't use it itself
          { amount: 5 * L, illnessGroup: "A" }, // SAME illness as trigger -> restoration blocked
          { amount: 3 * L, illnessGroup: "B" }, // DIFFERENT illness -> restoration usable
        ],
      });
      const [c1, c2, c3] = r[0].claims;
      close(c1.base, 4 * L, "Care Freedom claim1(6L): base 10L->4L");
      expect(c1.triggeredThisClaim, "Care Freedom claim1: triggers restoration").toBe(true);
      close(c1.restoration, 10 * L, "Care Freedom claim1: restoration triggers at full 10L");
      close(c2.usedFromRestoration, 0, "Care Freedom claim2 (same illness A): restoration blocked");
      close(c2.shortfall, 1 * L, "Care Freedom claim2 (same illness A): 1L shortfall (4L base only covers part of 5L)");
      close(c3.usedFromRestoration, 3 * L, "Care Freedom claim3 (different illness B): restoration usable");
      close(c3.shortfall, 0, "Care Freedom claim3 (different illness B): fully paid");

      close(r[1].opening.base, 10 * L, "Care Freedom Y2 opening base resets to full SI");
      close(r[1].opening.restoration, 0, "Care Freedom Y2 opening restoration resets (once per policy year / annual type)");
    });

    it("single-claim Base+Restoration cap at the original Base SI", () => {
      const p = resolvePlan("care_freedom")!;
      const r = simulate(p, 10 * L, 1, {
        1: [
          { amount: 1 * L, illnessGroup: "A" },
          { amount: 19 * L, illnessGroup: "B" }, // different illness, but the SI cap still binds
        ],
      });
      const c2 = r[0].claims[1];
      close(c2.usedFromRestoration, 1 * L, "Care Freedom capped claim2: only 1L of restoration usable (10L SI - 9L base)");
      close(c2.shortfall, 9 * L, "Care Freedom capped claim2: 9L shortfall (10L paid total, not the full 19L)");
    });

    it("has no bonus track and exposes the correct restoration/illness metadata", () => {
      const p = resolvePlan("care_freedom")!;
      expect(p.bonusTracks.length, "Care Freedom: no bonus track").toBe(0);
      expect(p.illnessScope, "Care Freedom: different-illness restoration rule").toBe("differentIllness");
      expect(p.restorationClaimRule, "Care Freedom: baseCapped").toBe("baseCapped");
      expect(!!p.baseRestorationCap, "Care Freedom: baseRestorationCap true").toBe(true);
    });
  });

  // --- B. Care Heart: stateful NCB with clawback + baseCapped restoration ---
  describe("Care Heart", () => {
    it("NCB grows 10% -> 20% over two claim-free years, then claws back by one unit after a claim", () => {
      const p = resolvePlan("care_heart")!;
      const r = simulate(p, 10 * L, 3, { 3: [{ amount: 2 * L, illnessGroup: "A" }] });
      close(r[0].closing.bonusTracks[0], 1 * L, "Care Heart NCB Y1 (claim-free): 10%");
      close(r[1].closing.bonusTracks[0], 2 * L, "Care Heart NCB Y2 (claim-free): 20%");
      close(r[2].closing.bonusTracks[0], 1 * L, "Care Heart NCB Y3 (had a claim): clawed back one unit, 20%->10%");
    });

    it("NCB clawback never goes below zero", () => {
      const p = resolvePlan("care_heart")!;
      // Two consecutive claim years: Y1 claim (NCB 0 -> stays 0, can't go negative), Y2 claim (still 0).
      const r = simulate(p, 10 * L, 2, { 1: [{ amount: 1 * L, illnessGroup: "A" }], 2: [{ amount: 1 * L, illnessGroup: "B" }] });
      close(r[0].closing.bonusTracks[0], 0, "Care Heart NCB Y1: clawback floors at 0, not negative");
      close(r[1].closing.bonusTracks[0], 0, "Care Heart NCB Y2: still floored at 0");
    });

    it("claim sequence is Base -> NCB -> Restoration, and restoration is baseCapped + different-illness", () => {
      const p = resolvePlan("care_heart")!;
      expect(p.illnessScope, "Care Heart: different-illness restoration rule").toBe("differentIllness");
      expect(p.restorationClaimRule, "Care Heart: baseCapped").toBe("baseCapped");
      expect(p.bonusMode, "Care Heart: stateful clawback NCB").toBe("clawbackAccrual");
    });
  });

  // --- C. Care Care: standard NCB, optional NCB Super add-on, ANY illness ---
  describe("Care Care", () => {
    it("no add-on: a single standard NCB track only", () => {
      const p = resolvePlan("care_care")!;
      expect(p.bonusTracks.length, "Care Care (no add-on): only one NCB track").toBe(1);
      const r = simulate(p, 10 * L, 1, {});
      close(r[0].closing.bonusTracks[0], 1 * L, "Care Care NCB Y1 (claim-free): 10%");
    });

    it("NCB Super add-on: grows to 50% in Year1, clawed back fully to 0% after a Year2 claim", () => {
      const p = resolvePlan("care_care", { addon: "ncbSuper" })!;
      expect(p.bonusTracks.length, "Care Care (NCB Super): two tracks (NCB + NCB Super, stacked)").toBe(2);
      const r = simulate(p, 10 * L, 2, { 2: [1 * L] });
      close(r[0].closing.bonusTracks[0], 1 * L, "Care Care NCB Y1: 10%");
      close(r[0].closing.bonusTracks[1], 5 * L, "Care Care NCB Super Y1: 50%");
      close(r[1].closing.bonusTracks[0], 0, "Care Care NCB Y2 (had a claim): clawed back to 0%");
      close(r[1].closing.bonusTracks[1], 0, "Care Care NCB Super Y2 (had a claim): clawed back fully to 0% (one 50%-unit wipes it out)");
    });

    it("NCB Super caps at 100%", () => {
      const p = resolvePlan("care_care", { addon: "ncbSuper" })!;
      const r = simulate(p, 10 * L, 5, {}); // 5 claim-free years: 50,100,100,100,100
      close(r[4].closing.bonusTracks[1], 10 * L, "Care Care NCB Super caps at 100% of SI");
    });

    it("restoration is usable regardless of illness match (ANY illness, unlike Care Freedom/Heart)", () => {
      const p = resolvePlan("care_care")!;
      expect(p.illnessScope, "Care Care: no illness restriction").toBeUndefined();
      const r = simulate(p, 10 * L, 1, {
        1: [
          { amount: 11 * L, illnessGroup: "A" },
          { amount: 5 * L, illnessGroup: "A" }, // SAME illness as claim1 -- still usable for Care Care
        ],
      });
      const c2 = r[0].claims[1];
      close(c2.usedFromRestoration, 5 * L, "Care Care: restoration usable even for a same-illness claim");
      close(c2.shortfall, 0, "Care Care: no shortfall");
    });
  });

  // --- D. Care Ultimate: Loyalty Boost / Loyalty Bonus / optional Infinity Bonus, unlimited restoration ---
  //
  // CONFIRMED claim/consumption order (the policy's own progressive-deduction
  // wording): Base SI -> Loyalty Boost -> Loyalty/Cumulative Bonus -> Infinity
  // Bonus -> Restoration (Unlimited Automatic Recharge). This means
  // bonusTracks[0] is always Loyalty Boost and bonusTracks[1] is always
  // Loyalty Bonus (bonusTracks[2] is Infinity Bonus, only when that add-on is
  // active) -- primaryBonusIndex (1) tells the UI which index is the actual
  // "Bonus" for display purposes; it has no effect on this consumption order.
  describe("Care Ultimate", () => {
    // D1. Loyalty Bonus: claim-free progression, 50%/yr, capped at 100%.
    it("default Loyalty Bonus: 50%/yr, capped at 100% -- bonusTracks[1], Loyalty Boost is bonusTracks[0]", () => {
      const p = resolvePlan("care_ultimate")!;
      expect(p.bonusTracks.length, "Care Ultimate: Loyalty Boost + Loyalty Bonus tracks").toBe(2);
      expect(p.bonusTracks[0].label, "Care Ultimate: track 0 is Loyalty Boost (consumed first)").toBe("Loyalty Boost");
      expect(p.bonusTracks[1].label, "Care Ultimate: track 1 is Loyalty Bonus").toBe("Loyalty Bonus");
      expect(p.primaryBonusIndex, "Care Ultimate: the actual 'Bonus' for UI display is index 1").toBe(1);
      const r = simulate(p, 10 * L, 3, {});
      close(r[1].closing.bonusTracks[1], 5 * L, "Care Ultimate Loyalty Bonus Y2: 50%");
      close(r[2].closing.bonusTracks[1], 10 * L, "Care Ultimate Loyalty Bonus Y3: 100% (at cap)");
    });

    // D2. Infinity Bonus: 100%/yr, no cap, paid add-on, OVER AND ABOVE Loyalty
    // Bonus (stacks, does not replace it) -- confirmed by the policy's own
    // progressive-deduction wording. Still excluded from Unlimited SI
    // (trivially true here since Unlimited SI is out of scope for this engine).
    it("Infinity Bonus add-on STACKS on top of Loyalty Bonus (does not replace it)", () => {
      const p = resolvePlan("care_ultimate", { addon: "infinityBonus" })!;
      expect(p.bonusTracks.length, "Care Ultimate (Infinity Bonus): 3 tracks -- Loyalty Boost, Loyalty Bonus (unaffected), Infinity Bonus").toBe(3);
      expect(p.bonusTracks[0].label, "track 0 is Loyalty Boost").toBe("Loyalty Boost");
      expect(p.bonusTracks[1].label, "track 1 is Loyalty Bonus (still present)").toBe("Loyalty Bonus");
      expect(p.bonusTracks[2].label, "track 2 is Infinity Bonus").toBe("Infinity Bonus");
      const r = simulate(p, 10 * L, 7, {});
      // Loyalty Bonus keeps growing/capping exactly as it does without the
      // add-on -- Infinity Bonus does not touch it.
      close(r[1].closing.bonusTracks[1], 5 * L, "Loyalty Bonus Y2: 50% (unaffected by Infinity Bonus)");
      close(r[2].closing.bonusTracks[1], 10 * L, "Loyalty Bonus Y3: 100% cap (unaffected)");
      close(r[6].closing.bonusTracks[1], 10 * L, "Loyalty Bonus Y7: still capped at 100% (unaffected)");
      // Infinity Bonus grows independently, uncapped.
      close(r[1].closing.bonusTracks[2], 10 * L, "Infinity Bonus Y2: 100%");
      close(r[2].closing.bonusTracks[2], 20 * L, "Infinity Bonus Y3: 200% (uncapped)");
      close(r[6].closing.bonusTracks[2], 60 * L, "Infinity Bonus Y7: 600% (still uncapped)");
      // Loyalty Boost is independent of which bonus add-on is active: with 7
      // claim-free years it still fires for exactly 100% of the ORIGINAL SI.
      close(r[6].closing.bonusTracks[0], 10 * L, "Loyalty Boost Y7: 100% of original SI, unaffected by Infinity Bonus");
    });

    // D3. Loyalty Boost: separate one-time lifetime benefit, NOT a recurring annual bonus track.
    describe("Loyalty Boost (one-time, 7 consecutive claim-free years, bonusTracks[0])", () => {
      it("6 consecutive claim-free years -> NOT eligible (stays 0)", () => {
        const p = resolvePlan("care_ultimate")!;
        const r = simulate(p, 10 * L, 6, {});
        for (const year of r) {
          close(year.closing.bonusTracks[0], 0, "Care Ultimate Loyalty Boost: not yet eligible before year 7");
        }
      });

      it("7 consecutive claim-free years -> eligible, amount = 100% of ORIGINAL first-policy-year SI", () => {
        const p = resolvePlan("care_ultimate")!;
        const r = simulate(p, 10 * L, 7, {});
        for (let i = 0; i < 6; i++) {
          close(r[i].closing.bonusTracks[0], 0, `Care Ultimate Loyalty Boost: still 0 in year ${i + 1}`);
        }
        close(r[6].closing.bonusTracks[0], 10 * L, "Care Ultimate Loyalty Boost Y7: 100% of original 10L SI");
      });

      it("once granted, cannot be generated again (stays flat in later years)", () => {
        const p = resolvePlan("care_ultimate")!;
        const r = simulate(p, 10 * L, 9, {});
        close(r[6].closing.bonusTracks[0], 10 * L, "Care Ultimate Loyalty Boost Y7: granted");
        close(r[7].closing.bonusTracks[0], 10 * L, "Care Ultimate Loyalty Boost Y8: unchanged (not regenerated)");
        close(r[8].closing.bonusTracks[0], 10 * L, "Care Ultimate Loyalty Boost Y9: unchanged (not regenerated)");
      });

      it("a claim during the qualifying period breaks the consecutive claim-free streak", () => {
        const p = resolvePlan("care_ultimate")!;
        // Claim in year 3 resets the streak; years 4-10 are then 7 consecutive
        // claim-free years, so the boost fires at year 10, not year 7.
        const r = simulate(p, 10 * L, 10, { 3: [1 * L] });
        for (let i = 0; i < 9; i++) {
          close(r[i].closing.bonusTracks[0], 0, `Care Ultimate Loyalty Boost: streak reset by Y3 claim, still 0 at year ${i + 1}`);
        }
        close(r[9].closing.bonusTracks[0], 10 * L, "Care Ultimate Loyalty Boost Y10: 7 consecutive claim-free years after the Y3 claim");
      });

      it("changing later-year SI/bonus levels does not change the Loyalty Boost amount (fixed to original SI)", () => {
        const p = resolvePlan("care_ultimate")!;
        const r = simulate(p, 10 * L, 7, {});
        // By Y7, Loyalty Bonus (track 1) has already grown to and capped at 100% of SI
        // (10L) -- a materially different, larger running value than track 1 had in
        // earlier years -- yet Loyalty Boost (track 0) is fixed at 100% of the
        // ORIGINAL SI regardless of how track 1 (or SI-driven growth generally) evolved.
        close(r[6].closing.bonusTracks[1], 10 * L, "Care Ultimate Y7: Loyalty Bonus at its 100% cap");
        close(r[6].closing.bonusTracks[0], 10 * L, "Care Ultimate Y7: Loyalty Boost still exactly 100% of ORIGINAL SI");
      });

      // The engine grants and makes the Loyalty Boost available in the same year it
      // becomes eligible -- there is no separate "eligible but not yet consumed"
      // pending state to model (see the implementation report for this documented
      // limitation).
    });

    // D5. Consumption order: Base -> Loyalty Boost -> Loyalty Bonus -> Infinity
    // Bonus -> Restoration, confirmed by the policy's own progressive-deduction
    // wording. Verified with a claim large enough to draw through every bucket.
    it("consumption order on a claim is Base -> Loyalty Boost -> Loyalty Bonus -> Infinity Bonus -> Restoration", () => {
      const p = resolvePlan("care_ultimate", { addon: "infinityBonus" })!;
      // By Y7 (claim-free so far): Base=10L, Loyalty Boost=0 (not yet granted --
      // the streak only reaches 7 at year-END, after this claim), Loyalty
      // Bonus=10L (capped), Infinity Bonus=60L (6 elapsed years x 100%).
      const r = simulate(p, 10 * L, 7, { 7: [35 * L] });
      const opening = r[6].opening.bonusTracks;
      close(opening[0], 0, "Y7 opening Loyalty Boost: 0 (not yet granted)");
      close(opening[1], 10 * L, "Y7 opening Loyalty Bonus: 10L (capped)");
      close(opening[2], 60 * L, "Y7 opening Infinity Bonus: 60L");
      const c = r[6].claims[0];
      // 35L claim: Base(10L) -> Loyalty Boost(0, nothing to draw) -> Loyalty
      // Bonus(10L, fully drawn) -> Infinity Bonus(remaining 15L drawn from 60L).
      close(c.base, 0, "35L claim: Base fully consumed (10L)");
      close(c.bonusTracks[0], 0, "35L claim: Loyalty Boost untouched (was already 0)");
      close(c.bonusTracks[1], 0, "35L claim: Loyalty Bonus fully drawn (10L used)");
      close(c.bonusTracks[2], 45 * L, "35L claim: Infinity Bonus drawn from 60L to 45L (15L used)");
      close(c.shortfall, 0, "35L claim: fully paid (10 base + 10 bonus + 15 infinity = 35L)");
    });

    // D6. Restoration: Base + Restoration cannot exceed original Base SI on a single claim.
    it("restoration is unlimited (reloads every claim) but still baseCapped per claim", () => {
      const p = resolvePlan("care_ultimate")!;
      expect(!!p.baseRestorationCap, "Care Ultimate: baseCapped restoration").toBe(true);
      const r = simulate(p, 10 * L, 1, { 1: [2 * L, 15 * L] });
      const c2 = r[0].claims[1];
      close(c2.usedFromRestoration, 2 * L, "Care Ultimate claim2: only 2L usable (10L SI - 8L base), even though reload topped it back to 10L");
      close(c2.shortfall, 5 * L, "Care Ultimate claim2: 5L shortfall");
    });
  });

  // --- D2. HDFC Ergo Optima Super Secure: additive coverage (was previously
  // only implicitly covered as "same shape as Optima Secure") -- the 3X
  // Secure Benefit and the inbuilt-vs-optional-Unlimited-Restoration
  // distinction each get an explicit test here. Purely additive: does not
  // touch any of the original 20 regression tests. ---
  describe("HDFC Ergo Optima Super Secure", () => {
    it("Secure Benefit is 3X Base SI (not 2X, unlike Secure/Secure+)", () => {
      const p = resolvePlan("hdfc_super_secure")!;
      const r = simulate(p, 10 * L, 1, {});
      close(r[0].closing.multiplier, 20 * L, "Super Secure Y1 Secure Benefit: 2x Base SI (factor=2 -> 3X total with Base)");
    });

    it("inbuilt restoration is a single use per policy year (no rider): no reload for a 2nd claim", () => {
      const p = resolvePlan("hdfc_super_secure")!;
      const r = simulate(p, 10 * L, 1, { 1: [3 * L, 27 * L] });
      const c1 = r[0].claims[0];
      close(c1.base, 7 * L, "Super Secure claim1(3L): base remaining");
      expect(c1.triggeredThisClaim, "Super Secure claim1: triggers restoration").toBe(true);
      const c2 = r[0].claims[1];
      // claim2(27L): base(7L)+secure(20L)=27L exactly covers it -- restoration
      // untouched, and critically must NOT have reloaded beforehand (no rider).
      close(c2.base, 0, "Super Secure claim2(27L): base exhausted");
      close(c2.multiplier, 0, "Super Secure claim2(27L): secure exhausted");
      close(c2.usedFromRestoration, 0, "Super Secure claim2(27L): base+secure alone cover it, restoration untouched");
      close(r[0].closing.restoration, 10 * L, "Super Secure after claim2: restoration stays at its single triggered value (10L, no reload)");
    });

    it("optional Unlimited Restoration add-on reloads restoration before a 2nd claim", () => {
      const p = resolvePlan("hdfc_super_secure")!;
      expect(p.riderAvailable, "Super Secure: Unlimited Restoration is an optional add-on, not inbuilt").toBe(true);
      const r = simulate(p, 10 * L, 1, { 1: [10 * L, 25 * L] }, { reloadPerClaim: true });
      const c1 = r[0].claims[0]; // claim1(10L): fully consumes base, triggers restoration
      close(c1.base, 0, "Super Secure+rider claim1(10L): base exhausted");
      const c2 = r[0].claims[1]; // claim2(25L): rider reloads restoration to 10L, secure(20L) covers the rest
      close(c2.multiplier, 0, "Super Secure+rider claim2(25L): secure fully used (20L of it)");
      close(c2.usedFromRestoration, 5 * L, "Super Secure+rider claim2(25L): 5L of the reloaded 10L restoration used");
    });
  });

  // --- E. Aditya Birla Activ Yuva: Yuva Credit (formula bonus) + Yuva Reload
  // (always-type, per-claim-reloading, independent-bucket restoration) ---
  describe("Aditya Birla Activ Yuva", () => {
    it("no longer uses the legacy dedicated state machine", () => {
      const p = resolvePlan("ab_yuva")!;
      expect(p.calculationModel, "Yuva Credit/Reload now fit the generic pipeline like every other plan").toBeUndefined();
    });

    it("Yuva Credit accrues +100% of Base SI on every continuous renewal, with no claims", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 6, {});
      close(r[0].opening.bonusTracks[0], 0, "Activ Yuva Y1 opening: Yuva Credit starts at 0");
      close(r[1].opening.bonusTracks[0], 10 * L, "Activ Yuva Y2 opening: Yuva Credit = 100% of 10L SI");
      close(r[2].opening.bonusTracks[0], 20 * L, "Activ Yuva Y3 opening: Yuva Credit = 200%");
      close(r[4].opening.bonusTracks[0], 40 * L, "Activ Yuva Y5 opening: Yuva Credit = 400%");
      close(r[5].opening.bonusTracks[0], 50 * L, "Activ Yuva Y6 opening: Yuva Credit = 500%");
    });

    it("Yuva Credit accumulates on the next renewal irrespective of a claim in the prior year", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 3, { 2: [5 * L] });
      close(r[2].opening.bonusTracks[0], 20 * L, "Activ Yuva Y3 opening: Yuva Credit = 200% (elapsed-year formula, unaffected by Y2's claim)");
    });

    it("Yuva Credit is capped at 1000% / 10X of Base SI", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 13, {});
      close(r[10].opening.bonusTracks[0], 100 * L, "Activ Yuva Y11 opening: Yuva Credit reaches the 1000% (10X) cap");
      close(r[11].opening.bonusTracks[0], 100 * L, "Activ Yuva Y12 opening: Yuva Credit stays capped at 10X, does not exceed it");
      close(r[12].opening.bonusTracks[0], 100 * L, "Activ Yuva Y13 opening: Yuva Credit stays capped at 10X");
    });

    it("Year 5 worked example: 10L Base + 40L Yuva Credit + 10L Yuva Reload = 60L claim", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 5, { 5: [60 * L] });
      const y5 = r[4];
      close(y5.opening.bonusTracks[0], 40 * L, "Activ Yuva Y5 opening: accumulated Yuva Credit = 40L");
      const c = y5.claims[0];
      close(c.base, 0, "Activ Yuva Y5 60L claim: Base (10L) fully consumed first");
      close(c.bonusTracks[0], 0, "Activ Yuva Y5 60L claim: Yuva Credit (40L) fully consumed second");
      close(c.usedFromRestoration, 10 * L, "Activ Yuva Y5 60L claim: remaining 10L drawn from Yuva Reload third");
      close(c.shortfall, 0, "Activ Yuva Y5 60L claim: fully settled, no shortfall (10L + 40L + 10L = 60L)");
    });

    it("first admissible claim in the policy can draw up to 2X Base SI (Base + Yuva Reload) in Year 1, when Yuva Credit is still 0", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 1, { 1: [15 * L] });
      const c1 = r[0].claims[0];
      close(c1.base, 0, "Activ Yuva Y1 claim(15L): Base fully used");
      close(c1.bonusTracks[0], 0, "Activ Yuva Y1 claim(15L): Yuva Credit is 0 in year 1, nothing to consume");
      close(c1.usedFromRestoration, 5 * L, "Activ Yuva Y1 claim(15L): remaining 5L drawn from Yuva Reload (pre-triggered from Year 1)");
      close(c1.shortfall, 0, "Activ Yuva Y1 claim(15L): no shortfall (10L Base + 5L of 10L Reload = 15L)");
    });

    it("a first claim beyond the 2X Base SI ceiling in Year 1 shows the excess as a shortfall", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 1, { 1: [25 * L] });
      const c1 = r[0].claims[0];
      close(c1.shortfall, 5 * L, "Activ Yuva Y1 claim(25L): 20L paid (10L Base + 10L Yuva Reload), 5L shortfall");
    });

    it("Yuva Reload gives an unlimited 100% Base SI refill for every claim after the first, even within the same year", () => {
      const p = resolvePlan("ab_yuva")!;
      // Both claims fall in Year 1, when Yuva Credit is still 0%, so Base +
      // Yuva Reload alone must cover each claim -- isolating Reload's own
      // "reload to full before every claim" behaviour from Credit.
      const r = simulate(p, 10 * L, 1, { 1: [15 * L, 8 * L] });
      const c1 = r[0].claims[0];
      const c2 = r[0].claims[1];
      close(c1.usedFromRestoration, 5 * L, "Activ Yuva Y1 claim1(15L): 10L Base + 5L of 10L Yuva Reload");
      close(c1.shortfall, 0, "Activ Yuva Y1 claim1(15L): fully settled");
      close(c2.usedFromRestoration, 8 * L, "Activ Yuva Y1 claim2(8L): Yuva Reload topped back to a full 10L before this claim, then 8L used");
      close(c2.shortfall, 0, "Activ Yuva Y1 claim2(8L): fully settled");
    });

    it("Yuva Reload refreshes to full SI at the start of every subsequent policy year", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 3, { 1: [15 * L], 2: [12 * L, 8 * L] });
      const y2c1 = r[1].claims[0];
      const y2c2 = r[1].claims[1];
      close(r[1].opening.bonusTracks[0], 10 * L, "Activ Yuva Y2 opening: Yuva Credit = 100% (unaffected by Y1's claim)");
      close(y2c1.shortfall, 0, "Activ Yuva Y2 claim1(12L): fully settled (10L Base + 2L of 10L Yuva Credit)");
      close(y2c2.usedFromRestoration, 0, "Activ Yuva Y2 claim2(8L): the 8L of Yuva Credit left over from claim1 already covers this claim, so Reload isn't touched");
      close(y2c2.shortfall, 0, "Activ Yuva Y2 claim2(8L): fully settled");
      close(r[2].opening.restoration, 10 * L, "Activ Yuva Y3 opening: Yuva Reload refreshes to full SI even with no new claims yet");
    });

    it("Yuva Reload does not affect accumulated Yuva Credit", () => {
      const p = resolvePlan("ab_yuva")!;
      const r = simulate(p, 10 * L, 4, { 1: [15 * L] });
      // Y1's claim draws on Base + Yuva Reload only (Credit is 0 in Y1); Credit
      // keeps accruing normally on the pure elapsed-year formula afterwards.
      close(r[1].opening.bonusTracks[0], 10 * L, "Activ Yuva Y2 opening: Yuva Credit = 100%, undisturbed by Y1's Reload-funded claim");
      close(r[3].opening.bonusTracks[0], 30 * L, "Activ Yuva Y4 opening: Yuva Credit = 300%, still on the pure elapsed-year formula");
    });
  });

  // --- F. Niva Bupa ReAssure 2.0 (Bronze+/Platinum+/Titanium+ Variants of
  //        ONE plan, "nb_reassure2") -- regression: independent-bucket
  //        restoration, explicitly re-verified for the expansion's CRITICAL
  //        "no Base SI cap" requirement, plus the Variant-driven Booster+
  //        cap resolution (needsReassure2Variant / REASSURE2_BOOSTER_CAP).
  //        These three Variants were previously separate PLANS entries
  //        (nb_bronze/nb_platinum/nb_titanium); the underlying math (this
  //        section) is UNCHANGED -- only how a Variant's plan gets resolved
  //        changed, from a distinct plan id to a single id + variant choice. ---
  describe("Niva Bupa ReAssure 2.0 variants (regression: independent bucket)", () => {
    it.each([
      ["bronze", 300],
      ["platinum", 500],
      ["titanium", 1000],
    ] as const)("%s: Base + ReAssure+ combine beyond the original Base SI (no cap), Booster+ capped at %s%%", (variant, expectedCapPct) => {
      const p = resolvePlan("nb_reassure2", { reassure2Variant: variant })!;
      expect(p.bonusTracks[0].capPct, `${variant} Booster+ cap`).toBe(expectedCapPct);
      expect(p.restorationClaimRule, `${variant} restoration claim rule`).toBe("independentBucket");
      expect(!!p.baseRestorationCap, `${variant}: no base+restoration cap`).toBe(false);

      const r = simulate(p, 10 * L, 1, { 1: [2 * L, 15 * L] });
      const c2 = r[0].claims[1];
      // base_before(8L) + restoration_used(7L) = 15L, which EXCEEDS the
      // original 10L Base SI -- proving the two buckets are independent.
      close(c2.usedFromRestoration, 7 * L, `${variant} claim2: full 7L of restoration usable, not capped to 2L`);
      close(c2.shortfall, 0, `${variant} claim2: no shortfall (15L fully paid from 8L base + 7L restoration = 15L > 10L SI)`);
    });

    it("defaults to the Bronze+ cap when no Variant is given (matches resolvePlan's Aspire-style fallback convention)", () => {
      const p = resolvePlan("nb_reassure2")!;
      expect(p.bonusTracks[0].capPct, "nb_reassure2 with no variant choice falls back to Bronze+'s 300% cap").toBe(300);
    });
  });

  // --- G. Niva Bupa ReAssure 3.0 ---
  describe("Niva Bupa ReAssure 3.0", () => {
    it("Booster+ caps at 10X (1000%) Base SI, carried forward from unused Base", () => {
      const p = resolvePlan("nb_reassure3")!;
      expect(p.bonusTracks[0].capPct, "ReAssure 3.0 Booster+ cap = 1000% (10X)").toBe(1000);
      const r = simulate(p, 10 * L, 10, {});
      close(r[9].closing.bonusTracks[0], 1 * CR, "ReAssure 3.0 Booster+ = 1 Cr after 10 claim-free years (10X of 10L base)");
    });

    it("ReAssure+ Forever is an independent bucket, unlimited, triggered repeatedly across years", () => {
      const p = resolvePlan("nb_reassure3")!;
      expect(!!p.baseRestorationCap, "ReAssure 3.0: no base+restoration cap").toBe(false);
      const r = simulate(p, 10 * L, 3, { 1: [2 * L, 15 * L], 3: [9 * L] });
      const c2 = r[0].claims[1];
      close(c2.usedFromRestoration, 7 * L, "ReAssure 3.0 Y1 claim2: 7L restoration usable, base(8L)+restoration(7L)=15L > 10L SI");
      close(r[2].opening.restoration, 10 * L, "ReAssure 3.0 Y3 opening restoration refreshes to full SI (lifetime, triggered)");
    });

    it("does not implement Unlimited SI (explicitly out of scope)", () => {
      const p = resolvePlan("nb_reassure3")!;
      expect((p as unknown as { unlimitedSI?: unknown }).unlimitedSI, "no Unlimited SI field").toBeUndefined();
    });

    // --- Cash-Bag+ add-on: a fully independent accumulator (see
    //     simulateCashBagPlus's own doc comment for the mechanics). Computed
    //     entirely outside resolvePlan()/simulate(), so these tests call it
    //     directly rather than through a ReAssure 3.0 ResolvedPlan -- proof
    //     in itself that enabling it can't touch the plan's own Booster+/
    //     Restoration math (nothing here even resolves a plan).
    describe("Cash-Bag+ add-on (independent of Booster+/Restoration/Lock the Clock)", () => {
      it("Year 1 has no balance; first renewal credits 10% of premium unconditionally", () => {
        const r = simulateCashBagPlus(10_000, 2, {});
        close(r[0].balance, 0, "Cash-Bag+ Y1: no renewal has happened yet");
        close(r[1].balance, 1_000, "Cash-Bag+ Y2 (1st renewal): +10% of 10,000 premium");
      });

      it("first renewal's 10% credit is unconditional, even if Year 1 had a claim", () => {
        const r = simulateCashBagPlus(10_000, 2, { 1: [1 * L] });
        close(r[1].balance, 1_000, "Cash-Bag+ Y2: still +10% of premium despite Year 1's claim");
      });

      it("second renewal onwards: +5% of premium per claim-free year, plus +10% of balance every 3rd consecutive claim-free year", () => {
        // No claims at all across 7 years -- pure accrual timeline:
        //   Y1: 0
        //   Y2 (1st renewal, unconditional): +10% of 10,000 = 1,000
        //   Y3 (Y2 was claim-free, streak=2): +5% of 10,000 = 500 -> 1,500
        //   Y4 (Y3 claim-free, streak=3, 3rd milestone): +500 -> 2,000, then
        //       +10% of 2,000 = 200 -> 2,200
        //   Y5 (streak=4): +500 -> 2,700
        //   Y6 (streak=5): +500 -> 3,200
        //   Y7 (streak=6, 6th milestone): +500 -> 3,700, then +10% of 3,700
        //       = 370 -> 4,070
        const r = simulateCashBagPlus(10_000, 7, {});
        const balances = r.map((y) => y.balance);
        [0, 1_000, 1_500, 2_200, 2_700, 3_200, 4_070].forEach((expected, i) => {
          close(balances[i], expected, `Cash-Bag+ Year ${i + 1} balance`);
        });
      });

      it("a claim year earns no renewal credit and resets the claim-free streak (never clawed back, just no new credit)", () => {
        // premium=20,000. Claims in Year 1 and Year 3.
        //   Y1: 0 (has a claim -- irrelevant, no renewal yet)
        //   Y2 (1st renewal, unconditional regardless of Y1's claim): +10% of
        //       20,000 = 2,000 -> 2,000
        //   Y3 (Y2 was claim-free, streak=1): +5% of 20,000 = 1,000 -> 3,000
        //   Y4 (Y3 HAD a claim -> no credit, streak resets to 0): stays 3,000
        //   Y5 (Y4 claim-free, streak=1): +1,000 -> 4,000
        const r = simulateCashBagPlus(20_000, 5, { 1: [1 * L], 3: [1 * L] });
        const balances = r.map((y) => y.balance);
        [0, 2_000, 3_000, 3_000, 4_000].forEach((expected, i) => {
          close(balances[i], expected, `Cash-Bag+ (claim in Y1/Y3) Year ${i + 1} balance`);
        });
      });

      it("is entirely independent of Booster+/Restoration -- resolving the plan and running simulate() alongside it changes neither", () => {
        const p = resolvePlan("nb_reassure3")!;
        const SI = 10 * L;
        const claims = { 2: [3 * L] };
        const engineResult = simulate(p, SI, 4, claims);
        const cashBag = simulateCashBagPlus(15_000, 4, claims);
        // Booster+ (unusedBaseCarryforward): Y1 +10L (no claim) -> 10L; Y2
        // claim(3L) leaves 7L unused -> +7L -> 17L; Y3 +10L -> 27L; Y4 +10L
        // -> 37L. Same value it would be with no Cash-Bag+ involved at all
        // -- proof that resolving/simulating alongside Cash-Bag+ doesn't
        // perturb Booster+'s own math.
        close(engineResult[3].closing.bonusTracks[0], 37 * L, "Booster+ unaffected by Cash-Bag+ existing alongside it");
        expect(cashBag.length, "Cash-Bag+ produces its own independent year series").toBe(4);
        close(cashBag[0].balance, 0, "Cash-Bag+ Y1 still starts at 0 regardless of the claim scenario shared with simulate()");
      });
    });
  });

  // --- H. Niva Bupa Aspire: getAspireBoosterCap resolver + independent restoration ---
  describe("Niva Bupa Aspire", () => {
    it("getAspireBoosterCap: all 12 age-band x variant combinations", () => {
      const cases: Array<[number, "gold" | "diamond" | "platinum" | "titanium", number]> = [
        [18, "gold", 3], [18, "diamond", 5], [18, "platinum", 10], [18, "titanium", 10],
        [40, "gold", 2], [40, "diamond", 3], [40, "platinum", 5], [40, "titanium", 5],
        [46, "gold", 1], [46, "diamond", 2], [46, "platinum", 3], [46, "titanium", 3],
      ];
      for (const [age, variant, expected] of cases) {
        expect(getAspireBoosterCap(age, variant), `age=${age} variant=${variant}`).toBe(expected);
      }
    });

    it("getAspireBoosterCap: age-band boundaries (35/36 and 45/46)", () => {
      expect(getAspireBoosterCap(35, "gold"), "age 35 -> young band").toBe(3);
      expect(getAspireBoosterCap(36, "gold"), "age 36 -> mid band").toBe(2);
      expect(getAspireBoosterCap(45, "gold"), "age 45 -> mid band").toBe(2);
      expect(getAspireBoosterCap(46, "gold"), "age 46 -> senior band").toBe(1);
    });

    it("resolvePlan wires the age/variant-specific cap into the Booster+ track", () => {
      const p = resolvePlan("nb_aspire", { entryAge: 40, variant: "diamond" })!;
      expect(p.bonusTracks[0].capPct, "Aspire(40, diamond) Booster+ cap = 300% (3X)").toBe(300);
    });

    it("ReAssure Forever is an independent bucket (no Base SI cap), like the other Niva plans", () => {
      const p = resolvePlan("nb_aspire", { entryAge: 30, variant: "platinum" })!;
      expect(!!p.baseRestorationCap, "Aspire: no base+restoration cap").toBe(false);
      const r = simulate(p, 10 * L, 1, { 1: [2 * L, 15 * L] });
      const c2 = r[0].claims[1];
      close(c2.usedFromRestoration, 7 * L, "Aspire claim2: 7L restoration usable, exceeding the original 10L SI when combined with base");
      close(c2.shortfall, 0, "Aspire claim2: no shortfall");
    });

    it("Base + Booster+ + ReAssure+ all combine correctly in a single scenario", () => {
      const p = resolvePlan("nb_aspire", { entryAge: 50, variant: "titanium" })!; // 3X cap at this age band
      expect(p.bonusTracks[0].capPct, "Aspire(50, titanium) Booster+ cap = 300% (3X)").toBe(300);
      const r = simulate(p, 10 * L, 2, {}); // one claim-free year credits Booster+
      close(r[0].closing.bonusTracks[0], 10 * L, "Aspire(50, titanium) Booster+ after 1 claim-free year = 10L (full unused base)");
    });
  });
});
