#!/usr/bin/env bash
set -euo pipefail

migrations_dir=${1:?usage: migrate.sh <migrations-dir>}
database_url=${DATABASE_URL:?DATABASE_URL must be set}
authenticator_password=${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD must be set}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

tracking_table=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL")
if [[ "$tracking_table" != "t" ]]; then
  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -v authenticator_password="$authenticator_password" \
    -f "$script_dir/compat.sql"
fi

shopt -s nullglob
for migration in "$migrations_dir"/*.sql; do
  filename=$(basename -- "$migration")
  version=${filename%%_*}
  name=${filename#*_}
  name=${name%.sql}

  applied=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -At \
    -v migration_version="$version" <<'SQL'
SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = :'migration_version';
SQL
  )
  if [[ "$applied" == "1" ]]; then
    printf 'Already applied %s\n' "$filename"
    continue
  fi

  printf 'Applying %s\n' "$filename"
  psql "$database_url" -X -v ON_ERROR_STOP=1 --single-transaction \
    -v migration_version="$version" \
    -v migration_name="$name" <<SQL
\\i $migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (:'migration_version', :'migration_name', ARRAY[:'migration_name']);
SQL
done
