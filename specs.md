# Product Requirements Document

## AI-Generated Historical Adventures

### 1. Project description

AI-Generated Historical Adventures is a web application that transforms historical teaching material into **playable 2D adventure games**.

Teachers provide source documents, a historical setting, and learning objectives. The application uses an LLM to generate an explorable map populated with historical stakeholders, evidence, and interconnected objectives. Students enter the world as a character, investigate their surroundings, converse with AI-controlled stakeholders, and make decisions that change the game state.

The product has two core features:

1. **AI-generated playable worlds:** Historical material becomes a navigable environment with meaningful locations, character placements, evidence, and objectives.
2. **Interactive AI-driven gameplay:** Characters respond to the student’s questions, discoveries, and decisions within a persistent world.

The experience is a game first—not a chatbot with a map attached or a worksheet presented through character dialogue.

---

### 2. Problem statement

Historical learning often presents events as a fixed sequence of facts. Students can learn what happened without understanding the competing interests, incomplete information, and constraints faced by people at the time.

Games can make these conditions tangible, but creating a curriculum-specific game requires substantial work in level design, writing, programming, and historical research. Existing historical games also tend to cover predetermined topics that teachers cannot easily adapt.

This product allows teachers to turn their material into an interactive adventure without designing a game from scratch. Students learn by exploring, questioning, and acting inside the generated world.

### 3. Target users

| User | Primary need |
| --- | --- |
| Secondary-school history teachers | Create engaging, curriculum-relevant adventures from their own material without game-development skills |
| Secondary-school students | Explore historical situations through understandable objectives, interactive characters, and consequential choices |

Teachers create and approve adventures. Students play individual sessions against AI-controlled stakeholders.

---

## 4. Core feature: AI-generated playable worlds

### 4.1 Generation inputs

Teachers provide:

- Historical source material through pasted text or text-based PDFs.
- A bounded event, setting, or decision window.
- Learning objectives.
- Student age or reading level.
- The student’s role, or a request for the system to suggest one.
- Optional stakeholder profiles and required locations.

The system identifies missing information rather than silently treating invented details as historical facts.

### 4.2 Generated adventure

The application generates a connected game experience containing:

| Element | Product requirement |
| --- | --- |
| **Map** | A small, navigable 2D environment with connected locations |
| **Locations** | Spaces relevant to the scenario, such as a market, meeting hall, port, or administrative office |
| **Player role** | A brief explaining responsibilities, objectives, knowledge, and limits |
| **NPCs** | Stakeholders with distinct interests, knowledge, authority, and relationships |
| **Evidence** | Inspectable documents, notices, objects, or accounts linked to supplied sources |
| **Objectives** | Tasks that connect exploration, conversation, evidence, and decisions |
| **Interactions** | Defined ways to inspect, question, negotiate, and act |
| **Consequences** | Supported changes to characters, access, objectives, and scenario conditions |

**The map, objectives, and NPCs must be generated together as parts of the same adventure.** A map should not be a random arrangement of buildings populated with unrelated conversations.

### 4.3 Meaningful spatial design

Locations must serve a gameplay purpose.

For example:

- Visiting a market reveals evidence about shortages.
- A meeting hall provides access to a stakeholder unavailable elsewhere.
- An administrative office contains a document that unlocks a negotiation option.
- A location becomes accessible after the student obtains permission.
- Choosing one investigation route consumes opportunities that could have been spent elsewhere.

The layout may be schematic rather than geographically exact. The application must distinguish sourced geography from invented spatial arrangements.

### 4.4 Playability requirements

Generated adventures must satisfy the following conditions:

- The player can reach every location required for completion.
- NPCs and evidence are accessible when their objectives require them.
- Required objectives do not depend on circular or impossible prerequisites.
- Characters and objects are not placed inside blocked areas.
- The student can understand what to do next without being given the answer.
- Alternative investigation routes offer different information or perspectives.
- The adventure has a reachable ending.

If generation produces an invalid adventure, the application must repair it or explain the failure instead of presenting an unplayable world.

### 4.5 Teacher control

Teachers can preview the generated adventure and revise:

- Location names and descriptions.
- Character briefs and knowledge.
- Evidence placements.
- Objectives and available decisions.
- Historical claims and simulation assumptions.

Teachers can request targeted regeneration of a selected element without discarding the entire adventure. Changes affecting connected objectives or interactions must be surfaced for review.

Once approved, the adventure is published as a fixed version so that student attempts remain consistent.

---

## 5. Core feature: interactive AI-driven gameplay

The interactive model combines **conversation, exploration, and persistent consequences**.

### 5.1 Exploring and investigating

Students control a character in the generated world. They can:

- Move between locations.
- Approach and interact with NPCs.
- Inspect evidence and environmental objects.
- Collect relevant information in a journal.
- Discover objectives and unlock supported actions.

An equivalent location-and-interaction list provides access for students who cannot comfortably use map navigation.

### 5.2 Conversational stakeholders

NPCs are participants in the scenario, not general-purpose historical assistants.

Each stakeholder has:

- A public position.
- Personal or institutional priorities.
- Knowledge available at that point in the scenario.
- Authority and practical limitations.
- Negotiable positions and firm constraints.
- Relationships with other stakeholders.
- Information that becomes available under defined conditions.

Students can ask their own questions or use suggested prompts. They can challenge an account, present evidence, ask for clarification, or propose a supported negotiation.

Responses should reflect the stakeholder’s perspective and the current world state. An NPC should respond differently after a relevant discovery, agreement, or decision.

### 5.3 Conversation connected to mechanics

Dialogue must affect gameplay where appropriate.

Examples include:

- A student presents a document and unlocks a new question.
- A stakeholder reveals information after a prerequisite is met.
- A negotiation produces an offer the player can accept or reject.
- A character refuses a request because it exceeds their authority.
- Conflicting testimony creates an investigation objective.
- A previous decision changes what assistance a character will provide.

NPCs must not promise actions or outcomes that the game cannot support.

### 5.4 Player decisions

Students make decisions through structured choices, supported negotiation options, or natural-language proposals interpreted into an allowed action.

For natural-language proposals, the application shows its interpretation before the student confirms.

A decision may change:

- Agreements and stakeholder cooperation.
- Access to locations or information.
- Available resources.
- NPC availability or responses.
- Active objectives.
- Later events and the ending.

Unsupported actions receive a clear explanation and nearby supported alternatives.

### 5.5 Persistent consequences

The world remembers what the student has done.

Evidence collected, conversations, agreements, decisions, and resulting changes persist throughout the attempt and across resumed sessions.

Important consequences should appear in the game itself—for example, a newly accessible room, an unavailable stakeholder, a changed notice, or a new objective—not only in a final text summary.

### 5.6 Investigation trade-offs

A limited action budget or round structure makes investigation a choice.

Students may not be able to consult everyone before acting. The challenge is to decide what information to seek and how to act under uncertainty.

Real-time pressure is not the default. Progress is based on investigation and decisions rather than movement speed.

---

## 6. Core user experiences

### Teacher: material to playable adventure

1. Create an adventure and specify the learning context.
2. Provide historical material.
3. Generate the map, characters, evidence, and objectives.
4. Preview the adventure as a player.
5. Correct or regenerate selected content.
6. Publish and share access with students.
7. Review completed attempts.

### Student: explore, investigate, act

1. Join an adventure and read the role brief.
2. Enter the generated world.
3. Explore locations and encounter stakeholders.
4. Ask questions, compare accounts, and collect evidence.
5. Complete objectives and make consequential decisions.
6. Observe changes and continue the adventure.
7. Reach an ending and reflect on the outcome.

### Student: resume an adventure

1. Sign in and select an unfinished attempt.
2. Review a short recap of objectives, discoveries, and decisions.
3. Continue from the saved world state.

---

## 7. Ending and learning feedback

Each adventure ends with:

- A summary of the student’s decisions and simulated consequences.
- A record of evidence and perspectives encountered.
- A sourced explanation of what happened historically.
- An explanation of where the simulation diverged.
- Reflection questions about uncertainty, competing interests, and trade-offs.

The application must distinguish:

| Category | Meaning |
| --- | --- |
| **Documented history** | Claims supported by historical sources |
| **Character knowledge** | Information available to a stakeholder at that moment |
| **Simulation assumptions** | Authored simplifications and plausible alternate consequences |

Completing the adventure is a game objective. Matching the historical outcome is not the definition of success.

Teacher review focuses on student reasoning and evidence use, not a universal moral score.

---

## 8. Initial product boundaries

### Included

- Individual student sessions.
- One supported historical setting or narrow family of settings.
- Generated maps with three to five meaningful locations.
- One player-controlled role and three to four AI stakeholders.
- A short adventure with approximately four to six decision rounds.
- One coherent visual asset library.
- Text dialogue and suggested questions.
- Evidence collection and a player journal.
- A restricted set of objectives, interactions, and consequences.
- Teacher preview, essential editing, publication, and sharing.
- Account-linked ownership, access control, and saved progress.
- An ending and basic attempt review.

### Excluded

- Unrestricted generation across every historical period.
- Full-scale historical cities.
- Multiplayer.
- Combat and voice interaction.
- Arbitrary generated game code or entirely new mechanics per adventure.
- Continuous regeneration of the whole map during play.
- A full classroom-management or automated grading platform.
- Guaranteed historically accurate counterfactual predictions.

---

## 9. Experience and trust requirements

- Students should understand movement, interaction, and their first objective through brief in-game onboarding.
- Generation must show meaningful progress and recoverable failure states.
- Dialogue latency must not freeze movement or unrelated interface controls.
- Historical quotations must be distinguishable from generated character speech.
- Private stakeholder information and unrevealed events must not be exposed through player-facing assets.
- AI-generated actions and content must be validated before affecting gameplay.
- Source uploads and student attempts must remain private to authorized users.
- Conflict must be handled in an age-appropriate, non-graphic manner.
- Students must not need to perform degrading or hateful conduct to complete an adventure.

---

## 10. Success criteria

The product succeeds when:

1. **Different source inputs produce meaningfully different playable adventures**, not merely renamed copies of the same level.
2. **Generated worlds are completable**, with reachable locations and coherent objective dependencies.
3. **NPC interaction matters**, changing available information, options, or subsequent behavior.
4. **Player choices change the world** in understandable and persistent ways.
5. **Teachers can obtain a usable adventure without extensive manual repair.**
6. **Students can complete and resume adventures without external guidance.**
7. **Students can distinguish historical evidence from simulated outcomes.**

Evaluation should track generation validity, objective completability, manual correction effort, NPC grounding, completion and abandonment, response latency, and cost per completed adventure.

### Product promise

> **Turn historical material into a world students can explore, question, and change.**
