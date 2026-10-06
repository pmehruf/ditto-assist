/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { planConfigs, planOverrides, planRestrictions } from "../../server/db/schema";
import type { MappingDump } from "../../mapping/seedBuilder";
import type { MappingTestEnv } from "./mappingTestDb";

/**
 * The mapping test database keeps plans in memory only. The suggestion-cleanup tools read the plan tables the way the live server
 * does, so this loads the same plan rows, plan-specific mappings and restrictions into those tables.
 */
export async function loadPlanTables(env: MappingTestEnv, dump: MappingDump): Promise<void> {
  const d = dump as unknown as { planConfigs: Array<Record<string, unknown>>; planOverrides: Array<Record<string, unknown>>; planRestrictions: Array<Record<string, unknown>> };
  if (d.planConfigs.length) await env.db.insert(planConfigs).values(d.planConfigs.map((p) => ({ ...p, overrides: p.overrides ?? {}, addedBy: "fixture" })) as never);
  if (d.planOverrides.length) await env.db.insert(planOverrides).values(d.planOverrides.map((o) => ({ ...o, id: undefined, addedBy: "fixture" })) as never);
  if (d.planRestrictions.length) await env.db.insert(planRestrictions).values(d.planRestrictions.map((r) => ({ ...r, id: undefined, createdBy: "fixture", updatedBy: "fixture" })) as never);
}
