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
not part of the public map projection. There is no actor collision, permission, knowledge, transcript,
transport/API, message, bubble, or renderer implementation here; live actor coordinate projection is
provided as a spatial primitive only. Interaction authorization and objective completion remain outside.

Map identity uses a deterministic FNV-1a helper for a non-security geometry identifier. It is not
authorization, authentication, persistence identity, or a save-integrity mechanism. Spatial functions
expect a validated StageMap. The map seed is public layout-only input and must never be reused for
resolution or private-context RNG. Initial compiled closed rooms are not a runtime lockout guarantee;
they are enclosed shells only, and the I1 room-kind adapter remains pending.

## Conversation versus physical interactions

Room conversation is broadcast to everyone present in that room, regardless of tile distance.
`areInSameRoom` checks geometric room membership only; it has no distance or door-state requirement.
`isInPhysicalInteractionRange` is for nearby physical actions, such as inspecting evidence, never chat.
The authoritative runtime still owns who was present when each message was sent, speech permissions,
and transcript projection. Sharing known evidence verbally remains room-wide. Doorway/outdoor chat
policy and knock/open-door proximity are separate integration decisions; this predicate does not
assign those spaces a room conversation.

## MVP spatial policy

- Actors are nonblocking for the MVP; actor collision, reservations, and deadlock strategy are future work.
- Live actor coordinates are globally visible through `projectActorPositions`, not initial `CompiledStage`,
  message text, bubbles, or private context.
- Room-wide speech remains limited to occupants; the server filters text before the client, not CSS hiding.
- Decision commits have no physical proximity gate; the retained decision anchor is decorative or optional UI.
- An authorized caller invokes `closeSpatialDoor`, which atomically closes the door and pushes doorway
  actors outside; overlapping the outside tile is legal.
- `walkActorTowardRoom` advances one deterministic tile per call. Player and NPC intents use the same
  movement checks; there is no instant presence change or teleport. A closed target waits without an
  automatic knock or opening action.
- I3 is deferred. The optional-research amendment remains unanswered, and the I1 adapter/team I2
  ratification remain pending.
- The server owns tick speeds, permissions, authoritative revisions, and atomic presence updates; this
  package does not introduce a unified gameplay state.
