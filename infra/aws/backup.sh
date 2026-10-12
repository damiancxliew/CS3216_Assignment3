#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source /etc/app.env
# shellcheck disable=SC1091
source /etc/db-admin.env
: "${DATABASE_URL:?DATABASE_URL is not configured in /etc/app.env}"
: "${AWS_REGION:?AWS_REGION is not configured in /etc/app.env}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom "$DATABASE_URL" | gzip -c | aws s3 cp - "s3://backups-cs3216/pg/${timestamp}.dump" --region "$AWS_REGION"
echo "Uploaded PostgreSQL backup ${timestamp}.dump."
