# @adventure/spec-v3

The v3 `AdventureSpec`: the zod schema for a whole generated adventure, plus `validateSpec()` for
structural validation. Owner: Yi Hao. Changes to the contract go through Kevin.

```bash
npm run check --workspace @adventure/spec-v3   # typecheck + tests, from the repo root
```

| Export | What it is |
|---|---|
| `AdventureSpec` | The full generated adventure: stages, characters, discoveries, documents, triggers, defining moments, endings, story events, sources |
| `validateSpec(input)` | `safeParse` wrapper — returns `{ ok: true, spec }` or `{ ok: false, issues }`, never throws |
| `Condition` | Recursive condition union (type + schema); the engine re-exports it |
| `SpecStage` … `SpecEnding` | Inferred types for each sub-schema |
| `CheckIssue` / `CheckResult` | Future `checkSpec` contract types (PRD count/reference rules — not implemented yet) |

Every object is `z.strictObject`: unknown keys are rejected. The schema only enforces structure
(the `.min()`s already here); PRD counts like rooms 2–5 or stance rules live in `checkSpec`.
