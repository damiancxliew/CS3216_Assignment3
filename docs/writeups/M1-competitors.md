# M1 — Competitors and why we win

Three products a history teacher could realistically use next Tuesday instead of us.

| | Twine / Inklewriter (branching-narrative authoring) | Character.AI / historical character-chat apps | A generic LLM tutor (ChatGPT, Khanmigo) with a prompt |
| --- | --- | --- | --- |
| What the teacher does | Writes every passage, link and outcome by hand | Writes a persona description | Writes a prompt, or pastes sources into a chat |
| Time to a usable lesson | Days per scenario | Minutes, but only one character | Minutes |
| Grounded in *the teacher's* sources | Only insofar as the teacher typed them in | No | Loosely — the model may or may not use them, and does not say which parts it used |
| Multiple actors with conflicting private motives | Only if hand-authored | No — one character, no world | No |
| Consequences that carry forward | Hand-authored branches | None; the conversation resets | Only within the context window, unverifiably |
| Distinguishes documented fact from invention | No mechanism | No — invention is the product | No; the same confident voice for both |
| Fixed version for a class of 30 | Yes (a static file) | N/A | No — each student gets a different conversation |

## Where each one actually loses

**Twine/Inklewriter** solve authoring, not production. The quality ceiling is high and
the cost is the teacher's evenings; every branch they don't write doesn't exist. They
scale badly across a syllabus for exactly the reason our problem statement names.

**Character-chat apps** are the closest thing to our conversations and the furthest
thing from our product. One character, no world, no state, no evidence, no decision, and
nothing separating what the record says from what the model made up — the failure mode
that makes generated history unusable in a classroom is their core mechanic.

**A generic LLM tutor** can improvise all of it and can guarantee none of it: no
reachability guarantee, no immutable version so that thirty students see the same
adventure, no server-held deadline, no citation discipline, and no teacher review step
between generation and the student.

## Why we win

1. **Production cost collapses without giving up structure.** The LLM proposes a *spec*;
   a deterministic compiler turns that spec into the map (D3). Teachers get the
   generation speed of a chatbot with the reachability and playability guarantees of a
   hand-authored game.
2. **Grounding is enforced, not requested.** Historical claims carry source, page and
   verbatim quote; everything else is labelled as a simulation assumption, and the
   ending debrief shows the two side by side with the point of divergence. Competitors
   have no place to put that distinction because they have no distinction.
3. **It behaves like classroom software.** Publishing is immutable, so editing
   mid-lesson creates a new version and leaves in-flight attempts alone; stage deadlines
   live on the server, so a refresh buys no extra time; a student who closes the tab
   resumes where they left off. None of the three alternatives offers any of this.
4. **Many actors, not one.** Stakeholders have private motivations and act autonomously
   between the player's turns, so the student is reading a room, not interviewing a
   persona.
