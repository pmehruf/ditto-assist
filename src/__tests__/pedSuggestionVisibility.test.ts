/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createMappingTestEnv, type MappingTestEnv } from "./helpers/mappingTestDb";

/**
 * Declaration Assist suggestion cleanup rests on one fact: hiding a name (is_visible = false) removes it from the suggestion
 * list and changes nothing else. This runs it for real on the production-shaped test data: the answer for every plan, before
 * and after hiding, must be identical (the mapping version number itself moves on, so it is left out), and the suggestion list must lose exactly the hidden names.
 */

let env: MappingTestEnv;
beforeAll(async () => {
  env = await createMappingTestEnv();
}, 60_000);

describe("hiding a name only removes it from the suggestion list", () => {
  it("gives the same answer on every plan for a hidden name, before and after", async () => {
    const all = await env.repos.pedAliases.listAll();
    const visible = all.filter((a) => a.isVisible).sort((a, b) => a.aliasText.localeCompare(b.aliasText));
    const step = Math.max(1, Math.floor(visible.length / 120));
    const picked = visible.filter((_, i) => i % step === 0).slice(0, 120);
    expect(picked.length).toBeGreaterThan(50);
    const plans = [...env.plans.keys()];

    const before = env.newInstance();
    const answers = async (inst: ReturnType<MappingTestEnv["newInstance"]>) => {
      const out: string[] = [];
      for (const a of picked) for (const plan of plans) { const { snapshotVersion: _v, ...answer } = await inst.lookup(a.aliasText, plan); out.push(JSON.stringify(answer)); }
      return out;
    };
    const was = await answers(before);

    for (const a of picked) await env.repos.pedAliases.setVisibility(a.id, false);
    await env.repos.mappingState.bump();

    const after = await answers(env.newInstance());
    const firstDiff = was.findIndex((x, i) => x !== after[i]);
    expect(firstDiff >= 0 ? `${was[firstDiff]}
---
${after[firstDiff]}` : "identical").toBe("identical");

    const nowVisible = new Set((await env.repos.pedAliases.listAll()).filter((a) => a.isVisible).map((a) => a.id));
    for (const a of picked) expect(nowVisible.has(a.id), a.aliasText).toBe(false);
    expect(nowVisible.size).toBe(visible.length - picked.length);
  }, 300_000);
});
