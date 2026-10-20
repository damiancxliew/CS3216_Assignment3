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
| `checkSpec(spec)` | Semantic checks: `checkSkeleton` plus the detail-only rules (conditions, stances, triggers, reachability fixpoint, …) |
| `SkeletonSpec` / `SkeletonShape` | The structural first pass a full spec satisfies; `validateSkeleton(input)` mirrors `validateSpec` |
| `checkSkeleton(s)` | The skeleton-level rules (refs, endings, counts, citations); identical paths on a full spec |
| `Condition` | Recursive condition union (type + schema); the engine re-exports it |
| `unconditionalOutcomeIds(moment, actId)` | Unconditional outcomes in authored rule order: first fallback, then alternatives for closed endings |
| `SpecStage` … `SpecEnding` | Inferred types for each sub-schema |
| `CheckIssue` / `CheckResult` | `{ code, path, message }` issues, split into `errors` and `warnings` |

Every object is `z.strictObject`: unknown keys are rejected. The schema only enforces structure
(the `.min()`s already here); PRD counts like rooms 2–5 or stance rules live in `checkSpec`.

A document holds at most two core discoveries, matching the two-passage limit and the
one-discovery-per-passage rule. Secret unlock conditions must describe positive achievements;
`checkSpec` rejects negation there even on generated specs without authoring metadata.
The persona and editor checks require at least one prerequisite for hidden-stance entry,
in addition to the action that fires the trigger. Authored guards retain their meaning.
