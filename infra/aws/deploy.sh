#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "usage: deploy.sh <40-character commit SHA>" >&2
  exit 2
fi

readonly SHA="$1"
readonly APP_ROOT="/opt/app"
readonly RELEASES_DIR="$APP_ROOT/releases"
readonly CURRENT="$APP_ROOT/current"
readonly RELEASE="$RELEASES_DIR/$SHA"
readonly RELEASE_INFRA="$RELEASE/infra/aws"
archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT

# shellcheck disable=SC1091
source /etc/db-admin.env
: "${DATABASE_URL:?DATABASE_URL is not configured in /etc/db-admin.env}"
: "${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD is not configured in /etc/db-admin.env}"

aws s3 cp "s3://backups-cs3216/deploys/${SHA}.tgz" "$archive"
mkdir -p "$RELEASE"
tar -xzf "$archive" -C "$RELEASE"
[[ -d "$RELEASE/supabase/migrations" ]] || { echo "Release has no bundled migrations." >&2; exit 1; }
[[ -d "$RELEASE_INFRA/systemd" ]] || { echo "Release has no bundled AWS service configuration." >&2; exit 1; }
chown -R app:app "$RELEASE"

install -m 0755 "$RELEASE_INFRA/migrate.sh" "$RELEASE_INFRA/deploy.sh" "$RELEASE_INFRA/backup.sh" "$RELEASE_INFRA/copy-data.sh" "$RELEASE_INFRA/check-isolation.sh" "$APP_ROOT/bin/"
install -m 0644 "$RELEASE_INFRA/compat.sql" "$RELEASE_INFRA/gen-keys.mjs" "$RELEASE_INFRA/copy-storage.mjs" "$APP_ROOT/bin/"

(
  unset NEXT_PUBLIC_DATA_URL ASSET_BUCKET ASSET_PUBLIC_BASE_URL DATA_SERVICE_ROLE_KEY
  set -a
  # shellcheck disable=SC1091
  source /etc/app.env
  # shellcheck disable=SC1091
  source /etc/data-api.env
  "$APP_ROOT/bin/check-isolation.sh"
)

for unit in app.service postgrest.service caddy.service backup.service backup.timer; do
  install -m 0644 "$RELEASE_INFRA/systemd/$unit" "/etc/systemd/system/$unit"
done

caddyfile_changed=0
if ! cmp -s "$RELEASE_INFRA/Caddyfile" /etc/caddy/Caddyfile; then
  install -m 0644 "$RELEASE_INFRA/Caddyfile" /etc/caddy/Caddyfile
  caddyfile_changed=1
fi
systemctl daemon-reload
if [[ "$caddyfile_changed" == 1 ]]; then
  if systemctl is-active --quiet caddy.service; then
    systemctl reload caddy.service
  else
    systemctl start caddy.service
  fi
fi
systemctl enable --now backup.timer

"$RELEASE_INFRA/migrate.sh" "$RELEASE/supabase/migrations"
systemctl restart postgrest.service

previous=""
if [[ -L "$CURRENT" ]]; then
  previous="$(readlink "$CURRENT")"
elif [[ -d "$CURRENT" ]]; then
  rmdir "$CURRENT"
fi

rollback() {
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "${CURRENT}.rollback"
    mv -Tf "${CURRENT}.rollback" "$CURRENT"
  else
    rm -f "$CURRENT"
    mkdir -p "$CURRENT"
  fi
  systemctl restart app.service || true
}

ln -s "$RELEASE" "${CURRENT}.next"
mv -Tf "${CURRENT}.next" "$CURRENT"

if ! systemctl restart app.service; then
  rollback
  echo "Application restart failed; restored the previous release." >&2
  exit 1
fi

healthy=0
for _ in $(seq 1 60); do
  if curl --silent --show-error --fail --max-time 5 http://127.0.0.1:3000/ >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  rollback
  echo "Application health check failed; restored the previous release." >&2
  exit 1
fi

current_target="$(readlink -f "$CURRENT")"
while IFS= read -r old_release; do
  [[ -n "$old_release" && "$old_release" != "$current_target" ]] && rm -rf -- "$old_release"
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2-)
echo "Deployed $SHA successfully."
