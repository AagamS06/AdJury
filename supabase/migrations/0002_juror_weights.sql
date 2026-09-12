-- AdJury migration 0002 — per-company juror weights (DailyPlan Day 16).
-- PRD.md §5.2: the aggregate is a weighted mean of the five juror scores;
-- weights default to equal (0.2 each) and are configurable per company.
--
-- Stored as a jsonb map of persona_name -> weight (a subset is allowed; jurors
-- omitted fall back to the equal default when resolved in the app layer). NULL
-- means "use the equal default", so existing rows keep today's behavior with no
-- backfill. Validation of the shape lives in the app (PersonaWeightsInputSchema);
-- the check below is a coarse guard that the value, when present, is a JSON
-- object rather than an array/scalar.

alter table companies
  add column if not exists juror_weights jsonb;

alter table companies
  add constraint companies_juror_weights_is_object
    check (juror_weights is null or jsonb_typeof(juror_weights) = 'object');

-- No RLS change: companies already exposes rows only to the owning company
-- (companies_select), and weight edits are performed server-side (admin-gated
-- in the app), so no client write policy is added.
