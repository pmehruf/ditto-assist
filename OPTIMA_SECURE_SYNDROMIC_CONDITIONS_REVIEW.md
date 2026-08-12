# Optima Secure — Syndromic Conditions Review (Down / Turner / Klinefelter / Noonan)

**Status:** Governance exercise / decision support. No repository or plan data changed. This is the dedicated review requested for the four chromosomal/genetic syndromes that were flagged as "not obviously either category" in the impact assessment, rather than defaulting them to Disability/Deformity or assuming they belong on Blood/Genetic.

## Method

For each condition: the actual clinical presentation, then a direct comparison against the literal wording of Optima Secure's two candidate questions —

- **Q1 (Disability/Deformity):** *"Are you having any disability / deformity including accidental or congenital?"*
- **Q9 (Blood/Genetic):** *"Any Blood disorder (example Anaemia, Haemophilia, Thalassaemia) or any genetic disorder?"*

Q1's core concept is physical/functional impairment or structural malformation, with "including accidental or congenital" only specifying that either cause qualifies — the question is fundamentally about *disability or deformity*, not about genetic origin. Q9's second clause is an independent, direct match for *"any genetic disorder"* — it doesn't require the condition to be a blood disease, only a genetic one.

This distinction matters: the earlier-reviewed structural anomalies (Cleft Lip, Club Foot, Gastroschisis, ASD, Spina Bifida, etc.) are birth defects, not commonly described clinically as "genetic disorders" — most arise from complex/multifactorial or sporadic developmental causes, which is why Q1's "deformity ... congenital" wording is their more specific match. The four conditions below are different in kind: each is a textbook chromosomal or monogenic **genetic disorder**, which is exactly what Q9 names directly.

---

## 1. Down Syndrome (Trisomy 21)

**Presentation:** extra copy of chromosome 21; characteristic facial features, hypotonia, intellectual disability, and elevated risk of associated conditions (congenital heart defects in ~50%, hypothyroidism, hearing/vision issues, leukemia risk).

**Analysis:** Down syndrome is not defined by a single structural malformation the way Cleft Lip or Club Foot is — it's a chromosomal abnormality with wide-ranging developmental and organ-system effects. It is, unambiguously, a "genetic disorder" in both clinical and lay usage. Q9 names this directly; Q1's "deformity" framing doesn't capture what Down syndrome fundamentally is, even though some associated features are physical.

**Recommendation: Blood/Genetic (Q9).** Route via explicit `plan_override` to `blood`, same mechanism as Marfan Syndrome / Ehlers-Danlos Syndrome.

---

## 2. Turner Syndrome (45,X monosomy)

**Presentation:** missing or incomplete X chromosome in females; short stature, ovarian failure/infertility, webbed neck, lymphedema, and elevated risk of congenital cardiac (bicuspid aortic valve, coarctation) and renal anomalies.

**Analysis:** Genuinely the most multi-system of the four — it has real structural features (webbed neck) and a meaningfully elevated rate of associated structural heart/kidney anomalies. But the syndrome itself, as an underwriting declaration item, is a chromosomal genetic condition; the associated structural risks are downstream possibilities, not the definition of the condition. Q9's "any genetic disorder" is a direct, specific match for the diagnosis itself.

**Recommendation: Blood/Genetic (Q9).** Route via explicit `plan_override` to `blood`.

---

## 3. Klinefelter Syndrome (47,XXY)

**Presentation:** extra X chromosome in males; hypogonadism, infertility, gynecomastia, learning differences, tall stature. Typically **no structural deformity**.

**Analysis:** The clearest case of the four. There is no deformity to route to Q1 at all in the typical presentation — the condition's clinical footprint is hormonal/reproductive, and its category is unambiguously genetic. "Disability/deformity" is a poor wording match here; "any genetic disorder" is a precise one.

**Recommendation: Blood/Genetic (Q9).** Route via explicit `plan_override` to `blood`.

---

## 4. Noonan Syndrome

**Presentation:** RASopathy (monogenic, not chromosomal); distinctive facial features, short stature, chest wall deformity (pectus carinatum/excavatum) in a meaningful subset, and a high rate (~80%) of congenital heart defects (pulmonary valve stenosis, hypertrophic cardiomyopathy).

**Analysis:** The closest call of the four — Noonan syndrome does have real, visible structural features (facial dysmorphism, chest wall deformity) that Q1's wording would reasonably capture, more so than the other three. But applying the same standard used for Marfan Syndrome and Ehlers-Danlos Syndrome in the already-approved governance review (both of which also have some physical/structural manifestations but were kept on Q9 because the *diagnosis itself* is a named genetic syndrome, not a structural birth defect) — the same logic applies here for consistency. The underlying condition being declared is a genetic syndrome; its structural complications (the heart defects specifically, if declared as their own item) would separately route through the Heart question on their own merits.

**Recommendation: Blood/Genetic (Q9), flagged as the most defensible-either-way of the four.** Route via explicit `plan_override` to `blood` for consistency with Down/Turner/Klinefelter and with the Marfan/Ehlers-Danlos precedent. If you'd prefer to treat Noonan differently given its higher structural-feature burden, that's a reasonable alternative call — flagging explicitly rather than deciding silently.

---

## Summary of recommendations

| Condition | Recommended question | Mechanism | Confidence |
|---|---|---|---|
| Down Syndrome | Blood/Genetic (Q9) | `plan_override` → `blood` | High |
| Turner Syndrome | Blood/Genetic (Q9) | `plan_override` → `blood` | High |
| Klinefelter Syndrome | Blood/Genetic (Q9) | `plan_override` → `blood` | Highest |
| Noonan Syndrome | Blood/Genetic (Q9) | `plan_override` → `blood` | Medium — closest call, flagged |

All four land on the same side, and for the same reason: each is a defined genetic/chromosomal syndrome that Q9 names directly and specifically, rather than a structural birth defect that Q1's "deformity" wording was written to capture. This treatment is consistent with — not an exception to — the already-approved Marfan Syndrome / Ehlers-Danlos Syndrome overrides in the FINAL governance doc.

**Awaiting your confirmation before folding these into the SQL.**
