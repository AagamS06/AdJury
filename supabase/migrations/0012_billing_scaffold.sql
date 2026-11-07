-- AdJury migration 0012 — billing scaffold / Stripe customer model (DailyPlan Day 71).
-- Week 11 (billing scaffold): AdJury is a paid product (PRD §6.3 — entry plan
-- AUD $20/month with a free trial, cancel anytime). This is the first billing
-- day: it models the Stripe *customer* on the company row so a company can be
-- linked to its Stripe customer + subscription and the app can read its
-- entitlement without a round-trip to Stripe on every request. Products/prices
-- themselves live in Stripe (test mode) and are referenced by id from config
-- (`src/lib/billing/plans.ts`); only the per-company linkage is stored here.
--
-- stripe_customer_id      — the Stripe Customer id (`cus_…`) for this company;
--                           NULL = no Stripe customer yet (free, never checked out).
-- stripe_subscription_id  — the active/most-recent Subscription id (`sub_…`);
--                           NULL = no subscription yet.
-- subscription_status     — the Stripe subscription status, mirrored locally so
--                           entitlement reads need no Stripe call. The CHECK set is
--                           the Stripe subscription-status vocabulary (plus NULL =
--                           no subscription). Kept in sync by the webhook (Day 74).
-- trial_ends_at           — when the current trial ends (NULL = not trialing). The
--                           trial length is a *config value* (`STRIPE_TRIAL_DAYS`),
--                           applied as a Stripe trial period at checkout, so the
--                           "3-month vs 1-month" monetization choice is a setting,
--                           not a schema change.
-- current_period_end      — when the current paid period ends (renewal/anchor);
--                           NULL = no active period. Informational for the
--                           manage-plan UI (Day 76).
--
-- Existing rows read all five as NULL with no backfill (every company starts on
-- the free tier with no Stripe linkage); checkout (Day 74) populates them.

alter table companies
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text
    check (subscription_status in (
      'trialing', 'active', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    )),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz;

-- A company maps to at most one Stripe customer; enforce it so a double-checkout
-- bug can't fork a company's billing across two customers. Partial unique index
-- so the many NULLs (free companies) don't collide.
create unique index if not exists companies_stripe_customer_id_key
  on companies (stripe_customer_id)
  where stripe_customer_id is not null;

-- No RLS change: `companies` already scopes SELECT to the caller's own company
-- (companies_select) and has no client write policy — every billing write runs
-- server-side through the service-role client with an explicit, session-derived
-- company_id (Rules.md §5), exactly like plan_tier/juror_weights/business_summary.
-- Billing columns are set only by server billing code (checkout + the Stripe
-- webhook), never by a client, so they inherit that same tenant guard with no new
-- policy surface. The values are non-secret references (`cus_…`/`sub_…` ids), not
-- credentials — the Stripe secret key lives only in the server env (Rules.md §4).
