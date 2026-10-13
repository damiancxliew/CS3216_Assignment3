#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source /etc/app.env
# shellcheck disable=SC1091
source /etc/db-admin.env
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL must point to the read-only source database}"
: "${DATABASE_URL:?DATABASE_URL must point to the EC2 PostgreSQL target}"
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is required for URL rewriting}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required to copy Storage objects}"
: "${ASSET_BUCKET:?ASSET_BUCKET is required for the copied assets}"
: "${ASSET_PUBLIC_BASE_URL:?ASSET_PUBLIC_BASE_URL is required for URL rewriting}"

if [[ "$SUPABASE_DB_URL" == "$DATABASE_URL" ]]; then
  echo "Source and target database URLs must differ." >&2
  exit 1
fi
target_address="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SELECT coalesce(inet_server_addr()::text, 'local-socket')")"
case "$target_address" in
  local-socket|127.0.0.1|::1) ;;
  *)
    echo "Refusing to write to a non-local PostgreSQL target: $target_address" >&2
    exit 1
    ;;
esac
has_live_attempts="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT EXISTS (SELECT 1 FROM attempt) OR EXISTS (SELECT 1 FROM adventure)")"
if [[ "$has_live_attempts" == "t" ]]; then
  echo "Refusing to copy into a target that already has adventures or attempts." >&2
  exit 1
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "DELETE FROM profile WHERE id IN (SELECT id FROM auth.users)"

pg_dump --data-only --schema=public --disable-triggers --no-owner --no-privileges "$SUPABASE_DB_URL" |
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1

import_dir="$(mktemp -d)"
chmod 0700 "$import_dir"
trap 'rm -rf "$import_dir"' EXIT
auth_rows="$import_dir/auth-users.csv"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "COPY (SELECT id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at FROM auth.users) TO STDOUT WITH (FORMAT csv, NULL '\\N')" \
  > "$auth_rows"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE copied_auth_users (
  id uuid,
  email varchar(255),
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);
\\copy copied_auth_users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) FROM '$auth_rows' WITH (FORMAT csv, NULL '\\N')
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
SELECT id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at
FROM copied_auth_users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  updated_at = EXCLUDED.updated_at;
COMMIT;
SQL

node "$(dirname "${BASH_SOURCE[0]}")/copy-storage.mjs"

old_prefix="${NEXT_PUBLIC_SUPABASE_URL%/}/storage/v1/object/public/assets/"
new_base="${ASSET_PUBLIC_BASE_URL%/}/"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v old_prefix="$old_prefix" \
  -v new_base="$new_base" <<'SQL'
UPDATE asset_cache
SET url = replace(url, :'old_prefix', :'new_base')
WHERE position(:'old_prefix' in url) > 0;

UPDATE asset
SET url = replace(url, :'old_prefix', :'new_base'),
    placeholder_url = replace(placeholder_url, :'old_prefix', :'new_base')
WHERE position(:'old_prefix' in url) > 0
   OR position(:'old_prefix' in placeholder_url) > 0;

UPDATE spec_version
SET json = replace(json::text, :'old_prefix', :'new_base')::jsonb,
    compiled_spec = CASE WHEN compiled_spec IS NULL THEN NULL ELSE replace(compiled_spec::text, :'old_prefix', :'new_base')::jsonb END,
    compiled_stages = CASE WHEN compiled_stages IS NULL THEN NULL ELSE replace(compiled_stages::text, :'old_prefix', :'new_base')::jsonb END
WHERE position(:'old_prefix' in json::text) > 0
   OR position(:'old_prefix' in coalesce(compiled_spec::text, '')) > 0
   OR position(:'old_prefix' in coalesce(compiled_stages::text, '')) > 0;
SQL
echo "Copied the EC2-compatible application data, auth metadata, and storage assets."
