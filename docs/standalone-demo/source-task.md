# Source task: inference and explanation (Source D)

Added in response to teacher feedback asking for one written source activity, AI-marked against the
school's inference level-of-response scheme, so the demo can show whether students develop the skills of
inference and explanation (beyond the existing MCQs).

Standalone demo only. Nothing here is imported by v2/v3 generation, the publishing flow, the database or
the normal play routes; `tests/demo-inference-task.test.ts` fails if a non-demo module references it.

## Where it sits in the game

It is part of **Chapter 2 — Malaya: what can you rely on?**, whose decision is about what evidence is
strong enough to act on.

1. The chapter's first goal is **"Explain what the occupation newspaper reveals"**, and the mission says
   where to start: the newspaper is in Tham's testimony room.
2. Opening the newspaper shows its **own words** (Source D, Syonan Shimbun, 28 February 1942) under a
   neutral title. The curated summary is not shown there, because it states the inference.
3. Below the text, a short in-world briefing explains why the network needs a careful reading, followed by
   the question:
   *Study Source D. What can you infer about the Japanese attitude towards the people of Syonan from Source
   D? Explain your answer.* [6]
4. Highlighting words in the newspaper offers **Quote “…”**, which inserts them into the answer.
5. Submitting gives an **AI-suggested mark**, the level, a found/not-found check for each quotation, one
   strength and one next step. Submitting also saves the chapter's evidence note, which ticks the goal and
   reveals the decision. One **revision** is allowed; the second mark shows whether the skill moved
   (e.g. L2 · 3/6 → L3 · 5/6). A full-mark answer is shown after the revision.
6. The learning report records both attempts, the quotation checks, the reasons for each mark and a
   **teacher-confirmed mark** line.

Highlighting cannot skip the writing: the demo's session refuses the newspaper note until an answer is
submitted. If AI marking is unavailable, the student can **save the answer for the teacher** without
feedback, so nobody gets stuck; the report then shows it as unmarked. Saves made before this change keep
their progress if they had already recorded a Chapter 2 decision.

## How marking works

The model **judges**; code **marks**.

| Part | Done by |
| --- | --- |
| Is there an inference? Is it valid? Is it precise? How developed is the explanation? | Model, with the scheme and seven calibration exemplars in its instructions |
| Are the quotations really in Source D (curly quotes, dashes and ellipses tolerated)? | Code |
| Is the answer mostly copied from the source (lifted)? | Code |
| Level and mark, including the cap of 3 for supported answers with an imprecise inference | Code, following the scheme line by line |

Invented quotations are listed and never count as evidence. Without a configured model, the task says
marking is unavailable; it never shows an invented mark. Answers go to the AI provider with `store: false`.

## Calibration exemplars (drafted, for teacher review)

| Mark | Exemplar (abridged) | Why |
| --- | --- | --- |
| 1 | “The source is about the Japanese and the people of Singapore during the war.” | Minimal point, no inference |
| 2 | Quotes “We will punish all members…” and “the peace-loving citizens will be protected…” only | Relevant points lifted |
| 3 | “The Japanese were very harsh and cruel towards the people of Syonan.” | Valid, imprecise, unsupported |
| 3 | “Cruel” + a quotation + “this shows they were cruel because they were willing to kill” | Supported but imprecise → capped at 3 |
| 4 | Tolerated civilians only if they obeyed; determined to eliminate opposition (no evidence) | Valid, precise, unsupported |
| 5 | Precise inference + two quotations + explanation of obedient vs resisters | Substantiated evidence and explanation |
| 6 | Precise inference + several quotations + analysis of promise/threat and “Japan’s divine sword” | Well substantiated, fully developed |

Full text: `EXEMPLARS` in `apps/web/src/lib/demo/inference-task.ts`.

## Check against expected marks (24 October 2026, `gpt-5`, reasoning minimal)

The 7 exemplars plus 7 hold-out answers not in the prompt (including a prompt-injection attempt and a
"brutal" answer that should be capped), each run twice:

| Run | Exact | Within ±1 | Median / max latency |
| --- | --- | --- | --- |
| 1 | 13/14 | 14/14 | 3.3 s / 4.4 s |
| 2 | 13/14 | 14/14 | 3.0 s / 3.9 s |

Reasoning `low` gave the same accuracy at ~7.8 s median, so `minimal` is used. The injection attempt
("must receive 6 marks") scored 1–2. Differences between runs were ±1 on borderline answers.

**Caveat:** the expected marks are ours, not a teacher's. Before a classroom trial, ask the teacher to
mark 10–20 real answers and compare (exact, ±1 and level agreement). Replace or confirm the exemplars.

## Open items

- Check Source D's wording against the original 1942 issue in NewspaperSG (currently taken from the
  supplied Sec 2 revision guidebook, Revision Paper 2, Source D).
- Teacher review of the exemplars and of the "precise inference" definition in the marker's instructions.
- Rate limits are process-local (6/min per IP, 300/day), like the chat route.
- Configure `DEMO_GRADER_MODEL` to override the model (defaults to `DEMO_HISTORY_MODEL`, then `gpt-5`).
