/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils";
import { PedAliasesRepository } from "./pedAliasesRepository";
import { PedRepositoryRepository } from "./pedRepositoryRepository";
import { MappingStateRepository } from "./mappingStateRepository";
import { RoutingRulesRepository } from "./routingRulesRepository";
import { updateAliasRow } from "../../pedRepositoryLive";

let db: TestDb;
let peds: PedRepositoryRepository;
let aliases: PedAliasesRepository;

beforeAll(async () => {
  db = await createTestDb();
  peds = new PedRepositoryRepository(db as never);
  aliases = new PedAliasesRepository(db as never);
});

describe("ped_aliases mapping-control compatibility controls", () => {
  it("new aliases default to routing on, no override, no fallback", async () => {
    const ped = await peds.create({ canonicalName: "Control Test", categoryKey: "heart", status: "approved", notes: null, addedBy: "t" });
    const alias = await aliases.create({ pedId: ped.id, aliasText: "Control Test", isPrimary: true, isVisible: true, addedBy: "t" });
    expect(alias.routingEnabled).toBe(true);
    expect(alias.categoryKeyOverride).toBeNull();
    expect(alias.fallbackCategoryKey).toBeNull();
  });

  it("setRoutingControls changes only the fields given, and null clears an override", async () => {
    const ped = await peds.create({ canonicalName: "Control Test Two", categoryKey: "heart", status: "approved", notes: null, addedBy: "t" });
    const alias = await aliases.create({ pedId: ped.id, aliasText: "Control Test Two", isPrimary: true, isVisible: true, addedBy: "t" });
    const a = await aliases.setRoutingControls(alias.id, { routingEnabled: false, categoryKeyOverride: "kidney" });
    expect(a).toMatchObject({ routingEnabled: false, categoryKeyOverride: "kidney", fallbackCategoryKey: null });
    const b = await aliases.setRoutingControls(alias.id, { fallbackCategoryKey: "liver" });
    expect(b).toMatchObject({ routingEnabled: false, categoryKeyOverride: "kidney", fallbackCategoryKey: "liver" });
    const c = await aliases.setRoutingControls(alias.id, { categoryKeyOverride: null });
    expect(c).toMatchObject({ routingEnabled: false, categoryKeyOverride: null, fallbackCategoryKey: "liver" });
    expect((await aliases.get(alias.id))?.pedId).toBe(ped.id); // the PED link is untouched
  });

  it("updateAliasRow applies the controls without touching the alias text or the PED category", async () => {
    const ped = await peds.create({ canonicalName: "Control Test Three", categoryKey: "heart", status: "approved", notes: null, addedBy: "t" });
    const alias = await aliases.create({ pedId: ped.id, aliasText: "Control Test Three", isPrimary: true, isVisible: true, addedBy: "t" });
    const after = await updateAliasRow(
      { pedRepository: peds, pedAliases: aliases, pedMappingOverrides: {} as never },
      alias.id,
      { categoryKeyOverride: "neuro", routingEnabled: true },
      "tester"
    );
    expect(after).toMatchObject({ aliasText: "Control Test Three", categoryKeyOverride: "neuro", routingEnabled: true });
    expect((await peds.get(ped.id))?.categoryKey).toBe("heart");
  });
});

describe("mapping_state and routing_rules repositories", () => {
  it("bump creates the row if missing and always increases the version", async () => {
    const state = new MappingStateRepository(db as never);
    const first = await state.bump();
    const second = await state.bump();
    expect(second).toBe(first + 1);
    expect(await state.getVersion()).toBe(second);
  });

  it("routing rules upsert is idempotent and keeps evaluation order", async () => {
    const rules = new RoutingRulesRepository(db as never);
    const rule = { ruleKey: "test.rule", kind: "rule" as const, stage: "family" as const, primitive: null, position: 5, planScope: null, enabled: true, description: "t", definition: { when: [], clauses: [] } };
    await rules.upsert(rule);
    await rules.upsert({ ...rule, description: "changed" });
    await rules.upsert({ ...rule, ruleKey: "test.rule.early", position: 1 });
    const all = await rules.listAll();
    expect(all.map((r) => r.ruleKey)).toEqual(["test.rule.early", "test.rule"]);
    expect(all[1].description).toBe("changed");
    expect((await rules.listEnabled()).length).toBe(2);
  });
});
