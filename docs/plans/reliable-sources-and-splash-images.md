# Reliable web sources and adventure asset review

## Summary

Address source-ingestion failures from #308 and extend the adventure-wide asset inventory merged in [PR #316](https://github.com/damiancxliew/CS3216_Assignment3/pull/316) into a place to review, upload, replace and generate adventure images. Cover stage-opening images and character portraits, including stance variants, using curated resources, teacher uploads, direct UN image links and optional AI generation.

Agreed defaults:

- New adventures start with neutral splash screens and sourced-image suggestions.
- Teachers approve image choices before publication.
- Teachers can upload their own images, including images outside the curated catalog.
- “Generate with AI” remains available as an explicit action.
- UN images load directly from their hosted URLs, with permission or an applicable reuse basis recorded.
- Selecting an image does not automatically add it as historical evidence.

## 1. Adventure asset review and curated resources

### Extend the merged asset inventory

PR #316 is merged into `main`. Reuse its `reviewAssets` inventory and existing Generated assets tab, renaming the tab **Assets** because it will also include uploaded and externally sourced images. Extend the merged implementation without duplicating its gallery or importing unrelated chat/editor work.

- Show every stage-opening image and character portrait slot for the adventure, including every major-character stance and inherited portrait version. Keep missing slots visible so teachers can fill them.
- Group by **Stage openings** and **Character portraits**, with filters for stage/character, image origin and availability. Each entry shows the actual image, where it is used, saved asset version, source/credit, selected or candidate status, and loading/pending/failed state.
- Allow full-image inspection and playback preview. Existing shared map sprites, tiles and audio remain shared runtime resources; this change adds upload/replacement controls for adventure image slots, not a tileset, sprite-sheet or audio editor.
- Put **Find an image**, **Upload**, **Generate with AI**, **Use image**, **Replace** and **Remove** on the relevant image slot. Portrait controls target a specific character/stance; changes must not silently replace every stance or another character. Removing a portrait restores the existing initials fallback.
- Keep draft selections separate from the currently saved/published image and from unselected candidates. Preview pending selections before Save. Preserve unsaved story and asset edits across tab switches; Save and Publish remain explicit.
- Keep **Retry loading** separate from **Generate new image**. Loading failures and gallery visits never trigger paid generation. Pending or completed jobs cannot overwrite a teacher's later choice.
- Contextual image controls in a stage or character editor open the same Assets workspace at the matching slot, using the same inventory and selection service.

### Curated resource registry

Add a server-side resource registry that distinguishes factual-source discovery from image discovery and reuse. Keep OpenAI web search for factual URL discovery, followed by our own pinned fetch and HTML/PDF extraction. Use our own Commons/LOC API adapters for image search and metadata; registry entries define provider capabilities, approved hosts and reuse handling. UN images use teacher-supplied hosted URLs and recorded reuse permission/basis.

| Resource | Initial support |
|---|---|
| Wikimedia Commons | Search images and retrieve file-level provenance, credits and licensing through its [documented metadata API](https://www.mediawiki.org/wiki/API:Imageinfo). |
| Library of Congress | Search vetted collections and inspect item-level rights. Treat it as supplemental: its documented API returned 403 during investigation. Use [Free to Use and Reuse collections](https://www.loc.gov/free-to-use/) as the starting collection set. |
| UN | Discover relevant factual documents; offer UN Photo record links and teacher-supplied direct image URLs with recorded reuse permission or basis. |
| NAS and NLB | Prioritize relevant historical information and link to archival records. Image availability alone does not make an image eligible for reuse. |

Within the Assets workspace, each stage has an **Opening image** panel with **Find an image**, **Upload**, **Generate with AI**, and **No image**. Character/stance portrait slots reuse the same source selection, upload, attribution and candidate-review workflow. Use the existing portrait framing for AI portrait generation; neutral openings remain the default for new stages, while existing automatic portrait-generation behavior is preserved until a teacher explicitly overrides a slot.

- Suggestions use the episode, stage title and public time/place; portrait searches also use the character name and historical identity. Return up to six candidates per request, with pagination, provider labels, dates, credits and source links.
- A teacher can adjust the search and preview the image with the opening text before selecting it. No candidate is selected automatically.
- Treat missing or ambiguous rights metadata as ineligible for catalog selection. Initially accept explicit public-domain/CC0 records and CC BY/CC BY-SA records with the required attribution and licence links.
- Preserve sourced and uploaded images’ aspect ratios using the existing cinematic image presentation. Keep AI artwork’s existing cinematic background treatment.
- Require caption and alternative text. Preserve provider credits separately from teacher-editable captions.
- Allow publication with a neutral opening. Missing images and provider outages must not block publication.

## 2. Uploads, UN links and AI generation

**Teacher uploads**

- Accept arbitrary teacher-chosen JPEG, PNG and WebP images; catalog membership is not required.
- Limit uploads to 10 MB and 40 megapixels. Validate the decoded image, remove embedded metadata, apply its orientation and resize within 2560 × 2560 without cropping.
- Store the normalized image through the existing S3/Supabase asset abstraction, using an immutable asset key.
- Record teacher-supplied caption, alt text and optional source/credit. Do not infer that an upload is an authentic historical photograph.

**UN links**

- Accept an HTTPS image URL on a configured UN-owned host, plus its original record URL and required credit.
- Record the teacher’s permission reference or applicable reuse basis, confirming user and timestamp.
- Load the image directly in the browser, without server image optimization, proxying, downloading or caching. Do not bulk-harvest UN photo metadata.
- Keep a source link and neutral fallback when the image cannot load. External hosting does not guarantee continued availability or bypass the [UN Photo usage terms](https://dam.media.un.org/CMS4/Brand/Root/).

**AI generation**

- Generate replacement candidates only when requested, using the existing public-stage framing for opening images or the existing character/stance framing for portraits and the existing image service. Preserve initial portrait generation for untouched slots.
- Show the result as a candidate; the teacher must choose **Use image**.
- Label selected AI images **AI-generated illustration**.
- Keep the current selection while generation is pending or fails. Regeneration produces a separate candidate and cannot overwrite an approved image.

## 3. Contracts, persistence and publication

Extend existing composition and versioning patterns rather than creating a separate publishing system.

- Add optional `authoring.stageImages`, keyed by stable stage ID, and `authoring.portraitImages`, keyed by the existing character/stance portrait key. Reuse a shared selection shape containing an explicit fallback choice or a snapshot of the selected image’s origin, location, caption, alt text, credit, source and reuse information. Explicit portrait selections take precedence over `portraitVersions`; untouched slots retain existing inherited-version resolution.
- Add an `adventure_media_v3` table for candidate ownership, target image slot, immutable asset references, provider metadata, UN permission records and pending/ready/failed generation state. Apply existing staff-access rules; students receive only selected metadata from their attempt’s version.
- Add typed staff actions for image search, upload, UN-link registration, AI generation and generation-status polling. Candidate creation uses an idempotency key to prevent duplicate submissions.
- Add dedicated `stageImage` and `portraitImage` editing commands backed by the same selection service. Resolve media IDs and target slots against server-owned candidate records during the existing optimistic-version save; generic editing commands cannot fabricate asset URLs or provider rights. Extend the merged asset inventory to resolve explicit selections first, preserving correct legacy URLs and inherited versions.
- Run image-generation requests as separate jobs using the existing runner. Jobs return candidates and never update the selected image themselves.
- Preview reads the current draft selection. Student playback reads the selection from the attempt’s pinned published version. Replacing or removing an image creates a new draft version.
- Retain assets referenced by older publications and attempts.
- Existing specs without `stageImages` retain their legacy artwork. On first edit, preserve those image references by stage ID before applying structural changes. New adventures receive explicit neutral selections and no automatic stage-art job.

## 4. Repair factual-source ingestion

Implement this as a separate workstream from image selection.

- Separate the accepted-source target from the candidate budget: default to five accepted sources from at most fifteen candidates, fetching three concurrently. Continue to later candidates when earlier ones fail.
- Support PDFs through the existing extractor, retaining page-level citations. Preserve the 2 MB HTML limit and use the existing PDF byte, page and extracted-text limits. Distinguish scanned PDFs without a text layer.
- Investigate the NLB discrepancy explicitly: the application's pinned fetch received HTTP 202 with an empty body, while a separate `curl` request retrieved extractable HTML from the same URL. Compare both clients from the same deployed worker, recording request headers, redirect chains, response headers/status, body size and timing. Check client-dependent and intermittent upstream behavior before choosing a fix; keep DNS pinning and do not lower the text-length threshold to admit empty content.
- Preserve DNS pinning, public-address checks and redirect-policy checks.
- Retry empty/transient responses once within the source pass’s 240-second budget. Retain the per-fetch timeout; do not retry permanent permission failures or introduce challenge-bypass behavior.
- Record candidate stage, HTTP status, content type, response size, extracted length and rejection reason. Report empty successful responses separately from genuinely short content.
- Extend `SourcesOutput` additively with diagnostics and summary counts while preserving its existing accepted-document and rejection fields.
- Include approved UN information domains in the factual-source registry. NAS/NLB remain prioritized. Provider capabilities never override the teacher’s source policy.
- Replace “Not used” with collapsed **Couldn’t import N sources** details. Distinguish no search results, policy rejection, access failure, unsupported content and extraction failure.
- Add **Retry search** at the guided source-review pause. Run it as a separate request job, preserve existing accepted sources and deselections, deduplicate additions, and prevent continuation while that request is importing results.

Full upload-informed query planning and post-skeleton searches (#282), and additional factual-document uploads at later review pauses (#307), remain follow-up work.

## 5. Verification and delivery

Deliver in three verifiable slices: ingestion recovery; extend the merged Assets inventory with stage/portrait uploads and versioned selection; then curated suggestions, UN embedding and explicit AI replacement generation.

Acceptance checks:

- Reproduce the reported empty NLB responses and PDF failures with controlled fixtures. Verify HTML, text PDFs, scanned PDFs, blocked responses and successful later candidates.
- Include an NLB fixture that first returns an empty HTTP 202 response, then usable HTML, plus a persistent-empty case. Separately compare live pinned-fetch and `curl` results under the same worker conditions and record whether recovery is verified or the site still requires a fallback source. For PDFs, verify successful extraction into numbered pages as well as no-text-layer, malformed, oversized and HTTP 403 outcomes; PDF support must not be reported as a fix for upstream access denial.
- Prove an accepted outside source is persisted and passed to subsequent generation with its URL, provenance and citation pages.
- Exercise the adventure-wide Assets workspace, image search, upload, selection, replacement, removal, AI failure/retry and UN direct embedding for stage openings and character/stance portraits. Verify UN image bytes never enter application storage.
- Test invalid uploads, missing rights metadata, untrusted URLs, cross-adventure candidate access, duplicate requests and concurrent saves.
- Verify reload persistence, published-version isolation, resumed attempts, stable stage/portrait keys and legacy artwork compatibility. Extend PR #316 inventory tests to cover every stance, inherited portrait versions, explicit overrides, missing slots and genuine pending/failed states. Confirm asset-tab switching preserves unsaved story/image changes and a late job cannot replace a selected upload.
- Check desktop/mobile openings, keyboard controls, captions, credits, alt text and broken-image fallbacks in a real browser.
- Repeat live Commons, LOC and representative source-fetch checks from the deployed worker environment. Record provider failures explicitly; the current Commons metadata check succeeded, while LOC returned 403.
- Run relevant source, generation, schema, editing, publication and cinematic tests plus typechecks. Record source acceptance/rejection counts, provider failures and image-job outcomes for rollout diagnosis.
