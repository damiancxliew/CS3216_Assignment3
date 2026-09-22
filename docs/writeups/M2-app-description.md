# M2 — App description, objectives and user stories

Source: `docs/PRD.md` §1/§3, `docs/specs.md` §1/§3.

## In one line

A teacher drops in historical source material; the system generates a small, playable 2D
world where a student roams rooms, talks to LLM-driven historical stakeholders who each
have private motivations, and makes decisions whose consequences are resolved
probabilistically and carried forward.

## Objectives

1. **Turn a teacher's own sources into a playable adventure in minutes**, without game
   design, writing or programming.
2. **Make historical constraint tangible** — incomplete information, competing
   interests, time pressure — by requiring the student to act inside it rather than
   describe it.
3. **Never blur invention and record.** Every historical claim is grounded in a cited
   span of the teacher's source; everything else is labelled as a simulation assumption,
   and the debrief shows where the student's story diverged from what is documented.
4. **Be usable in a real class period**: ~15 minutes, one shared link, thirty students on
   the same frozen version, resumable if a laptop dies.

## User stories

### Teacher

- As a teacher, I paste the three pages I am teaching from and get back a proposed world
  — locations, stakeholders, evidence, objectives, a decision per stage — so I don't
  design a game.
- As a teacher, I review and edit any generated element and request targeted
  regeneration, so the history is mine and not the model's.
- As a teacher, I set how long each stage runs (and disable the timer for a
  research-heavy stage), so the lesson fits the period.
- As a teacher, I publish and get one share link, and publishing freezes the version, so
  the class I am teaching now is not disturbed by an edit I make tomorrow.
- As a teacher, I see who has joined and how far they got, so I know what to debrief.

### Student

- As a student, I open the link, sign in and get a role and a brief — not a quiz.
- As a student, I walk between rooms and question stakeholders who each want something
  different and won't all tell me the truth.
- As a student, I collect evidence into a journal so I can justify what I decide.
- As a student, I commit to one of the options the situation actually allows, before the
  stage deadline, and I don't get to preview the consequences.
- As a student, I close the tab and come back later to exactly where I was, with no extra
  time on the clock.
- As a student, I finish and read a debrief that separates what really happened — with
  the page and the quote — from what the simulation assumed, and shows where my story
  left history behind.

## What ships in the MVP

In: teacher sign-in, sources → generated spec → stage editor → publish; 1–3 stages; 3–4
stakeholders; rooms with doors and shared chat; autonomous NPC agents with private
context; movement; Resolver-maintained decision options; probabilistic resolution;
per-stage timers; persistence and resume; ending debrief with source/simulation
labelling; ambient overlays and curated effects; landing page; analytics; eval harness.

Out, explicitly: multiplayer, voice, combat, free-text decision *proposals*, mobile
layout, classroom management/grading, and generated game code.
