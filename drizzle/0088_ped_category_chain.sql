-- Mapping-control Phase 4 / R11 — additive only: ordered category fallback per PED (NULL = single-category, unchanged).
ALTER TABLE "ped_repository" ADD COLUMN "category_chain" jsonb;
