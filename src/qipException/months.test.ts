import { test, expect } from "vitest";
import { monthRange, monthLabel, scoreText } from "./months";

test("From month + count fills consecutive months", () => {
  expect(monthRange("2026-01", 3)).toEqual([
    { key: "2026-01", name: "January" },
    { key: "2026-02", name: "February" },
    { key: "2026-03", name: "March" },
  ]);
});

test("range rolls over the year", () => {
  expect(monthRange("2026-11", 3).map((m) => m.key)).toEqual(["2026-11", "2026-12", "2027-01"]);
  expect(monthRange("2026-11", 3).map((m) => m.name)).toEqual(["November", "December", "January"]);
});

test("empty or invalid input gives no months", () => {
  expect(monthRange("", 3)).toEqual([]);
  expect(monthRange("2026-13", 3)).toEqual([]);
  expect(monthRange("2026-05", 0)).toEqual([]);
});

test("month label and score text", () => {
  expect(monthLabel("2026-07")).toBe("July 2026");
  expect(monthLabel("")).toBe("");
  expect(scoreText(3.4)).toBe("3.4");
  expect(scoreText(3.4567)).toBe("3.46");
  expect(scoreText(null)).toBe("");
});
