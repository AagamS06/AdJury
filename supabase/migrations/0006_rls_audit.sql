-- AdJury migration 0006 — RLS audit hardening (DailyPlan Day 43).
-- Week 7 (security & cost pass): verify every tenant-table policy and close the
-- one real defect the audit surfaced. No new tables, columns, or data.
--
-- ── Finding (critical): auth_company_id() self-recursion + mutable search_path ──
-- Every tenant policy scopes rows through auth_company_id() (0001), which reads
-- the `users` table to resolve the caller's company:
--
--     select company_id from users where id = auth.uid()
--
-- As originally defined the function was SECURITY INVOKER (the default), so it
-- runs with the caller's privileges and RLS is re-applied to that inner read of
-- `users`. But the `users` table's own policy (`users_select`) is itself
-- `company_id = auth_company_id()` — so resolving it calls auth_company_id()
-- again, which reads `users` again, which re-applies `users_select`… Postgres
-- aborts this with:
--
--     ERROR: infinite recursion detected in policy for relation "users"
--
-- Because *every* tenant policy (companies/users/brand_profiles/reviews/
-- persona_scores/invitations) funnels through auth_company_id(), the recursion
-- breaks RLS-based tenancy entirely: an authenticated user cannot even read
-- their *own* rows. This is the canonical Supabase RLS footgun — a helper that
-- resolves the caller's tenant must bypass RLS on the lookup table.
--
-- ── Fix ──
-- Re-create auth_company_id() as SECURITY DEFINER so the `users` lookup runs as
-- the function owner (a role that bypasses RLS), which both resolves the company
-- correctly and breaks the recursion. A SECURITY DEFINER function MUST pin its
-- search_path or it becomes a privilege-escalation vector (an attacker who can
-- create objects on a mutable search_path could shadow `users`/`auth`), so we
-- set an empty search_path and fully-qualify every object (`public.users`,
-- `auth.uid()`). STABLE is kept (same result within a statement; lets the
-- planner cache it per query).
--
-- Fail-closed behavior is preserved: for an unauthenticated caller auth.uid() is
-- NULL, the lookup returns NULL, and `company_id = NULL` is NULL (not true) in
-- every policy — so no rows are ever exposed (Rules.md §6 "fail closed on
-- anything touching authz, tenancy, or secrets").

create or replace function auth_company_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select company_id from public.users where id = auth.uid()
$$;

-- ── Verified correct (no change needed), recorded here for the audit trail ──
--  * RLS is ENABLED on all six tenant tables (companies, users, brand_profiles,
--    reviews, persona_scores, invitations) — 0001 and 0004.
--  * Every permissive policy is company-scoped: it constrains rows through
--    auth_company_id() (persona_scores via its parent review's company_id). No
--    policy uses `using (true)`/`with check (true)`, so none exposes rows across
--    tenants.
--  * brand_profiles writes and invitations reads are additionally admin-gated
--    (role = 'admin'); brand_profiles_write is FOR ALL, whose USING clause also
--    governs INSERT/UPDATE WITH CHECK, so an admin can neither read nor move a
--    row to another company.
--  * Server-side-only tables rely on fail-closed RLS: companies, users,
--    persona_scores, and invitations have NO client INSERT/UPDATE/DELETE policy
--    and reviews has none for UPDATE/DELETE, so those writes are denied to the
--    authenticated/anon client and only ever happen via the service-role client
--    (which bypasses RLS by design, Rules.md §4/§5).
