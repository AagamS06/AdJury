-- AdJury migration 0011 — user notification preferences (DailyPlan Day 51, Part 2).
-- Week 8 (dashboard & settings): the account settings page lets a user manage how
-- AdJury contacts them. Part 1 (migration 0010) added the display name; this adds
-- the per-user notification opt-ins. They are a *preference store* read later by
-- the notification/digest surfaces (Day 53+) and by email delivery when it ships —
-- storing the choice now keeps the account page complete and gives those features
-- a tenant-safe source of truth to read.
--
-- notify_review_complete — email me when a review I submitted finishes (default on;
--                          the most useful signal for an active user).
-- notify_weekly_digest   — a weekly summary of my company's review activity
--                          (default off; opt-in to a recurring email).
-- notify_product_news    — occasional product announcements (default on).
--
-- All three are NOT NULL with a default, so existing rows read a sensible default
-- with no backfill, and a reader never has to handle a null preference.

alter table users
  add column if not exists notify_review_complete boolean not null default true,
  add column if not exists notify_weekly_digest   boolean not null default false,
  add column if not exists notify_product_news     boolean not null default true;

-- No RLS change: `users` already scopes SELECT to the caller's own company
-- (users_select) and has no client write policy — the self-edit on `/account`
-- writes only the session user's own id + company_id under the service-role client
-- (Rules.md §5), exactly like the Day 51 display-name write. The new columns
-- inherit that same tenant guard with no new policy surface.
