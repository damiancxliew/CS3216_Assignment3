# V3 evidence checks, preparation, and guidance

Status: implemented on `feat/v3-evidence-preparation`, incorporating the discussion on 27 October 2026. Verification and remaining limits are recorded below.

## Outcome and scope

Generated v3 adventures should require students to understand relevant evidence before speaking with a character and to learn from every essential character before making the stage decision. Extend the existing discovery events, conditions, notes, stances, and hints. There is no global score or per-character score.

This work covers reading checks, prerequisites, recoverable consequences, essential conversations, and prominent guidance. The remaining Lim Bo Seng feedback about room size, art consistency, and navigation is separate. The hand-authored demo is not automatically upgraded by changes to generation.

## Reading checks and highlighting

- Give each scroll one reading-check objective and four prepared question variants. Each variant offers three plausible interpretations and requires a supporting selection from the scroll. Test meaning, inference, or source limitations; avoid obvious recall and distractors that reveal the answer without reading.
- All variants check the same main point. Author accepted supporting spans and an explanation alongside the question. Validate that supporting spans occur in the document and support the intended discovery. Keep answer keys and accepted spans private to the server and teacher editor.
- Replace overlap-only granting for documents with reading checks. A successful check requires both the correct interpretation and adequate supporting evidence. Selecting a key passage alone must not grant its discovery before the check is complete.
- Validate the raw highlight against an authored supporting span before normalizing its presentation to sentence boundaries. Default to requiring coverage of at least 80% of the non-whitespace characters in each supporting sentence, with up to one immediately adjacent sentence of context. Reject larger selections and selections containing unrelated paragraphs. Validate offsets, coverage, and context against the pinned document on the server, rather than trusting client selection handling.
- Author alternative valid supporting spans where the source permits them. Snapping a partial phrase to a whole sentence must not increase its grading coverage. Flag questions whose entire document would fit inside the accepted selection for revision into a more discriminating task. The 80% coverage default supplies selection tolerance; it is an implementation default to validate with real touch and mouse selections.
- On success, grant the supported discovery using the existing event. Afterwards, allow highlighting to collect the scroll's other eligible notes. Reopening the scroll does not require passing the check again.
- Keep completion, first-attempt outcome, submission history, and current variant in the attempt. Reopening, refreshes, concurrent tabs, duplicate requests, and stale variant submissions cannot reset attempts or duplicate discoveries.

There are two different buffers: alternative evidence routes provide flexibility in preparation, and bounded selection tolerance accommodates highlighting. Neither grants completion for selecting indiscriminately. These checks establish a supported answer; they cannot prove that a student read every sentence.

## Wrong answers and recovery

- One wrong submission consumes the active question and marks the scroll as needing review. Do not identify the correct option or reveal whether the interpretation or selection was the incorrect part.
- Prevent immediate resubmission. Before receiving a different question, the student must complete a different relevant evidence task or a guided correction on the current source. Once eligible, offer a different prepared variant; cycle the fixed bank after exhaustion. There are no replacement-question model calls during play.
- Author the recovery route with the source task. It must be accessible without the discovery being recovered or a conversation that discovery unlocks. Guided correction asks the student to identify what a relevant source sentence supports, with a narrower source-grounded prompt; opening a hint or waiting does not itself complete correction.
- If the student presents an unsupported interpretation to a character, use the existing challenge and stance system. A supported correction must provide a recovery path; repeatedly submitting the same claim must not farm triggers or permanently remove an essential conversation.
- Keep private reading-check failures separate from character knowledge. A character's response changes when the student actually presents the unsupported claim. Do not make every character react to a private quiz attempt.
- Record first attempts and later corrections separately for teacher review. Completing recovery does not erase the original attempt or create a numerical attainment grade.

## Character and decision prerequisites

- Author a relevant prerequisite set for each character in each stage. Remove the earlier arbitrary default of one document discovery. The number and content follow what students need to discuss with that person.
- Represent preparation as groups of discovery IDs with a minimum completion count; every group must be satisfied. This supports an essential discovery plus one of several relevant alternatives. Discovery IDs must be distinct within a target's groups so one fact cannot count twice for that target.
- Show a short count beside locked interactions, such as "1 of 3 preparation tasks complete." Count only the required amount within alternative groups. Explain how preparation works when introduced; use hints to guide students towards the missing evidence.
- Apply conversation requirements to messages and note-sharing actions in the engine. Preparation allows conversation; existing stances and evidence conditions still govern what the person reveals. Discoveries remain idempotent, and conversations do not earn points.
- Explicitly identify every essential character for the stage and the information a qualifying exchange must establish. Require a substantive student exchange and server-confirmed acquisition or discussion of that character's designated information. Opening dialogue, greetings, unrelated messages, and notes obtained before a response do not count as completed conversations.
- Require every essential conversation before a stage decision. Also enforce the authored essential evidence and alternative groups during normal progression. Show both preparation progress and "Essential conversations: 2 of 3."
- Preserve the earlier timer exception only for additional evidence preparation. At expiry, students may decide once all essential conversations are complete. The timer and timer-triggered story events cannot bypass essential conversations or grant missing discoveries. If any remain, show the final call once and keep investigation open; permit the decision when the remaining essential exchanges complete.
- Reject circular requirements, inaccessible recovery routes, and prerequisites dependent on a character's own locked information. Validate normal progression without timer expiry and across authored placement/situation variants. Essential characters must have a reachable qualifying exchange, including after recoverable mistakes.

## Hints and prominent instructions

The current upper-right mission panel is collapsible and starts folded on small screens. Important instructions must also appear at the point where the student needs them.

| Situation | Presentation and behavior |
| --- | --- |
| Stage begins | Put the objective, essential people, and preparation rule in the existing stage-introduction dialog before the stage timer starts. Avoid a second consecutive introduction dialog. |
| First reading check | Explain answering and highlighting inside the open scroll, including what happens after a wrong submission. Keep the guidance beside the task; do not stack another modal over the scroll. |
| Student attempts a locked conversation or decision | Open a short dialog with the outstanding count, essential-conversation status where relevant, and an accessible next-step hint from the existing hint system. Dismissal returns to exploration and grants no progress. |
| Reading check fails | Show the consequence and recovery action prominently inside the current scroll. Do not rely on a corner message or briefly displayed toast. |
| Student becomes stuck | Extend existing timed hint escalation to follow unfinished preparation dependencies. Prioritize a locked character in the current room, then decision requirements, and target an accessible task. Keep answers and undiscovered facts private. |
| Decision becomes available | Show a once-per-stage notice with "Review decision" and "Keep exploring." Reviewing opens the existing decision flow. Keep progress visible after dismissal. |
| Student chooses to end investigation | Use a dialog to confirm that exploration ends, replacing the small inline confirmation in the mission panel. Name the actual decision where the authored content supports it. |
| Timer expires | Make the final-call message prominent and explain any essential conversations still required. Offer the decision when permitted by the timer rule above. |

- Keep routine progress counts and location in the mission panel. Reuse the existing dialog and cinematic visual language. Avoid repeated instructions across dialogs and the panel.
- Queue automatic notices until an active scroll, conversation, cinematic, or other modal closes. Do not steal focus or stack modals. Coalesce overlapping decision-ready and timer notices into the current next action.
- Remember automatic guidance dismissals per attempt and stage in client storage, allow replay through help, and tolerate unavailable storage. These acknowledgements never affect authoritative preparation or eligibility.
- Support keyboard dismissal, focus containment and restoration, mobile scrolling, and reduced motion. Lock map controls while a dialog is open. Returning focus must not accidentally trigger movement or submission.
- Apply the humanizer skill to new instructions, questions, feedback, and authored hint guidance. Preserve historical quotations exactly.

## Interfaces, generation, and editing

- Extend the strict v3 spec with optional document reading-check banks, recovery tasks, stage preparation groups, essential character IDs, and qualifying conversation discoveries. Existing specs without these fields retain current behavior.
- Generate question and recovery content with stage details. Extend the linking output to author preparation groups and essential conversation requirements once document and character discoveries are known.
- Validate question coverage, source spans, recovery independence, references, alternative counts, and reachability. Preserve requirements through discovery deduplication and assign repairs to the owning stage or linking part.
- Add a bounded client action for reading-check submissions containing document ID, active task/variant ID, interpretation choice, and supporting selection. Use the existing revision-protected action path. Any recovery submission is also checked by the engine.
- Add reading-check state and essential-conversation progress to attempt JSON. Derive preparation counts from authoritative discovery events and qualifying exchanges. Normalize absent state fields when loading existing attempts.
- Project only active public questions, source text, completion/recovery status, safe hints, and preparation counts. Private marking rules, accepted spans, persona information, and undiscovered facts remain server-side.
- Include the question bank, recovery route, preparation groups, and essential-character designations in teacher review and editing. Revalidate them when source text, discoveries, or requirements change. Expanding chat to arbitrary structural edits is separate work.
- Use the same engine behavior for teacher preview and student play. Add no SQL migration solely for these JSON fields. Existing published snapshots and attempts remain pinned to their existing content.

## Implementation order and acceptance checks

Implement in thin slices: contracts and validators; one checked-scroll path with recovery; character and essential-conversation requirements; generation and teacher editing; hints and dialogs. Verify each working slice before expanding it.

1. Reading checks: a correct interpretation with inadequate evidence fails; incidental overlap, broad highlights, unrelated paragraphs, forged variants, and immediate retries cannot bypass the task. Valid support with allowed surrounding context passes once. A wrong answer requires actual recovery, and the replacement variant differs from the previous one.
2. Preparation: irrelevant discoveries do not unlock a character. Essential-plus-alternative groups produce accurate counts without double counting. Notes, stance triggers, messages, refreshes, concurrent requests, and asynchronous checks cannot bypass requirements or duplicate completion.
3. Essential conversations: all designated people must contribute relevant information before the decision. A greeting does not count. Delayed conversation checks update progress correctly. Verify qualifying exchanges involving shared notes and slant confrontations as well as newly granted notes.
4. Recovery and timer: required tasks always have an accessible recovery route. Corrected claims permit continued essential interaction. Timer expiry waives only additional evidence requirements, announces the final call once, and never skips an essential conversation.
5. Generation and editing: reject stale source spans, trivial full-document support, circular locks, insufficient alternatives, and unreachable essential exchanges. Requirements survive merge, deduplication, repair, teacher edits, publication, and resumed attempts. Review question quality with realistic sources; structural validation alone does not establish instructional quality.
6. Guidance: check desktop, mobile, keyboard, collapsed-panel, and reduced-motion flows. Verify stage instructions, locked interactions, recovery, decision readiness, and timer notices when another dialog is already open. No automatic notice steals focus, repeatedly reopens after dismissal, or begins a decision without the intended transition.
7. Compatibility: legacy v3 specs/attempts, existing preview behavior, and the standalone demo retain their current behavior when the capability is absent. Verify that the public view exposes no private marking or future content.

Run affected package typechecks and tests for spec-v3, engine, generation, and play-contract; focused web API, preview, editing, publication, and UI tests; and real-browser progression checks using the installed harness.

## Implementation and verification

The spec, generation passes, authoritative engine, preview/action services, teacher review/editor, class summary, and player UI now support the mechanism. Existing publications without the optional fields retain their gameplay. No SQL migration or dependency installation was required.

Independent review added regressions for secondary-note highlight sweeps, checked-source dependency cycles, one-shot stance transitions, optional evidence missed in previous stages, competing automatic transitions, stale trust recovery across authored consequences, and hints for partially completed conversations. Validation conservatively rejects conflicting automatic stance changes in prepared stages. Reachability remains an optimistic bounded static check; it is not an exhaustive exploration of every runtime state.

Verified runs include 94 spec tests, 11 play-contract tests, 225 orchestration tests, 109 engine tests, 622 web API and unit tests, 63 top-level demo and compatibility tests, and 255 generation tests (one existing test remains skipped). Package and web typechecks, scoped ESLint, and the Next production build pass. The build reports existing warnings in unrelated modules. Browser fixtures exercise the actual engine, projection, map, and UI with deterministic model/transport substitutes: desktop and mobile reading/recovery/essential-conversation journeys; existing Journal and cinematic regressions; teacher review and editor at desktop and mobile sizes. The browser reports and screenshots are in `output/v3-preparation-check/`. Reading checks also retain first-response and correction counts in the teacher's Discoveries summary.

Live provider generation could not be verified because the configured local model relay was unavailable. No provider response or usage was recorded. The local Supabase service was also unavailable, so browser fixtures and action-service tests do not establish live database/authentication behavior. Model-authored question quality and historical support still require teacher review. A fixed question bank and guided correction create a cost for mistakes; they do not prove reading or prevent eventual memorisation.
