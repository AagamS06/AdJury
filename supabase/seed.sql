-- Dev seed data. Run against a local/dev Supabase project only.
-- NOTE: `users` references auth.users, so create the auth user first
-- (via the Supabase dashboard or auth API) and swap in its UUID below.

insert into companies (id, name, industry, plan_tier)
values ('00000000-0000-0000-0000-000000000001', 'Acme Marketing', 'saas', 'pro')
on conflict (id) do nothing;

insert into brand_profiles (company_id, tone_guide_text)
values (
  '00000000-0000-0000-0000-000000000001',
  'Tone: measured, expert, trustworthy. Avoid hype and absolute claims. Prefer concrete outcomes over adjectives.'
)
on conflict do nothing;

-- Example (uncomment after creating the matching auth user):
-- insert into users (id, company_id, email, role)
-- values ('<AUTH_USER_UUID>', '00000000-0000-0000-0000-000000000001', 'admin@acme.test', 'admin');
