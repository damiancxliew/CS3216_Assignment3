#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly POSTGREST_VERSION="v12.2.12"
readonly CADDY_VERSION="2.9.1"
readonly NODE_VERSION="v22.23.2"
readonly PGVECTOR_VERSION="v0.8.1"
readonly APP_ROOT="/opt/app"
readonly POSTGREST_SECRET="/etc/postgrest/jwt-secret.json"
readonly DATA_API_ENV="/etc/data-api.env"

if [[ "$EUID" -ne 0 ]]; then
  echo "bootstrap.sh must run as root." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "Cannot detect the operating system." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "amzn" || "${VERSION_ID:-}" != 2023* ]]; then
  echo "bootstrap.sh requires Amazon Linux 2023." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64)
    readonly CADDY_ARCH="amd64"
    readonly NODE_ARCH="x64"
    readonly POSTGREST_ASSET="postgrest-${POSTGREST_VERSION}-linux-static-x86-64.tar.xz"
    ;;
  aarch64)
    readonly CADDY_ARCH="arm64"
    readonly NODE_ARCH="arm64"
    readonly POSTGREST_ASSET="postgrest-${POSTGREST_VERSION}-ubuntu-20.04-aarch64.tar.xz"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

dnf install -y awscli-2 curl gcc git gzip libcap make tar xz
dnf install -y postgresql16 postgresql16-devel postgresql16-server

PG_CONFIG="$(command -v pg_config || true)"
if [[ -z "$PG_CONFIG" || "$("$PG_CONFIG" --version)" != *" 16."* ]]; then
  PG_CONFIG="/usr/pgsql-16/bin/pg_config"
fi
if [[ ! -x "$PG_CONFIG" ]]; then
  echo "PostgreSQL 16 pg_config was not found." >&2
  exit 1
fi

if [[ ! -f "$("$PG_CONFIG" --sharedir)/extension/vector.control" ]]; then
  if ! dnf install -y pgvector >/dev/null 2>&1 || [[ ! -f "$("$PG_CONFIG" --sharedir)/extension/vector.control" ]]; then
    build_dir="$(mktemp -d)"
    trap 'rm -rf "$build_dir"' EXIT
    curl -fsSL "https://github.com/pgvector/pgvector/archive/refs/tags/${PGVECTOR_VERSION}.tar.gz" -o "$build_dir/pgvector.tar.gz"
    tar -xzf "$build_dir/pgvector.tar.gz" -C "$build_dir"
    make -C "$build_dir/pgvector-${PGVECTOR_VERSION#v}" PG_CONFIG="$PG_CONFIG" -j"$(nproc)"
    make -C "$build_dir/pgvector-${PGVECTOR_VERSION#v}" PG_CONFIG="$PG_CONFIG" install
    rm -rf "$build_dir"
    trap - EXIT
  fi
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != "$NODE_VERSION" ]]; then
  if dnf -q list --available nodejs22 >/dev/null 2>&1; then
    dnf install -y nodejs22
  else
    node_asset="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    node_dir="/opt/node-${NODE_VERSION}"
    download_dir="$(mktemp -d)"
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${node_asset}" -o "$download_dir/$node_asset"
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
    node_sha="$(awk -v asset="$node_asset" '$2 == asset { print $1; exit }' "$download_dir/SHASUMS256.txt")"
    [[ -n "$node_sha" ]] || { echo "Node.js release checksum is missing for $node_asset." >&2; exit 1; }
    printf '%s  %s\n' "$node_sha" "$download_dir/$node_asset" | sha256sum --check --status
    mkdir -p "$node_dir"
    tar -xJf "$download_dir/$node_asset" --strip-components=1 -C "$node_dir"
    ln -sfn "$node_dir/bin/node" /usr/local/bin/node
    ln -sfn "$node_dir/bin/npm" /usr/local/bin/npm
    ln -sfn "$node_dir/bin/npx" /usr/local/bin/npx
    rm -rf "$download_dir"
  fi
fi

if [[ ! -x /usr/local/bin/node ]]; then
  ln -s "$(command -v node)" /usr/local/bin/node
fi

PG_SERVICE="postgresql"
if systemctl list-unit-files --no-legend | awk '{print $1}' | grep -qx 'postgresql-16.service'; then
  PG_SERVICE="postgresql-16"
fi
if ! find /var/lib/pgsql -name PG_VERSION -type f -print -quit 2>/dev/null | grep -q .; then
  if command -v postgresql-setup >/dev/null 2>&1; then
    postgresql-setup --initdb
  elif [[ -x /usr/pgsql-16/bin/postgresql-16-setup ]]; then
    /usr/pgsql-16/bin/postgresql-16-setup initdb
  else
    echo "PostgreSQL 16 initialization utility was not found." >&2
    exit 1
  fi
fi

PGDATA_CONF="$(find /var/lib/pgsql -name postgresql.conf -type f -print -quit)"
PGDATA_HBA="$(find /var/lib/pgsql -name pg_hba.conf -type f -print -quit)"
[[ -n "$PGDATA_CONF" && -n "$PGDATA_HBA" ]] || { echo "PostgreSQL configuration files were not found." >&2; exit 1; }
if ! grep -q '^# BEGIN aws-migration settings$' "$PGDATA_CONF"; then
  printf '\n# BEGIN aws-migration settings\nlisten_addresses = '\''127.0.0.1'\''\npassword_encryption = '\''scram-sha-256'\''\n# END aws-migration settings\n' >> "$PGDATA_CONF"
fi
if ! grep -q '^# BEGIN aws-migration settings$' "$PGDATA_HBA"; then
  hba_tmp="$(mktemp)"
  {
    printf '%s\n' '# BEGIN aws-migration settings'
    printf '%s\n' 'local all postgres peer'
    printf '%s\n' 'local all all scram-sha-256'
    printf '%s\n' 'host all all 127.0.0.1/32 scram-sha-256'
    printf '%s\n' 'host all all ::1/128 scram-sha-256'
    cat "$PGDATA_HBA"
  } > "$hba_tmp"
  install -o postgres -g postgres -m 0600 "$hba_tmp" "$PGDATA_HBA"
  rm -f "$hba_tmp"
fi
systemctl enable --now "$PG_SERVICE"
systemctl restart "$PG_SERVICE"
if ! runuser -u postgres -- psql -X -Atc "SELECT 1 FROM pg_database WHERE datname = 'adventure'" | grep -q '^1$'; then
  runuser -u postgres -- createdb adventure
fi

if [[ ! -e /etc/db-admin.env ]]; then
  install -m 0600 /dev/null /etc/db-admin.env
fi
if [[ ! -e /etc/postgrest.env ]]; then
  install -m 0600 /dev/null /etc/postgrest.env
fi
chmod 0600 /etc/db-admin.env /etc/postgrest.env
# shellcheck disable=SC1091
set -a
source /etc/db-admin.env
source /etc/postgrest.env
set +a
: "${POSTGRES_SUPERUSER_PASSWORD:?Set POSTGRES_SUPERUSER_PASSWORD in /etc/db-admin.env before bootstrap.}"
: "${DATABASE_URL:?Set DATABASE_URL in /etc/db-admin.env before bootstrap.}"
: "${AUTHENTICATOR_PASSWORD:?Set AUTHENTICATOR_PASSWORD in /etc/db-admin.env before bootstrap.}"
: "${PGRST_DB_URI:?Set PGRST_DB_URI in /etc/postgrest.env before bootstrap.}"
runuser -u postgres -- psql -X -v postgres_password="$POSTGRES_SUPERUSER_PASSWORD" <<'SQL'
ALTER ROLE postgres WITH PASSWORD :'postgres_password';
SQL

if ! command -v caddy >/dev/null 2>&1 || [[ "$(caddy version | awk '{print $1}')" != "v${CADDY_VERSION}" ]]; then
  caddy_asset="caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz"
  download_dir="$(mktemp -d)"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/${caddy_asset}" -o "$download_dir/$caddy_asset"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_checksums.txt" -o "$download_dir/checksums.txt"
  caddy_sha="$(awk -v asset="$caddy_asset" '$2 == asset { print $1; exit }' "$download_dir/checksums.txt")"
  [[ -n "$caddy_sha" ]] || { echo "Caddy release checksum is missing for $caddy_asset." >&2; exit 1; }
  printf '%s  %s\n' "$caddy_sha" "$download_dir/$caddy_asset" | sha256sum --check --status
  tar -xzf "$download_dir/$caddy_asset" -C "$download_dir"
  install -m 0755 "$download_dir/caddy" /usr/local/bin/caddy
  rm -rf "$download_dir"
fi
setcap cap_net_bind_service=+ep /usr/local/bin/caddy

if ! command -v postgrest >/dev/null 2>&1 || [[ "$(postgrest --version | awk '{print $2}')" != "${POSTGREST_VERSION#v}" ]]; then
  download_dir="$(mktemp -d)"
  postgrest_url="https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/${POSTGREST_ASSET}"
  curl -fsSL "$postgrest_url" -o "$download_dir/$POSTGREST_ASSET"
  if [[ "$POSTGREST_ASSET" == *"ubuntu-20.04-aarch64"* ]]; then
    printf '%s  %s\n' "6b2eaa5759329e024df76f79d93f6bb3d87a93de11433acc5d66aa6c96f81f90" "$download_dir/$POSTGREST_ASSET" | sha256sum --check --status
  elif curl -fsSL "${postgrest_url}.sha256" -o "$download_dir/postgrest.sha256" 2>/dev/null; then
    postgrest_sha="$(awk '{ print $1; exit }' "$download_dir/postgrest.sha256")"
    [[ -n "$postgrest_sha" ]] || { echo "PostgREST checksum file is empty." >&2; exit 1; }
    printf '%s  %s\n' "$postgrest_sha" "$download_dir/$POSTGREST_ASSET" | sha256sum --check --status
  else
    echo "PostgREST does not publish a SHA-256 sidecar for $POSTGREST_ASSET; downloaded over HTTPS." >&2
  fi
  tar -xJf "$download_dir/$POSTGREST_ASSET" -C "$download_dir"
  install -m 0755 "$download_dir/postgrest" /usr/local/bin/postgrest
  rm -rf "$download_dir"
fi

if [[ ! -f "$("$PG_CONFIG" --sharedir)/extension/vector.control" ]]; then
  echo "pgvector is not installed for PostgreSQL 16." >&2
  exit 1
fi

if [[ ! -e /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
fi
if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  swapon /swapfile
fi
if ! grep -qE '^[[:space:]]*/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! id app >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --shell /sbin/nologin app
fi
if ! id caddy >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/caddy --shell /sbin/nologin caddy
fi
mkdir -p "$APP_ROOT/releases" "$APP_ROOT/bin" "$APP_ROOT/current" /etc/postgrest /etc/caddy /var/lib/caddy
chown -R app:app "$APP_ROOT"
chown -R caddy:caddy /var/lib/caddy
chmod 0750 /var/lib/caddy
if [[ ! -e /etc/app.env ]]; then
  install -m 0600 /dev/null /etc/app.env
fi
chmod 0600 /etc/app.env
# shellcheck disable=SC1091
set -a
source /etc/app.env
set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?Set NEXT_PUBLIC_SUPABASE_URL in /etc/app.env before bootstrap.}"
: "${SITE_DOMAIN:?Set SITE_DOMAIN in /etc/app.env before bootstrap.}"

if [[ ! -s "$POSTGREST_SECRET" || ! -s "$DATA_API_ENV" ]]; then
  node "$SCRIPT_DIR/gen-keys.mjs" "$NEXT_PUBLIC_SUPABASE_URL" "$POSTGREST_SECRET" "$DATA_API_ENV"
fi
chmod 0600 "$POSTGREST_SECRET" "$DATA_API_ENV"
chown app:app "$POSTGREST_SECRET"

install -m 0644 "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
install -m 0644 "$SCRIPT_DIR/systemd/postgrest.service" /etc/systemd/system/postgrest.service
install -m 0644 "$SCRIPT_DIR/systemd/app.service" /etc/systemd/system/app.service
install -m 0644 "$SCRIPT_DIR/systemd/caddy.service" /etc/systemd/system/caddy.service
install -m 0644 "$SCRIPT_DIR/systemd/backup.service" /etc/systemd/system/backup.service
install -m 0644 "$SCRIPT_DIR/systemd/backup.timer" /etc/systemd/system/backup.timer
install -m 0755 "$SCRIPT_DIR/migrate.sh" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/backup.sh" "$SCRIPT_DIR/copy-data.sh" "$SCRIPT_DIR/check-isolation.sh" "$APP_ROOT/bin/"
install -m 0644 "$SCRIPT_DIR/compat.sql" "$APP_ROOT/bin/compat.sql"
install -m 0644 "$SCRIPT_DIR/gen-keys.mjs" "$APP_ROOT/bin/gen-keys.mjs"
install -m 0644 "$SCRIPT_DIR/copy-storage.mjs" "$APP_ROOT/bin/copy-storage.mjs"
chown -R root:root "$APP_ROOT/bin"
chmod 0755 "$APP_ROOT/bin"

systemctl daemon-reload
systemctl enable postgrest.service app.service caddy.service backup.timer
systemctl enable --now backup.timer
systemctl enable --now caddy.service
echo "AWS application host bootstrap complete. Deploy a release to start the application."
