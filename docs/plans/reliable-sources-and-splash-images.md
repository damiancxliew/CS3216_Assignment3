# Reliable sources and complete adventure asset management

This is the implementation contract for PR #322, covering source-ingestion failures in
[#308](https://github.com/damiancxliew/CS3216_Assignment3/issues/308), the agreed splash-image
workflow, and walking-sprite review/replacement in
[#323](https://github.com/damiancxliew/CS3216_Assignment3/issues/323). Extend the gallery merged
in [#316](https://github.com/damiancxliew/CS3216_Assignment3/pull/316). Keep #323 open until its
implementation and verification are complete.

## Outcome and boundaries

Use one **Assets** tab with three sections:

| Section | Slots | Actions |
| --- | --- | --- |
| Stage openings | Every stage, including missing images | Find image, upload, generate with AI, select, remove |
| Character portraits | Every character/stance portrait, including inherited versions | Find image, upload, generate with AI, select, remove |
| Walking sprites | Player and every character, even when actors share a sheet | Choose bundled sprite, upload sheet, generate with AI, select, reset to default |

Selections are unsaved edits until **Save**. Save commits story and asset edits together;
**Publish** remains separate. Candidate creation, loading retries and background jobs never
replace a selection automatically. Selecting an asset does not make it historical evidence.

New stage openings are neutral until a teacher chooses an image. Untouched initial portrait
generation continues. Walking sprites retain existing bundled defaults unless changed.
Sprites belong to the player or character, independently of stage, portrait and conversation
stance. Ambient crowds, animals, terrain tiles and audio customization are outside this work.
Full upload-informed factual query planning/post-skeleton searches (#282) and later factual
source uploads (#307) remain follow-ups.

## Shared contracts and persistence

### Resource registry

Commit server-side provider IDs, labels, capabilities, approved record/image hosts and reuse
handling. Factual discovery uses existing OpenAI web search followed by the application's
DNS-pinned fetcher and HTML/PDF extraction. Preserve factual-domain defaults, NAS/NLB priority
and teacher policy; add approved UN information hosts. Image discovery uses provider APIs:

- Commons: documented search and [image metadata API](https://www.mediawiki.org/wiki/API:Imageinfo).
  Validate responses and sanitize HTML credits/descriptions. Use an identifiable client for
  provider requests, following [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).
- LOC: documented [JSON API](https://www.loc.gov/apis/json-and-yaml/), starting with vetted
  collections and [Free to Use and Reuse](https://www.loc.gov/free-to-use/) resources. Item-level
  reuse checks still apply. LOC is supplemental; its failures never block uploads or Commons.
- UN: teachers supply hosted image URL, original record link, credit and permission/reuse basis.
  No bulk photo harvesting. The [UN usage terms](https://dam.media.un.org/CMS4/Brand/Root/)
  require particular care; external hosting does not establish permission.
- Walking sprites: the existing bundled character catalog supplies defaults. Commons/LOC
  photographs are never offered as walking sheets. Existing shared pack files are never overwritten.

Registry capabilities never override a teacher's factual-source policy.

### Candidates

Add `adventure_media_v3` with candidate ID, adventure, creator, timestamps, stable target kind/key,
origin (`upload`, `commons`, `loc`, `un`, `ai`), pending/ready/failed state and failure information.
Store immutable storage reference or external UN URL, dimensions, format, caption, alternative
text, credit, original source and licence metadata, and sprite layout when applicable. Keep
UN permission/reuse confirmation, confirming user and timestamp private. Pin AI source spec
versions and retain cost, including rejected-generation cost.

Use staff authorization and server-controlled writes. Each request has an idempotency key and
input hash; reusing a key with different input conflicts. A candidate has no global selected flag.
Only its selected public presentation snapshot is delivered to student playback.

### Versioned selection

Add optional maps under `authoring`:

| Map | Key | Selection |
| --- | --- | --- |
| `stageImages` | Stable stage ID | Explicit fallback or immutable candidate snapshot; legacy artwork captured by stage ID |
| `portraitImages` | Existing character/stance portrait key | Explicit fallback or immutable candidate snapshot; overrides inherited portraits |
| `walkingSprites` | `player` or `character:<characterId>` | Bundled ID or custom-sheet snapshot, with actor-appropriate bundled fallback |

Add dedicated `stageImage`, `portraitImage` and `walkingSprite` editing commands. During optimistic
version Save, resolve candidate IDs, ownership, readiness and target compatibility on the server.
Generic edits cannot fabricate URLs, licences or sprite selections. Preserve media metadata during
story edits and AI repair, outside model-authored generation output.

Share resolution between inventory, preview and student playback. Pass presentation descriptors
into existing components and actor `sprite`/`spriteSheetUrl` fields without changing gameplay,
movement or collision. Record resolved bundled IDs on explicit bundled selection or reset so
publications remain stable if a later draft changes character descriptions.

## Ordered implementation slices

### 1. Recover downloads and PDF extraction

Return bounded bytes and response metadata before choosing an extractor. Preserve DNS pinning,
public-address checks and per-redirect policy validation. Support HTML/plain text and PDFs using
the existing extractor, keeping numbered citation pages. Retain the 2 MB HTML limit and 15 MB PDF
limit, page limits and extracted-text limits.

Distinguish empty responses, genuinely short text, malformed PDFs, scanned PDFs without a text
layer, unsupported content and HTTP failures. Retry empty responses, timeouts, 429 and transient
5xx responses once within the remaining budget; do not retry permanent 403/404. Enforce a
240-second source pass, at most 180 seconds for search with 60 seconds reserved for retrieval
and extraction, and keep the per-fetch timeout. Target five accepted sources from at most fifteen
candidates, fetching no more than three concurrently and replacing failed candidates with later hits.

Investigate NLB from the same deployed worker: compare pinned fetch and curl for identical URLs,
recording request headers, redirects, response headers/status, bytes and timing. Earlier investigation
reported empty HTTP 202 from pinned fetch and extractable HTML from a separate curl request; that
alone does not establish a deployed-worker fix. Apply a header/client adjustment only after proving
its benefit while retaining DNS pinning. Otherwise mark NLB unavailable and continue alternatives.
Never lower the text threshold or bypass an upstream challenge.

Acceptance: valid PDF retains numbered pages; transient empty response recovers; later candidates
succeed after earlier failures. PDF extraction is not a fix for upstream permission denial.

### 2. Source outcomes and retry

Extend `SourcesOutput` additively with summary counts and candidate diagnostics, preserving existing
accepted documents and rejection fields. Track candidate stage, HTTP status, content type, byte
count, extracted length and reason. Replace “Not used” with collapsed **Couldn't import N sources**
details. Separate no search results, policy rejection, access failure and extraction failure.

Add source-search run records with requester, idempotency key, input hash, state, diagnostics, usage
and results. Explicit Retry at the guided source-review pause uses the existing job runner. Retry
and Continue serialize on the adventure row; Continue fails while an import is active. Append
sources with deduplication, never removing accepted evidence. Persist teacher deselections through
retry and reload. Include retry usage in generation totals. Failed terminal jobs must release the
active-import lock.

Acceptance: Retry adds evidence to the same adventure, preserves deselections, and passes accepted,
selected material, URL/provenance and citation pages to skeleton generation.

### 3. Ordinary-image upload and selection

Deliver candidate persistence, selection metadata, commands and resolvers together. Accept arbitrary
JPEG, PNG and WebP uploads, up to 10 MB and 40 megapixels. Decode, apply orientation, remove metadata,
and resize within 2560 × 2560 without cropping. Store normalized WebP under an immutable candidate
key. Require caption and alternative text, with optional teacher credit/source. Do not imply that an
upload is an authentic historical photograph.

Upload returns a ready candidate without changing the spec. **Use image** adds a local edit. Save
commits image and story changes together. Explicit portrait choices override inherited versions;
removal restores initials. Acceptance: upload → select → Save → reload → preview works, with older
publications retaining their image.

### 4. Unified Assets workspace

Reuse `reviewAssets` and the merged gallery; rename **Generated assets** to **Assets**. Show every
slot once, including missing slots, owner/use, origin/credit, saved version, default/override and
loading/job state. Distinguish saved selections, unsaved selections and unselected candidates.
Filter by stage/character, origin and availability. Preserve story and asset edits across tabs.
Contextual stage/character controls open the same asset workspace at the appropriate slot.

Use playback's saved-version resolution, including inherited portraits and existing artwork.
Separate **Retry loading** from paid generation. Preserve sourced/uploaded aspect ratios in cinematic
presentation, retain AI cinematic treatment, and show credits, alternative text and neutral failures.
Neutral openings and provider outages must not block publication.

Acceptance: every slot appears once, saved labels agree with playback and tab switching preserves edits.

### 5. Walking sprites in inventory and map

Use one `resolveWalkingSprites` function in both inventory and gameplay. Include player and every
character, even when they share a bundled sheet. Explicit selections win; absent maps retain
`PLAYER_CHARACTER`/`characterFor`. Preserve authored standalone-scene sheets. Pass chosen IDs/custom
URLs into existing actor fields and use an actor-appropriate bundled fallback on custom-image failure.
Keep selections character-level across stages and stances. Never overwrite bundled files. Store
resolved bundled IDs for explicit selection/reset.

Acceptance: gallery and actual map agree; portrait/stance changes cannot change a saved walking sprite.

### 6. Sprite uploads and animated review

Keep this pipeline separate from ordinary image normalization. Accept one static PNG/WebP, up to
10 MB, square 64 × 64 through 2048 × 2048, dimensions divisible by four. Require an alpha channel,
visible content and transparent background pixels in every cell. Decode and re-encode lossless PNG
without changing dimensions, cropping, rotating or moving cells.

Renderer contract:

- Columns: down, up, left, right.
- Rows: four animation frames; animation index `row * 4 + directionColumn`.
- Walking review: eight frames per second.
- Idle review: row zero for the selected direction.

Show four labelled previews, Play/Pause and full sheet. Respect reduced motion. Structural checks
cannot prove drawing orientation: require teacher review of the labelled frames before selection.
Provide bundled choice, upload and actor-specific reset. Acceptance: upload animates correctly in
gallery and actual map after Save/reload; malformed sheets receive actionable feedback.

### 7. Curated images and external UN links

Return up to six candidates per page with provider/item IDs, thumbnails, dates, dimensions, credits,
record links and reuse metadata. Seed search with public stage framing or character identity and let
teachers edit it. Offer explicit public-domain/CC0 and supported CC BY/CC BY-SA records, preserving
attribution and licence links; reject ambiguous rights. Re-fetch metadata by provider/item ID before
import. Download eligible images through the guarded fetcher and create ready candidates. A failure
in one provider must not block uploads or other providers.

For UN, require HTTPS on configured UN-owned image/record hosts, original record, credit, and private
permission/reuse confirmation. Create an external candidate without downloading its image bytes.
Render directly with image optimization/proxying disabled, original source link and fallback.

Acceptance: Commons import retains attribution; UN image bytes never enter application storage.

### 8. Complete AI candidate jobs

Use the existing job runner and image service for stage openings, portraits and walking sprites.
Pin source spec version, deduplicate retries and write immutable candidate objects. Require explicit
selection; a job never changes a selected asset. Label AI images **AI-generated illustration**.
Stop automatic stage-art jobs for new adventures, preserving untouched initial portrait generation
and compatibility with legacy queued artwork jobs.

For walking sheets invoke `kind: "sprite"`, using the existing pose reference and strict generated
pose/layout checks plus sprite normalization. Build the prompt from public identity/role and the
teacher's appearance description. Validate normalized output with the upload validator. Retain
rejected cost and actionable failure information; failed sheets are never selectable.

Acceptance: every authoring action creates a reviewable candidate and late results cannot overwrite
later uploads/selections.

## Compatibility, acceptance and delivery

Before structural edits, capture legacy positional stage artwork under stable stage IDs. Optional
maps must preserve inherited portrait resolution and bundled defaults. Stage/character removal
prunes selections only in the new draft; assets referenced by older versions/attempts remain retained.
Preview uses draft selections; student attempts use their pinned publication. Republishing must not
change earlier release links or resumed attempts.

Required checks:

| Area | Acceptance checks |
| --- | --- |
| Sources | Empty 202 then success; persistent empty; 403; rejected redirect; HTML; valid, scanned, malformed and oversized PDFs; successful later candidates |
| Persistence | Staff access; cross-adventure IDs; target mismatch; idempotency; Retry/Continue contention; stale saves; private permission metadata |
| Images | Every stance; inherited versions; missing slots; invalid uploads; credit; selection/removal; late generation |
| Sprites | Player and all characters; duplicate defaults; direction/frame order and idle; bad dimensions; blank/opaque cells; portrait rejection; portrait/stance independence |
| Actual map | Chosen bundled/custom sheets in four directions; idle; broken-sheet fallback; replacement/reload; movement/collision unchanged |
| Publication | Draft changes; republish; previous release links; resumed attempts retain assets |
| Browser | Desktop/mobile; keyboard; reduced motion; unsaved edits across tabs; loading/failure and preview states |

Run affected generation, schema, API, publication and inventory tests; extend sprite-normalization
and editor browser tests. Run game-client checks/browser suite if rendering changes are necessary.
Repeat Commons/LOC and NLB checks from the deployed worker, recording failures explicitly. Report
fixture success separately from live providers and local-environment checks.

Delivery order: additive migrations → compatible readers → source retry → candidate/versioned image
uploads → unified workspace → walking sprites/bundled choices/uploads → curated/UN images → all AI
jobs → publication/compatibility/browser verification. Do not close #323 until verification is complete.

Implementation evidence and remaining deployment checks are recorded in
[the verification report](../verification/reliable-sources-and-assets.md).
