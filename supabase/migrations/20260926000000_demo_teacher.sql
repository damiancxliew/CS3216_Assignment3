-- Demo teacher account for the playable grading demo.
--
-- `npm run db:seed` publishes a demo adventure under this user so a grader can
-- be handed a join link on any environment built from migrations. Putting the
-- auth row in a migration (rather than creating it in the seed script) means
-- `supabase db reset` and `db push` both leave the account in place, and the
-- seed can rely on a fixed id instead of an admin API call.
--
-- Adventure content itself is still seeded by `npm run db:seed` — this
-- migration provisions only the identity it publishes under.
--
-- Idempotent: every insert is conflict-guarded, so repeated `db push` runs are
-- safe and `db reset` simply recreates the same rows.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  -- GoTrue scans these as non-nullable strings; leaving them NULL makes the
  -- admin users endpoint fail with a scan error.
  email_change,
  email_change_token_new,
  email_change_token_current,
  reauthentication_token,
  phone,
  phone_change,
  phone_change_token,
  email_change_confirm_status,
  is_sso_user,
  is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000d3a',
  'authenticated',
  'authenticated',
  'demo-teacher@adventure.local',
  -- Random throwaway password: the account signs in via the teacher flow or is
  -- only ever impersonated by the service role; nobody needs to know it.
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Demo teacher"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  0,
  false,
  false
)
on conflict do nothing;

-- Supabase Auth requires a matching identity row for the user to sign in.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000d3a',
  '00000000-0000-4000-8000-000000000d3a',
  '00000000-0000-4000-8000-000000000d3a',
  '{"sub": "00000000-0000-4000-8000-000000000d3a", "email": "demo-teacher@adventure.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict do nothing;
