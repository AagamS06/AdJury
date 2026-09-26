-- AdJury migration 0005 — brand-voice cache write (DailyPlan Day 29).
-- Week 5: compute a bounded brand summary once per brand_profiles update and
-- store it alongside a content-addressed cache key in embedding_ref, so a review
-- (Day 30) can reuse the small cached summary instead of reprocessing the full
-- style guide every time — keeping cost per review independent of guide size
-- (Rules.md §1 cost discipline; Architecture.md §5 brand-voice caching).
--
-- `embedding_ref` already exists (0001) as the "pointer/hash to cached embedding".
-- This adds the cached derived summary itself. Both are written together on every
-- brand-guide save; NULL means "no cache yet" (existing rows read that way with no
-- backfill — the next brand edit populates the cache).

alter table brand_profiles
  add column if not exists brand_summary text;

-- No RLS change: brand_profiles already scopes reads to the owning company
-- (brand_profiles_select) and restricts writes to admins (brand_profiles_write).
-- The cache columns are written on the same admin-gated write path as
-- tone_guide_text, so they inherit the same tenant + role guards.
