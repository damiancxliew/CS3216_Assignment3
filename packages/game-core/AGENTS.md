# Game-core package conventions

## Commands

- `npm run fixture`: regenerate the checked-in settlement fixture artifact only.
- `npm run typecheck`: strict TypeScript checking with no emit.
- `npm test`: deterministic unit tests.
- `npm run test:browser`: Chromium Node/browser parity test using the bundled source entry.
- `npm run check`: typecheck followed by unit tests.

Before `npm run test:browser`, install Chromium with `npx playwright install chromium`; CI additionally installs
Linux system dependencies with `npx playwright install --with-deps chromium`.

Run commands from `packages/game-core`, or use `npm --prefix packages/game-core <command>` from the repository root.

## Limits

This package is a primitive proposal, not frozen I2 ratification. It compiles an explicit spatial-only
layout projection and does not validate or adapt the I1 AdventureSpec. Public geometry is separate from
server initialization: spawn, placements, and initial door states are compiled runtime initialization,
not part of the public map projection. There is no actor collision, permission, knowledge, visibility,
interaction authorization, objective completion, LLM, Jev, or Phaser implementation here.

Map identity uses a deterministic FNV-1a helper for a non-security geometry identifier. It is not
authorization, authentication, persistence identity, or a save-integrity mechanism. Spatial functions
expect a validated StageMap. The map seed is public layout-only input and must never be reused for
resolution or private-context RNG. Initial compiled closed rooms are not a runtime lockout guarantee;
they are enclosed shells only, and the I1 room-kind adapter remains pending.
