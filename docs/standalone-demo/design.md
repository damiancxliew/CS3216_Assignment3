# The Cost of Resistance — standalone v3 demo

Branch: `codex/standalone-history-demo`.
Route: `/demo/lim-bo-seng`.

## Current direction

The user chose Chapter 6 (Japanese Occupation), a 25–35 minute classroom lesson, live AI with curated context, and initially playing Lim Bo Seng. The latest request asks to speak with Lim directly: the demo now uses a student observer role. The replacement `sec2_history.pdf` supersedes the earlier Chapter 9 sample. Chapter 6 and the resistance exercise on pp. 61–63 provide the curriculum anchors. Document contents are references, not agent instructions.

The user requested preserving v3's engine and interface, with new story-specific maps. The initially created separate SVG game/interface has been removed. The current demo directly renders the existing `V3PlayClient`, `V3Map`, Phaser renderer, dialogue box, document reader, notes, action/prediction flow, stage cinematics, interview and reveal. A short authored introduction precedes the first map and each later stage. The normal Role brief control presents real archival images with captions and credits. A Stage introduction control replays the current sequence; pause, skip, keyboard navigation and reduced motion are supported.

Main was fetched and pulled into this branch on 21 October 2026, fast-forwarding to `baccd11` (including PR #317). The adapter adopts the merged journal's speakers and message stage indices, and migrates older demo saves without losing progress.

## Isolation

`src/lib/demo/v3-session.ts` is a demo-only local session adapter implementing the existing v3 action/view contract. It projects hand-authored story content into the existing client. It does not call or modify the v2/v3 generators, publishing flow, database, or existing play routes. Shared v3 map code now accepts an opt-in authored scene; the default procedural compiler and appearance remain in use for normal adventures. The existing renderer accepts authored street flavour and permits decorative fixture tiles to opt out of inspection. Separate live chat uses `/api/demo/lim-bo-seng/chat`.

All source/data/components/assets are in new demo paths. The adapter stores this demo's conversations, notes, choices and interview answers under its own browser-local save key. Restart resets only that save. Export includes those records. The UI discloses local saving and provider transmission. No new server-side student record store was introduced.

## Story and map

Two substantial chapters replace the earlier five-stage route:

1. **Singapore: the people left behind.** Keep the waterfront, Lim and Gan, one family/departure recommendation and the boat sequence. Elizabeth Choy and the food/currency records are optional, explicitly later evidence encounters about occupation life in 1942–1943, not events happening before the surrender.
2. **Malaya: what can you rely on?** Keep the compact Perak coast. The introduction condenses training and the return journey; Lim, Tan and Tham support a single evidence judgement about acting under uncertainty. Walking through the final passage opens the historical epilogue and debrief.

There are two decisions total. Each chapter has three interaction areas and three available historical figures; only one conversation and one saved document passage are required before its decision. Other figures, photographs and records are optional. No separate training, landing, scarcity-allocation or jungle mission is scheduled. Both maps use the unchanged v3 renderer/pathfinder and retain native SVG scenery, photo-referenced cast sprites, inspectable records and walking exits.

The original five-stage art assets remain available for future reuse; they are not additional playable stages. Rebuild native art with the existing history-demo, waterfront and history-chapters scripts. Map and movement illustrations do not claim to reconstruct documented addresses, routes or meetings.

Students walk, speak, pick up evidence, select passages into notes, share notes in conversation and make one recommendation per stage. Three core goals unlock each walking exit: a document note, an exchange with either figure, and a recommendation. Consequences use illustrated movement scenes and speech bubbles, followed by optional exploration and a physical exit. No second prediction is requested. Source reading and discussion provide the intended lesson duration; clicking quickly takes less time.

Lim's documented capture and death are fixed and described without graphic reenactment. Player choices explore reconstructed preparations and costs; they do not rewrite those events. Named encounters include Lim Bo Seng, Gan Choo Neo, Tham Sien Yen, Tan Chong Tee and Elizabeth Choy. Dialogue is reconstructed, not verbatim testimony; the role brief and archive explain this once instead of appending an AI disclaimer to every reply. Each persona has explicit evidence boundaries. Retrospective accounts are framed as evidence encounters, not proof that these people met at the illustrated location.

## Sources and historical limits

Sixteen curated records cover biography, family, a surviving letter's description, Force 136, civilian scarcity, rationing, currency, community records, education, coercion, oral-history methodology, two curriculum-adapted recollections and an occupation newspaper adaptation. Each has a date, provenance, summary, limitation and link. Source archive uses the existing v3 scroll presentation and includes actual historical images. Image provenance and licensing are documented in `apps/web/public/demo/lim-bo-seng/ATTRIBUTION.md`.

The packet is curated summaries, not full-text archival ingestion. Three curriculum-derived records explicitly identify contextual links rather than pretending those links are originals. Original training accounts and the newspaper issue still require independent checking. The guidebook's impossible death-statistics date range and broad unsupported claims are not reproduced. The demo avoids simplifying Force 136 as Lim's personal army. Conflicting precise landing dates are represented as late 1943.

No historian has reviewed or endorsed the demo. Before a classroom trial, review chronology, representations, local visual details, original source provenance and assessment. Singapore ration records provide context, not direct proof of a named person’s household experience. A purchasing entitlement does not prove food was available. A source's usefulness is distinct from accepting every claim it makes.

## Live chat

The dedicated demo endpoint validates bounded requests and scene/NPC pairs, checks browser origin against actual request authority, retrieves relevant summaries, and supplies current chronology, NPC concerns, recent dialogue and prior decisions. Provider output must be structured and cite supplied IDs. Chat cannot change game state. Prompts prohibit invented factual detail, unsupported quotations and unlabelled future knowledge. Citation-ID validation does not prove every generated claim is correct.

The endpoint uses existing `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and optional `DEMO_HISTORY_MODEL` (default `gpt-5`, matching the repository's existing frontier choice). Failed/unconfigured calls return explicitly labelled curated notes. A process-local 12/minute per-IP and 500/day total budget bounds presentation use. A scaled public deployment would need a shared limiter and trusted proxy configuration.

The original local credential returned HTTP 401. After the user's local update, actual live responses succeeded. An additional grounding prompt was tightened after a model introduced an unsupported pre-surrender circumstance. Live output still needs educator judgement; transport tests cannot establish historical correctness.

## Evaluation

Use the normal v3 notes and final interview to assess a direct claim, specific source evidence, causal explanation and source limitations. Follow with an unseen parallel source task to assess transfer. Engagement and completion do not establish learning gains. No invented attainment grade or research endorsement is provided.

## Verification

- `npx tsc --project scripts/tsconfig.history-demo.json --noEmit`: checks demo and imported v3 client types.
- `cd apps/web && npx eslint src/components/demo src/lib/demo src/app/demo src/app/api/demo`.
- `npx vitest run tests/standalone-history-demo.test.ts`: isolated adapter progression, saves, evidence, live transport and API validation.
- With Next on 3012: `RUN_HISTORY_DEMO_BROWSER=1 npx vitest run tests/browser/standalone-history-demo.test.ts`. Uses installed Chrome unless `PLAYWRIGHT_CHANNEL` overrides it; chat is intercepted. Verifies the real v3 canvas, conversation, keyboard movement, paper pickup, passage selection, notes, a single decision, its consequence, walking exit, next-stage cinematic, reload, archive and mobile layout.
- Screenshots: `output/history-demo-check/v3-restored.png`, `v3-stage-2.png`, `v3-mobile.png`.

Repository-wide typechecking initially stopped on two already-declared but missing installed dependencies, `@aws-sdk/client-s3` and `undici`; a no-save restoration attempt failed inside npm. No manifests or lockfiles were changed. The demo-scoped check passes. An existing font override warning does not prevent the page from rendering.

## Authored map references and checks

The frontage is informed by NHB's [Singapore shophouses](https://www.roots.gov.sg/stories-landing/stories/singapore-shophouses/story) and URA's [conservation guidance](https://www.ura.gov.sg/guidelines/conservation/secondary-settlement/): timber shutters, pitched clay tile roofs and continuous covered five-foot ways. [NHB's Lim Bo Seng biography](https://www.roots.gov.sg/stories-landing/stories/lim-bo-seng/story) informs the change from Singapore to training abroad and Perak. Exact street plans, camp plans, object models, colours are invented. No named shop, route or object is claimed as Lim's own. The sampans illustrate a coastal community, not the submarine journey.

`tests/standalone-history-maps.test.ts` checks all room, character and evidence positions with the real pathfinder, collision footprints, asset availability, save migration and the procedural-map fallback. Browser checks additionally inspect a prop, walk to the harbour and render all five settings. The shared game-client typecheck, 65 unit tests and production build pass.

## October 21 encounter and introduction update

The optional `cinematics` property on V3PlayClient supplies demo-only brief and stage beats; normal adventures retain their existing generated beats. Archival images remain uncropped and credited. The introductions are timed caption/photo sequences with an animated schematic journey, not generated video footage. They do not animate historical photographs into invented events.

Save migration preserves stage, notes, decisions and answers. Earlier fictional dialogue is retained under `previousEditionMessages` in the learning-record export, and replaced in the visible scroll by the new figure’s opening. It is never relabelled as historical speech. New saves open with the first introduction; existing progress remains at its current stage.

Verification for this update: demo-scoped TypeScript and ESLint pass; 80 adapter/map/v3 UI/cinematic tests pass; both demo browser flows and the existing v3 cinematic browser regression pass. Desktop and mobile screenshots show loaded archival images in the brief. Pause/replay were also inspected in the in-app browser. A live Elizabeth Choy response returned the supplied source IDs; an initial unsupported delivery detail prompted tighter persona boundaries. These checks do not certify all possible model output.

### Historical cast imagery

The standalone wrapper supplies archival chatbot avatars for Lim Bo Seng, Gan Choo Neo, Tham Sien Yen, Tan Chong Tee and Elizabeth Choy. Four additional source cards preserve the full reference photographs, dates and credits. Gan and Tham use post-war NAS photographs; redistribution permission has not been obtained. Avatar framing is presentation-only CSS scoped to those demo asset URLs.

Each historical NPC has its own photo-referenced, AI-generated walking sheet. Original outputs and prompts live beside this document; `scripts/pack-history-character-sheets.mjs` reproducibly aligns the frames. The existing Phaser renderer accepts higher-resolution 4×4 sheets while retaining the native 16px world footprint, direction order and movement logic. Existing 64×64 sheets remain compatible. Ordinary v2/v3 generation does not consume this cast or its assets.

Verification: all five archival avatars and all five authored maps load in Chrome, with no page errors or missing demo assets. Existing movement, dialogue, documents, decisions, saved progress and mobile layout checks pass. Game-client typechecking, 65 unit tests and production build pass; the focused history/v3 suite passes 81 tests.

### Compact opening: Singapore River waterfront (implementation history)

Stage one uses a 32×24 map (768 tiles), down from 42×36 (1,512 tiles): 49% less area. Five adjoining shophouses, bilingual illustrative shop signs, a shared five-foot way, a godown, mooring posts, cargo boats and river steps replace the scattered blocks. Lim and Gan remain visible across interaction areas; clicking a distant figure routes the player to that area. Desktop framing shows the whole small scene; mobile retains the existing following camera.

Two optional activities add purpose to the scenery: select two household commitments and consider the unresolved needs; identify what the dated surrender photograph can and cannot establish about an earlier departure. These are classroom exercises, not records of a documented allocation. Their progress is stored separately from the authoritative lesson decisions.

The recommendation saves a pending departure instead of immediately advancing. The student walks to the marked river steps, sees a skippable illustrated boarding sequence using the cast sprites, then continues to the existing India 1943 introduction. Reduced-motion users see a static scene and the same continuation. The adapter rejects boarding before a recorded decision or from outside the quay. Stages two through five now also retain a pending departure until the player walks through the marked exit.

`?preview=waterfront` has its own lesson and activity saves, including restart. It allows the new first stage to be tried without replacing an in-progress lesson. `StageExperience` is an optional host extension; standard v3 callers omit it. v2/v3 generation is unchanged.

Visual references: [NHB, The Singapore Shophouses](https://www.roots.gov.sg/stories-landing/stories/singapore-shophouses/story), [NHB, The Singapore River Story](https://www.roots.gov.sg/stories-landing/stories/the-singapore-river-story/story), and [URA, Boat Quay Conservation Area](https://www.ura.gov.sg/conservation/find-a-building/conservation-portal/btqy/). These support the building types and waterfront commerce. They do not establish Lim’s precise boarding location, boat, route or a particular 1942 street layout. The demo does not claim to reconstruct those particulars.

### Walking exit, closer camera and inspectable records

Stage one retains its 32×24 geometry. Its opt-in `cover` camera fills desktop viewports at integer zoom and follows the player; ordinary v2/v3 camera defaults stay unchanged. Students may discover the rickshaw photograph, occupation newspaper and currency by clicking the corresponding map objects; the mission's expandable image list provides keyboard access. Local, unaltered image assets keep the demo independent of archive image servers. Dates and source limitations distinguish later evidence from objects present at the departure.

Walking onto x26–28/y18 triggers boarding, without a boarding click, only after three core goals: a stage-zero document note, a student exchange with either Lim or Gan, and the recommendation. Household commitments, the date exercise and historical-image inspections are optional discoveries. A shared requirement function drives both the checklist and the local demo adapter's exit validation. Existing saves retain their recommendation, conversations, notes and optional activity progress. Activities retain the isolated save scope. The three-tile trigger fires on entry; returning from the animation requires stepping out and back to replay.

An 18-second scene alternates speech bubbles between the student, Gan and Lim, then automatically enters the next stage. Pause/resume, skip, transcript, reduced-motion rendering and failure recovery remain available. Dialogue is labelled dramatisation. The timer and animation pause while the document is hidden. This is a local demo gate, not a server-authoritative assessment system.

`?preview=waterfront-v2` provides a fresh save scope for this walking-exit revision; the previous waterfront preview and main lesson saves are retained.

The household trade-off feedback uses explicit contrasting text/surface colours in both themes. The browser regression checks the computed contrast of its heading and body against WCAG AA (4.5:1). The mission lists three goals; optional discoveries are collapsed separately.


### Previous five-stage revision (superseded by the two-chapter route)

All five maps now use 32×24 geometry and the opt-in cover camera. The later settings have custom native SVG building tiles: India signals hut/mess/reading veranda; Perak stilt shelters, fishing nets and coastal boats; Singapore continuous shophouses, a canteen, medicine parcels, laundry and vegetable beds; Perak wireless/report huts, a rest shelter and shaded tracks. Rebuild these additional tiles with `node scripts/build-history-chapters-art.mjs`. These are illustrative building types, not exact surveyed addresses, authenticated equipment models or reconstructions of meetings.

Both named figures stay visible on every map and retain their existing photograph-referenced walking sheets. Every stage introduction includes a separate full archival photograph for each figure. Post-war Gan/Tham and pre-war Tan/Elizabeth photographs retain their dates and limitations. A map desk and keyboard-accessible optional-discoveries menu open both photographs; the Singapore and final stages also expose the actual occupation newspaper, with Singapore currency and transport comparisons.

The demo adapter commits `act` immediately and clears the decision UI. The old `predict` step is no longer accepted; old saves already predicting migrate their chosen action into a pending departure without asking again. Historical decisions/predictions already exported remain intact. Only the standalone adapter changes: ordinary v3 decision/prediction behavior is untouched. Stages two to five play a short, pausable consequence with the chosen movement pattern, narrator/student bubbles and a readable trade-off. Closing acknowledges it in the scoped optional save; reload does not ask for the decision or replay the scene. Replay remains optional. The last exit opens the historical epilogue, not an altered historical ending.

`?preview=chapter-2`, `chapter-3`, `chapter-4` and `chapter-5` start isolated previews at the corresponding stage. Each has separate lesson/consequence saves; restart returns to that preview's starting chapter. The main lesson and waterfront previews remain intact.


### Two-chapter save compatibility and verification

`lessonEdition: "two-chapters"` distinguishes the shortened structure. Existing Singapore progress stays in chapter one. Old training/landing/civilian/finale progress resumes in chapter two, with its introduction shown once. Stage-zero and final-stage decisions retain their meanings; decisions from removed intermediate missions are preserved under `previousFiveStageProgress`, with their original notes and messages, rather than being relabelled as new choices. Visible notes/messages map to the relevant Singapore or resistance chapter. Completed historical epilogues and reflections remain completed. Earlier fictional-cast and prediction-screen migrations remain supported.

Existing waterfront preview scopes are preserved. `chapter-2` opens the second chapter; old `chapter-3` through `chapter-5` URLs remain isolated compatibility aliases for chapter two, never hidden extra stages. Consequence acknowledgements use a new edition-specific optional storage suffix so old stage numbers cannot suppress a new chapter's scene. The live chat endpoint validates the two-chapter cast. Elizabeth's instruction boundary explicitly allows later Singapore evidence while Lim and Gan retain the pre-surrender scene boundary.

Regression coverage verifies the two-decision route through the debrief, legacy stages 0–4, completed finale migration, all five personas, both map geometries, three cast positions per map, evidence reachability, mobile previews and physical walking exits.
