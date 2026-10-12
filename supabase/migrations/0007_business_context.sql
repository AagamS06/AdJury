-- AdJury migration 0007 — business context (DailyPlan Day 23a).
-- Week 4 (multi-tenant foundations): a company can record its public website so
-- AdJury can research what the business actually does and ground every juror in
-- the business's field/offering — "so judging an ad knows which business it is
-- about" (PRD §4/§5). The researched context is condensed to a small, bounded
-- summary and cached on the company row, mirroring the brand-voice cache (0005):
-- compute once per website/identity change, reuse per review, so cost per review
-- stays independent of the business's web footprint (Rules.md §1 cost discipline;
-- Architecture.md §5 caching).
--
-- `website_url`           — the company's public site (optional; the authoritative
--                           source for the research, far better than the name alone).
-- `business_summary`      — cached bounded business-context summary; NULL = no cache.
-- `business_context_ref`  — content-addressed cache key over the identity inputs
--                           (name + industry + website) + algorithm version; NULL =
--                           no cache. A change to any input or the version yields a
--                           new ref so staleness is detectable (same pattern as
--                           brand_profiles.embedding_ref).
--
-- Existing rows read all three as NULL with no backfill; the next onboarding/edit
-- (or the first review for a company with a website) populates the cache.

alter table companies
  add column if not exists website_url text,
  add column if not exists business_summary text,
  add column if not exists business_context_ref text;

-- No RLS change: `companies` already scopes SELECT to the caller's own company
-- (companies_select) and has no client write policy — every write runs server-side
-- through the service-role client with an explicit, session-derived company_id
-- (Rules.md §5), exactly like name/industry/plan_tier/juror_weights. The new
-- columns inherit that same tenant guard.
