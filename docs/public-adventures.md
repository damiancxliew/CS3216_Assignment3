# Public adventures

Adventures default to **School members**. In legacy adventures, open **Publish & share**;
for v3 adventures, open **Version history**. Set **Who can play** to **Anyone with the link**,
publish, and share the existing player link. This applies to all release links for that
adventure; it does not publish draft edits or add adventures to a public directory.

Anyone with a public link can enter without Google sign-in or school enrollment.
A Supabase anonymous session gives each guest a separate private attempt and resumes
progress in the same browser. Clearing cookies or signing out loses access to that
guest attempt. Guests do not receive school membership or authoring permissions.
Existing signed-in players keep their own identities and attempts.

Switching back to School members blocks outsiders from starting or continuing play.
Unpublishing or archiving closes public access. School members retain the existing
rules for continuing their attempts.

## Deployment

Apply `20261027000000_public_adventures.sql` before deploying the app. Enable
**Allow anonymous sign-ins** in the hosted Supabase Auth settings as well as the
local `supabase/config.toml` setting. Auth's anonymous sign-in rate limit continues
to apply. The split Auth/Data deployment also uses its existing `sync_auth_user`
RPC before creating a guest attempt.

Anonymous sessions use the existing Supabase Auth integration:
[Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).

## Verification

Service and entry-route checks:

```sh
npm test -- tests/api/attempts-v3.test.ts tests/api/v3-publish.test.ts tests/api/public-entry.test.ts --cache=false
```

With local Supabase running and migrations applied (does not reset data):

```sh
npm test -- tests/db/public-adventures.test.ts --cache=false
```

The isolated selector browser test covers successful and failed saves at desktop
and mobile widths (it stubs the server action, so it does not verify authorization):

```sh
RUN_PUBLIC_ACCESS_BROWSER_TESTS=1 npm test -- tests/browser/public-access.test.ts --cache=false
```
