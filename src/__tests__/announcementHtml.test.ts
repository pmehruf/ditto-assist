/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { RATING_REGEX } from "../utils/announcementHtml";

/**
 * RATING_REGEX drives the "rated N" chip-badge auto-detection in announcement
 * content (see announcementHtml.ts's enhanceForDisplay). Pure regex, no DOM
 * needed, so it's testable directly here even though the rest of this file's
 * DOM-parsing functions aren't (see announcementEditorHtml.test.ts's header
 * comment on why this project's Vitest environment has no DOMParser).
 *
 * 2026-09: content started coming out as "Rated-3" — a hyphen glued directly
 * onto the word with no space — which the regex's old \s+ requirement on the
 * no-colon alternatives couldn't match. Locking in that fix here.
 */
function matches(text: string): string[] {
  RATING_REGEX.lastIndex = 0;
  return text.match(RATING_REGEX) ?? [];
}

describe("RATING_REGEX", () => {
  it("matches a hyphen glued directly onto the word, no space (the 2026-09 regression)", () => {
    expect(matches("Rated-3")).toEqual(["Rated-3"]);
    expect(matches("rated-1")).toEqual(["rated-1"]);
    expect(matches("Rating-5")).toEqual(["Rating-5"]);
  });

  it("still matches every previously-working spaced/colon form", () => {
    expect(matches("Rated 3")).toEqual(["Rated 3"]);
    expect(matches("Rated: 3")).toEqual(["Rated: 3"]);
    expect(matches("Rating -2")).toEqual(["Rating -2"]);
    expect(matches("rating:4")).toEqual(["rating:4"]);
    expect(matches("R-3")).toEqual(["R-3"]);
    expect(matches("r2")).toEqual(["r2"]);
  });

  it("matches the exact sentence from the Rating Implication example", () => {
    expect(matches("Not adhering to the updated recommendations would be rated-1")).toEqual(["rated-1"]);
  });

  it("does not match a bare number or an out-of-range rating", () => {
    expect(matches("Rated-7")).toEqual([]);
    expect(matches("Rated-0")).toEqual([]);
    expect(matches("just a 3 with no rating word")).toEqual([]);
  });

  it("does not false-positive inside an unrelated longer word", () => {
    expect(matches("Ratings123")).toEqual([]);
  });
});
