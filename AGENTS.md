# AGENTS.md

## Product

Historical Adventures turns a teacher's history sources into a playable 2D adventure for one 45-minute lesson.
Target users are Singapore secondary-school history teachers and their students. **v3 is the product.**

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

## Current work: teacher lesson materials

- Lesson: **Sec 2 History, Unit 3, the Japanese Occupation**, built in v3.
- Curriculum: MOE 2021 Lower Secondary History syllabus
  (<https://www.moe.gov.sg/api/media/ae214ffc-611a-42e5-921d-388a44ceb416/2021-History-Lower-Secondary-Syllabus.pdf>).
  Unit 3 key knowledge: "repression and resistance" and "economic hardships and resilience". Guiding questions 1–2.
  Concepts: accounts, causation, change and continuity, diversity, significance. Link to it; do not commit the PDF.
- Sec 2 assessment: source-based questions (inference, comparison, purpose) and structured questions (identify,
  describe, explain).
- No specific partner teacher or school is assumed.
- The teacher report leads by breaking down a normal history lesson along the syllabus inquiry phases (sparking
  curiosity, gathering evidence, exercising reasoning, reflective thinking), then shows how the game does each part.
  Keep it short and structural; do not detail how individual characters reply. Present learning claims as hypotheses
  for the teacher to judge.
- Verify historical claims against sources; never present invented detail as fact.

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
