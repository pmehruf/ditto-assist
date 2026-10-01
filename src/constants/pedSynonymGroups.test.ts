import { describe, it, expect } from "vitest";
import { buildGroupedSuggestions } from "./pedSynonymGroups";

// Ranking of the PED search dropdown: exact → name starts with query → a
// word in the name starts with it → an alias starts with it → substring
// anywhere → fuzzy fallback; alphabetical within a tier.

const inserted = (raw: string[], query: string, excluded: string[] = []) =>
  buildGroupedSuggestions(raw, query, excluded).map((r) => r.insertValue);

describe("buildGroupedSuggestions ranking", () => {
  it('"d": conditions starting with D come first, alphabetically, before mid-word matches', () => {
    const raw = ["ASD", "CDH", "DKA", "Dengue", "DDH", "Acidity", "Deep vein thrombosis"];
    expect(inserted(raw, "d")).toEqual([
      "DDH",
      "Deep vein thrombosis",
      "Dengue",
      "DKA",
      // tier 5 (substring only), alphabetical
      "Acidity",
      "ASD",
      "CDH",
    ]);
  });

  it('"di": Di… conditions (and word starts) rank before Beedi / Acidity', () => {
    const raw = ["Beedi", "Acidity", "Dizziness", "Dialysis", "Bell's palsy", "Kidney disease"];
    expect(inserted(raw, "di")).toEqual(["Dialysis", "Dizziness", "Kidney disease", "Acidity", "Beedi"]);
  });

  it('"dia": Diabetes and Dia… names first; Prediabetes / later matches after', () => {
    const raw = [
      "Prediabetes",
      "Otitis media",
      "Diabetic gangrene",
      "Type 2 diabetes mellitus",
      "Diabetes",
      "Diabetes type 2",
      "Diabetes insipidus",
      "Diabetic foot",
      "Gestational diabetes",
    ];
    const rows = buildGroupedSuggestions(raw, "dia", []);
    expect(rows.map((r) => r.insertValue)).toEqual([
      "Diabetes", // Type 2 DM synonym group — one row, inserts the matched term
      "Diabetes insipidus",
      "Diabetic foot",
      "Diabetic gangrene",
      "Gestational diabetes", // tier 3: a later word starts with "dia"
      "Otitis media", // tier 5: substring only
      "Prediabetes",
    ]);
    // the grouped row still displays the group's canonical name
    expect(rows[0].displayName).toBe("Type 2 diabetes mellitus");
  });

  it('"diab": Diabetes/Diabetic conditions strongly prioritised over Prediabetes', () => {
    const raw = ["Prediabetes", "Diabetic foot", "Diabetes insipidus", "Borderline diabetes"];
    expect(inserted(raw, "diab")).toEqual([
      "Diabetes insipidus",
      "Diabetic foot",
      "Borderline diabetes",
      "Prediabetes",
    ]);
  });

  it("orders every tier: exact > name prefix > word prefix > alias prefix > substring", () => {
    // "Ventricular septal defect" is grouped with "VSD"; with "VSD" itself
    // not in the list it can only match "vs" through its alias (tier 4).
    const raw = ["Ravsky syndrome", "Ventricular septal defect", "Acute vsx", "Vsx syndrome", "vs"];
    expect(inserted(raw, "vs")).toEqual([
      "vs", // 1 exact
      "Vsx syndrome", // 2 name starts with query
      "Acute vsx", // 3 a word starts with query
      "Ventricular septal defect", // 4 alias (VSD) starts with query
      "Ravsky syndrome", // 5 substring
    ]);
  });

  it("is case-insensitive", () => {
    expect(inserted(["ASTHMA", "Myasthenia gravis"], "AsTh")).toEqual(["ASTHMA", "Myasthenia gravis"]);
  });
});

describe("buildGroupedSuggestions fuzzy fallback", () => {
  const raw = ["Diabetes insipidus", "Diabetic foot", "Hypertension", "Asthma", "Migraine"];

  it("still finds conditions for a typo", () => {
    expect(inserted(raw, "diabtes")).toEqual(["Diabetes insipidus", "Diabetic foot"]);
    expect(inserted(raw, "migrane")).toEqual(["Migraine"]);
    expect(inserted(raw, "hypertensoin")).toEqual(["Hypertension"]);
  });

  it("only applies when nothing matches on tiers 1–5", () => {
    // "asth" matches Asthma directly, so no fuzzy extras are added.
    expect(inserted([...raw, "Astigmatism"], "asth")).toEqual(["Asthma"]);
  });

  it("does not guess on very short queries or unrelated text", () => {
    expect(inserted(raw, "dib")).toEqual([]);
    expect(inserted(raw, "xyzq")).toEqual([]);
  });
});

describe("buildGroupedSuggestions selection behaviour", () => {
  it("collapses a synonym group into one row that inserts a real matched term", () => {
    const rows = buildGroupedSuggestions(["Hypertension", "High BP", "Hyperopia"], "high", []);
    expect(rows).toHaveLength(1);
    expect(rows[0].insertValue).toBe("High BP");
  });

  it("never suggests terms already queued", () => {
    expect(inserted(["Asthma", "Astigmatism"], "ast", ["Asthma"])).toEqual(["Astigmatism"]);
  });
});
