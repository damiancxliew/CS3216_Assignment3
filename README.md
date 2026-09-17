# AI-Generated Historical Adventures

Turn historical material into a world students can explore, question, and change.

A web application that transforms historical teaching material into playable 2D adventure games. Teachers supply source documents, a historical setting, and learning objectives; an LLM generates an explorable map populated with stakeholders, evidence, and interconnected objectives. Students enter the world as a character, investigate, converse with AI-controlled stakeholders, and make decisions that change the game state.

## Core features

- **AI-generated playable worlds** — historical material becomes a navigable environment with meaningful locations, character placements, evidence, and objectives, all generated together as one coherent adventure.
- **Interactive AI-driven gameplay** — stakeholders respond to the student's questions, discoveries, and decisions within a persistent world where consequences carry forward.

## Users

| User | Primary need |
| --- | --- |
| Secondary-school history teachers | Create curriculum-relevant adventures from their own material without game-development skills |
| Secondary-school students | Explore historical situations through objectives, interactive characters, and consequential choices |

## Key flows

**Teacher:** create an adventure and learning context → provide material → generate map, characters, evidence, objectives → preview as a player → correct or regenerate selected elements → publish and share → review attempts.

**Student:** join an adventure and read the role brief → explore locations and meet stakeholders → ask questions, compare accounts, collect evidence → complete objectives and make decisions → observe persistent changes → reach an ending and reflect.

## Scope

Included: individual student sessions, generated maps with 3–5 meaningful locations, one player role and 3–4 AI stakeholders, roughly 4–6 decision rounds, evidence collection and a journal, teacher preview/editing/publishing, saved progress, and an ending with attempt review.

Excluded: unrestricted generation across all periods, full-scale historical cities, multiplayer, combat and voice interaction, arbitrary generated game code, and automated grading.

## Success criteria

Different inputs produce meaningfully different adventures; generated worlds are completable; NPC interaction changes available information and options; player choices persistently change the world; teachers get a usable adventure without extensive repair; students can complete and resume unaided; students can distinguish historical evidence from simulated outcomes.

Full product requirements are in [`docs/specs.md`](docs/specs.md).
