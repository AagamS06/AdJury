-- AdJury migration 0004 — team invitations (DailyPlan Day 24).
-- Week 4 multi-tenant foundations: an admin invites a teammate by email; the
-- invitee follows a tokenised link and joins the *existing* company as a member.
--
-- Security notes (Rules.md §4/§5):
--  * We store only a SHA-256 HASH of the invite token (`token_hash`), never the
--    raw token. The raw token lives only in the emailed link — like a password
--    reset token, a DB leak must not hand an attacker a usable invite. Lookups
--    hash the presented token and match the hash.
--  * `company_id` is the tenant key; the invite adds the member to THIS company.
--  * There is deliberately no client write policy — invitations are created and
--    accepted server-side with the service-role client, admin-gated in the app
--    (same pattern as the Day 16 weights / Day 22 onboarding write paths).

create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  email       text not null,
  role        text not null default 'member'
                check (role in ('admin', 'member')),
  -- SHA-256 hex of the raw token; unique so a token maps to at most one invite.
  token_hash  text not null unique,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked')),
  invited_by  uuid references users (id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Admin lists their company's invitations, newest first.
create index if not exists invitations_company_created_idx
  on invitations (company_id, created_at desc);

-- ── Row-Level Security ────────────────────────────────────────────────
alter table invitations enable row level security;

-- An admin may READ their own company's invitations (to manage the pending
-- list). Acceptance reads happen server-side with the service-role client,
-- because the invitee is typically not yet a member of the company (so RLS
-- would hide the row) — the token itself is the bearer credential there.
create policy invitations_select on invitations
  for select using (
    company_id = auth_company_id()
    and exists (
      select 1 from users u where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- No insert/update/delete policy: writes are server-side (service role only).
