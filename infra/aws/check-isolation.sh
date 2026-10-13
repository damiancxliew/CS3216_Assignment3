#!/usr/bin/env bash
set -euo pipefail

missing=()
[[ -n "${NEXT_PUBLIC_DATA_URL:-}" ]] || missing+=(NEXT_PUBLIC_DATA_URL)
[[ -n "${ASSET_BUCKET:-}" ]] || missing+=(ASSET_BUCKET)
[[ -n "${ASSET_PUBLIC_BASE_URL:-}" ]] || missing+=(ASSET_PUBLIC_BASE_URL)
[[ -n "${DATA_SERVICE_ROLE_KEY:-}" ]] || missing+=(DATA_SERVICE_ROLE_KEY)

if ((${#missing[@]})); then
  printf 'Isolation check failed; required variables are missing or empty: %s\n' "${missing[*]}" >&2
  exit 1
fi
