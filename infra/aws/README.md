# AWS application host

The target is Amazon Linux 2023 with PostgreSQL 16 + pgvector, PostgREST, the
Next.js standalone server, and Caddy. Supabase remains the Google OAuth/session
provider; the application database and generated images live on EC2 and S3.

## Setup order

1. Create an AL2023 x86_64 (or aarch64) EC2 instance in `ap-southeast-2`, attach
   the `ec2-cs3216` instance role, and point `SITE_DOMAIN` DNS at the instance.
   The role needs Put/Get on `assets-cs3216` and Put/Get/List on
   `backups-cs3216`; it does not need Delete.
2. Before bootstrapping, create `/etc/app.env`, `/etc/db-admin.env`, and
   `/etc/postgrest.env`, each mode `0600`. They are shell-style environment
   files; quote values containing whitespace or shell metacharacters. Do not
   put static AWS credentials in them.
3. Set these application values in `/etc/app.env`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DATA_URL` (the Caddy origin),
   `AWS_REGION=ap-southeast-2`, `ASSET_BUCKET=assets-cs3216`,
   `ASSET_PUBLIC_BASE_URL` (the CloudFront base URL), and `SITE_DOMAIN`.
   Bootstrap generates `NEXT_PUBLIC_DATA_ANON_KEY` and
   `DATA_SERVICE_ROLE_KEY` into `/etc/data-api.env` from the Supabase JWKS.
4. Set these database values in `/etc/db-admin.env`:
   `POSTGRES_SUPERUSER_PASSWORD`, `DATABASE_URL` (the local `adventure`
   database as PostgreSQL superuser), and `AUTHENTICATOR_PASSWORD`. Set
   `PGRST_DB_URI` in `/etc/postgrest.env` to the local `authenticator` URI
   using the same authenticator password. Bootstrap sets the PostgreSQL
   superuser password supplied in the file; it does not generate passwords.
5. Run `sudo bash infra/aws/bootstrap.sh` on the instance. It installs pinned
   binaries, initializes PostgreSQL, creates the local `adventure` database,
   installs systemd units, and enables the nightly backup timer. It does not
   copy hosted data or start the app before a release is deployed.
6. Apply schema migrations with
   `DATABASE_URL=... AUTHENTICATOR_PASSWORD=... bash infra/aws/migrate.sh supabase/migrations`.
   The first run applies `compat.sql` and then each migration in a transaction.
7. Create a console-less IAM user limited to `s3:PutObject` on
   `backups-cs3216/deploys/*`, `ssm:SendCommand` on this instance and the
   `AWS-RunShellScript` document, and `ssm:GetCommandInvocation`. Store its
   access key as the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets of
   the `aws-staging` GitHub environment, set `AWS_DEPLOY_ENABLED=true`,
   `AWS_INSTANCE_ID`, and the `NEXT_PUBLIC_*` build values, then push to
   `aws-migration-branch` or run the workflow manually. If
   `AWS_DEPLOY_ENABLED` is not `true`, the workflow exits successfully with a
   notice instead of attempting AWS access.

`bootstrap.sh` pins PostgREST v12.2.12, Caddy v2.9.1, Node.js 22, and pgvector
v0.8.1 when an AL2023 pgvector package is unavailable. It verifies the published
Caddy and Node SHA-256 checksums, and the published PostgREST aarch64 digest.
The PostgREST x86_64 release does not publish a checksum sidecar; bootstrap
downloads that pinned static binary over HTTPS and reports the missing
checksum. PostgREST listens only on `127.0.0.1:3001`; Next.js listens only on
`127.0.0.1:3000`. Caddy strips `/rest/v1/` before forwarding API requests and
uses a 300-second response-header timeout for both upstreams.

## Environment variables

| File | Variables |
| --- | --- |
| `/etc/app.env` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DATA_URL`, `AWS_REGION`, `ASSET_BUCKET`, `ASSET_PUBLIC_BASE_URL`, `SITE_DOMAIN` |
| `/etc/db-admin.env` | `POSTGRES_SUPERUSER_PASSWORD`, `DATABASE_URL`, `AUTHENTICATOR_PASSWORD`; set `SUPABASE_DB_URL` here only during an approved rehearsal/cutover |
| `/etc/postgrest.env` | `PGRST_DB_URI` |
| generated `/etc/data-api.env` | `NEXT_PUBLIC_DATA_ANON_KEY`, `DATA_SERVICE_ROLE_KEY` |
| GitHub `aws-staging` environment | variables `AWS_DEPLOY_ENABLED`, `AWS_INSTANCE_ID`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_DATA_URL`, `NEXT_PUBLIC_DATA_ANON_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`; secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

The S3 client uses the AWS SDK default credential provider chain, so EC2
credentials come from the instance role. `AWS_ENDPOINT_URL_S3` is optional and
is intended for local S3-compatible testing such as MinIO.

The application database must be fresh when `copy-data.sh` runs. It removes
the migration-provisioned profile rows before loading source profiles, and
refuses to proceed if adventures or attempts already exist.

## Backup and restore

`backup.timer` runs `/opt/app/bin/backup.sh` nightly at 02:00 UTC. It writes a
gzip-compressed custom-format dump to
`s3://backups-cs3216/pg/<UTC timestamp>.dump`.

To restore a downloaded backup into a prepared local PostgreSQL database:

```bash
aws s3 cp s3://backups-cs3216/pg/<UTC timestamp>.dump /tmp/adventure.dump.gz
gunzip -c /tmp/adventure.dump.gz | pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL"
```

## Hosted-data rehearsal and cutover

`copy-data.sh` is authored for a controlled rehearsal/cutover and **must not be
run against hosted Supabase without an explicit cutover approval**. It uses
`SUPABASE_DB_URL` only for read-only `pg_dump`/`COPY TO STDOUT` operations and
refuses a non-local PostgreSQL target. Its writes go to the local EC2 database
and the configured S3 bucket. It copies public-schema rows with triggers
disabled, copies only `id`, `email`, `raw_user_meta_data`, `raw_app_meta_data`,
`created_at`, and `updated_at` from `auth.users`, uploads objects from the
Supabase `assets` Storage bucket, and rewrites matching URLs in the EC2 copy.

The image URL locations handled by the rewrite are:

- `asset.url` and `asset.placeholder_url` (the latter normally contains a
  curated local `/assets/curated/...` path and is unchanged unless it contains
  the old Supabase Storage prefix);
- `asset_cache.url`;
- JSON values in `spec_version.json`, `spec_version.compiled_spec`, and
  `spec_version.compiled_stages`.

The public `asset` table is the persisted asset manifest. Generated object keys
are retained when copied to S3 so these database references remain stable. The
rewrite replaces only
`<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/assets/` with
`<ASSET_PUBLIC_BASE_URL>/` in the target database; the hosted database is never
updated.

Example rehearsal after the target migrations have been applied:

```bash
sudo bash infra/aws/copy-data.sh
```
