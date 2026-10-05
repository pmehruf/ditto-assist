import { test, expect } from "vitest";
import { buildPrompt, shape, parseModelJson } from "./qipExceptionWriter";

const full = (task: "advisor" | "shared", facts: string) => {
  const p = buildPrompt(task, facts);
  return `${p.system}\n${p.user}`;
};

test("writer instructions carry the safety rules and the output shape", () => {
  const a = full("advisor", "Advisor: Test");
  const s = full("shared", "Facts");
  for (const x of ["Use ONLY the facts given", "must appear in the facts", "exact name", "No placeholders", "ONE advisor", "connected paragraphs", "Never say the same thing twice", "Advisor: Test"]) {
    expect(a).toContain(x);
  }
  expect(s).toContain('"background"');
  expect(s).toContain('"conclusion"');
  expect(s).toContain("Do not include the final request sentence");
});

test("answers are trimmed to the expected shape; junk is dropped", () => {
  expect(shape("advisor", { overview: ["a", 1], categories: { pay: ["b", "c", "d", "e"], lead: "x" }, extra: 1 })).toEqual({ overview: ["a"], lead: [], pay: ["b", "c"] });
  expect(shape("shared", { background: [" x  y "], conclusion: ["a", "b", "c"] })).toEqual({ background: ["x y"], conclusion: ["a", "b"] });
  expect(shape("shared", null)).toEqual({ background: [], conclusion: [] });
});

test("writer is told to use very simple, human language", () => {
  for (const p of [full("advisor", "f"), full("shared", "f")]) {
    for (const x of ["very basic, everyday English", "under 18 words", "never over 25", 'Say "use" not "utilize"', "leverage", "Do not use dashes", "real person who knows the advisor", "connected paragraphs"]) {
      expect(p).toContain(x);
    }
  }
});

test("JSON parser copes with code fences and rejects non-JSON", () => {
  expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(() => parseModelJson("no json here")).toThrow();
});
