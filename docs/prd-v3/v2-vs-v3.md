# v2 vs v3: What changes

> **Derived view, do not edit.** Compares [`../archive/PRD-v2.md`](../archive/PRD-v2.md) (v2 as specified), the
> code at `9abd46f` (v2 as built, verified in the glossary of
> [`../archive/gameplay-depth-plan.md`](../archive/gameplay-depth-plan.md)) and
> [`../PRD-v3.md`](../PRD-v3.md) with [`../PRD-v3-rationale.md`](../PRD-v3-rationale.md) (v3, levels 0–6 agreed).
> "V" numbers are v3 decisions; "D" and "FR" numbers are v2's.

## In one paragraph
v2 built a small world to *talk to history*: roam rooms, chat with characters, pick an option, and an AI resolver
decides what happens. In practice nothing a student did inside a stage changed the outcome except the final pick,
progress was a checklist that any substantive reply completed, and characters felt generic. v3 is built to
*reason about history*: understanding the episode comes first; the student is a go-between whose questions, notes
passed on and documents shown change how characters stand and what becomes possible; rules, not an AI, decide
consequences; and the game ends with an Interview and an honest reveal. The platform underneath (app, map
compiler, renderer, ingest, LLM client, assets) is largely kept; the game, the generator and the teacher review
are rebuilt.

## Purpose and outcomes
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Purpose | A generated 2D world where students talk to stakeholders and make decisions "resolved probabilistically and carried forward" | As specified | Students question people, weigh conflicting evidence and make choices no one is fully happy with; their thinking is played back; never graded (Purpose) |
| Learning outcomes | None defined; the teacher supplies learning objectives for the planner | Same | **1. Understand the episode** (primary). **2. Critical thinking**: question claims, cross-check, consider perspectives, reason about consequences, judge (V21–V26) |
| Design principles | Decisions D1–D19, mostly technical | — | **Seven pillars**, for example understanding first, low floor/high ceiling, the world pushes back (V28) |

## The player
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Role | A teacher-specified student role | A generic role with a short brief ("effectively a random office worker") | A role with identity, stakes, a private brief, real access and decisions that matter (G3–G3.4). Tentatively a **fictional go-between** trusted by several sides (TD1) |
| Number of roles | Single player (D2) | Single player | One shared role per class, tentatively (TD2) |

## Characters
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Count | 3–4 stakeholders | Up to 4 per stage | **2–4 major + 1–3 minor** per stage (G8, G8.1) |
| Depth | Public position + private motivation + knowledge horizon (FR-2) | Same fields, but prompts told characters to "pursue a modest aim" and never steer; replies felt generic | Persona with voice and **real phrases**, what they knew then, **what they want from the student**, what they slant or withhold (G7, P11) |
| Attitude to the player | A disposition number | −5…+5, **changed only at stage resolution** | **3–5 named stances** per major character, changed only by written **triggers** during play; shown by **portrait expression** (G4, P6) |
| Acting on their own | **Fully autonomous** agents, ticking between player turns (D17, FR-12a) | Only acted when evidence was shared or at the decision; otherwise static | **Written behaviour only**: summons and movement through story events; no free-roaming AI (V45, C8) |

## Progress and investigation
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| What counts as progress | An objective graph (DAG) targeting agents or evidence | A character claims a goal, a cheap judge confirms it; **any substantive reply** completes it | **Discoveries** with reveal conditions become **notes** in the role's voice; notes are the source of truth for what the student knows (V35, V36) |
| What the student sees | Objectives | "Next step: Talk to X" with a button that walks there | The stage's **central question** and their notes; open questions stay hidden (V35) |
| Guidance | — | Two hint levels on the case board, plus the always-visible "next step" | **Automatic hints when stuck**, as the role's own thoughts, adapting to time left, never completing anything (V52) |
| Navigation | Click-to-travel, WASD (FR-10) | Auto-walk to any goal's target | Walk to named rooms only; **no auto-walk to people or objects**; minimap shows the layout only (V51) |
| Guaranteed understanding | — | — | **Core discoveries**: hinted first, nudged before the defining moment, covered in the reveal (V39) |

## Evidence and documents
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Form | Evidence items with source spans; later "progress-adaptive" AI-generated evidence in a notebook (FR-18a) | Scrolls picked up by walking onto them | **Real excerpts** where a source exists, with period-appropriate provenance; at least one slanted or contradicted document per stage (V46) |
| Reading | — | Picking up = done | **Close reading**: select the passage that matters to make a note (V47) |
| Using evidence | — | `share_evidence` existed in the API only, with no effect | **Show** a document or **insert a note** into chat to someone; can fire triggers (P8, P13.5) |
| Conflicting claims | — | "Account clues" (two characters' versions) | **Slants**, catchable through documents or other accounts, **with no "contradicted" labels** during play; corrected in the reveal (V48, V69) |
| Made-up claims | — | No check | Challenged in character ("how do you know?"); change nothing; repeated ones cost trust (V36, V57) |

## Decisions and consequences
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| The choice | Options maintained and added to by the AI resolver (FR-13, FR-14) | Written options plus up to 2 AI-**minted** options | A **defining moment**: a real figure decides based on what the student advises, conveys or keeps back; 2–4 written **go-between acts**, including deception acts and a hidden secret act (V37, V56, V57) |
| Who decides outcomes | An **AI resolver**; outcomes "probabilistic" (D9, D10) | A seeded roll that changed standing and narration but **never the branch**; the branch came only from the option picked | **Written rules, no randomness**: the act plus stances plus what each character knows picks one of 3–4 outcomes; the reason is shown (V38) |
| Predicting | — | — | One-tap **prediction** of the outcome, revealed with the reason (V53) |
| Stages | Up to 3; each option branches to a stage or ending | Same | **1–2 preferred**; no separate branches; earlier outcomes **change the next stage and close endings** (V30, V42, V54) |
| Endings | Endings via branch targets | Same | 1 historical, 2–3 alternatives, 0–1 secret; no good/bad labels; the historical ending can be closed by earlier choices (V54–V56) |

## End of game
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Sequence | Debrief: summary, evidence, actual history with citations, divergence, reflection questions (FR-19) | As specified | **Epilogue → the Interview → reveal → teacher's own questions** (V40, V72) |
| Judgement | Reflection questions | Same | **The Interview**: pick a verdict, back it with notes, face one push-back chosen by rule, respond (V40, V59) |
| What's shown | Everything at once | Same | A short core by default (what happened, where your run split from history, key corrections), more on request (V42, V54) |

## Time
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Session length | ~15 min in class, ~30 self-directed (D15) | Not enforced | **45 minutes by default**, including the Interview and reveal (V12, V42) |
| Timer | On by default; expiry = **pass** (D12, FR-16) | 480 s per stage default | Set by the teacher at creation; default sized to 45 min; expiry = **final call**, the student still chooses (V17, V20) |

## Grounding and sources
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Sources | Uploaded materials only; gaps listed as "missing information" | Same | Teacher's materials set the focus; **the wider record fills gaps**, from an **allowlist** the teacher can extend (V1, V66) |
| Labels | Source spans and named assumptions | Debrief separates documented and simulated | Every item labelled with the **named source**, its provenance, or "invented"; core discoveries must be cited; quotes checked word for word (V66, V72) |
| Immersion | — | Citations in the debrief | **No citations in dialogue**; provenance shown the way the period would show it (V19) |

## Generation
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Approach | One planner call + up to 2 repairs (FR-2, FR-4) | Same; ~23k output tokens, ~200 s planning, ~10 min end to end; driven by the teacher's browser tab | **Passes**: sources → skeleton → details and personas in parallel → endings → reveal → checks with **targeted repair** (V62) |
| Teacher involvement | Review and edit after generation (FR-5) | Same | **Modes**: Quick, Standard (pause after the skeleton; default), Guided (V63) |
| Checks | Schema, playability, reachability (FR-8) | Same | Plus skeleton checks and full rule checks (reachable endings, core discoveries, catchable slants, no rule gaps) (V65, V70) |

## The teacher
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Editing | Edit any field, regenerate an element, preview, publish (FR-5) | Brief chat and workspace | Skeleton review, a **review screen** with labels and conflicts, **plain-language edits**, real excerpts swappable but not rewritable, versions (V65, V71) |
| After play | Review attempts | Attempts and debriefs | A **tabbed class summary**: where students got stuck, predictions, verdicts, discoveries missed, endings, anonymised answers, flagged messages (V60) |

## AI, cost and safety
| | v2 PRD | v2 as built | v3 |
|---|---|---|---|
| Who uses AI for what | Resolver/orchestrator AI over autonomous agents | Resolver narration, option minting (~77% of play cost), character replies, goal judge | **Rules own what's true and what changes; AI owns language** (conversation, combined checks, interviewer wording, narration, moderation) (V67) |
| Model strength | Tiered: strongest for resolver and planner (D14) | Same | **Intelligence spent at generation**; fast, constrained models during play (V68) |
| Cost control | Per-attempt token budget, rate limits, budgeted ticks (FR-12b, FR-22) | Deflections, action caps, low-key prompts | An abuse rate limit and a generous ceiling; **no throttling of characters** (V18) |
| Safety | Injection defence, content filter (FR-20, FR-23) | As specified | Plus in-character refusal of slurs and character-breaking, and **flags shown to the teacher** (V58) |

## Kept from v2
- Desktop web, 2D top-down tile map (D1), with the deterministic compiler owning geometry (D3).
- Phaser renderer (D16) and the asset policy for generated portraits, props and landmarks (D4), extended to one
  portrait expression per stance (G4.2).
- Server-authoritative state; private character context never reaches the browser (D8, FR-21).
- Teacher-set reading level (FR-1a), now Sec or JC with verbatim excerpts kept shorter for Sec (V70).
- Published versions are frozen, and attempts stay on the version they started (FR-5, V71).

## Dropped from v2
- Autonomous AI characters (D17, FR-12a/b) → written behaviour (V45).
- AI resolver and probabilistic outcomes (D9, D10) → deterministic rules (V38, V67).
- AI-minted options (FR-13) → written acts (V37, V67).
- Expiry as a pass (D12) → final call (V17).
- The objective checklist and "next step" auto-walk → discoveries, notes and hints (V35, V51).
- Doors as a privacy mechanic (D7) → no longer matter for gameplay; removal decided at level 7.
- Session length of 15–30 min (D15) → 45 min (V12).

## Not yet addressed in v3
- **Ambient overlays and scene effects** (D19, FR-15a–c): not discussed; carry over or drop.
- **Spectator mode on elimination** (D13): no elimination exists in v3, so likely dropped.
- **Model provider** (D14, OpenAI only): left to level 7 evaluations (G14.3).
- **Resume with a recap** (FR-18): v3 has pause and resume at low priority (P10).
