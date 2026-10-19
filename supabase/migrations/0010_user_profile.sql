-- AdJury migration 0010 — user profile (DailyPlan Day 51).
-- Week 8 (dashboard & settings): give each user an editable account profile. The
-- `users` row has only the identity fields it needs for auth + tenancy (id,
-- company_id, email, role); there was nowhere for a person to set how they are
-- shown in the app. This adds a single optional `display_name` so a user can give
-- themselves a friendly name on the account settings page (PRD §6.1 auth/roles).
--
-- `display_name` — the user's preferred display name; NULL/absent = not set, in
--                  which case the UI falls back to the email. Edited only by the
--                  user themselves on `/account`; email/role stay read-only there
--                  (role is changed by an admin via team management, Day 25).
--
-- Existing rows read it as NULL with no backfill; the first time a user saves
-- their account settings it is populated (or cleared back to NULL).

alter table users
  add column if not exists display_name text;

-- No RLS change: `users` already scopes SELECT to the caller's own company
-- (users_select) and has no client write policy — every write runs server-side
-- through the service-role client with an explicit, session-derived id +
-- company_id (Rules.md §5), exactly like the Day 25 role change. The self-edit on
-- `/account` writes only the session user's own id, so the new column inherits
-- that same tenant guard with no new policy surface.
