import { describe, it, expect } from "vitest";
import {
  combineSessionNotes,
  toIsoDate,
  filterFeedbackEntries,
  feedbackOwners,
  feedbackCountLabel,
  isFeedbackFilterActive,
  EMPTY_FEEDBACK_FILTER,
} from "./sessionFeedback";

describe("combineSessionNotes", () => {
  it("keeps both legacy fields, discussion first, nothing dropped", () => {
    expect(combineSessionNotes("Point A\nPoint B", "Notes line 1\n\nNotes line 3")).toBe("Point A\nPoint B\n\nNotes line 1\n\nNotes line 3");
  });
  it("returns the single non-empty part unchanged (line breaks intact)", () => {
    expect(combineSessionNotes(null, "Line 1\nLine 2")).toBe("Line 1\nLine 2");
    expect(combineSessionNotes("Only discussion", "   ")).toBe("Only discussion");
  });
  it("is empty when there are no notes", () => {
    expect(combineSessionNotes(null, null)).toBe("");
  });
});

describe("toIsoDate", () => {
  it("accepts ISO dates (with or without a time part)", () => {
    expect(toIsoDate("2026-10-01")).toBe("2026-10-01");
    expect(toIsoDate("2026-10-01T10:00:00Z")).toBe("2026-10-01");
  });
  it("reads day-month-year text as day first, never month first", () => {
    expect(toIsoDate("01-10-2026")).toBe("2026-10-01");
    expect(toIsoDate("10/09/2026")).toBe("2026-09-10");
  });
  it("rejects impossible or unknown values", () => {
    expect(toIsoDate("31-02-2026")).toBeNull();
    expect(toIsoDate("2026-13-01")).toBeNull();
    expect(toIsoDate("Oct 1 2026")).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
  it("handles leap years", () => {
    expect(toIsoDate("29-02-2028")).toBe("2028-02-29");
    expect(toIsoDate("29-02-2026")).toBeNull();
  });
});

describe("filterFeedbackEntries", () => {
  const entries = [
    { id: 1, meetingDate: "2026-09-10", authorName: "Mehruf" },
    { id: 2, meetingDate: "2026-09-25", authorName: "Asha" },
    { id: 3, meetingDate: "2026-10-01", authorName: "Mehruf" },
    { id: 4, meetingDate: "not a date", authorName: "Asha" },
  ];
  const ids = (f = EMPTY_FEEDBACK_FILTER) => filterFeedbackEntries(entries, f).map((e) => e.id);

  it("returns everything with no filter", () => {
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(isFeedbackFilterActive(EMPTY_FEEDBACK_FILTER)).toBe(false);
  });
  it("filters by inclusive date range", () => {
    expect(ids({ from: "2026-09-10", to: "2026-09-25", owner: "" })).toEqual([1, 2]);
    expect(ids({ from: "2026-09-20", to: "", owner: "" })).toEqual([2, 3]);
    expect(ids({ from: "", to: "2026-09-10", owner: "" })).toEqual([1]);
  });
  it("filters by owner", () => {
    expect(ids({ from: "", to: "", owner: "Mehruf" })).toEqual([1, 3]);
  });
  it("combines owner and date range", () => {
    expect(ids({ from: "2026-09-15", to: "", owner: "Mehruf" })).toEqual([3]);
    expect(ids({ from: "2026-09-15", to: "2026-09-30", owner: "Mehruf" })).toEqual([]);
  });
  it("lists distinct owners alphabetically and labels counts", () => {
    expect(feedbackOwners(entries)).toEqual(["Asha", "Mehruf"]);
    expect(feedbackCountLabel(1)).toBe("1 feedback");
    expect(feedbackCountLabel(12)).toBe("12 feedbacks");
  });
});
