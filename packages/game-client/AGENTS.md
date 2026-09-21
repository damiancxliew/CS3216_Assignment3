# Game-client package conventions

## Commands

- `npm run dev`: start the Vite playground at `http://127.0.0.1:5174`.
- `npm run typecheck`: strict TypeScript checking with no emit.
- `npm test`: pure model and pointer unit tests; no browser install required.
- `npm run build`: build the standalone demo; the reusable entry is exported as TypeScript source.
- `npm run test:e2e`: run `npm run build` first, install Chromium with `npx playwright install chromium`, then run the Playwright demo tests.
- `npm run check`: typecheck, unit tests, and production build.

Run commands from `packages/game-client`, or use `npm --prefix packages/game-client <command>` from the repository root.

## Architecture and limits

This is a reusable DOM plus Phaser map playground using a synthetic public fixture. It does not import the
compiled server fixture or the obsolete PoC gameplay and does not implement chat, evidence collection,
decisions, resolution, transport, persistence, server authority, or fake networking. `@adventure/game-core`
owns geometry, doors, collision, movement, and pathfinding. The client model receives trusted validated
maps through the core adapter and is not an unknown-blob validator.

The browser demo exposes only detached public map and actor-position snapshots through its development-only
`__MAP_PLAYGROUND__` hook. Live actor coordinates are globally visible for this sandbox; this is not a
privacy or backend proof. Room conversation, speech permissions, message history, and transcript filtering
remain server responsibilities. Snapshot output omits the compiler placement list; public synthetic layout
definitions are intentionally bundled, while private adventure data is not present.

Actor collision and reservation policy, I3 integration, the I1 room-kind adapter, and team I2 ratification
remain future work. Decision anchors are decorative in this slice and commits have no spatial gate. Door
controls are explicitly demo-only; callers still own authorization and authoritative revisions.

Keyboard repeats run on an independent 160ms timer rather than OS key repeat. Keyup, canvas blur, window
blur, hidden documents, and destroy clear held keys; the latest pressed direction wins and manual movement
remains available while paused. Async mounting must be awaited before destroy.
