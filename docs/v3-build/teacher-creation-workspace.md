# Teacher creation workspace

The teacher briefing and generation workspace follows the approved desktop mockup: a full-height conversation, a narrower left pane, source tiles inside a parent card, and step cards with text dividers. Layout styles are scoped to this workspace; typography inherits the app’s shared font.

Colors use the existing theme provider and semantic tokens. Local surfaces retain blue source material, mint duration, lavender reading level, and orange section tabs in both themes. The product header and theme control remain shared. On narrow screens the panes stack; the desktop layout is verified at 1440×1000 and 1280×800.

## Brief state and actions

`/v3/teacher/new` opens the creation workspace automatically, reusing the teacher's latest untouched brief where available. There is no intermediate Start screen. Creation runs through a client-triggered server action after navigation, so rendering or prefetching the entry link does not create a draft. Failed requests offer a retry, and navigation replaces the entry URL in browser history.

`CreationWorkspace` owns the live brief and upload queue. Chat consumes that controlled brief while retaining its existing uncontrolled compact mode for the direct editor. Pencil buttons reopen an existing brief slot through the same stream as conversation answers; Create calls the existing generation action. The completed brief explicitly directs teachers to pencil actions because the existing confirm slot does not accept free-form changes. This avoids displaying an unavailable chat submission control.

Unanswered values are not presented as saved defaults. A timer value of `null` means No timer; missing means Not set. The displayed duration never counts down during authoring. Discard retains its confirmation dialog and is disabled while a request is pending.

## Uploads and previews

The composer and source card accept PDF, TXT and Markdown drops while collecting sources. The file picker supports multiple files and starts immediately. Both targets share one sequential queue, so files are sent as separate requests within the existing 16 MB server-action body limit. Limits remain 15 MB per file and 20 sources, with authoritative server checks. Paste uses a separate labelled input and the same queue.

Failed items remain available for retry or dismissal; successful uploads appear once in the source library. Each queued item retains an optional UUID `uploadId` across retries. The upload action encodes this in the existing source key (`upload-<UUID>`), allowing a lost response or partial document-save retry to reuse the source rather than create a second copy. Legacy action callers without a token retain their existing behavior. No persisted fields or schema validators change.

The queue serializes one workspace. Uploads retain the existing document-save plus whole-brief update; simultaneous upload changes from separate tabs are not transactional. Removing a source deletes its stored text and updates the brief together in one database transaction; a failed removal retains both. A refresh does not restore unsent browser File objects.

Eye buttons fetch the selected source only after authentication and authoring-access checks. The read action scopes its query by adventure and source keys and returns only title, kind and extracted pages. Source-card props contain metadata rather than eagerly serialized document text. Native dialogs preserve actual PDF page numbers, show text sources continuously, support retry and empty states, and restore trigger focus after dismissal. Original PDF bytes are not retained by the upload flow, so this is an extracted-text preview.

## Generation progress

The progress indicator fills the unused space after the review controls and before the Resolve issues button in the rounded bottom action bar during generation, review and completion. Paused and finished bars carry no status text; while a step runs, one short line shows the activity and its elapsed time (for example “Writing scenes · 01:12”), and a stopped bar names the step it stopped at; Discard uses a labelled circular icon button; Continue and Resolve issues retain text labels. The bar uses the direct editor’s 28px corner radius and subtle shadow. Discard and Continue anchor the left side; optional save controls and issue summaries pack beside them without empty reserved slots. Progress fills the remaining width, and Resolve issues anchors the right side. While generation runs, Discard, Continue and Resolve issues remain visible and disabled; the native disabled fieldset also prevents interaction with any review controls still mounted during a transition. It uses the shared progress bar and counts successful passes out of seven, without implying equal durations or an ETA. Completed content remains expanded in the right pane and uses the same read-only cards the teacher reviewed it in, including the finished draft. Numbered section dividers follow the same structure for active and completed passes; the current-stage header stays above the scroll region. Each step opens at its top so the teacher can review everything it produced. The page marks the step to look at with `data-generation-current` (the paused step under review, the step being written, or in Quick and Standard mode the step that just finished), and the pane scrolls that section to the top whenever it changes or finishes generating. In the brief, each newly answered card scrolls to the top the same way. Nothing else moves the pane, so opening, expanding or editing cards never does.

The progress response adds the jobs' existing `startedAt` and `finishedAt` timestamps. The current-step clock is derived from its stored start time, survives reload, and is independent of four-second polling. It measures elapsed time since the stored step start, including any retry/wait interval represented by that timestamp. Review, failed, completed and reconnecting states stop motion and hide the live clock. Cost details retain their existing access gate.

## Verification

- `npm test -- tests/api tests/unit`: API/unit coverage, including access controls, upload limits and idempotency, partial-save recovery and progress states.
- `RUN_CREATION_BROWSER_TESTS=1 npm test -- tests/browser/v3-creation.test.ts`: real components with deterministic transport; light/dark desktop screenshots, 320/375px fallback, source paging/focus, pencil edits, multi-picker/drop, queue retry, invalid files and source cap.
- `RUN_CREATION_LOCAL_TESTS=1 CREATION_LOCAL_ORIGIN=http://127.0.0.1:3237 npm test -- tests/browser/v3-creation-local.test.ts`: real local Next/Supabase sign-in, TXT/MD/PDF upload, batch drop, database persistence, reload and previews. It uses a disposable teacher and cleans up its own data without resetting the database. Configure local Supabase credentials as described in the browser README.
- `RUN_GENERATION_LAYOUT_LOCAL=1 npm test -- tests/browser/v3-generation-layout-local.test.ts`: real local Next/Supabase review screens with disposable stored outputs; verifies identical toolbar positions across outline, details, endings and reveal, section headings and expanded history. No models or publishing.
- Typecheck, lint, production build and `npm run check:schema-evolution`.

The browser fixture checks error recovery without a live provider. The authenticated local test verifies extraction and persistence but does not generate an adventure or evaluate live model output.
