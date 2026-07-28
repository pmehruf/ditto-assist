# PED Repository Migration Summary

Generated: 2026-07-28T10:49:33.540Z

## PED Repository

- PEDs imported (clean, no conflict): 1199
- Aliases imported: 1349
- Categories imported: 34
- Plan overrides imported: 21
- Collision repository entries created: 0 (created at --apply time for resolved conflicts + regression seeds — see conflicts report)
- AI Mapping Review records linked: 0 (no ai_memory rows reference a ped_repository row yet — linking happens going forward, not retroactively, since a historical AI suggestion's original condition text may not map cleanly onto a canonical PED without review)
- Mapping History records created: 1199 (one "created" entry per imported PED, at --apply time)

## Plan Override Summary

- **Optima Secure**: 22 category mappings imported, 6 plan-specific overrides created, 4 umbrella mappings, 0 unresolved conflicts
- **Care Supreme**: 22 category mappings imported, 4 plan-specific overrides created, 2 umbrella mappings, 1 unresolved conflicts
- **Activ One Max**: 22 category mappings imported, 0 plan-specific overrides created, 1 umbrella mappings, 0 unresolved conflicts
- **Activ Fit Preferred**: 22 category mappings imported, 11 plan-specific overrides created, 0 umbrella mappings, 3 unresolved conflicts
- **Aspire**: 23 category mappings imported, 0 plan-specific overrides created, 3 umbrella mappings, 0 unresolved conflicts
- **Reassure 2.0**: 22 category mappings imported, 0 plan-specific overrides created, 0 umbrella mappings, 0 unresolved conflicts

## Data Quality Summary

- PEDs without categories: 334
- Categories with no mapped PEDs: 1 (ent)
- Duplicate canonical PEDs: 3
- Category conflicts requiring manual review: 1
- Ambiguous synonym groups requiring manual review: 21
- Records skipped: 0

## Validation (data-level — NOT the full engine cutover comparison)

This compares each merged PED's resolved category against what
TOP_PED_DICTIONARY (the legacy default) said for that same term, where
both exist. The full legacy-vs-DB-backed **engine** comparison across
every plan happens later, in Phase 4, before runtime cutover — this
section only checks the source data merge itself.

- Terms present in both legacy dictionary and new registry: see full JSON report
- Identical mappings (no category change from legacy default): computed in JSON report per term
- Intentional changes (an override or ped_directory category legitimately overrides the old static default): computed in JSON report per term
- Unexpected differences: none possible at this stage by construction — every difference here is either an explicit override (intentional, by definition) or a flagged category conflict (excluded from the merged set, not silently applied)
- Failed imports: 0 (see Skipped Records below)
- Skipped records: 0
