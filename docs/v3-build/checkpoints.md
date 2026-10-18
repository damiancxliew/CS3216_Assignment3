# v3 checkpoints: runbooks and cut lists

Owner: Kevin. Each checkpoint is a live run-through on the test school with test accounts, never real teachers'
data. If a step fails, fix it if that takes under an hour; otherwise take the next cut on the list, in order, and
record it here.

## Checkpoint 1 (D1 19:00): `golden-1819` from briefing to reveal
Through the real API, engine and screens (not the mock).

| # | Step | Passes when |
|---|---|---|
| 1 | Start an attempt on `golden-1819` | The role briefing shows identity, stakes and the private brief [P18] |
| 2 | Continue into stage 1 | The central question is always visible; the timer counts down [P7, P1] |
| 3 | Walk to a room and question a character | The reply is in voice; a discovery whose condition is met becomes a note [P7.1, P7.2] |
| 4 | Assert a fact you have no note for | The character questions how you know; no note, no stance change [P8.2, P8.3] |
| 5 | Open a document and select its key passage | A note appears; opening alone made none [P13.1, P13.2] |
| 6 | Insert a note to the character its trigger names | The portrait changes and a subtle notice shows [P6.3, P6.4] |
| 7 | Start the defining moment | Acts shown; a nudge if a core discovery is missing [P9.1, P9.6] |
| 8 | Act, then predict | Immediate reaction, then one-tap predictions without secret or closed outcomes [P9.7, P3.3] |
| 9 | Stage 2 opens | The prediction is revealed with the reason [P3.4, P3.5] |
| 10 | Let the timer run out | The final call brings the defining moment; you still choose [P1.2] |
| 11 | Epilogue, Interview, reveal | Each shows; the reveal leads with what actually happened [E1–E3] |
| 12 | Engine CI | Reachability, walkthrough and leak tests green |

**Cuts if it fails, in order:**
1. Story events reduced to the final call only.
2. Reactions as written text only (no model variation).
3. The map replaced by a room list.
4. Timer off: the student ends the stage with `endStage` only.
5. Hints off.

## Checkpoint 2 (D2 13:00): a generated adventure, end to end
create → review → edit → preview → play → reveal → class summary.

| # | Step | Passes when |
|---|---|---|
| 1 | Create in Standard mode from the 1819 handout | Progress shows; it pauses after the skeleton [T6] |
| 2 | Review and edit the skeleton | `checkSpec` re-runs after each edit [T6.2] |
| 3 | Finish generation | Every `checkSpec` error is repaired or shown [G12.2, G15] |
| 4 | History check of core discoveries | Kevin signs off `history-check.md` [G13] |
| 5 | Review screen, one direct edit | Labels and conflicts shown; the edit sticks [T4.2, T4.3] |
| 6 | Preview as a student | Plays without saving an attempt [T4.8] |
| 7 | Two test students play to the reveal | Both reach an ending |
| 8 | Class summary | Tabs show stuck points, predictions, verdicts, discoveries, endings, answers, flags [T2] |
| 9 | Simulated students | 0 leaks, 0 unearned progress, 0 engine crashes in the latest `sim` summary |

**Cuts if it fails, in order:**
1. Guided mode.
2. Plain-language "regenerate this part" (direct edits stay).
3. Per-stance portraits: one portrait plus the stance notice.
4. Overheard conversations.
5. Secret endings in generated adventures (the golden fixture keeps its own).

## Where Kevin's judgement goes
- **Game feel in the rules:** the reachability test's witness paths, and playing `golden-1819` twice (once on the
  historical path, once off it).
- **The characters' voice:** the persona transcripts from `packages/orchestration/evals/v3-persona.ts`, 10+ replies
  per character, iterating the prompt.
- **Historical accuracy:** `fixtures/golden-1819.review.md`, and `history-check.md` for generated skeletons.

## Cut log
| When | Checkpoint | Cut | Why |
|---|---|---|---|
| 2026-10-17 | 2 | Overheard conversations between characters [P12.2] (#229) | Low priority and "only if easily viable", but it needs a new spec field, generation, an engine event and play UI across all three owners. Characters are still summoned and moved by story events [P12, P12.1]. |
