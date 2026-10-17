# @adventure/play-contract

The v3 play contract: zod schemas and types for everything that crosses between the engine, the API and the
student screens. Owner: Kevin. Changes go through Kevin and are announced to Yi Hao and Damian.

```bash
npm run check --workspace @adventure/play-contract   # typecheck + tests, from the repo root
```

| Export | What it is |
|---|---|
| `Action` | Everything a student can do. The API parses request bodies with it; strict objects, bounded strings (C10) |
| `PlayerView` | What the client may see, built by `engine.project` from public fields only |
| `GameEvent` | Recorded events (`attempt_events_v3`), the input to the class summary |
| `ClassSummary` | The teacher's class summary (T2), class totals only |

The post-turn check result is **not** an `Action`. The engine exports it as an internal action, so a client can
never post a discovery.

## Change log
| Date | Change |
|---|---|
| D1 | First version. `Action` adds `enterRoom`, `openDocument`, `closeDocument`, `continue` and `tick` to the brief's seven; no `showDocument` (slants are confronted by inserting a note). `GameEvent` adds `challenge`, `outcome`, `storyEvent` and `phase`. |
