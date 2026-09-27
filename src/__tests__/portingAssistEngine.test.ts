/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  deriveCoverTranches,
  mergeBonusIntoTranches,
  computeEffectiveTranchesForMember,
  allocatePortingCover,
  computePedGroupResult,
  computeUndeclaredPedResult,
  aggregateTrancheStatus,
  aggregatePedStatus,
  calculatePortingAssist,
  groupMembersByIdenticalResult,
  formatRupees,
  validatePortingAssistInput,
  type CoverHistoryEntry,
  type MemberInput,
  type PortingAssistInput,
} from "../portingAssistEngine.js";

const L = 100_000; // 1 Lakh in rupees

function coverHistory(amountsInLakhs: number[]): CoverHistoryEntry[] {
  return amountsInLakhs.map((amt, i) => ({ policyYear: i + 1, coverAmount: amt * L }));
}

function member(overrides: Partial<MemberInput> & { id: string }): MemberInput {
  return {
    relationship: "Self",
    memberSinceYear: 1,
    hasPeds: false,
    pedGroups: [],
    undeclaredPedConditions: [],
    ...overrides,
  };
}

describe("deriveCoverTranches", () => {
  it("treats flat cover across every year as one tranche dated to Year 1", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 10]));
    expect(tranches).toEqual([{ amount: 10 * L, sinceYear: 1, heldYears: 3 }]);
  });

  it("splits a cover enhancement into a separate, later-dated tranche (spec's own worked example)", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 15]));
    expect(tranches).toEqual([
      { amount: 10 * L, sinceYear: 1, heldYears: 3 },
      { amount: 5 * L, sinceYear: 3, heldYears: 1 },
    ]);
  });

  it("handles more than one enhancement across different years", () => {
    const tranches = deriveCoverTranches(coverHistory([5, 5, 8, 8, 12]));
    expect(tranches).toEqual([
      { amount: 5 * L, sinceYear: 1, heldYears: 5 },
      { amount: 3 * L, sinceYear: 3, heldYears: 3 },
      { amount: 4 * L, sinceYear: 5, heldYears: 1 },
    ]);
  });

  it("gives up the most recently added tranche first on a decrease (defensive, not spec-mandated)", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 15, 10]));
    // Year2 added a 5L tranche (sinceYear 2); Year3 drops back to 10L, which
    // removes that same 5L tranche entirely, leaving only the original 10L.
    expect(tranches).toEqual([{ amount: 10 * L, sinceYear: 1, heldYears: 3 }]);
  });
});

describe("mergeBonusIntoTranches", () => {
  it("enlarges the most recent tranche by the bonus amount, keeping that tranche's own vintage", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 15]));
    const merged = mergeBonusIntoTranches(tranches, 5 * L);
    expect(merged).toEqual([
      { amount: 10 * L, sinceYear: 1, heldYears: 3 },
      { amount: 10 * L, sinceYear: 3, heldYears: 1 },
    ]);
  });

  it("is a no-op for zero bonus", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 10]));
    expect(mergeBonusIntoTranches(tranches, 0)).toEqual(tranches);
  });

  it("contributes nothing when there is no existing cover to attach to", () => {
    expect(mergeBonusIntoTranches([], 10 * L)).toEqual([]);
  });
});

describe("computeEffectiveTranchesForMember", () => {
  it("caps a tranche that predates the member's own join year to the member's own tenure", () => {
    const owner = deriveCoverTranches(coverHistory([10, 10, 10])); // single tranche since Year 1, heldYears 3
    const spouse = computeEffectiveTranchesForMember(owner, 3, 2); // joined Year 2
    expect(spouse).toEqual([{ amount: 10 * L, sinceYear: 2, heldYears: 2 }]);
  });

  it("keeps a tranche created after the member joined at its own vintage", () => {
    const owner = deriveCoverTranches(coverHistory([10, 10, 15])); // 2nd tranche since Year 3
    const self = computeEffectiveTranchesForMember(owner, 3, 1);
    expect(self[1]).toEqual({ amount: 5 * L, sinceYear: 3, heldYears: 1 });
  });
});

describe("Scenario A — same cover every year, no enhancement, no bonus, no PEDs", () => {
  const result = calculatePortingAssist({
    coverHistory: coverHistory([10, 10, 10]),
    availableBonus: 0,
    portingCoverAmount: 10 * L,
    members: [member({ id: "self" })],
  });

  it("carries forward the full 10L with initial and specific-illness waiting periods completed", () => {
    const self = result.members[0];
    expect(self.carryForwardAmount).toBe(10 * L);
    expect(self.freshAmount).toBe(0);
    expect(self.initialStatus).toBe("completed");
    expect(self.specificIllnessStatus).toBe("completed");
    expect(self.tranches).toEqual([
      {
        amount: 10 * L,
        sinceYear: 1,
        heldYears: 3,
        initialCompleted: true,
        specificIllnessRemainingYears: 0,
        specificIllnessCompleted: true,
      },
    ]);
    expect(self.pedResults).toEqual([]);
    expect(self.pedStatus).toBe("none");
  });
});

describe("Scenario B — cover enhancement, no bonus, no PEDs", () => {
  const result = calculatePortingAssist({
    coverHistory: coverHistory([10, 10, 15]),
    availableBonus: 0,
    portingCoverAmount: 20 * L,
    members: [member({ id: "self" })],
  });
  const self = result.members[0];

  it("splits into the original 10L (completed both), the 5L enhancement (1yr SI remaining), and a fresh 5L", () => {
    expect(self.tranches).toEqual([
      {
        amount: 10 * L,
        sinceYear: 1,
        heldYears: 3,
        initialCompleted: true,
        specificIllnessRemainingYears: 0,
        specificIllnessCompleted: true,
      },
      {
        amount: 5 * L,
        sinceYear: 3,
        heldYears: 1,
        initialCompleted: true,
        specificIllnessRemainingYears: 1,
        specificIllnessCompleted: false,
      },
      {
        amount: 5 * L,
        sinceYear: null,
        heldYears: 0,
        initialCompleted: false,
        specificIllnessRemainingYears: 2,
        specificIllnessCompleted: false,
      },
    ]);
    expect(self.carryForwardAmount).toBe(15 * L);
    expect(self.freshAmount).toBe(5 * L);
    expect(self.initialStatus).toBe("partial");
    expect(self.specificIllnessStatus).toBe("partial");
  });
});

describe("Scenario C — bonus fully covers the enhancement", () => {
  const result = calculatePortingAssist({
    coverHistory: coverHistory([10, 10, 10]),
    availableBonus: 10 * L,
    portingCoverAmount: 20 * L,
    members: [member({ id: "self" })],
  });
  const self = result.members[0];

  it("carries forward the full 20L, inheriting the single tranche's 3-year status", () => {
    expect(self.carryForwardAmount).toBe(20 * L);
    expect(self.freshAmount).toBe(0);
    expect(self.initialStatus).toBe("completed");
    expect(self.specificIllnessStatus).toBe("completed");
    expect(self.tranches).toHaveLength(1);
    expect(self.tranches[0].amount).toBe(20 * L);
    expect(self.tranches[0].heldYears).toBe(3);
  });
});

describe("Scenario D — bonus partially covers the porting cover", () => {
  const result = calculatePortingAssist({
    coverHistory: coverHistory([10, 10, 10]),
    availableBonus: 10 * L,
    portingCoverAmount: 25 * L,
    members: [member({ id: "self" })],
  });
  const self = result.members[0];

  it("carries forward 20L (completed) and gives the remaining 5L fresh waiting periods", () => {
    expect(self.carryForwardAmount).toBe(20 * L);
    expect(self.freshAmount).toBe(5 * L);
    expect(self.tranches).toHaveLength(2);
    expect(self.tranches[0]).toMatchObject({ amount: 20 * L, heldYears: 3, specificIllnessCompleted: true });
    expect(self.tranches[1]).toMatchObject({ amount: 5 * L, sinceYear: null, initialCompleted: false });
  });
});

describe("Scenario E — PED declared at inception (3-year policy)", () => {
  it("completes the PED waiting period", () => {
    const r = computePedGroupResult(
      { id: "g1", conditions: "Diabetes", declared: true, declaredSinceInception: true, declaredYear: null },
      3,
      1
    );
    expect(r.servedYears).toBe(3);
    expect(r.remainingYears).toBe(0);
    expect(r.completed).toBe(true);
    expect(r.declaredLabel).toBe("Declared at inception");
  });
});

describe("Scenario F — PED declared in Year 2 (3-year policy)", () => {
  it("gives 1 year of credit, 2 years remaining", () => {
    const r = computePedGroupResult(
      { id: "g1", conditions: "Thyroid", declared: true, declaredSinceInception: false, declaredYear: 2 },
      3,
      1
    );
    expect(r.servedYears).toBe(1);
    expect(r.remainingYears).toBe(2);
    expect(r.completed).toBe(false);
    expect(r.declaredLabel).toBe("Declared in Year 2");
  });
});

describe("Scenario G — undeclared PED (3-year policy)", () => {
  it("always gets a fresh 3-year waiting period", () => {
    const r = computeUndeclaredPedResult("u1", "Asthma");
    expect(r.servedYears).toBe(0);
    expect(r.remainingYears).toBe(3);
    expect(r.completed).toBe(false);
    expect(r.declared).toBe(false);
  });

  it("also applies via a PED group explicitly marked not-declared", () => {
    const r = computePedGroupResult(
      { id: "g1", conditions: "Asthma", declared: false, declaredSinceInception: false, declaredYear: null },
      3,
      1
    );
    expect(r.remainingYears).toBe(3);
    expect(r.completed).toBe(false);
  });
});

describe("Scenario H — multiple PED declaration groups, each with its own status (3-year policy)", () => {
  const groups = [
    { id: "g1", conditions: "Diabetes, Hypertension", declared: true, declaredSinceInception: true, declaredYear: null },
    { id: "g2", conditions: "Thyroid", declared: true, declaredSinceInception: false, declaredYear: 2 },
    { id: "g3", conditions: "Asthma", declared: false, declaredSinceInception: false, declaredYear: null },
  ] as const;

  it("resolves each group independently", () => {
    const results = groups.map((g) => computePedGroupResult(g, 3, 1));
    expect(results[0]).toMatchObject({ servedYears: 3, remainingYears: 0, completed: true });
    expect(results[1]).toMatchObject({ servedYears: 1, remainingYears: 2, completed: false });
    expect(results[2]).toMatchObject({ servedYears: 0, remainingYears: 3, completed: false });
  });

  it("aggregates to a partial PED status when the group results differ", () => {
    const results = groups.map((g) => computePedGroupResult(g, 3, 1));
    expect(aggregatePedStatus(results)).toBe("partial");
  });

  it("full end-to-end calculatePortingAssist wires all three groups through for one member", () => {
    const result = calculatePortingAssist({
      coverHistory: coverHistory([10, 10, 10]),
      availableBonus: 0,
      portingCoverAmount: 10 * L,
      members: [
        member({
          id: "self",
          hasPeds: true,
          pedGroups: groups.map((g) => ({ ...g })),
        }),
      ],
    });
    expect(result.members[0].pedResults).toHaveLength(3);
    expect(result.members[0].pedStatus).toBe("partial");
  });
});

describe("Scenario I — different member joining dates get independent histories", () => {
  // Policy inception Year 1; Self since Year 1, Spouse since Year 2, Child since Year 3 of a 3-year policy.
  const input: PortingAssistInput = {
    coverHistory: coverHistory([10, 10, 10]),
    availableBonus: 0,
    portingCoverAmount: 10 * L,
    members: [
      member({ id: "self", relationship: "Self", memberSinceYear: 1 }),
      member({ id: "spouse", relationship: "Spouse", memberSinceYear: 2 }),
      member({ id: "child", relationship: "Child +1", memberSinceYear: 3 }),
    ],
  };
  const result = calculatePortingAssist(input);

  it("gives Self the full 3-year history", () => {
    expect(result.members[0].tranches[0].heldYears).toBe(3);
    expect(result.members[0].specificIllnessStatus).toBe("completed");
  });

  it("gives Spouse only 2 years of history from their own join year", () => {
    expect(result.members[1].tranches[0].heldYears).toBe(2);
    expect(result.members[1].specificIllnessStatus).toBe("completed"); // 2 years already meets the 2-year SI bar
  });

  it("gives Child only 1 year of history, leaving specific-illness waiting partially served", () => {
    expect(result.members[2].tranches[0].heldYears).toBe(1);
    expect(result.members[2].specificIllnessStatus).toBe("fresh");
    expect(result.members[2].tranches[0].specificIllnessRemainingYears).toBe(1);
  });

  it("consolidates Self and Spouse only if their results actually match, and keeps Child distinct", () => {
    const groups = groupMembersByIdenticalResult(result.members);
    // Self (3yr, completed) and Spouse (2yr, also completed) differ in heldYears
    // even though both count as "completed" for specific illness, so they are
    // NOT byte-identical results and must remain separate groups.
    expect(groups).toHaveLength(3);
    const child = groups.find((g) => g.relationships.includes("Child +1"))!;
    expect(child.memberIds).toEqual(["child"]);
  });

  it("consolidates two members whose full results genuinely match", () => {
    const identicalInput: PortingAssistInput = {
      ...input,
      members: [
        member({ id: "self", relationship: "Self", memberSinceYear: 1 }),
        member({ id: "spouse", relationship: "Spouse", memberSinceYear: 1 }),
      ],
    };
    const r = calculatePortingAssist(identicalInput);
    const groups = groupMembersByIdenticalResult(r.members);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(["self", "spouse"]);
    expect(groups[0].relationships).toEqual(["Self", "Spouse"]);
  });
});

describe("aggregateTrancheStatus", () => {
  it("is fresh for an empty tranche list", () => {
    expect(aggregateTrancheStatus([], "initial")).toBe("fresh");
  });
});

describe("formatRupees", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatRupees(2_000_000)).toBe("20,00,000");
    expect(formatRupees(1_000_000)).toBe("10,00,000");
    expect(formatRupees(0)).toBe("0");
  });
});

describe("validatePortingAssistInput", () => {
  const validBase: PortingAssistInput = {
    coverHistory: coverHistory([10, 10, 10]),
    availableBonus: 0,
    portingCoverAmount: 10 * L,
    members: [member({ id: "self" })],
  };

  it("passes for a fully valid input", () => {
    expect(validatePortingAssistInput(validBase)).toEqual([]);
  });

  it("flags a negative cover amount", () => {
    const bad: PortingAssistInput = { ...validBase, coverHistory: coverHistory([10, -5, 10]) };
    expect(validatePortingAssistInput(bad).length).toBeGreaterThan(0);
  });

  it("flags a member-since year outside the policy's history", () => {
    const bad: PortingAssistInput = {
      ...validBase,
      members: [member({ id: "self", memberSinceYear: 5 })],
    };
    expect(validatePortingAssistInput(bad).length).toBeGreaterThan(0);
  });

  it("flags a PED declared before the member joined", () => {
    const bad: PortingAssistInput = {
      ...validBase,
      members: [
        member({
          id: "self",
          memberSinceYear: 2,
          hasPeds: true,
          pedGroups: [{ id: "g1", conditions: "X", declared: true, declaredSinceInception: false, declaredYear: 1 }],
        }),
      ],
    };
    expect(validatePortingAssistInput(bad).length).toBeGreaterThan(0);
  });

  it("flags a declared PED's own join year picked via the selector instead of the inception checkbox", () => {
    const bad: PortingAssistInput = {
      ...validBase,
      members: [
        member({
          id: "self",
          memberSinceYear: 1,
          hasPeds: true,
          pedGroups: [{ id: "g1", conditions: "X", declared: true, declaredSinceInception: false, declaredYear: 1 }],
        }),
      ],
    };
    expect(validatePortingAssistInput(bad).length).toBeGreaterThan(0);
  });

  it("flags zero members", () => {
    expect(validatePortingAssistInput({ ...validBase, members: [] }).length).toBeGreaterThan(0);
  });

  it("flags a non-positive porting cover amount", () => {
    expect(validatePortingAssistInput({ ...validBase, portingCoverAmount: 0 }).length).toBeGreaterThan(0);
  });
});

describe("allocatePortingCover", () => {
  it("allocates oldest-first and never allocates more than a tranche's own amount", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 15]));
    const portions = allocatePortingCover(tranches, 12 * L);
    expect(portions).toEqual([
      {
        amount: 10 * L,
        sinceYear: 1,
        heldYears: 3,
        initialCompleted: true,
        specificIllnessRemainingYears: 0,
        specificIllnessCompleted: true,
      },
      {
        amount: 2 * L,
        sinceYear: 3,
        heldYears: 1,
        initialCompleted: true,
        specificIllnessRemainingYears: 1,
        specificIllnessCompleted: false,
      },
    ]);
  });

  it("produces no fresh portion when porting cover is fully absorbed by tranches", () => {
    const tranches = deriveCoverTranches(coverHistory([10, 10, 10]));
    const portions = allocatePortingCover(tranches, 10 * L);
    expect(portions.every((p) => p.sinceYear !== null)).toBe(true);
  });
});
