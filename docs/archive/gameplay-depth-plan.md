# Gameplay depth plan (from teacher meeting + NUS app feedback, 6 Oct 2026)

Sources: meeting notes with Gabriel (teacher, RGS) and `NUS_App_Feedback.docx` (educator + student perspectives).
Both point the same way: **from "talking to history" toward "reasoning about history".**

## Priority 1: Character depth (main complaint: "AI responses feel generic")
- **Persona cards** per historical figure: goals, fears, red lines, **what they know / don't know at that moment**,
  what they'd **hide or spin**, speaking style, and **authentic snippets** (e.g. Lee Kuan Yew's memoirs) to quote.
- **Human, not perfectly coherent**: uncertainty, hedging, occasional inconsistency; every decision carries
  political risk. Historical actors lacked perfect information.
- **Strategic withholding / distortion**: NPCs sometimes evade or slant answers, so students ask
  "why is this person telling me this?"
- **Input pending**: the teacher's pilot ChatGPT prompt for character responses (follow up to get it).

## Priority 2: Make probing pay off (also fixes "not sure how to succeed" / "stage objectives unclear")
- **Layered reveals**: deeper concerns or conflicts unlock only when the student asks a good probing question
  (motives, fears, trade-offs), not on generic questions.
- **"Insights discovered" tracker** per character (e.g. 3/5 of Tunku's concerns found): a visible objective that
  doesn't spoil the history.
- **Timed hints** (e.g. one every ~2 min) instead of an always-visible guide; teacher prefers hiding or making the
  minimap optional to force exploration.

## Priority 3: Evidence you have to judge
- **Conflicting primary sources** (speeches, newspapers, memoirs) tagged with **provenance and purpose**; players
  assess reliability, not just collect information.
- Occasionally **biased, incomplete, or later-contradicted** evidence.
- Source diversity per episode, so the game doesn't reproduce one source pack's bias.

## Priority 4: Debrief becomes an argument
- **Causal map** of the player's choices: decision → reaction → consequence → new constraint → later decision;
  compare with the actual historical sequence.
- **Historians' competing interpretations** in the debrief.
- An **evaluative final question** answered with evidence gathered in-game, e.g. "Was separation inevitable by this
  stage?", "Which factor was most important?", "Which evidence most changed your interpretation?"
- Keep **counterfactual outcomes visibly speculative**; avoid probabilities that read as historical fact.
- Optional: student reflection prompt after the debrief (educator asked about reflection).
- Keep (praised): hidden consequences before decisions; the debrief's distinction between documented events,
  simulated dialogue, game assumptions, and counterfactuals.

## Quick wins (cheap, do first)
- **Room conversation bar too small**: hard to scroll and read.
- **Scenario 3 map failed to start** (educator report: 4 Oct, 6:47pm). Reproduce and fix.
- **Persona cap of 4** → support more; e.g. let students **dialogue with the British** in Scene 1.
- **Fit one 1-hour lesson**: tune time limits and chat depth (the educator ran out of time to probe).

## Later (not this week)
- **Multiplayer**: UN-style structured debate (clear roles, scheduled turns; AI fills the remaining roles), or pairs
  on one persona / different personas then compare. Unstructured multiplayer risks group-chat behaviour. Ties to
  the MOE social-mixing directive (cross-school play).
- **Teacher analytics**: review the questions students ask; post-game summary of FAQs and common misunderstandings
  (also surfaces quieter students' thinking).
- **Content upload** without full regeneration; clarify the max number of documents.
- **IP / data ownership**: RGS has a stake; **Xiao Hua** is the contact.
- Team offered to help build initial pilot content.
- Open educator questions to answer: rationale for the platform; why the Merger unit was demoed instead of the unit
  presented; how it supports group-based learning; whether time limits are intentional.

---

# Gameplay loop design (DRAFT, under discussion, 8 Oct 2026)

**Status:** draft. The earlier session transcript is input, not a record of decisions. Nothing below has been
decided except the scope.

## Scope (agreed)
- Core gameplay improvements, made before any demo or pilot.
- Web and external sources ship before the pilot.
- Out of scope for now: the teacher FAQ/flag surface, ranked-priority decisions, multiplayer and analytics.

## Glossary of mechanics (as built, @ `9abd46f`)

### Content and structure
- **Adventure spec**: the planner LLM writes it once from the teacher's sources. Nothing is authored during play
  except minted options.
- **Stage**: one map. It has 2–5 rooms, 1–4 agents, 1–6 evidence items, 1–8 objectives and exactly one decision. An
  adventure has 1–3 stages.
- **Room**: enclosed or open, with a door that can be open or closed and an optional landmark.
- **Stakeholder**: a historical figure across the whole adventure. There are 3–4, each with name, role and a grounded
  summary.
- **Agent**: a stakeholder placed in one stage. It has a start room, a `publicPosition`, a `privateContext` and a
  `modelTier`.
- **Private context**: `persona`, `motivations`, `hiddenInterests` and `knowledgeHorizon`. It is grounded and stays
  server-side.
- **Ending**: a simulated `summary`, a grounded `historicalOutcome`, a `divergence` note and 2–4
  `reflectionQuestions`.

### Grounding
- **Source span**: `{sourceId, page, quote}`, checked against the extracted page text.
- **Assumption**: a named invention, with a rationale, that the debrief can flag.
- **Grounded text**: text that must cite at least one span or assumption.

### Space and presence
- **Movement**: one tile per step, with no teleporting. "Go somewhere" auto-walks the player to a room.
- **Hearing**: speech reaches everyone in the same room. A closed door makes the room private. The server filters
  the transcript per actor.
- **Knock**: the player knocks on a closed door and an occupant opens it straight away, with no model call.
- **Recall**: each NPC also gets the lines it heard earlier in other rooms.

### Conversation
- **Player message**: addressed to a person or to the room. For room messages, a router picks who answers.
- **Character turn**: a mid-tier LLM call. Possible actions are `speak`, `move_room`, `open_door`, `close_door`,
  `knock`, `share_evidence`, `record_private_note`, `commit_decision`, `goal_evidence`, `pass` and `yield`. Replies to
  the player cannot move the NPC (`move_room` is filtered out).
- **Autonomous turns**: these happen only when evidence is shared and when the stage ends with the decision. NPCs
  never act unprompted in ordinary play.
- **Withholding**: the agent prompt tells NPCs to hold back secrets until earned, never steer, and pursue a "modest
  aim".
- **Private note**: the NPC's evolving aim, view of the player, boundary and next trigger. Only the latest note is fed
  back. Nothing ever acts on "next trigger".
- **Deflection**: a canned in-character line used when the rate limit or the 60k-token stage budget runs out.

### Progress
- **Objective (goal)**: `{title, targetId, requires}`. The target is an agent or an evidence item. Objectives form a
  DAG and gate the decision through `decision.requires`. An objective carries no authored content describing what
  the character should convey.
- **Goal claim → goal check**: the NPC proposes that its line met a goal, then a cheap judge confirms it (at most 2
  attempts). The judge checks topic and substance, not the question the student asked.
- **Evidence (scroll)**: picked up by walking onto it or inspecting it when nearby. It goes into the **journal**
  together with its source span.
- **Account clue**: two NPCs give different grounded accounts of one question, plus a document. A side is revealed
  when a student question shares at least half the question's keywords and that NPC replies.
- **Share evidence**: in the API only, with no UI button. The NPC who witnesses it reacts for one turn. It has no
  mechanical effect.

### Guidance
- **Next step panel**: the first available goal, shown with a "Talk to X / Read Y" button that auto-walks there.
- **Case board**: tabs for Goals, Evidence and Decision. Each goal has two hint levels: a clue based on the character's
  role, then "Ask X in room Y".
- **Walkthrough**: the first-run UI tour.
- **Timer**: one per stage, held on the server, 480s by default. A warning appears at 120s. When it expires, the stage
  resolves as a pass.

### Decision and resolution
- **Decision option**: 2–4 authored options. Each has a `stance` (cooperative, neutral, evasive or antagonistic),
  `preconditions` (objective ids) and a `branchTarget` (next stage or an ending).
- **Minted option**: an extra option proposed from the transcript after at least 6 new lines, up to 2 per stage. It
  must reuse an authored branch target.
- **Commit and ledger**: the player commits, NPCs get 2 turns to commit, and everyone else passes.
- **Roll**: p = stance base (0.45–0.60) + 0.03 × mean disposition + 0.04 × min(evidence count, 4) ± 0.04 for each NPC
  who committed for or against (capped at ±0.15), clamped to 0.05–0.95. The seed is deterministic. **The roll changes
  dispositions, the announcement and the effects, never the branch**, which comes from the chosen option alone.
- **Disposition**: −5 to +5 per stakeholder. It changes only at resolution, never during conversation, and carries
  over to later stages.
- **Stakeholder memory**: after each stage, a "reaction" text is added to that stakeholder's notes in the next stage.
- **Scene effects**: visual effects chosen by stance and success, such as confetti or smoke.

### Debrief
- Includes the path (choice, announcement and changes for each stage), the simulated outcome, documented history with
  citations, assumptions, divergence, reflection questions and the evidence collected.

### Proposed terms (not decided)
- **Insight**: an authored, grounded concern held by one character, which the student can uncover.
- **Reveal condition**: the line of questioning that earns an insight.
- **Layer**: a surface insight that unlocks a deeper, guarded one.
- **Insight tracker**: "N/M concerns found" per figure.
- **Pressure point**: presenting this document (or another character's account) to this character makes something
  happen.
- **Leaning**: an NPC's current stance toward each decision option. It moves during the stage.
- **Beat**: an authored event triggered by time or by a condition, which makes NPCs act unprompted.
- **Outcome tier**: strong, contested or failed. It is set by the stage state and explainable.
- **Timed hint**: a hint that unlocks with time rather than being always visible.
- **Provenance tag**: the type, author, purpose and reliability of an evidence item.
- **Web source**: an approved external page, ingested as a source of `kind: 'web'`.
- **Causal map**: the debrief view running from decision to reaction to consequence.
- **Evaluative question**: a final question answered by citing gathered evidence.

## Diagnosis
Inside a stage, nothing the student does changes the world or the outcome except which option they pick.
- Disposition changes only when the stage resolves.
- Evidence affects the odds only by how many items were found.
- `share_evidence` has no effect and no UI.
- NPCs never act unprompted.
- The roll never changes the branch.

Depth exists in the spec (`hiddenInterests`, `motivations`), but nothing in play depends on it:
- The planner is told objectives must not require secrets (`planner/prompt.ts`).
- The NPC is told that goals never override withholding (`agent/prompt.ts`).
- Objectives have titles but no authored substance.

## Infrastructure constraints
- `PlaySession` (`apps/web/src/lib/play/session.ts`, about 1470 lines) holds the rules, the LLM orchestration and the
  projection to client state in one class.
- The snapshot is a jsonb `PlaySnapshot` with `version: 1`. Backward compatibility is handled with optional fields.
  Saves use optimistic `revision` checks (`store.ts`).
- Every asynchronous LLM job (reply, mint, goal-check) is built the same way: a `pending*` snapshot field, a `*Ready`
  flag on `PlayState`, a dedicated `/api/attempt/[id]/*` route, and `begin`/`produce`/`complete` methods.
- The spec is `SPEC_VERSION = 2`. Attempts pin a published version.
- Source kinds are only `pdf | text`. Ingest has span verification (`ingest/spans.ts`). There is no web search
  capability anywhere in the packages.

## Draft loop: Probe → Confront → Rally → Commit → Consequence (+ Beats)

| Step | Student does | World changes | Replaces or extends |
|---|---|---|---|
| Probe | Asks characters questions | Layered **insights** are uncovered | Objectives that target agents; unused private context |
| Confront | **Presents** a document or another character's account | A **pressure point** unlocks a guarded layer or moves a **leaning** | `accountClues`, `share_evidence` |
| Rally | Argues using what they found | NPC **leanings** per option move and are roughly visible | End-of-stage NPC commits; disposition that changes only at resolution |
| Commit | Chooses an option | Insights unlock options, instead of a checklist | `decision.requires` checklist |
| Consequence | — | The stage state picks an **outcome tier**, with a recorded reason | A roll that never changes the branch; evidence counted by quantity |
| Beats | — | Timed or conditional events make NPCs act unprompted | Static NPCs; "next trigger" that nothing acts on |

## Draft infrastructure
1. **A pure rules core.** A deterministic reducer from state plus event to new state plus effects. `PlaySession`
   becomes a thin adapter around it.
2. **An exchange evaluator, called once per player turn.** It replaces the NPC marking its own goal claims and the
   judge that then checks them. It proposes events (`insightRevealed`, `leaningShift`, `pressureApplied`) and the
   rules validate them.
3. **Explicit state for the character agent.** It is told which insights it holds and may reveal, its current
   leaning, and which beats have fired.
4. **A generic background-job slot.** It replaces the separate pending/ready/route set for each job.
5. **Spec v3 and snapshot v2.** Spec v3 adds insights, pressure points, leanings, beats, outcome tiers, evidence
   provenance and web sources as a source kind.

Web sources (draft): approved pages are ingested as sources with `kind: 'web'` + `url`, stored as one page of text. The
existing span verification and citations then work unchanged. The teacher approves suggested sources before
generation, and the debrief labels them as supplementary.

## Open questions
1. **Old adventures:** regenerate the demo adventures under v3 and drop v2 play, or keep published v2 specs working?
2. **Randomness:** keep a roll, or make outcomes deterministic from state?
3. **Visibility of leanings:** shown exactly, shown vaguely (mood, body language), or only in the debrief?
4. **Scope before demos:** all six steps, or Probe + Confront + Rally + Consequence first, with beats and the job
   refactor in a second wave?
5. **Insights vs objectives:** an objective subtype, a separate `insights[]`, or a hybrid (objectives as a small public
   spine, insights as an optional layer that unlocks options)?
6. **Reveal gating:** decided by the NPC, by the judge, by prerequisite layers, or a combination? The current lean
   is that the NPC decides, crediting is by substance only, and layers come from prerequisites.
