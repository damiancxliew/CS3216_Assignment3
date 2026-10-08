# PRD v3: Gameplay redesign

Status: design in progress. The rationale for each requirement is in [`PRD-v3-rationale.md`](PRD-v3-rationale.md).

## Purpose

A teacher's materials set the focus; the game draws on the wider historical record to fill in everything a
convincing situation needs. Students step into it: they question the people involved, weigh evidence that
disagrees, and make choices where no option satisfies everyone and not everything can be known. As they play,
the world pushes back and their predictions are put to the test. At the end they give their own account of what
happened and why, then see how it compares with what actually happened and how differently it has been
understood. Students see their own thinking played back, and the teacher gets a picture of the class's thinking
to discuss, without anyone being graded.

## Learning outcomes

### Student
1. **Understand the episode** (primary): who was involved, what each wanted and feared, the key conflicts and
   risks, and what happened and why.
2. **Critical thinking** (skills the game develops):
   - **Question claims:** who says this, why, and how do they know? This includes reading primary text closely.
   - **Cross-check:** compare accounts and documents before trusting them.
   - **Consider other perspectives:** of the people at the time, and of people who have read it differently
     since.
   - **Reason about consequences:** if X, then what?
   - **Weigh and reach a judgement:** prioritise factors and defend a view with evidence.

Understanding the episode wins any trade-off with the skills.

When each skill is practised:

| When | Student does | Skills |
|---|---|---|
| During a stage | Talks, reads, compares | Question claims, consider other perspectives, cross-check |
| End of a stage | Decides, and predicts what happens next | Weigh and reach a judgement, reason about consequences |
| Start of the next stage (or the reveal, for a one-stage adventure) | Sees the consequences of their choice and prediction | Reason about consequences |
| End of the game | The Interview: defends a verdict with evidence against push-back | Weigh and reach a judgement, drawing on all of the above |

### Teacher (provisional, still open)
- **TO1:** gets a ready-to-run activity from their materials with little preparation.
- **TO2:** can trust it: sees what is documented and what is invented, and can correct it before students play.
- **TO3:** gets a picture of the class's thinking to run a discussion.
- **TO4:** keeps control: focus, timer, their own questions.

### Not outcomes
- Connecting the past to the present (left to the teacher).
- Reflection on how the student's own view changed.
- Exam practice during play.
- Grading or ranking.
- Training historians.

## Pillars

1. **Understanding first.** Every student leaves understanding the episode.
2. **Low floor, high ceiling.** Everyone reaches understanding; skilful play earns more, never marks.
3. **Characters are people, not encyclopaedias.** They have stakes, blind spots, agendas and a voice.
4. **The world pushes back.** What the student says and does changes things, not just the final choice.
5. **Hard choices, not a hard clock.** The pressure comes from trade-offs and incomplete information, not time.
6. **The record stays apart from the simulation, without breaking immersion.**
7. **Investigation takes real thought.** Finding people and documents is the start; understanding what they mean
   is the work.

## Product Backlog

### 1. Functional Requirements

| Status | ID | Requirement | Priority | Planned Week |
|---|---|---|---|---|
| | **G** | **Generation** | | |
| ☐ | G1 | The system should generate an adventure focused on the teacher's materials. | | |
| ☐ | G1.1 | The system should draw on sources beyond the teacher's materials for people, setting, context and primary material. | | |
| ☐ | G1.2 | The system should label all content as from the teacher's materials, from other cited sources, or invented. | | |
| ☐ | G1.2.1 | The system should treat any fact without a citation as invented. | | |
| ☐ | G2 | The system should generate one or more stages, with the number set by the episode. | | |
| ☐ | G2.1 | The system should carry the student's choices forward into later stages. | | |
| ☐ | G2.2 | The system should prefer 1–2 stages for a 45-minute session, and use 3 only for simple stages. | | |
| ☐ | G3 | The system should give the student a role with an identity (who they are, their relationships, their reputation). | | |
| ☐ | G3.1 | The system should give the role personal stakes: something to win or lose. | | |
| ☐ | G3.2 | The system should give the student a private brief: goals, fears, constraints, and what they know at that moment. | | |
| ☐ | G3.3 | The system should give the role reasons why each character will or won't talk to them. | | |
| ☐ | G3.4 | The system should give the role decisions that genuinely change things. | | |
| ☐ | G3.5 | (Tentative, team to confirm) The system should make the role a fictional go-between trusted to different degrees by several sides. | | |
| ☐ | G3.6 | (Tentative, team to confirm) The system should give every student in a class the same role. | | |
| ☐ | G4 | The system should generate 3–5 character-specific stances for each character (for example guarded, wary, alarmed, confiding). | | |
| ☐ | G4.1 | The system should generate triggers for each character: a student action, the stance change it causes, and what that change unlocks or closes. | | |
| ☐ | G5 | The system should generate grounded discoveries for each character, each with a reveal condition (prior discoveries and/or a stance). | | |
| ☐ | G5.1 | The system should generate open questions linked to the discoveries that answer them. | | |
| ☐ | G5.2 | The system should generate a central question for each stage. | | |
| ☐ | G5.3 | The system should mark the discoveries in each stage that are core to understanding the episode. | | |
| ☐ | G6 | The system should generate 3–4 outcomes for each defining moment, with rules that map the student's act, characters' stances and what each character knows to one outcome. | | |
| ☐ | G6.1 | The system should allow hidden outcomes that only skilful play can reach (secret endings). | | |
| ☐ | G6.2 | The system should generate an Interview question and interviewer for each ending, fitting that ending. | | |
| | **P** | **Play** | | |
| ☐ | P1 | The system should allow the teacher to turn the stage timer on or off and set its length. | | |
| ☐ | P1.1 | The system should let the student end a stage by acting at its defining moment. | | |
| ☐ | P1.2 | When the timer runs out, the system should force a final decision instead of skipping the student's choice. | | |
| ☐ | P1.3 | The system should require the teacher to set the timer when creating an adventure. | | |
| ☐ | P1.4 | The system should default the timer to on, with the whole session (stages, epilogue, Interview and reveal) fitting into 45 minutes. | | |
| ☐ | P1.5 | The system should default to about 2 minutes of briefing, 30 minutes of stages in total, 1 minute of epilogue, 4 minutes of Interview and 6 minutes of reveal. | | |
| ☐ | P2 | The system should let characters challenge claims the student makes. | | |
| ☐ | P2.1 | The system should change the situation when the student shows evidence to a relevant character. | | |
| ☐ | P3 | The system should ask the student for a prediction at the end of each stage. | | |
| ☐ | P3.1 | The system should reveal how each prediction turned out later in the game. | | |
| ☐ | P4 | The system should show a document's provenance in a form that fits its period (for example, masthead and date, or sender and recipient). | | |
| ☐ | P4.1 | The system should mark real documents subtly and let the student view their source on request. | | |
| ☐ | P4.2 | The system should not show citations in character dialogue. | | |
| ☐ | P5 | The system should give gradually more specific hints when the student is stuck. | | |
| ☐ | P5.1 | The system should detect when a student is stuck (for example, no new note for a few minutes, or several unproductive questions in a row). | | |
| ☐ | P5.2 | The system should start with an open question as the first hint, give more specific angles after that, and end with a story event. | | |
| ☐ | P5.3 | The system should never complete progress on the student's behalf through a hint. | | |
| ☐ | P5.4 | The system should steer hints towards core discoveries first. | | |
| ☐ | P6 | The system should change a character's stance only through its generated triggers. | | |
| ☐ | P6.1 | The system should let a character's stance shape what they reveal, how they treat the student, and which options are available. | | |
| ☐ | P6.2 | The system should let a character express each stance freely in their own voice. | | |
| ☐ | P7 | The system should show the stage's central question at all times. | | |
| ☐ | P7.1 | The system should let a character reveal only discoveries whose conditions are met. | | |
| ☐ | P7.2 | The system should record a discovery as a note in the role's voice when a character conveys it. | | |
| ☐ | P7.3 | The system should not show discoveries or open questions as game objects; open questions appear only as hints. | | |
| ☐ | P8 | The system should let the student insert one of their notes into a chat message through a tool in the message box. | | |
| ☐ | P8.1 | The system should count information as passed on only when it is inserted from the student's notes. | | |
| ☐ | P8.2 | When the student asserts something they haven't discovered, the character should question how they know it and prompt them to find out properly. | | |
| ☐ | P8.2.1 | The system should challenge only assertions of undiscovered facts, not questions. | | |
| ☐ | P8.3 | The system should never create notes, unlock content or fire triggers from information the student hasn't discovered. | | |
| ☐ | P9 | The system should build each stage to a defining moment where a real figure decides based on what the student advises, conveys or keeps back. | | |
| ☐ | P9.1 | The system should offer 2–4 written go-between acts at the defining moment, phrased in the role's voice. | | |
| ☐ | P9.2 | The system should make the historical outcome reachable at every defining moment, without labelling it. | | |
| ☐ | P9.3 | The system should determine the outcome of a defining moment from its rules, without randomness. | | |
| ☐ | P9.4 | The system should vary minor details of how an outcome plays out, never the outcome itself. | | |
| ☐ | P9.5 | The system should let the student start the defining moment when ready; when the timer runs out, a story event brings it to them. | | |
| ☐ | P9.6 | If core discoveries are missing when the student starts the defining moment, a character should nudge them without blocking. | | |
| ☐ | P9.7 | The system should have the characters present react immediately to the student's act, before the prediction and consequences. | | |
| ☐ | P10 | The system should let the student pause and resume a session. | Low | |
| | **E** | **End of game** | | |
| ☐ | E1 | The system should show an epilogue: a short ending scene for the student's run, labelled as their simulation. | | |
| ☐ | E2 | The system should hold the Interview after the epilogue: a short in-chat conversation in which a character asks the student a question that fits their ending. | | |
| ☐ | E2.1 | The system should let the student answer by choosing a verdict. | | |
| ☐ | E2.2 | The system should let the student back the verdict by inserting notes as evidence. | | |
| ☐ | E2.3 | The system should let the student add their own words, optionally. | | |
| ☐ | E2.4 | The interviewer should push back once, using a discovery that cuts the other way or a core discovery the student missed. | | |
| ☐ | E2.5 | The system should let the student respond to the push-back, including changing their verdict. | | |
| ☐ | E3 | The system should show the reveal after the Interview. | | |
| ☐ | E3.1 | The system should show what actually happened. | | |
| ☐ | E3.2 | The system should show how the episode has been interpreted differently. | | |
| ☐ | E3.3 | The system should play back the student's own choices, predictions and Interview answers. | | |
| ☐ | E3.4 | The system should show which content came from the teacher's materials, which from other sources, which was invented, and which was the student's own path. | | |
| ☐ | E3.5 | The system should correct anything the student was misled about during play. | | |
| ☐ | E3.6 | The system should show how outcomes could have gone differently. | | |
| ☐ | E3.7 | The system should cover any core discoveries the student missed. | | |
| ☐ | E3.8 | The system should show by default only what actually happened, the student's path compared with history, and key corrections, with the rest available on request. | | |
| | **T** | **Teacher** | | |
| ☐ | T1 | The system should allow the teacher to add their own end-of-game questions. | | |
| ☐ | T2 | The system should show the teacher a summary of the class's thinking. | | |
| ☐ | T3 | The system should show the teacher the source label of all content before publishing. | | |
| ☐ | T4 | The system should allow the teacher to reshape the generated adventure extensively, including the number of stages. (Details to be designed.) | | |

### 2. Constraints

| Status | ID | Requirement | Priority | Planned Week |
|---|---|---|---|---|
| ☐ | C1 | The system should size its default timings so a full session, including the epilogue, Interview and reveal, fits into 45 minutes. | | |
| ☐ | C2 | The system should not present exam-style questions during play. | | |
| ☐ | C3 | The system should support Sec through JC reading levels. | | |
| ☐ | C4 | The system should never grade or rank students. | | |
| ☐ | C5 | The system should limit requests to above human speed, to stop automated abuse. | | |
| ☐ | C6 | The system should end an attempt gracefully when it reaches a ceiling set well above normal use. | | |
| ☐ | C7 | The system should not throttle or hold back characters to save cost during normal play. | | |
