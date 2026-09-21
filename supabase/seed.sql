-- Dev seed data. Run against a local/dev Supabase project only.
-- NOTE: `users` references auth.users, so create the auth user first
-- (via the Supabase dashboard or auth API) and swap in its UUID below.

insert into companies (id, name, industry, plan_tier, onboarded_at)
values ('00000000-0000-0000-0000-000000000001', 'Acme Marketing', 'saas', 'pro', now())
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

-- Example pending invitation (Day 24). `token_hash` is the SHA-256 of the raw
-- token that goes in the /invite/<token> link — the raw token is never stored.
-- Generate a real pair in dev with `node -e "const c=require('crypto');const t=c.randomBytes(32).toString('hex');console.log('token', t);console.log('hash', c.createHash('sha256').update(t).digest('hex'))"`.
-- insert into invitations (company_id, email, role, token_hash, expires_at)
-- values ('00000000-0000-0000-0000-000000000001', 'teammate@acme.test', 'member',
--         '<SHA256_OF_RAW_TOKEN>', now() + interval '7 days');
