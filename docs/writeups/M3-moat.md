# M3 — Moat

Owner: Damian, with Kevin on the runtime claims.

The honest starting point: the prompt is not the moat. Anyone can ask a model to invent
a historical scenario, and by next month the base models will do it better than ours
does. What is not reproducible by prompting is everything that stands between a
generated scenario and something a teacher can put in front of thirty students.

## 1. The deterministic compiler between the model and the world

The LLM never produces the map. It produces an **Adventure Spec v2** — a schema-validated
description of stages, rooms, stakeholders, evidence, objectives and decisions — and a
seeded, deterministic compiler turns that spec plus a curated tile set into the playable
map (D3). Reachability, collision and "the evidence you need is behind a door you can
open" are properties of the compiler, not hopes about the model's output.

Why this is a moat and not an implementation detail: a competitor prompting a model for
a level gets a plausible level and no guarantee. The guarantee is what makes the product
usable in a classroom, and it is earned with a validator, a repair loop and a compiler
that took days to get right — not with a better prompt.

## 2. A validated multi-agent state machine, not a chat transcript

Stakeholders are autonomous agents with private context (persona, motivations, hidden
interests, knowledge horizon) who move between rooms and talk to each other whether or
not the student is present (D8/D17). Above them sits a Resolver that maintains the
available options, resolves a stage probabilistically once every actor has committed,
writes the new world state and branches the stage (D9/D10).

The engineering that is hard to copy is the containment: private context never reaches a
client payload (FR-21, enforced at the database's column grants and tested negatively),
decisions are options-only from a Resolver-maintained list so the model cannot invent an
action the world cannot execute (D18), and the effect catalogue is a frozen enumeration
rather than free-form model output (D19). Each of those is a class of failure removed by
construction, and each was a deliberate narrowing that costs capability.

## 3. The teacher-corrected spec library, which compounds

Every published adventure is an immutable version of a spec that a teacher reviewed and
edited before it went to students. That produces something no amount of prompting
replicates: a growing corpus of *expert-corrected* pairs — what the model proposed, what
a history teacher changed it to, for real curriculum material. It is the natural training
and evaluation set for the planner, and it is generated as a by-product of teachers using
the product for their own reasons.

This is the only one of the three that strengthens over time, and it is the reason the
review step is mandatory rather than optional.

## 4. The distinction as a product primitive

Grounded historical claims carry source, page and quote; everything else is labelled as
an assumption; the debrief shows both plus the divergence. Competitors cannot bolt this
on late, because it constrains the generation schema, the runtime and the UI at once —
by the time it is retrofitted, it is a rewrite.

## What is *not* a moat, stated plainly

The models (anyone can call them), the Phaser renderer, the tile art, and the funnel
analytics. We claim the compiler, the contained multi-agent runtime, and the corrected
spec corpus — nothing else.
