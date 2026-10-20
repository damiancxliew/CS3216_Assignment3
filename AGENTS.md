# AGENTS.md

## Product

Historical Adventures turns a teacher's history sources into a playable 2D adventure for one 45-minute lesson.
Target users are Singapore **secondary and junior college (JC)** history teachers and their students; adventures set a
reading level of `sec` or `jc`. **v3 is the product.**

## Sources of truth

- Requirements: `docs/PRD-v3.md`, `docs/PRD-v3-rationale.md`, `docs/prd-v3/` (overview, glossary, diagrams,
  playthrough) and `docs/v3-build/`.
- Code: the `/v3` routes in `apps/web/src/app/v3`, `apps/web/src/components/play/v3`, `apps/web/src/lib/play/v3`,
  `apps/web/src/lib/v3`, and the packages they import (`engine`, `spec-v3`, `play-contract`, `jobs` and the shared
  packages).
- Student actions are defined in `packages/play-contract/src/action.ts`.

## Do not use as guidance

These are retired. Do not read them for direction, cite them, or carry forward people, schools or feedback named in
them:

- `docs/archive/`
- `docs/specs.md`, `docs/EXECUTION_SPEC.md`, `docs/TEAM_PLAN.md`, `docs/KICKOFF_PROMPTS.md`,
  `docs/gameplay-review.md`, `docs/prd-v3/v2-vs-v3.md`
- Non-v3 play and teacher routes in `apps/web`

## Working on lessons and teacher materials

- Ground every lesson in the official MOE History syllabus for the level (Lower Secondary, Upper Secondary or
  A-Level) and the teacher's own scheme of work, textbook and sources. Quote the syllabus wording; do not paraphrase
  it from memory. Link to syllabus documents rather than committing them.
- Ask for the level, topic and the teacher's materials before designing a lesson. Do not assume a particular teacher
  or school.
- Tie each game mechanic to a named syllabus outcome, historical concept or assessed skill, and state what the
  teacher can see as evidence of it. Present learning claims as hypotheses for the teacher to judge, not as proven.
- Teacher-facing documents speak the teacher's language: lesson parts, outcomes and skills, not internal
  requirement IDs or implementation detail.
- Verify historical claims against sources. Label anything invented; never present it as fact. Handle sensitive
  history (violence, race, religion) without graphic detail, and flag it for teacher review.

## Commands

```bash
npm run lint
npm run typecheck
npm run build
npx vitest run tests/api tests/unit   # no database
npm run db:test                       # needs local Supabase running
```

Running v3 locally (feature flag, seed data, sign-in) is described in `README.md` under "Running the v3 version
locally".
