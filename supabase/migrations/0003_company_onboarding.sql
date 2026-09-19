-- AdJury migration 0003 — first-admin company onboarding (DailyPlan Day 22).
-- Week 4 multi-tenant foundations: the first admin names their company and sets
-- its industry + plan tier, turning the auto-provisioned company (name only,
-- from signup) into a usable, described company context.
--
-- `onboarded_at` is the explicit "has the admin completed onboarding" signal
-- (like `juror_weights` being an explicit per-company override in 0002). NULL
-- means "not yet onboarded", so existing rows read as needs-onboarding with no
-- backfill and the app can guide the admin through it. The value is stamped once
-- the admin submits the onboarding form.

alter table companies
  add column if not exists onboarded_at timestamptz;

-- No RLS change: companies already exposes rows only to the owning company
-- (companies_select), and there is deliberately no client write policy — company
-- writes are performed server-side with the service-role client, admin-gated in
-- the app (same pattern as the Day 16 juror-weights write path).
