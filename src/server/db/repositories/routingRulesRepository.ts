/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { routingRules, type RoutingRuleDbRow } from "../schema.js";
import type { PrimitiveName, RoutingRuleRow, RuleDefinition, StepKind, StepStage } from "../../../mapping/ruleTypes.js";

function toRuleRow(row: RoutingRuleDbRow): RoutingRuleRow {
  return {
    ruleKey: row.ruleKey,
    kind: row.kind as StepKind,
    stage: row.stage as StepStage,
    primitive: (row.primitive as PrimitiveName | null) ?? null,
    position: row.position,
    planScope: row.planScope ?? null,
    enabled: row.enabled,
    description: row.description,
    definition: row.definition as RuleDefinition,
  };
}

/**
 * Data Access Layer for `routing_rules` — the ordered routing pipeline as
 * data (see schema.ts and src/mapping/ruleTypes.ts).
 */
export class RoutingRulesRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every rule, in evaluation order. */
  async listAll(): Promise<RoutingRuleRow[]> {
    const rows = await this.db.select().from(routingRules).orderBy(asc(routingRules.position), asc(routingRules.id));
    return rows.map(toRuleRow);
  }

  /** Only enabled rules, in evaluation order — what the runtime snapshot loads. */
  async listEnabled(): Promise<RoutingRuleRow[]> {
    return (await this.listAll()).filter((r) => r.enabled);
  }

  async getByKey(ruleKey: string): Promise<RoutingRuleRow | undefined> {
    const [row] = await this.db.select().from(routingRules).where(eq(routingRules.ruleKey, ruleKey));
    return row ? toRuleRow(row) : undefined;
  }

  /** Inserts the rule, or replaces the existing rule with the same key. Idempotent. */
  async upsert(rule: RoutingRuleRow): Promise<void> {
    const values = {
      ruleKey: rule.ruleKey,
      kind: rule.kind,
      stage: rule.stage,
      primitive: rule.primitive,
      position: rule.position,
      planScope: rule.planScope,
      enabled: rule.enabled,
      description: rule.description,
      definition: rule.definition,
    };
    await this.db
      .insert(routingRules)
      .values(values)
      .onConflictDoUpdate({ target: routingRules.ruleKey, set: { ...values, updatedAt: new Date() } });
  }
}
