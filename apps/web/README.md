# Historical Adventures — web app

The Next.js App Router app: landing, teacher console (brief, sources, publish,
share links), student play, debrief, and the Turn API under `src/app/api`.

## Commands

Run everything from the repository root:

```bash
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run build
```

## Environment

Environment variables live in `apps/web/.env.local` — Next.js does not read the
repository root. Copy [`.env.example`](../../.env.example) and fill in the keys
printed by `npx supabase start`.

See the root [README](../../README.md) for the full quickstart and
[`docs/PLATFORM.md`](../../docs/PLATFORM.md) for the platform notes.
