-- AdJury initial schema (Architecture.md §3).
-- Multi-tenant, keyed on company_id, protected by Row-Level Security.

create extension if not exists "pgcrypto";

-- ── companies ─────────────────────────────────────────────────────────
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text,
  plan_tier   text not null default 'free'
                check (plan_tier in ('free', 'pro', 'enterprise')),
  created_at  timestamptz not null default now()
);

-- ── users (mirrors auth.users) ────────────────────────────────────────
create table if not exists users (
  id          uuid primary key references auth.users (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  email       text not null,
  role        text not null default 'member'
                check (role in ('admin', 'member')),
  created_at  timestamptz not null default now()
);
create index if not exists users_company_id_idx on users (company_id);

-- ── brand_profiles ────────────────────────────────────────────────────
create table if not exists brand_profiles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies (id) on delete cascade,
  tone_guide_text text,
  embedding_ref   text,
  updated_at      timestamptz not null default now()
);
create index if not exists brand_profiles_company_id_idx on brand_profiles (company_id);

-- ── reviews ───────────────────────────────────────────────────────────
create table if not exists reviews (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies (id) on delete cascade,
  submitted_by    uuid not null references users (id),
  content_text    text not null,
  content_type    text not null
                    check (content_type in ('ad_copy', 'social_post', 'email', 'landing_page')),
  platform        text,
  aggregate_score numeric(3,1),
  verdict         text check (verdict in ('pass', 'revise', 'fail')),
  created_at      timestamptz not null default now()
);
create index if not exists reviews_company_created_idx
  on reviews (company_id, created_at desc);

-- ── persona_scores ────────────────────────────────────────────────────
create table if not exists persona_scores (
  id                uuid primary key default gen_random_uuid(),
  review_id         uuid not null references reviews (id) on delete cascade,
  persona_name      text not null
                      check (persona_name in (
                        'brand_voice_guardian', 'compliance_legal_flagger',
                        'target_audience_fit', 'seo_discoverability', 'stop_scrolling')),
  score             int check (score between 0 and 10),
  confidence        text check (confidence in ('high', 'medium', 'low')),
  feedback_text     text,
  issues_json       jsonb not null default '[]'::jsonb,
  suggested_rewrite text,
  status            text not null default 'ok' check (status in ('ok', 'error'))
);
create index if not exists persona_scores_review_id_idx on persona_scores (review_id);

-- ── Row-Level Security ────────────────────────────────────────────────
-- A user may see only rows for their own company. company_id is resolved via
-- the users table from the authenticated auth.uid(); never trust the client.
alter table companies      enable row level security;
alter table users          enable row level security;
alter table brand_profiles enable row level security;
alter table reviews        enable row level security;
alter table persona_scores enable row level security;

create or replace function auth_company_id() returns uuid
language sql stable as $$
  select company_id from users where id = auth.uid()
$$;

-- companies: read your own; no client-side writes (managed server-side).
create policy companies_select on companies
  for select using (id = auth_company_id());

-- users: read members of your company.
create policy users_select on users
  for select using (company_id = auth_company_id());

-- brand_profiles: members read; only admins write.
create policy brand_profiles_select on brand_profiles
  for select using (company_id = auth_company_id());
create policy brand_profiles_write on brand_profiles
  for all using (
    company_id = auth_company_id()
    and exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- reviews: read/insert within your company.
create policy reviews_select on reviews
  for select using (company_id = auth_company_id());
create policy reviews_insert on reviews
  for insert with check (company_id = auth_company_id());

-- persona_scores: visible if the parent review is visible.
create policy persona_scores_select on persona_scores
  for select using (
    exists (
      select 1 from reviews r
      where r.id = persona_scores.review_id and r.company_id = auth_company_id()
    )
  );
