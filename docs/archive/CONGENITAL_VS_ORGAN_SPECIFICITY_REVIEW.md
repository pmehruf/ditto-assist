# Congenital vs. Organ-System Declaration Question Review

**Purpose:** Following the ASD (Atrial Septal Defect) observation — a condition that could plausibly sit under either "Heart Disease" or "Congenital / Birth Defect" — this reviews the repository for every similar case, per the Constitution's specificity and evidence-hierarchy rules (`MASTER_CONSTITUTION.md`, Parts VI–VII).

**Methodology / what this is based on:**
- `MASTER_CONSTITUTION.md` and `PED_REPOSITORY_GOVERNANCE.md` (the governing rules).
- `TOP_PED_DICTIONARY` (`src/types.ts`) — the legacy dictionary, still mirrored on every live write per the Constitution's rollback-safety note.
- The 24 disease-family regex sections in `src/engine.ts`, especially §16b (Genetic & Congenital) and §16c (FOP).
- Actual plan question wording (`categoryMap` / `questions[]`) for all six plans in `src/types.ts`.

**What this could *not* check:** `PED_SOURCE=db` is the live flag in `.env`, meaning `ped_repository` / `ped_aliases` (Postgres, Neon) is the actual runtime source of truth as of 2026-07-29 — but that database host isn't reachable from this environment's network. Everything below is verified against the legacy dictionary + regex layer, which mirrors the DB but may not reflect DB-only edits made after the migration. Table C flags terms I could not confirm at all and should be checked directly in the PED Repository admin UI.

---

## Table A — Congenital chosen over an organ-system question (confirmed, by design)

For every row, the organ-system question's actual wording only lists **acquired/adult** pathology (confirmed by reading all six plans' text) — none mention "congenital" or "birth defect" — while the Congenital/Genetic question explicitly does. Per Evidence Hierarchy #1 (`MASTER_CONSTITUTION.md`, Part VI), wording is decisive, so this isn't just clinical judgment — the plan text itself settles it.

| Condition | Possible Question 1 | Possible Question 2 | Recommended Question | Why the other question is rejected |
|---|---|---|---|---|
| Atrial Septal Defect (ASD) | Heart Disease | Congenital / Genetic Disorder | **Congenital** | Heart question wording (sampled across plans) reads e.g. *"Chest Pain / Heart Attack or any other Heart Disease"*, *"Coronary artery disease / Rheumatic heart disease / Heart Attack..."* — all acquired-cardiac language. None name septal defects or birth-origin conditions. Confirmed dictionary entry: `"atrial septal defect": "genetic"`. |
| Ventricular Septal Defect (VSD) | Heart Disease | Congenital / Genetic Disorder | **Congenital** | Same reasoning as ASD. Dictionary: `"ventricular septal defect": "genetic"`. |
| Tetralogy of Fallot | Heart Disease | Congenital / Genetic Disorder | **Congenital** | Same reasoning; it's a compound structural defect, not an acquired cardiac event. Dictionary: `"tetralogy of fallot": "genetic"`. |
| Congenital Heart Defect (generic term) | Heart Disease | Congenital / Genetic Disorder | **Congenital** | Dictionary: `"congenital heart defect": "genetic"` — the term itself names its own category. |
| Spina Bifida | Neurological | Congenital / Genetic Disorder | **Congenital** | Neuro question wording is stroke/epilepsy/paralysis/MS-oriented (adult neurological disease), not developmental spinal defects. Dictionary: `"spina bifida": "genetic"`. |
| Cleft Lip / Cleft Palate | ENT / no clean organ fit | Congenital / Genetic Disorder | **Congenital** | No plan's ENT/eye question ("Eye or vision disorders / Ear / Nose or Throat diseases") covers oral/facial structural defects — it's acquired-ENT-disease wording (infections, hearing/vision loss). Dictionary: `"cleft lip cleft palate": "genetic"`. |
| Club Foot / Talipes | Musculoskeletal | Congenital / Genetic Disorder | **Congenital** | Musculoskeletal wording ("Arthritis, Spondylitis, Fracture...") targets acquired/degenerative joint and bone disease, not a structural deformity present at birth. Dictionary: `"clubfoot deformity": "genetic"`. |
| Hydrocephalus (congenital) | Neurological | Congenital / Genetic Disorder | **Congenital** | Same neuro reasoning as Spina Bifida. Confirmed via `engine.ts` §16b's explicit term list (not a dictionary key — caught only by regex, see Table C note on reliability). |
| Microcephaly / Anencephaly | Neurological | Congenital / Genetic Disorder | **Congenital** | Same reasoning. Also `engine.ts` §16b regex list only, not dictionary. |
| Marfan Syndrome | Heart *or* Eye *or* Musculoskeletal | Congenital / Genetic Disorder | **Congenital** | Marfan has aortic, ocular, *and* skeletal manifestations — a true 3-way organ overlap. No single organ question captures the syndrome; the genetic question does. Dictionary: `"marfan syndrome": "genetic"`. |
| Ehlers-Danlos Syndrome | Skin *or* Musculoskeletal | Congenital / Genetic Disorder | **Congenital** | Same multi-organ logic as Marfan (joint hypermobility + skin fragility + vascular fragility). Dictionary: `"ehlers danlos syndrome": "genetic"`. |
| Osteogenesis Imperfecta ("brittle bone disease") | Musculoskeletal | Congenital / Genetic Disorder | **Congenital** | Musculoskeletal wording targets acquired fractures/arthritis, not an inherited collagen defect. Dictionary: `"osteogenesis imperfecta": "genetic"`. |
| Achondroplasia | Musculoskeletal | Congenital / Genetic Disorder | **Congenital** | Same reasoning — a growth-plate genetic disorder, not degenerative bone disease. Dictionary: `"achondroplasia": "genetic"`. |

---

## Table B — The reverse pattern: organ/functional specificity beats the generic "Congenital/Genetic" label

This is the mirror image of the ASD case, and worth knowing about: several conditions are congenital or hereditary *by origin*, but the repository correctly routes them to a **more specific functional question** instead of the generic Congenital/Genetic one — because that question's wording is the more specific match. This confirms the hierarchy is genuinely wording-first, not "congenital always wins."

| Condition | Possible Question 1 | Possible Question 2 | Recommended Question | Why the other question is rejected |
|---|---|---|---|---|
| Congenital Adrenal Hyperplasia (CAH) | Congenital / Genetic Disorder | Endocrine | **Endocrine** | Despite the name, CAH's defining underwriting characteristic is a hormonal/adrenal disorder — the endocrine question ("adrenal gland disorders", "Endocrine organ disorders") names it directly and more specifically than the generic congenital label. Dictionary: `"congenital adrenal hyperplasia": "endocrine"`. |
| Charcot-Marie-Tooth Disease | Congenital / Genetic Disorder | Neurological | **Neurological** | It's a hereditary condition, but it manifests and is underwritten purely as a peripheral neuropathy — the neuro question is the specific match. Dictionary: `"charcot marie tooth disease": "neuro"`. |
| Friedreich's Ataxia | Congenital / Genetic Disorder | Neurological | **Neurological** | Same logic — a hereditary ataxia, underwritten as a neurological condition. Dictionary: `"friedreich ataxia": "neuro"`. |
| Hereditary Spastic Paraplegia | Congenital / Genetic Disorder | Neurological | **Neurological** | Same logic. Dictionary: `"hereditary spastic paraplegia": "neuro"`. |

---

## Findings for governance review (not just confirmations — actual gaps worth escalating)

1. **Huntington's disease has a dictionary/regex split that can produce inconsistent routing for the same disease.**
   The dictionary explicitly maps `"huntington chorea"`, `"huntington disease neuro"`, and `"huntington chorea neuro"` → **`neuro`**. But `engine.ts` §16b's regex (the GENETIC & CONGENITAL section) separately lists the bare token `huntington` as a trigger for → **`genetic`**. Dictionary beats regex (Part V), so exact dictionary-key phrasings correctly resolve to `neuro` — but any other phrasing containing "Huntington" that *isn't* one of those three exact keys (e.g. just "Huntington's Disease") falls through to the regex and gets `genetic` instead. Same disease, different category, purely by phrasing. This is exactly Part IX item 6 (synonym-consistency, unresolved) — worth a decision on which category Huntington's should own, then reconciling the regex list.

2. **Friedreich's Ataxia vs. Spinocerebellar Ataxia — inconsistent sibling treatment.**
   Both are hereditary ataxias. Friedreich's routes to `neuro` (Table B); Spinocerebellar Ataxia routes to `genetic` (Table A pattern). No documented reason distinguishes them — this looks like an unintentional inconsistency rather than a deliberate specificity call, and is worth a business-owner decision (Part IX item 6) rather than leaving it as an accident of dictionary history.

3. **Optima Secure has an explicit "...congenital" question that standard congenital routing never uses.**
   Optima Secure's question list includes *"Are you having any disability / deformity including accidental or congenital?"* — the single most on-the-nose piece of wording found anywhere in this review. But it isn't wired into `categoryMap` under any category key, so the standard `genetic` categoryKey routing (used by every condition in Table A) never reaches it — for Optima Secure specifically, ASD/VSD/Spina Bifida/etc. all resolve instead to *"Any Blood disorder... or any genetic disorder?"* The only place this "congenital" question is actually used is one hardcoded special case (Fibrodysplasia Ossificans Progressiva, `engine.ts` §16c), via an explicit fallback chain: `disability/deformity wording → congenital wording → genetic category → musculoskeletal category`. That chain is a good template — it's arguably what *every* Table A condition should do on Optima Secure, but currently only FOP gets it. Worth a governance decision on whether to generalize it (this is squarely Part IX item 9, "competing declaration questions within one plan," which the Constitution already flags as unresolved).

---

## Table C — Named in your list but not confirmed in this environment

The DB (`ped_repository`/`ped_aliases`, the live `PED_SOURCE=db` source) wasn't reachable from here, and none of these appear in the legacy dictionary or the engine's regex sections either — so I have no evidence of how (or whether) they currently route. I'm flagging this rather than guessing:

- **Patent Ductus Arteriosus (PDA)**
- **Coarctation of Aorta**
- Congenital Hip Dysplasia
- Congenital Cataract
- Hypospadias / Undescended Testis (Cryptorchidism)
- Pyloric Stenosis / Hirschsprung's Disease / Biliary Atresia
- Congenital forms of Polycystic Kidney Disease

Only the generic §16b regex tokens (`congenital`, `hereditary`, `birth defect`, etc.) would catch these, and only if a user's typed input literally contains one of those words — "Patent Ductus Arteriosus" or "Coarctation of Aorta" typed alone would not trigger it, and no earlier cardiac/vascular regex section matches them either (checked — the Heart section's wording is `aortic aneurysm` / `aortic stenosis` specifically, not generic `aorta`/`aortic`). **Recommend checking these terms directly in the PED Repository admin UI (PED Library tab)** to see their current live category — if they're genuinely unmapped, that's a coverage gap worth fixing regardless of this review.

---

*No code or mapping was changed as part of this review — purely a QA/audit exercise per the request.*
