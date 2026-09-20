# Team plan — CS3216 Assignment 3

Companion to [`PRD.md`](PRD.md). Deadline **Fri 25 Sep 2026, 23:59** — that is **6 calendar days from
Sun 20 Sep**, so this plan is a sprint, not a roadmap. Everything here is sized to that.

Team: **Kevin** (Zhang Li), **Yi Hao** (Hon), **Di Heng** (Hoo), **Damian** (Liew Cho Xiang).

---

## 1. Workstream ownership

Each person owns one vertical slice end-to-end (code + the write-up milestones that describe it), so
nobody blocks on a review to keep moving.

### Kevin — AI orchestration (the Resolver and the agents)

The hardest and highest-risk slice; it is also the thing the coolness score rides on.

- Resolver/Orchestrator service: observes room transcripts, recomputes available decision options,
  resolves a stage from all parties' actions into structured deltas (per-agent state, world context,
  public announcement, branch target).
- Character-agent runtime: one context window per agent (shared historical context + private persona +
  personal memory), room-scoped visibility, no cross-agent state.
- **Autonomous agent tick** (PRD D17/FR-12a–b): agents move, open/close doors and hold agent-to-agent
  conversations whether or not the player is present, symmetric with the player except that the stage
  decision is the player's. Ship it with the budget rails from day one — capped actions per stage,
  only stage-relevant agents ticked, yield when idle — or it eats the token budget.
- Probabilistic outcome model: action succeeds/fails/partially succeeds based on context, with the roll
  recorded server-side and never previewed to the player (PRD D10/D11).
- Model tiering + structured outputs (Zod schemas) + retry/repair policy.
- Prompt-injection guards and the action allow-list.
- Owns: FR-12 – FR-17, FR-20, FR-21.
- Write-up: **M7, M8, M9, M10, M13, M22 (optional)**.

### Yi Hao — Game client, map compiler and the PoC → product port

He built the PoC, so he owns the port.

- **Port the renderer to Phaser 3** (decided 20 Sep — PRD D16). Keep `core.ts` pure and authoritative;
  Phaser renders and tweens, one scene per stage, DOM panels stay outside the canvas, e2e asserts
  through the DOM plus a `GameState` test hook. Constraints in PRD §7.1.
- Port `PoC/src/core.ts` into a shared package usable by both browser and server.
- Extend the compiler from one scene to **rooms with doors** and up to 3 stages; keep the determinism
  and playability guarantees (FR-7 – FR-9).
- Client: movement (WASD + click-to-travel), room chat panel with chat bubbles, decision panel, journal,
  spectator mode, accessible interaction list.
- Latency handling: dialogue calls must never freeze movement (FR-22).
- Owns: FR-7 – FR-11, FR-17 (client side), FR-22.
- Write-up: **M15, M16, M17, M12**.

### Di Heng — Ingest, generation pipeline and evals

- PDF/text upload, server-side extraction, chunking with page references, content hashing, size limits.
- Retrieval over sources (pgvector) so generated claims carry source spans; hybrid search if time
  allows (optional M21).
- Planner LLM: documents → adventure spec (stages, stakeholders, rooms, evidence, objectives, decision
  options), schema validation, bounded repair, missing-information report.
- Asset generation: landmark/portrait images, prompt-hash cache, cost cap, teacher review gate.
- **Eval harness**: a fixed set of 5–8 source documents, automated checks for spec validity, map
  playability, source-span grounding, and persona adherence; results table for the write-up.
- Owns: FR-1 – FR-6, FR-24 (generation metrics).
- Write-up: **M11, M12 (generation side), M21 (optional)**.

### Damian — Platform, teacher/student product surface, launch

- Supabase project: schema from PRD §6, migrations, RLS so a teacher only sees their adventures and a
  student only their attempts.
- Auth (Google sign-in), adventure sharing links, publish/immutable versioning.
- Teacher console: upload form, generation progress, stage/stakeholder editor, targeted regeneration,
  preview-as-player, publish.
- Adventure settings incl. **per-stage timer length** (adventure-wide default, per-stage override,
  disable per stage — PRD D12/FR-16). The deadline is server-held on `attempt.stage_deadline_at`; the
  client only renders the countdown, so a refresh or a clock fiddle cannot buy time.
- Student surface: adventure list, resume with recap, ending/debrief screen with the documented-history
  vs simulation-assumption split (FR-19).
- Deployment on Vercel, env/secret management, analytics instrumented **on day 1** (M19 needs real data).
- Landing page (hero / features / pricing, SEO + OG tags), Product Hunt kit, README, submission packaging.
- Owns: FR-18, FR-19, FR-23, persistence and access control.
- Write-up: **M0, M1, M2, M3, M4, M5, M6, M14, M18, M19, M20** — the product/GTM half. Kevin reviews.

### Shared / whoever finishes first

- `AGENTS.md` kept current as the contract between slices (the PoC already does this well).
- Integration test: upload → generate → publish → play a full 3-stage adventure → ending.
- Demo video and the 2-page pitch PDF.

---

## 2. Interfaces to freeze on day 1 (Sun 20 Sep)

These four contracts unblock everyone in parallel; agree them before writing code.

1. **Adventure spec schema v1** (Di Heng ⇄ Kevin ⇄ Yi Hao) — the planner's output and the compiler's
   input. Extend the PoC's Blueprint v1 with `stages[]`, `rooms[]`, `agents[].privateContext`,
   `decisionOptions[].branchTarget`.
2. **Map artifact schema** (Yi Hao) — the compiler's output consumed by renderer and server.
3. **Turn API** (Kevin ⇄ Damian) — `POST /attempt/:id/message`, `POST /attempt/:id/decision`,
   `GET /attempt/:id/state`; response is always a *public projection* of state.
4. **Resolution payload** (Kevin ⇄ Damian) — the structured outcome the Resolver writes and the DB stores.

Put all four in `AGENTS.md` as the shared contract, with a stub implementation each, by Sunday night.

---

## 3. Day-by-day plan

| Day | Goal | Kevin | Yi Hao | Di Heng | Damian |
| --- | --- | --- | --- | --- | --- |
| **Sun 20** | Contracts frozen, repo scaffolded | Draft Resolver + agent prompt contracts; agent tick loop design | Scaffold Next.js monorepo; port `core.ts`; Phaser scene rendering the PoC map | Spec schema v1 draft; upload + extraction spike | Supabase project, schema, auth, shared OpenAI key in Vercel env, deploy of an empty app + analytics |
| **Mon 21** | Vertical slice: one hardcoded stage playable end-to-end | Single agent answering in-room with private context | Finish Phaser port (tweened movement, camera follow, click-to-travel); rooms + doors in the compiler; chat panel against a stub API | Planner prompt → valid spec for one test document | Turn API wired to DB; attempt create/resume |
| **Tue 22** | Generation → playable | Multi-agent + autonomous tick + Resolver updating decision options | Render a compiled generated map; decision panel | Repair loop, source spans, missing-info report; 3 test documents passing | Teacher console: upload, progress, stage editor |
| **Wed 23** | Stages, consequences, endings | Stage resolution, probabilistic outcomes, branching, spectator; timer expiry → pass → resolve | Stage transition as a Phaser scene swap; journal; accessible list | Asset generation + cache; eval harness v1 with results | Publish/versioning, sharing link, timer settings UI, ending/debrief screen |
| **Thu 24** | Freeze + polish | Prompt-injection tests, token budget, latency pass | UI polish, Playwright happy path | Eval results table + a second full document set | Landing page, README, analytics screenshots |
| **Fri 25** | Submit by 23:59 | M7–M10, M13 write-up | M12, M15–M17 write-up | M11 write-up | M0–M6, M14, M18–M20 write-up, pitch PDF, demo video, packaging |

**Feature freeze: Thu 24 at noon.** After that, only bug fixes, the write-up and the demo.

---

## 4. Milestone → owner → evidence

20 graded milestones. M1, M2, M3, M14 are 2.5% each; the rest ≈3.75%.

| M | Deliverable | Owner | Evidence needed by Fri |
| --- | --- | --- | --- |
| 0 | Problem statement | Damian | `specs.md` §2 condensed |
| 1 | 3 competitors + why we win | Damian | Comparison table (e.g. Twine/Inklewriter authoring, character-chat apps, generic LLM tutors) |
| 2 | App description, objectives, user stories | Damian | PRD §1/§3 |
| 3 | Moat | Damian + Kevin | Deterministic compiler + validated multi-agent state machine + teacher-corrected spec library — not clonable by prompting alone |
| 4 | Target users + acquisition | Damian | Teacher channels, school pilots |
| 5 | MVP scope + future features | Damian | PRD §8 |
| 6 | Pricing/monetisation | Damian | Per-seat/per-class tiers vs inference cost per adventure (use real numbers from M12) |
| 7 | How and why LLMs | Kevin | PRD §2, §4 |
| 8 | 2–3 prompts explained | Kevin | Planner prompt, persona prompt, resolver prompt + techniques |
| 9 | Model/provider justification vs 2 alternatives | Kevin + Yi Hao | OpenAI-only decision (D14) + per-tier model table with measured latency/cost; alternatives = multi-provider router, single model everywhere |
| 10 | AI interaction patterns | Kevin | Structured outputs, multi-agent orchestration, RAG, tool/action allow-list, repair loop |
| 11 | Eval dataset + strategy + results | Di Heng | Eval harness output, before/after prompt change |
| 12 | Production optimisation + metrics | Yi Hao + Di Heng | Caching, tiering, streaming, parallel agent calls; latency/cost deltas |
| 13 | Risks + ≥2 safeguards + threat model | Kevin | Injection guard, action allow-list, private-context isolation, rate limits |
| 14 | Name + logo | Damian | Name rationale + alternatives |
| 15 | Tech stack choices + alternatives | Yi Hao | PRD §7 |
| 16 | 3 common workflows | Yi Hao | Teacher generate-review-publish; student explore-chat-decide; resume |
| 17 | AI-specific UI decisions | Yi Hao | Resolver-maintained option list (why options, not free text — D18), surfacing what NPCs did offscreen, source-vs-simulation labelling, generation progress + repair states, regenerate-this-element |
| 18 | Landing page, SEO, OG | Damian | Live URL |
| 19 | Analytics + insights | Damian | Screenshot + what we changed because of it |
| 20 | Product Hunt kit | Damian | Copy, assets, first comment |
| 21* | Advanced RAG | Di Heng | Hybrid/graph retrieval over sources, if time |
| 22* | Multi-agent orchestration | Kevin | Already core to the product — near-free points, write it up properly |
| 23* | MCP | — | Skip unless a genuine reason appears |

M22 is essentially already in scope; M21 is the cheapest remaining optional. Do not touch M23.

---

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Resolver is the critical path and the hardest piece | Kevin ships a dumb deterministic resolver on Mon so the rest of the game works; the LLM version swaps in behind the same interface |
| Autonomous agents blow the token budget or wander pointlessly | Budget rails are part of the first implementation, not a later optimisation (FR-12b): capped actions per stage, only stage-relevant agents ticked, idle agents yield. If cost is still wrong on Wed, drop the tick rate rather than the mechanic |
| Generated adventures are unplayable | Deterministic compiler + independent validator + bounded repair; never publish an invalid map (already proven in the PoC) |
| Latency makes the game feel dead | Stream dialogue, pre-warm agents on room entry, resolve stages asynchronously with an in-world "the day ends" beat |
| Cost blowup during demos | Per-attempt token budget, cheap tier for chat, prompt-hash cache for images, cap generated images per adventure |
| Analytics has no data by Friday | Deploy and instrument on **Sunday**, not Thursday (M19 needs a few days of events) |
| Everyone blocked on one schema | Freeze the four contracts Sunday night with stubs behind each |
| Phaser port overruns and blocks the vertical slice | The port is renderer-only — `core.ts`, the compiler and their tests are untouched. If Phaser is not rendering the PoC map by Sunday night, ship Monday's slice on the existing Canvas renderer and finish the port after the slice is green |
| Scope creep into multiplayer | Explicitly out (PRD D2); the player-as-agent abstraction keeps the door open without paying for it now |
