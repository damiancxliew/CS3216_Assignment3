#!/usr/bin/env bash
# Run the app locally: Docker -> Supabase -> .env.local keys -> Next.js dev server.
# Usage: scripts/dev-local.sh [--kill-port]
#   --kill-port  stop whatever is already listening on port 3000 instead of exiting
set -euo pipefail

cd "$(dirname "$0")/.."
PORT=3000
ENV_FILE=apps/web/.env.local

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker..."
  [[ "$(uname)" == "Darwin" ]] && open -a Docker
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || { echo "Docker did not start; open Docker Desktop and retry." >&2; exit 1; }
fi

[[ -d node_modules ]] || npm ci

echo "Starting Supabase..."
for _ in $(seq 1 10); do
  npx supabase status >/dev/null 2>&1 && break
  npx supabase start >/dev/null 2>&1 || sleep 5
done
npx supabase status >/dev/null 2>&1 || { echo "Supabase failed to start; run 'npx supabase start' to see why." >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || cp .env.example "$ENV_FILE"
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
sed -i.bak -E \
  -e "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY|" \
  -e "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|" \
  "$ENV_FILE" && rm -f "$ENV_FILE.bak"

if pids=$(lsof -tiTCP:$PORT -sTCP:LISTEN); then
  if [[ "${1:-}" == "--kill-port" ]]; then
    echo "Stopping processes on port $PORT: $pids"
    kill $pids 2>/dev/null || true
    sleep 3
    pids=$(lsof -tiTCP:$PORT -sTCP:LISTEN) && kill -9 $pids 2>/dev/null || true
  else
    echo "Port $PORT is already in use:" >&2
    lsof -nP -iTCP:$PORT -sTCP:LISTEN >&2
    echo "Re-run with --kill-port to stop it." >&2
    exit 1
  fi
fi

echo "Supabase Studio: http://127.0.0.1:54323  |  App: http://localhost:$PORT"
exec npm run dev
