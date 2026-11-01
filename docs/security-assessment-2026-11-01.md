# Preliminary staging security assessment

Assessed **1 November 2026, approximately 16:31–16:40 Singapore time**.
Submission deadline: **2 November 2026, 18:30 Singapore time**.
Submit exactly: **https://staging.pocketadventures.world/**

The site is available for the preliminary tutor scan. This is a bounded assessment,
not a clean security bill of health. Fixes in this branch are **not deployed**.

## Scope and evidence

- Repository baseline: `88061d3e84adce117f2b9eb88699fc1a24dc939d` (`main`). The
  [latest successful AWS deployment](https://github.com/damiancxliew/CS3216_Assignment3/actions/runs/41031705971)
  used this commit. No separate live build fingerprint was available.
- Low-volume GET/HEAD checks, public homepage JavaScript inspection, browser
  inspection, source/migration review, npm advisory checks and isolated local tests.
- No staging writes, account creation, exploit payloads, load tests, port scans,
  credential guessing, database resets, deployment, or migration execution.
- A proposed unauthenticated job-runner POST was rejected by automatic approval
  review because it might trigger work. It was omitted; code and local tests
  were used instead.
- The current user checkout was preserved; fixes use an isolated worktree.

## Findings, ordered by priority

### High: service startup can log application secrets — fixed in branch

`infra/aws/systemd/caddy.service` loads `/etc/app.env` and previously ran
`caddy run --environ`. That flag prints the environment at startup, potentially
including application credentials in the service journal. This is confirmed in
the repository and reproduced locally with a harmless sentinel; live logs were
not accessed, and actual historical disclosure is unverified.

Removed `--environ`. This prevents future startup dumps; it does not erase old
logs or rotate credentials. Before the deadline, the deployment owner should
restrict/review journal and log-export access, identify which secrets were present
at affected startups, and rotate those potentially logged. Do not paste log values
into issues or this report. Coordinate rotation to avoid interrupting staging.

### Critical advisory / high priority: vulnerable Next.js and image processing — patched in branch

The baseline locks Next.js **15.5.25** and Sharp **0.35.4**. The
[upstream image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
describes possible remote code execution through affected image processing on
glibc Linux. The documented AWS target is Amazon Linux 2023; image optimization
and server-side media handling make this a priority. Exploitability was not tested.

Updated Next.js and matching ESLint configuration to **15.5.28**, and both direct
Sharp dependencies to **0.35.5**, including the generated root lockfile. These are
the documented patch versions; Next.js also fixes a Server Actions denial-of-service
advisory. Reviewed the
[Next.js release](https://github.com/vercel/next.js/releases/tag/v15.5.28) and
[Sharp release](https://github.com/lovell/sharp/releases/tag/v0.35.5).

### Medium: missing browser security headers — fixed in branch

Live homepage HTTPS response lacked HSTS, CSP, X-Frame-Options,
X-Content-Type-Options and Referrer-Policy, and advertised `X-Powered-By: Next.js`.

The Caddy configuration now covers both Next.js and `/rest/v1/` responses with:

- HSTS `max-age=86400` (no preload or subdomain commitment).
- `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- CSP `frame-ancestors 'self'; object-src 'none'; base-uri 'self'`.
- Removal of `X-Powered-By`.

This is a limited CSP baseline, **not script/XSS enforcement**. A strict script
policy requires a nonce and external-resource inventory. Cross-origin framing of
the hosted app will be blocked; review any intended LMS embedding before merge.
The normal deployment script installs and reloads the changed Caddyfile.

### High/medium: remaining dependency advisories — follow-up required

Root-workspace `npm audit --omit=dev --json` reported **18 affected packages**
(2 critical, 14 high, 2 moderate) before patches and **17** (1 critical, 13 high,
3 moderate) afterwards. These are package counts including inherited findings,
not 17 independently exploitable staging vulnerabilities.

| Package/group | Reachability and next action |
| --- | --- |
| DOMPurify 3.4.15, via PostHog (critical advisory) | Browser dependency. Inspected PostHog tour sanitizer does not use the reported `SAFE_FOR_TEMPLATES`, DOM-output or `IN_PLACE` modes, so the critical path is not demonstrated. Update and verify analytics/tours; do not dismiss solely on this inspection. |
| Zod 4.6.5 and nested 4.5.4 (high) | Runtime request/spec validation; oversized constrained collections are relevant to resource exhaustion. Patch and run schema/generation suites; audit recommends a major Remotion change for some inherited findings, so forced remediation was not used. |
| Undici 6.29.0 (high) | Used by outbound source fetching. Public-address pinning helps SSRF but does not resolve transport/parser advisories. Patch within the 6.x line and rerun source-fetch tests. |
| fflate 0.8.2 (moderate) | `readSpecArchive` calls `unzipSync` on teacher-uploaded ZIPs. Existing byte/file caps do not prove protection from malformed ZIP64 parser loops. Patch to 0.8.3 or later and rerun archive tests. No malformed archive was sent to staging. |
| PostCSS, source-map-js, fast-uri | Primarily build/tool processing. No app feature accepting user CSS was identified; verify the dependency paths and patch in a separate tested change. Next.js still appears as moderate through PostCSS. |
| Remotion packages | Root audit includes the preview-video workspace; its studio is not the deployed Next.js server. Inherited Zod findings still require tooling updates. |

Deferred to separate, tested dependency changes to avoid an unreviewed bulk/forced
upgrade. **Owner: project maintainers; review by 2 November 2026 before 18:30 SGT**,
prioritizing runtime paths. This branch does not make the dependency audit clean.

### Medium: legacy SECURITY DEFINER helper lacks an object-access check — source finding

`supabase/migrations/20260923130000_publish_completeness.sql` defines
`spec_version_gaps(uuid)` as SECURITY DEFINER and reads spec/stage identifiers
without checking the caller's ownership/read permission. Its later `GRANT` does
not revoke default PUBLIC execution; AWS compatibility defaults also grant
functions to API roles. A caller knowing a spec UUID may obtain missing-stage or
child identifiers, including unpublished metadata. Actual deployed grants and a
cross-tenant example were not tested.

Restrict execution and add an explicit owner/staff authorization check, with
two-user database regression tests. Do not assume table RLS protects a definer
function. Deferred because the local Docker daemon is unavailable and a policy
migration should be validated against a disposable database before deployment.

### Medium: anonymous-account abuse protections need operational verification

The deployed public Auth settings confirm anonymous sign-in and Google sign-in
are enabled. Latest source/local configuration agrees. Public entry code checks
link eligibility before creating a guest and synchronizes split Auth/Data users.
This application guard does not prevent direct calls to public Supabase signup.
No CAPTCHA token is supplied by the guest helper; hosted CAPTCHA/rate-limit
settings were not available from the public settings response.

Verify hosted signup rate limits, CAPTCHA/bot protection, anonymous-user retention,
and cost budgets. Local demo/game rate limiters are process-local and reset on
restart; they do not provide a shared limit across instances. Do not enable a
CAPTCHA setting without adding its supported guest flow first.

## Checks that passed, with limits

- Homepage returns HTTP 200 and renders the game/teacher links. HTTP redirects
  to HTTPS with 308. Certificate validation succeeds, negotiated TLS 1.3; the
  certificate covers staging and expires 10 January 2027. Older TLS acceptance
  was not exhaustively tested.
- `/teacher` and `/admin` return sign-in screens, not protected content; their
  responses are private/no-store. A 200 on these screens is not an auth bypass.
- An unauthenticated GET to `/api/v3/attempts/00000000-0000-4000-8000-000000000000`
  returns 401 with a generic sign-in error. Source checks user identity, attempt
  ownership and school/public eligibility before using service-role data.
- Bounded anonymous data reads returned zero profile/source rows and 401 for
  `attempts_v3` and `platform_admin`. All 45 migration-defined application tables
  have RLS-enable statements. This does not prove deployed policy parity or
  cross-user isolation; no authenticated A/B account test was performed.
- Supabase anonymous users use the **authenticated** database role, so policies
  must enforce ownership/membership, not merely that role. See
  [Supabase guidance](https://supabase.com/docs/guides/auth/auth-anonymous).
- `/.env` and `/.git/config` return 404. Credential-pattern checks of tracked
  text files and 18 homepage script references found no private-key/provider-key
  matches. Browser JWTs were anon-role keys, not service-role keys. The test
  service-role JWT is a standard local Supabase demo fixture. Filename history
  checks found no tracked real `.env`/private-key files; full historical secret
  scanning, all lazy chunks and cloud secret stores were not covered.
- Callback without an OAuth code and with an external `next` target stays on
  staging. Local redirect tests cover protocol-relative and unsafe targets.
- Source-fetch code validates public addresses and pins DNS resolution. React
  handles normal text escaping; inspected raw-HTML uses are static theme/input
  scripts and structured data. No SQLi/XSS/SSRF exploit was attempted.
- Job-runner code rejects missing/wrong secrets and uses timing-safe comparison;
  local authorization tests pass. No live job-runner request was sent.

## Verification of this branch

- Header regression failed before the fix and passes after it, exercising both
  upstream routes with 200, 401 and 404 responses using Caddy **2.9.1**.
- Regression detects restored `--environ` with a harmless sentinel and detects
  removed frame protection. Official Caddy binary checksum verified; config
  adaptation/validation passes.
- 801 unit/API tests pass; 32 generation asset/sprite tests pass. Relevant auth,
  redirect, guest-entry and image/archive tests also passed before patching.
- Typecheck and production build pass with dummy local Supabase configuration.
  Build required network access to download Google Fonts. Lint: zero errors,
  four existing image/hook warnings.
- Database and authenticated end-to-end suites were not run: Docker is not
  running, and no disposable staging test accounts were supplied. No checks
  were disabled to obtain passing results.

Run the proxy regression locally with:

```sh
python3 scripts/test-security-headers.py /path/to/caddy
```

Before the deadline: review/merge the PR, allow the normal staging deployment,
recheck live headers and login/public-play behavior, address the operational and
dependency follow-ups above, then submit **https://staging.pocketadventures.world/**.
No coursework submission was made by this assessment.
