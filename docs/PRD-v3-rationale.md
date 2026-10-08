# PRD v3: Rationale

The reasoning behind [`PRD-v3.md`](PRD-v3.md). The previous PRD, the 6 Oct feedback (teacher meeting and
`NUS_App_Feedback.docx`) and the gameplay notes may be consulted as reference. Nothing from them enters the v3
documents without Kevin's approval.

## Method

Design from the highest level down, and agree each level before going below it. We expect a rewrite of large
parts of the code. The existing code is useful as infrastructure that is already set up.

| Level | Topic | State |
|---|---|---|
| 0 | Purpose | Agreed |
| 1 | Learning outcomes (student and teacher) | Student agreed; teacher open |
| 2 | Pillars | Agreed |
| 3 | Player role and experience | Agreed, except team decisions TD1 and TD2 |
| 4 | Core loop (moment, stage, session) | Agreed |
| 5 | Mechanics | — |
| 6 | Content model | — |
| 7 | Systems and architecture | — |
| 8 | Build plan | — |

## Decisions (approved)

| # | Decision | Rationale | Requirements |
|---|---|---|---|
| V1 | The teacher's pack sets the focus; the wider historical record supplies the substance. *How* it is sourced is decided at level 7. | A source pack is almost always far too thin to build a convincing situation from. | G1, G1.1 |
| V2 | The clock is a teacher setting, not a design pillar. | Time pressure is not the pressure we want. | P1 |
| V4 | Holistic aims, not historian training. | The aim is critical, reflective, curious thinkers, not professional historians. Differing interpretations are presented as "people read this differently, and here's why". | E3.2 |
| V6 | The game ends with an in-character judgement (now the Interview, V40), then the reveal. There is no extra prompt after the reveal. Teachers can add their own questions. | The judgement speaks from inside the student's own choices. It goes at the end of the game, not each stage, because it needs evidence from every stage and shouldn't break the flow. | E2, E3, T1 |
| V7 | Stages are sequential, and choices carry forward. | This makes causes and consequences across stages teachable. Stages don't need large time gaps between them (see V30). | G2, G2.1 |
| V8 | Web and external sources ship before the pilot. | Follows from V1. | G1.1 |
| V9 | The world pushes back. | Testing reasoning means getting feedback, not a score. | P2, P2.1 |
| V10 | Predict, then reveal. | The gap between prediction and outcome teaches without grading. | P3, P3.1 |
| V11 | Thinking is played back to the student and summarised for the teacher. | This is part of the approved purpose statement. | E3.3, T2 |
| V12 | By default, a full session (stages, epilogue, Interview and reveal) fits into 45 minutes. | Lessons don't always start on time, and the teacher may want to speak, so a 45–60 minute lesson needs a buffer. This is a default only (see V32). | C1, P1.4 |
| V13 | "Pressure" means: no option satisfies everyone, and not everything can be known. | These are the pressures historical actors really faced, and they make students think rather than hurry. | — |
| V14 | No exam-style questions during play; any exam element comes at the end of the game. | Keeps play from feeling like a test. | C2 |
| V15 | Support Sec through JC reading levels. | Both are target audiences. | C3 |
| V16 | Never grade or rank students. | Part of the purpose statement. | C4 |
| V17 | The teacher decides whether the timer is on. The student can always end a stage by deciding. When a timer runs out, a final call happens in the story: the decision is forced, and the student still chooses. | The timer is a teaching choice, not a cost control. A forced final call paces without punishing, unlike an automatic pass. | P1, P1.1, P1.2 |
| V18 | Cost is capped by an abuse rate limit above human speed and a generous per-attempt ceiling, not by throttling characters. | A character reply costs about S$0.00026 (measured 25 Sep, simulated attempts). Typing speed caps a real student at cents per hour, even at 5–10× today's per-turn cost. The real risk is scripts, and forgotten tabs cost nothing. Deflections, action caps and low-key prompts hurt the experience more than they save. | C5, C6, C7 |

| V19 | Labelling: provenance that fits the world during play, and an honest breakdown at the end of the game. During play: period-appropriate document details, a subtle mark on real material, the source on request, and no citations in dialogue. At the end: the teacher's materials, other sources, invented content, and the student's own path. The teacher sees every label before publishing. Facts without a citation count as invented. | The record has to stay separate from the simulation, but citing everywhere breaks immersion and feels like an AI chat. Provenance that fits the period is also what source skills need (who wrote it, when, why). The model's own knowledge can't be checked, so it isn't treated as documented. | G1.2, G1.2.1, P4, P4.1, P4.2, E3.4, T3 |
| V20 | The teacher sets the timer when creating an adventure. It defaults to on, with stage lengths adding up to 45 minutes of play. | Superseded in part by V12: the default now fits the whole session, including the epilogue, Interview and reveal, into 45 minutes. | P1.3, P1.4 |

| V21 | Understanding the episode is the primary learning outcome. Critical thinking is what the game develops along the way. | The teacher's own measure of success is that students grasp the concerns, conflicts and risks, and why things turned out as they did. The feedback's "insights tracker" measures exactly that. Skills without understanding leave students sharp but unsure what happened. | Learning outcomes |
| V22 | Critical thinking is broken into five parts: question claims (including close reading), cross-check, consider other perspectives (then and since), reason about consequences, and weigh and reach a judgement. | Checked against the feedback: slanting and withholding characters, conflicting sources with provenance, persona depth, the causal map, competing interpretations, the evaluative question, and the teacher's "top three priorities" mechanic. | Learning outcomes |
| V23 | Connecting the past to the present is not a game outcome. | The teacher covers it in class. | — |
| V24 | Understanding the episode wins any trade-off with the skills. | The outcomes support each other, but they pull apart in specific choices: slanting characters, biased documents, time spent going deep versus covering everything, and how much hints give away. | Learning outcomes |
| V25 | Characters and documents may mislead during play, but whatever misled the student is corrected by the end of the game. | Misleading content is what exercises critical thinking. Understanding comes first, so no student leaves with a false picture. | E3.5 |
| V26 | The skills follow the rhythm of a stage (during, end, next stage, end of game). There is no ranking among the skills. | Every skill is practised every stage. The stage decision is itself a judgement, so ranking judgement low didn't make sense. | Learning outcomes |
| V27 | Reflection (noticing how your own view changed) is not a learning outcome. | It isn't easily measurable and isn't worth designing for. | — |
| V28 | Seven pillars (see the PRD). They settle design trade-offs at every lower level. | Each comes from an approved decision. 1 from V24/V25; 2 from the hint and secret-ending discussion, with "never graded" (V16) folded in; 3 because fleshed-out characters serve both outcomes; 4 from V9; 5 from V13/V2/V17; 6 from V19. 7 because the current game makes every step trivial (walk up, ask anything, the goal completes), while exploring stays valuable and walking is thinking time. | Pillars |
| V29 | The player role must have an identity, stakes, a private brief, real access and decisions that matter, whatever the role is. | The current role (effectively a random office worker) feels pointless because it has none of these, not because it is fictional. Real and fictional roles can both meet them. | G3–G3.4 |
| V30 | The episode sets the number of stages, and it can be one. Stages don't need large time gaps between them. | Some episodes are a single moment. Requiring big jumps in time would be a heavy constraint on the generator and on teachers' choice of episode. For one-stage adventures, consequences and predictions are resolved in the reveal. | G2 |
| V31 | Students are guided by gradually more specific hints during a stage, plus the timer if the teacher turned it on. | Some guidance and pacing is needed without rushing or doing the work for the student. Hint design is an idea for levels 4–5. | P5 |
| V32 | Time is the teacher's decision. The design is not otherwise built around time limits; only default timings are set. | Take-home use has no lesson to fit. Keep it simple. | P1, P1.3, P1.4, C1 |
| V33 | The teacher has broad power to reshape the generated adventure, including the number of stages. Details are designed later. | The generator's choices won't always suit the lesson. | T4 |
| V34 | Relationships: each character has 3–5 stances specific to them, changed only by triggers written at generation. The model expresses each stance freely. A hidden top stance can be reached through good play. | Anything the game must judge reliably is written in advance and detected during play. A score updated every message would be noisy and easy to game (flattery). A small set of states is the industry norm (WoW reputation, Fire Emblem supports, Persona social links). The depth comes from free expression, meaningful reasons for a change, what a change unlocks, and different characters reacting differently. Character-specific stances read as people, not meters. | G4, G4.1, P6, P6.1, P6.2 |
| V35 | Progress engine: discoveries written in advance with reveal conditions, confirmed during play by a cheap checker. The student sees only the stage's central question and their notes. Open questions stay hidden and surface only as hints when the student is stuck. | Highly feasible: judgements are made against a short written list. The character decides whether to reveal, and the checker only confirms it happened. Hiding the questions makes students form their own (questioning claims, curiosity) and avoids a checklist. The central question and quick hints answer the NUS complaint that students were "not sure how to succeed". | G5, G5.1, G5.2, P5.1–P5.3, P7–P7.3 |
| V36 | The student's notes are the source of truth for what they know. Discoveries are earned only when a character conveys them. Information is passed on only by inserting a note into the chat. Asserting something undiscovered makes the character question its basis, and changes nothing in the game. | Stops students skipping the game by typing what they read elsewhere or heard from a classmate, while prior knowledge isn't punished. Challenging the basis is fairer than silently ignoring it, and is itself critical thinking ("how do you know?"). A tool inside the chat keeps passing on information deterministic without leaving the conversation. | P8–P8.3 |
| V37 | Each stage combines continuous influence (discoveries, stance changes, information passed on) with a defining moment: a scene in the story where a real figure decides based on what the student advises, conveys or keeps back. The student chooses from 2–4 written go-between acts. The historical outcome is always reachable, and never labelled. | A go-between doesn't make historical decisions ("who are you to decide?"), but controls information, framing and advice. Real figures keep the real decisions, so history stays clean. The defining moment keeps the "weigh and judge" phase, the felt pressure, a moment for the prediction, and a point the class can compare. Written acts are more reliable than interpreting free text. A reachable historical outcome makes the comparison at the reveal always possible. | P1.1, P9–P9.2 |
| V38 | Consequences are deterministic: written rules pick one of 3–4 outcomes for each defining moment, minor details vary, and contingency is taught in the reveal and through secret endings. | The most explainable, testable and teacher-reviewable option, and it avoids "probabilities that read as historical fact". Deterministic outcomes risk suggesting history was inevitable, so the reveal discusses how things could have gone differently, and secret endings show other paths. Varying details gives variety without unfairness. Rules stay small (a few acts × a few conditions → 3–4 outcomes). Dice felt unfair and were hard to explain; a model deciding was less predictable and harder to test. | G6, G6.1, P9.3, P9.4, E3.6 |
| V39 | The student starts the defining moment when ready (the timer can bring it to them). Core discoveries are marked: hints steer towards them, a character nudges without blocking if they're missing, and the reveal covers them. Characters react immediately to the student's act, then come the prediction and the consequences. | Freedom without leaving anyone out (understanding first, low floor). Nudging rather than blocking avoids a return to the checklist. The immediate reaction makes the world push back at the most important moment. | G5.3, P5.4, P9.5–P9.7, E3.7 |
| V40 | The end of the game is Epilogue → Interview → Reveal. The epilogue shows how the student's run ended, labelled as their simulation. The Interview is a short in-chat conversation, essentially a gamified reflection: a character fitting the ending asks a question; the student picks a verdict, backs it by inserting notes, optionally adds words; the interviewer pushes back once; the student can respond or change their verdict. | A written "testimony" would be the least fun part and feel like homework, and the word is hard to decode. A conversation uses verbs students already know. Defending a verdict against push-back is the judgement skill and "the world pushes back" in one moment. Choosing plus attaching notes is the low floor; arguing in their own words is the high ceiling. Each ending needs its own question, because "could separation have been prevented?" makes no sense if separation never happened in that run. | E1, E2–E2.5, G6.2 |
| V41 | Pausing and resuming is low priority. | In class there's time, and take-home has no limit, so it's rarely needed. | P10 |
| V42 | Default time split: about 2 minutes of briefing, 30 minutes of stages, 1 of epilogue, 4 of Interview, 6 of reveal (about 43 in total). The generator prefers 1–2 stages. The reveal shows a short core by default, with more on request. | About 10 minutes per stage allows only about 15–25 exchanges once walking, reading and model replies are counted, so 3 stages would be shallow. Seven reveal items won't fit in 6 minutes; the teacher can cover the rest in class. | G2.2, P1.5, E3.8 |

## Ideas for levels 4–5 (raised, not designed)

- **Secret or bonus endings:** approved in principle (V38, G6.1). Still to design: what unlocks them (catching a contradiction, uncovering a guarded concern, seeing through a biased report). They are labelled as counterfactual and still lead into the same reveal.
- ~~Guided hints without automatic completion~~: now approved (V35, P5.1–P5.3).

## Team decisions (for the whole team)

| # | Question | Options | Current lean | Impact |
|---|---|---|---|---|
| TD1 | Is the player a real historical figure or a fictional character? (Kevin will push for (d).) | **(c) Real figure** (central, or from the inner circle such as Goh Keng Swee): the stage decision is the real dilemma, the reveal compares "Lee actually did X; you did Y", and it follows the "Reacting to the Past" classroom method. **(d) Fictional go-between** (for example a liaison officer trusted to different degrees by several sides): access to every side, and real figures' actions stay historical. | **(d), tentatively.** The current role is a weak version of (d) because it lacks identity, stakes, a brief, access and meaningful decisions (G3–G3.4), not because it is fictional. | Medium at levels 5–6: who is frank with the player, how characters push back, the reveal's comparison, and whether stage decisions must match a real person's dilemmas. Low elsewhere. |
| TD2 | One role per adventure, or different students playing different sides? | **One role:** everyone has the same experience. **Several roles:** for example half the class are Lee and half are Tunku, which makes a strong class discussion and answers the educator's group-learning question. | **One role, tentatively.** It's easier to build, and easier for teachers and students to coordinate when everyone has the same experience. Several roles with (c) sounded very fun, so it's worth revisiting. | High at level 6 (content multiplies by the number of roles), medium at levels 7–8. |

Levels 4–6 are designed against the minimum role requirements (G3–G3.4), so they hold whichever way TD1 goes.

## Open

- Teacher outcomes TO1–TO4 are provisional and the section is still open.
- **Claims under test (level 4):** written slants that the student can check against documents. Status labels such
  as "contradicted" do the thinking for the student. Options under consideration:
  - no verdicts during play (the student notes their own doubts, and the reveal corrects them);
  - no board at all (doubt is shown by confronting someone, which is a relationship trigger);
  - hints that prompt checking, never verdicts.
- **How visible a character's stance is:** named labels, indirect cues only (portrait, tone, manner), a brief notice
  when it changes, or nothing. This balances guiding the student against giving away the character's feelings.
