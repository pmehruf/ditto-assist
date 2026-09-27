# Knowledge Base: Production vs. Staging Reconciliation (Corrected)

**Generated:** 2026-08-17 (v2 — corrects the count errors and unresolved gaps flagged in your review) · **Status:** Read-only analysis. No production data has been modified.

> Approved: deleting production ids 21 ("Activ Health — Chronic Management Program") and 3 ("Aditya Birla Features.pdf") — captured below, **not yet executed**. Still no INSERT/UPDATE/DELETE has been run against production.

---

## 0. What changed from the first version

| # | Your correction | Resolution |
|---|---|---|
| 1 | Section 4 counts didn't reconcile | Recounted every row by hand from the raw data. Corrected Section 1 (staging HDFC ERGO is **24**, not 20; Niva Bupa is **33**, not 27). The real insert count is **82**, not 81 — see §4. |
| 2 | documentType discrepancy | Root-caused via git — see §5. It's uncommitted local code, never migrated, never deployed. Not a live inconsistency. |
| 3 | Niva Bupa Smart Health Plus — Brochure (id103) | Marked **BLOCKED**, excluded from all insert counts until re-ingested and verified. |
| 4 | Optima Super Secure | Verified against HDFC ERGO's official site — it's a real, currently-sold, distinct plan, **not** in the new staging KB. Production id12 can no longer be a clean REPLACE — see §6. |
| 5 | Ultimate Care vs. Care Ultimate | Verified against Care Health's official site — canonical name is **"Ultimate Care."** Applied consistently below. |
| 6 | Re-run reconciliation | Done — §1, §2, §4, §7 all recomputed on the corrected basis. |

---

## 1. Corrected summary

| | Production | Staging (cleaned) |
|---|---|---|
| Total resources | 27 | 92 |
| Aditya Birla | 6 | 10 |
| Care Health | 5 | 24 |
| HDFC ERGO | 6 | **24** *(was misstated as 20)* |
| Niva Bupa | 9 | **33** *(was misstated as 27)* |
| General / Others | 1 | 1 |

Production resource disposition (corrected):

| Action | Count |
|---|---|
| **KEEP** (identical resource already in staging under a different ID, or standalone with no staging equivalent) | 10 |
| **KEEP — partial, pending gap-fill** (Optima Secure merged file — see §6) | 1 |
| **PROTECTED** (Product Playbook) | 1 |
| **REPLACE** (superseded by newer, more granular staging resources) | 12 *(was 13 — Optima Secure merged moved out of this bucket, see §6)* |
| **DELETE** (redundant legacy duplicate) | 1 |
| **DELETE — approved this turn** (ambiguous items, ids 21 & 3) | 2 |
| **Total** | 27 |

---

## 2. The 2 approved deletions (not yet executed)

Per your message: **approved.** These will run in Phase 3 of the migration (§7), after Phases 1–2 are verified — not before.

- Aditya Birla id21 — "Activ Health — Chronic Management Program"
- Aditya Birla id3 — "Aditya Birla Features.pdf"

(The third item from the original ambiguous list, "Care Joy Today," was already confirmed not to exist in production — nothing to do there.)

---

## 3. Full per-insurer count reconciliation (corrected math)

Staging total = 92. Of those, **10 are no-op** — already present in production as identical content under a different ID (9 carryover pairs + the Product Playbook). That leaves **82** to actually insert, not 81 as originally stated.

| Insurer | Staging rows | No-op carryovers (already in prod) | To insert |
|---|---|---|---|
| Aditya Birla | 10 | 0 | **10** |
| Care Health | 24 | 2 (Care Freedom PW, Ultimate Care merged PW) | **22** |
| HDFC ERGO | 24 | 2 (Claim Process, Copay article) | **22** |
| Niva Bupa | 33 | 5 (Claim Checklist, Exclusion List, Terms Glossary, How-to-Claim, Lapsed vs Grace) | **28** |
| General/Others | 1 | 1 (Product Playbook) | **0** |
| **Total** | **92** | **10** | **82** |

Of the 82 to insert, 1 (Niva Bupa Smart Health Plus — Brochure, id103) is **BLOCKED** (0 chunks — see §4), leaving **81 actually insertable this pass**.

### Per-insurer breakdown: replacing a retired legacy doc vs. genuinely additive

| Insurer | Replacing a fully-retired legacy resource | Additive (new plan, or supplements a *retained* legacy doc) | Total to insert |
|---|---|---|---|
| Aditya Birla | 10 (Activ One 3, Activ Fit 4, Super Health Plus Top Up 3) | 0 | 10 |
| Care Health | 18 (Add-ons 3, Care Supreme 2, "Other Plans" bucket 13) | 4 (Care Freedom Brochure+Prospectus 2, Ultimate Care Brochure+Prospectus 2 — both supplement a *retained* legacy PW) | 22 |
| HDFC ERGO | 15 (Riders 12, Medisure Super Top Up 3) | 7 (Energy — genuinely new plan, 3; Optima Secure/Secure+ granular — additive alongside retained id12, 4) | 22 |
| Niva Bupa | 28 (Add-ons 5 *(4 unblocked + 1 blocked)*, Aspire 3, "Other Plans" bucket 15, ReAssure 2.0 5) | 0 | 28 |
| **Total** | **71** | **11** | **82** |

`71 + 11 = 82` ✓. `82 − 1 (blocked) = 81` insertable this pass. This replaces the original report's incorrect "75 replacing + 6 new = 81."

---

## 4. Niva Bupa Smart Health Plus — Brochure (id103): BLOCKED

Confirmed via direct query: **0 chunks.** The row exists in staging but has no extracted content — ingestion silently produced nothing (likely a parse failure on that specific PDF).

**Status: BLOCKED.** Excluded from every count above and from the migration in §7. Do not insert into production until it's re-ingested (re-run the Niva Bupa seed script for this one URL, verify chunk_count > 0 and spot-check the extracted text) and verified. Its sibling Prospectus (id104) is unaffected and proceeds normally.

---

## 5. documentType — root cause (not a live inconsistency)

Checked the actual repo state, not just the database:

- `src/server/db/schema.ts` defines `documentType` as a `NOT NULL DEFAULT 'other'` enum column, and `drizzle/0034_kb_resource_document_type.sql` contains the matching `ALTER TABLE` + `CREATE TYPE` — both are real, well-formed, and registered in `drizzle/meta/_journal.json` at index 34.
- **But `git status` shows both are uncommitted:** `schema.ts` is locally modified (never committed), and `0034_kb_resource_document_type.sql` / `0035_kb_chunks_embedding_idx_record.sql` are untracked files (`??`) — never added to git, never pushed.
- The last actual commit (`00c3f11`, "Swap Product Assist nav icon...") predates this change entirely. **The deployed Cloud Run app is running code that has no idea `documentType` exists.**
- That's why `information_schema.columns` shows no `document_type` column on either live branch: the migration was written but `npm run db:migrate` was never run against production or staging for it, and the app was never redeployed with it.

**Conclusion: there is no active inconsistency to fix.** The database, the deployed app, and git history all agree with each other (none of them know about `documentType`) — only this local working tree is ahead of all three. 

**For this migration:** documentType stays completely out of scope. No column exists to write to, so nothing changes here. Continue inferring type from title text for display/reporting purposes only (as in §7's final breakdown), the same way the original report did. Shipping the real column is a separate, atomic piece of work (commit schema.ts + migrations together, run `db:migrate` on both branches, deploy) — bundling it into this content migration would create exactly the "inconsistent metadata" risk you flagged, since only resources touched *after* the column existed would get real values while everything else silently defaulted to `'other'`.

---

## 6. Optima Super Secure — verified, not guessed

Checked HDFC ERGO's official site directly: **[Optima Super Secure](https://www.hdfcergo.com/health-insurance/optima-super-secure-plan)** is a real, currently-sold, distinct product — 5X health cover, separate from Optima Secure (4X) and Optima Secure+ (infinite/unlimited restore). It is not a discontinued or renamed variant.

Staging's new granular Optima Secure documents (id26–29) cover only **Optima Secure** and **Optima Secure+** — there is no dedicated Optima Super Secure Policy Wording, Prospectus, or Brochure anywhere in staging. **This is a genuine content gap**, the same category of issue as the blocked Niva Bupa item, just discovered instead of self-evident from chunk_count.

Consequence for production id12 ("Optima Secure-policy wording_prospectus_merged.pdf," currently tagged Optima Secure / Optima Super Secure / Optima Secure+): it **cannot be fully replaced and deleted** — doing so would remove the only source of Optima Super Secure content from the KB entirely.

**Recommended handling (this migration):**
1. Insert the 4 new granular Optima Secure / Optima Secure+ resources (id26–29) as planned — they're a strict improvement for those two variants.
2. **Retain** production id12, but **re-tag it from `{Optima Secure, Optima Super Secure, Optima Secure+}` to `{Optima Super Secure}` only.** Its actual text still covers all three, but narrowing the tag to just the variant it's now uniquely needed for prevents it from surfacing (and diluting answers) in Optima Secure / Optima Secure+ queries, where the new granular documents should take sole precedence.
3. Flag id12's status explicitly (e.g. `status` note or title suffix) as legacy content retained pending a dedicated ingest — not a clean, permanent resource.

**Follow-up (separate from this migration, not blocking):** source and ingest an official Optima Super Secure Policy Wording / Prospectus / Brochure from hdfcergo.com, matching the pattern already used for Optima Secure/Secure+, then retire id12 for good.

---

## 7. Ultimate Care vs. Care Ultimate — verified, canonical name confirmed

Checked Care Health's official site: **[careinsurance.com/product/ultimate-care](https://www.careinsurance.com/product/ultimate-care)** — the branded, official product name is **"Ultimate Care."** "Care Ultimate" (the tag on the retained legacy PW, id14 in both environments) is not the insurer's actual product name — it appears to be a reversed/informal label introduced during the original legacy ingestion.

**Canonical name: `Ultimate Care`.**

**Where it gets applied (Phase 1 of the migration, run identically on both branches so they don't re-diverge):**
- `kb_categories.plan_names` roster for Care Health — ensure the roster entry reads `Ultimate Care`, remove `Care Ultimate` if present as a separate entry.
- `kb_resources.plan_tags` on the retained legacy PW resource (id14) — update from `{"Care Ultimate"}` to `{"Ultimate Care"}` so it matches the new granular Brochure (id49) / Prospectus (id48) tags and the roster.

This is a metadata-only rename, no content or re-ingestion involved.

**One more finding surfaced while verifying this (not one of your 6 items, flagging for visibility, not blocking):** I also checked the "Activ Fit" naming concern from the original report the same way — fetched the actual staging source PDF and cross-referenced it against production's stored chunk text for id2. Both are genuinely the same official product, **"Activ Fit (Young Adult Product)"** (confirmed via the PDF's own product-name line and UIN). Production's old tag "Activ Fit Plus/Preferred" was actually a **mis-tag** — the "preferred" reference in that resource's text is an internal policy-type option *within* the Young Adult product, not Aditya Birla's separately-marketed "Activ Fit Plus" / "Activ Fit Preferred" family plans (which are different, larger products with their own pages on adityabirlacapital.com). Staging's plain "Activ Fit" tag is correct and canonical — no action needed, this one resolves cleanly as a REPLACE.

That said, this surfaced a **new, unverified possibility**: Aditya Birla's actual "Activ Fit Plus" and "Activ Fit Preferred" family products don't appear to have *any* KB coverage in either environment. I have not confirmed this is a real gap the way I did for Optima Super Secure — flagging it as worth a follow-up check, not asserting it as fact.

---

## 8. Final expected production resource count after this migration

**93 total** (up from the original report's 92, because Optima Secure's merged file is now retained rather than deleted — see §6). This assumes: both approved deletions run (ids 21, 3), the Niva Bupa Smart Health Plus Brochure stays blocked, and Optima Secure's legacy file is retained/re-tagged rather than deleted.

| Insurer | Kept/retained | Newly inserted | **Final total** |
|---|---|---|---|
| Aditya Birla | 1 (How to Claim article) | 10 | **11** |
| Care Health | 2 (Care Freedom PW, Ultimate Care PW — retagged) | 22 | **24** |
| HDFC ERGO | 3 (Claim Process, Copay article, Optima Secure merged — retagged to Optima Super Secure only) | 22 | **25** |
| Niva Bupa | 5 (informational articles) | 27 *(28 minus 1 blocked)* | **32** |
| General/Others | 1 (Product Playbook, protected) | 0 | **1** |
| **Total** | **12** | **81** | **93** |

*(Will become 94 once the blocked Niva Bupa item is fixed and added in a follow-up pass; will drop back toward 92 once Optima Super Secure gets its own dedicated documents and id12 is finally retired.)*

### By inferred document type (93 total — inferred from title text; no `document_type` column exists to query, per §5)

| Document type | Aditya Birla | Care Health | HDFC ERGO | Niva Bupa | General/Others | **Total** |
|---|---|---|---|---|---|---|
| Policy Wording | 3 | 2 *(legacy-sourced)* | 7 | 7 | — | **19** |
| Prospectus | 3 | 12 | 11 | 9 | — | **35** |
| Brochure | 3 | 10 | 4 | 11 | — | **28** |
| Product Benefit Table | 1 | — | — | — | — | **1** |
| General/Informational | 1 | — | 2 | 5 | — | **8** |
| Merged legacy (retained, pending gap-fill) | — | — | 1 *(Optima Super Secure)* | — | — | **1** |
| Sheet/Reference | — | — | — | — | 1 *(protected)* | **1** |
| **Total** | **11** | **24** | **25** | **32** | **1** | **93** |

---

## 9. Migration plan (updated for the above)

Same 3-phase, transaction-per-phase structure as before, with the corrections folded in:

1. **Safety net:** Neon branch/point-in-time snapshot of `production` before anything runs.
2. **Phase 1 — roster & tag fixes (own transaction):** normalize `Ultimate Care` (§7) in both `kb_categories.plan_names` and resource `plan_tags`; re-tag production id12 to `{Optima Super Secure}` only (§6). Verify, commit.
3. **Phase 2 — inserts (own transaction):** insert the 81 unblocked staging resources (82 minus the blocked Smart Health Plus Brochure) plus their chunks/embeddings. Verify counts and spot-check content, commit.
4. **Phase 3 — deletes (own transaction, run last):** delete the 12 fully-superseded legacy resources, the 1 HDFC duplicate (id9), and the 2 approved items (ids 21, 3) — **13 total**, note this is one less than the original plan since id12 is no longer among them. Verify final count lands on 93, commit.

Still waiting on your go-ahead before Phase 1 runs. No production changes have been made.
