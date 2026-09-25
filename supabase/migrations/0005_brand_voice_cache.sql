-- AdJury migration 0005 — brand-voice cache (DailyPlan Day 29).
-- Week 5 (brand-voice caching & analytics): compute a condensed brand-voice
-- summary once per `brand_profiles` update and store it, so a review reuses the
-- cached summary instead of reprocessing the full (up to 8,000-char) style guide
-- on every run (PRD §6.2 v1.5; Architecture.md §5 "brand-voice caching"; Rules.md
-- §1 cost discipline). Day 30 wires reviews onto the cache; this migration adds
-- the storage.
--
-- Design (Architecture.md §3): `embedding_ref` was always the "pointer/hash to
-- cached embedding" — we now use it as the CACHE KEY (a version tag + a hash of
-- the normalized guide) so a save can tell whether the stored summary is still
-- fresh for the current guide and skip recomputation when it is. The condensed
-- summary itself lives in the new `brand_summary` column (the payload the key
-- points at). Both are nullable: a legacy row with no cache still works (Day 30
-- falls back to the full guide until the next admin save repopulates the cache).

alter table brand_profiles
  add column if not exists brand_summary text;

comment on column brand_profiles.brand_summary is
  'Cached, bounded brand-voice summary computed on save (Day 29); reused by reviews instead of the full tone_guide_text.';
comment on column brand_profiles.embedding_ref is
  'Cache key for brand_summary: a version tag + hash of the normalized tone guide (Day 29). Lets a save detect a stale/fresh cache and skip recomputation.';
