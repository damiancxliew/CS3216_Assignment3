# Branch protection: no merge until CI passes

`main` should refuse merges while checks are red or still running. The rules
live in `.github/settings.yml`, but GitHub only reads that file when the
[Settings app](https://github.com/apps/settings) is installed on the repo.
Otherwise a repo admin applies them once with the commands below.

## Required checks

Only the `CI` workflow runs on every pull request, so its two pull-request jobs
are the required contexts:

- `web` — lint, typecheck, API tests, generation asset tests, `npm run build`
- `database` — local Supabase reset plus `tests/db`

The `game-client`, `game-core`, `generation` and `orchestration` workflows are
path-filtered. A required check that never starts blocks a pull request
forever, so they stay optional and only gate the pull requests that touch them.

`CI`'s `migrate` job runs on pushes to `main` only and is never a pull-request
check.

## Apply with the GitHub CLI

```bash
gh api -X PUT repos/damiancxliew/CS3216_Assignment3/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=web' \
  -f 'required_status_checks[contexts][]=database' \
  -F 'enforce_admins=false' \
  -F 'required_pull_request_reviews=null' \
  -F 'restrictions=null'
```

`strict=true` also requires the branch to be up to date with `main` before
merging, so a pull request cannot land against a stale base.

## Or through the UI

Settings → Branches → Add branch ruleset (or Add rule) for `main`:

1. Enable **Require status checks to pass before merging**.
2. Add `web` and `database`.
3. Enable **Require branches to be up to date before merging**.

## Verify

```bash
gh api repos/damiancxliew/CS3216_Assignment3/branches/main/protection \
  --jq '.required_status_checks'
```

Open a pull request with a deliberate lint error: the merge button should be
disabled until `web` and `database` report success.
