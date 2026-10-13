DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END
$$;

ALTER ROLE anon NOLOGIN NOBYPASSRLS;
ALTER ROLE authenticated NOLOGIN NOBYPASSRLS;
ALTER ROLE service_role NOLOGIN BYPASSRLS;
ALTER ROLE authenticator LOGIN NOINHERIT PASSWORD :'authenticator_password';
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

SET search_path TO "$user", public, extensions;

SELECT format(
  'ALTER DATABASE %I SET search_path TO "$user", public, extensions',
  current_database()
)
\gexec

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud varchar(255) DEFAULT 'authenticated',
  role varchar(255) DEFAULT 'authenticated',
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255) NOT NULL DEFAULT '',
  confirmation_sent_at timestamptz,
  recovery_token varchar(255) NOT NULL DEFAULT '',
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255) NOT NULL DEFAULT '',
  email_change varchar(255) NOT NULL DEFAULT '',
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone text UNIQUE,
  phone_confirmed_at timestamptz,
  phone_change text NOT NULL DEFAULT '',
  phone_change_token varchar(255) NOT NULL DEFAULT '',
  phone_change_sent_at timestamptz,
  email_change_token_current varchar(255) NOT NULL DEFAULT '',
  email_change_confirm_status smallint NOT NULL DEFAULT 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) NOT NULL DEFAULT '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL,
  provider varchar(64) NOT NULL,
  provider_id text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE (provider_id, provider)
);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text,
  statements text[] NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH claims AS (
    SELECT nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb AS value
  )
  SELECT coalesce(value, '{}'::jsonb)
    || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'sub',
        coalesce(
          value ->> 'sub',
          nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')
        ),
        'role',
        coalesce(
          value ->> 'role',
          nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '')
        )
      )
    )
  FROM claims;
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(auth.jwt() ->> 'role', '');
$$;

CREATE OR REPLACE FUNCTION public.sync_auth_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb := auth.jwt();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (
    auth.uid(),
    claims ->> 'email',
    coalesce(claims -> 'user_metadata', '{}'::jsonb),
    coalesce(claims -> 'app_metadata', '{}'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
      raw_app_meta_data = EXCLUDED.raw_app_meta_data,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.sync_auth_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_auth_user() TO authenticated;
