/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { PLANS, resolvePlan, simulate, totalOf, usableRestoration } from "../coverageProjectionEngine";

// Direct port of the standalone Coverage Projection Studio's engine.test.js
// (70/70 passing at time of port). Same scenarios, same expected values —
// only the assertion style changed (assertEq -> expect().toBeCloseTo), to
// keep this a faithful regression net for the ported TypeScript engine.

const L = 100_000; // 1 Lakh in rupees
const CR = 10_000_000; // 1 Crore in rupees
const RUPEE_TOLERANCE = 1; // matches engine.test.js's `< 1` tolerance

function plan(id: string) {
  const p = PLANS.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown plan id: ${id}`);
  return p;
}

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
    const p = resolvePlan("nb_titanium")!;
    const r = simulate(p, 10 * L, 10, {});
    close(r[9].closing.bonusTracks[0], 1 * CR, "ReAssure Titanium+ Booster+ = 1 Cr after 10 claim-free years (10L base)");
    close(r[9].closing.base, 10 * L, "ReAssure Titanium+ Base SI stays 10L (resets each year)");
  });

  it("Niva Bupa ReAssure 2.0 Bronze+: a partial-base claim only carries forward the unused remainder", () => {
    const p = resolvePlan("nb_bronze")!;
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
    const p = resolvePlan("nb_bronze")!;
    const r = simulate(p, 10 * L, 3, { 2: [13 * L] });
    close(r[1].closing.bonusTracks[0], 7 * L, "ReAssure Bronze+ Y2 closing Booster+ = 7L after a 13L claim draws 3L from it");
    close(r[2].opening.bonusTracks[0], 7 * L, "ReAssure Bronze+ Y3 opening Booster+ stays at 7L (does not heal back to 10L)");
  });

  it("FIX: lifetime restoration refreshes to full SI at each subsequent policy year once triggered", () => {
    // Year1: Claim1(6L) triggers restoration (full 10L, unused by the
    // triggering claim itself). Claim2(12L) reloads restoration to a full
    // 10L (reloadPerClaim), then draws 8L of it down to 2L by year end.
    const p = resolvePlan("nb_platinum")!;
    const r = simulate(p, 10 * L, 2, { 1: [6 * L, 12 * L] });
    const c2 = r[0].claims[1];
    close(c2.restoration, 2 * L, "ReAssure Platinum+ Y1 closing restoration = 2L after Claim2 draws 8L");
    close(r[1].opening.restoration, 10 * L, "ReAssure Platinum+ Y2 opening restoration refreshes to full 10L (lifetime, triggered), not stuck at 2L");
  });
});
