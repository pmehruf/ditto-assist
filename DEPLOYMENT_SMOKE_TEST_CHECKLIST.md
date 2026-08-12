# Deployment Smoke Test Checklist

Concrete cases for each category in your deployment sequence's step 3, using real conditions from this governance work. All lookups below are on **Optima Secure** unless noted, since that's the plan this work actually changed.

| # | Category | Input to try | Expected result | What it confirms |
|---|---|---|---|---|
| 1 | Exact PED | `Marfan Syndrome` | *"Any Blood disorder ... or any genetic disorder?"* | Exact-match plan override still works |
| 2 | Alias | `PDA` (alias of Patent Ductus Arteriosus) | *"Are you having any disability / deformity ...?"* | Alias resolution → default category routing (no override on this one) |
| 3 | Free-text phrase | `Family history of Marfan syndrome in mother` | *"Any Blood disorder ... or any genetic disorder?"* — **same as #1** | The F1 fix, live. This is the one that would have been wrong before (would have returned the Disability/Deformity question instead) |
| 4 | Plan override | `Cystic Fibrosis` | *"Any Blood disorder ... or any genetic disorder?"* | One of the 11 newly-added overrides — confirms the override set from this round, not just the original 2 |
| 5 | Category mapping | `Gastroschisis` | *"Are you having any disability / deformity ...?"* | A structural anomaly deliberately left on the default (no override) — confirms `categoryMap.genetic`'s repoint is live |
| 6 | Umbrella fallback | `Cystoscopy` | Routes to the tests/investigations umbrella question, not a disease category | Confirms the umbrella mechanism is untouched by this work |
| 7 | AI fallback | Any genuinely novel/invented term, e.g. `xyzzy made up condition 12345` | Falls through to AI Memory/Gemini, not a hard error | Confirms deterministic-miss handling still works |

A couple of worthwhile additions if you have five more minutes:

- **Klinefelter Syndrome** (exact) → should also land on Blood/Genetic — this is one of the syndromic overrides that took the most reasoning to settle on, worth eyeballing once.
- **Noonan Syndrome** (exact) → same expectation, but this was flagged as the closest call of the four syndromic additions — if you want to sanity-check that call yourself before trusting it long-term, this is the one to look at.
- Confirm the boot log shows `[PED Repository] DB-backed runtime cache initialized: N aliases loaded and ready.` with no `WARNING: 0 aliases` line, and that `N` is noticeably higher than before the deploy (~50+ more, for the 28 new PEDs' primary + secondary aliases).

If all seven behave as expected, this work is done — nothing further from me is needed.
