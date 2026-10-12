-- AdJury migration 0009 — Business Analyst juror (DailyPlan Day 23b).
-- A sixth juror joins the jury: a Business Analyst briefed on the spot to act as
-- the posting company's insider, giving a secondary business-and-market read
-- grounded in the business context researched from public sources (PRD §5). Its
-- persona_scores rows carry persona_name = 'business_analyst', so the existing
-- CHECK constraint (which enumerated only the five original jurors) must allow it.
--
-- Recreate the check with the sixth name added. No data change: existing rows use
-- the five original names, all still permitted.

alter table persona_scores
  drop constraint if exists persona_scores_persona_name_check;

alter table persona_scores
  add constraint persona_scores_persona_name_check
  check (persona_name in (
    'brand_voice_guardian', 'compliance_legal_flagger',
    'target_audience_fit', 'seo_discoverability', 'stop_scrolling',
    'business_analyst'));

-- No RLS change: persona_scores visibility still follows the parent review
-- (persona_scores_select), and rows are still written only via the service-role
-- insert path alongside their review.
