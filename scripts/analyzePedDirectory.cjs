/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Read-only analysis script for the PED Directory cleanup task. Loads the
// backed-up live data (scripts/ped_directory_backup.json) and reports:
//   1. Clusters of same-concept terms where category is null on some rows
//      but set on a sibling — candidates for a category UPDATE.
//   2. Clusters with >1 row that might be exact duplicates/typos (same
//      normalized key) for manual review.
// Makes no changes — just prints a report to stdout.
const fs = require("fs");

const rows = JSON.parse(fs.readFileSync("scripts/ped_directory_backup.json", "utf8"));

// Normalizes a term down to a "concept key": lowercase, strip punctuation,
// drop a small set of generic trailing/leading filler words that don't
// change the underlying medical concept, and singularize simple plurals.
// Deliberately conservative — under-merging (missing a real cluster) is
// safer than over-merging (collapsing two different concepts together).
const FILLER_WORDS = new Set([
  "disease", "disorder", "syndrome", "condition", "state", "diagnosis",
  "finding", "episode", "critical", "infection",
]);

function conceptKey(term) {
  let t = String(term).toLowerCase();
  t = t.replace(/['’]/g, "");
  t = t.replace(/[^a-z0-9\s-]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  let words = t.split(" ").filter((w) => w && !FILLER_WORDS.has(w));
  words = words.map((w) => (w.endsWith("s") && w.length > 4 && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return words.join(" ");
}

const byKey = new Map();
for (const r of rows) {
  const key = conceptKey(r.term);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

console.log("=== CATEGORY-FIX CANDIDATES (same concept key, mixed null/non-null category) ===");
let fixCount = 0;
for (const [key, group] of byKey) {
  if (group.length < 2) continue;
  const cats = new Set(group.map((r) => r.category).filter(Boolean));
  const hasNull = group.some((r) => r.category === null);
  if (hasNull && cats.size >= 1) {
    fixCount++;
    console.log(`[${key}]`, group.map((r) => `${r.term}(#${r.id}:${r.category})`).join(" | "));
  }
}
console.log("Total fix-candidate groups:", fixCount);

console.log("\n=== CONFLICTING CATEGORY CLUSTERS (same concept key, 2+ DIFFERENT non-null categories) ===");
for (const [key, group] of byKey) {
  const cats = new Set(group.map((r) => r.category).filter(Boolean));
  if (cats.size > 1) {
    console.log(`[${key}]`, group.map((r) => `${r.term}(#${r.id}:${r.category})`).join(" | "));
  }
}

console.log("\n=== EXACT concept-key duplicate groups (3+ rows, likely typo/near-duplicate) ===");
for (const [key, group] of byKey) {
  if (group.length >= 3) {
    console.log(`[${key}]`, group.map((r) => `${r.term}(#${r.id})`).join(" | "));
  }
}

// All existing terms, lowercased, for set-difference checks against other
// source lists (done in a separate step / separate script or by hand).
fs.writeFileSync(
  "scripts/existing_terms_lower.json",
  JSON.stringify(rows.map((r) => r.term.toLowerCase()), null, 0),
  "utf8"
);
console.log("\nWrote scripts/existing_terms_lower.json (", rows.length, "terms )");
