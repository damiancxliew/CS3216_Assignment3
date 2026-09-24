/**
 * The visual dossier for the version currently shown: generated artwork where
 * it has settled, curated/styled placeholders where it hasn't, and nothing
 * from `privateContext` — the dossier type has no field that could carry it
 * (FR-21). All server-rendered; the only client islands are the action
 * buttons and the progress poller.
 */
import {
  editAgentPosition,
  editAssumption,
  editDecision,
  editEnding,
  editEvidence,
  editObjective,
  editRoom,
  editStage,
  editStakeholder,
  generateArtwork,
  regenerateAsset,
} from "../actions";
import { AssetRegeneration } from "@/components/teacher/asset-regeneration";
import { InlineEdit } from "@/components/teacher/inline-edit";
import { StageMapPlan } from "@/components/teacher/stage-map";
import { ArtworkProgress } from "@/components/teacher/artwork-poller";
import { RecordEntry, Section, Skeleton, WorldEntry } from "@/components/ui";
import type { Dossier, ImageStatus } from "@/lib/teacher/dossier";

const INTENSITY_LABELS = ["", "light", "moderate", "heavy"] as const;

/**
 * An asset tile with a fixed aspect ratio, so the four states (generated,
 * curated placeholder, still drawing, failed) never shift the layout.
 */
function Artwork({
  kind,
  alt,
  imageUrl,
  imageStatus,
  className = "w-full aspect-square",
}: {
  kind: "portrait" | "landmark" | "prop";
  alt: string;
  imageUrl: string | null;
  imageStatus: ImageStatus;
  /** Owns sizing entirely — the branches add no width of their own. */
  className?: string;
}) {
  if (imageStatus === "pending") {
    return (
      <div data-artwork-kind={kind} role="img" aria-label={`${alt}, artwork in progress`} className={`flex items-center justify-center overflow-hidden rounded-control border border-line bg-sunken ${className}`}>
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    );
  }
  if (imageUrl) {
    return (
      <div data-artwork-kind={kind} className={`relative overflow-hidden rounded-control border border-line bg-sunken ${className}`}>
        <img src={imageUrl} alt={alt} width={800} height={800} loading="lazy" className="h-full w-full object-cover" />
        {imageStatus === "failed" ? (
          <span className="absolute inset-x-1 bottom-1 rounded bg-ink/80 px-1.5 py-0.5 text-center text-xs font-semibold text-paper">
            Needs retry
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div data-artwork-kind={kind} role="img" aria-label={`${alt}, artwork unavailable`} className={`flex items-center justify-center rounded-control border border-line bg-sunken px-2 text-center text-xs font-semibold text-muted ${className}`}>
      Artwork unavailable
    </div>
  );
}

function RegenerateButton({ adventureId, specVersionId, assetId }: { adventureId: string; specVersionId: string; assetId: string | null }) {
  if (!assetId) return null;
  return (
    <div className="mt-auto pt-1">
      <AssetRegeneration
        action={regenerateAsset.bind(null, adventureId, specVersionId, assetId)}
        specVersionId={specVersionId}
        assetId={assetId}
      />
    </div>
  );
}

export function DossierSections({
  dossier,
  adventureId,
  specVersionId,
  version,
  isDraft,
  view,
  stageId,
  watchForArtwork = false,
}: {
  dossier: Dossier;
  adventureId: string;
  specVersionId: string;
  version: number;
  isDraft: boolean;
  view: "story" | "stage-content" | "stage-style" | "artwork";
  stageId?: string;
  watchForArtwork?: boolean;
}) {
  return (
    <>
      {view === "story" ? (
      <Section title="Cast">
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {dossier.stakeholders.map((person) => (
            <li key={person.id} className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-4">
              <Artwork kind="portrait" alt={`Portrait of ${person.name}`} imageUrl={person.imageUrl} imageStatus={person.imageStatus} />
              <InlineEdit
                action={editStakeholder.bind(null, adventureId, specVersionId, person.id)}
                label={`Edit ${person.name}`}
                editable={isDraft}
                fields={[
                  { name: "name", label: "Name", defaultValue: person.name },
                  { name: "role", label: "Role", defaultValue: person.role },
                  { name: "summary", label: "Summary", defaultValue: person.summary, multiline: true },
                ]}
              >
                <div className="flex flex-col gap-0.5">
                  <p className="font-serif text-lg leading-snug text-ink">{person.name}</p>
                  <p className="text-sm text-muted">{person.role}</p>
                </div>
                <p className="line-clamp-3 text-base text-muted">{person.summary}</p>
              </InlineEdit>
              <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={person.assetId} />
            </li>
          ))}
        </ul>
      </Section>
      ) : null}

      {view === "stage-content" || view === "stage-style" ? (
      <Section title="Stages">
        <ol className="flex flex-col gap-8">
          {dossier.stages.filter((stage) => stage.id === stageId).map((stage) => {
            const banner = stage.rooms.find((r) => r.landmark) ?? stage.rooms[0];
            const roomNames = Object.fromEntries(stage.rooms.map((r) => [r.id, r.name]));
            return (
              <li key={stage.id} className="flex flex-col gap-6 overflow-hidden rounded-surface border border-line bg-surface">
                {view === "stage-style" ? <div className="relative">
                  {banner?.imageUrl ? (
                    <img
                      src={banner.imageUrl}
                      alt={banner.landmark ? `Artwork of ${banner.landmark.name}` : `Stage ${stage.index + 1}`}
                      width={1536}
                      height={512}
                      loading="lazy"
                      className="w-full aspect-[3/1] object-cover"
                    />
                  ) : (
                    // Defensive fallback for malformed legacy specs.
                    <div role="img" aria-label={`Stage ${stage.index + 1}`} className="h-36 w-full bg-sunken" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline justify-between gap-2 bg-ink/60 px-5 py-3">
                    <p className="font-serif text-xl text-paper">
                      {stage.index + 1}. {stage.title}
                    </p>
                    {stage.ambientOverlay ? (
                      <span className="rounded-control border border-paper/40 px-2.5 py-1 text-sm font-semibold capitalize text-paper">
                        {stage.ambientOverlay.id}, {INTENSITY_LABELS[stage.ambientOverlay.intensity] ?? stage.ambientOverlay.intensity}
                      </span>
                    ) : null}
                    <span className="rounded-control border border-paper/40 px-2.5 py-1 text-sm font-semibold capitalize text-paper">{stage.mapTheme} map</span>
                  </div>
                </div> : null}

                <div className="flex flex-col gap-6 p-6">
                  {view === "stage-content" ? <>
                  <InlineEdit
                    action={editStage.bind(null, adventureId, specVersionId, stage.id)}
                    label={`Edit stage ${stage.index + 1}`}
                    editable={isDraft}
                    hiddenInputs={{ map_theme: [stage.mapTheme] }}
                    fields={[
                      { name: "title", label: "Title", defaultValue: stage.title },
                      { name: "shared_context", label: "Shared context", defaultValue: stage.sharedContext, multiline: true, rows: 6 },
                      { name: "timer_seconds", label: "Timer for this stage, in seconds", defaultValue: stage.timerSeconds === null ? "" : String(stage.timerSeconds), optional: true, hint: "Empty inherits the adventure default; 0 disables the timer." },
                    ]}
                  >
                    <p className="font-serif text-xl text-ink">{stage.title}</p>
                    <p className="max-w-[64ch] text-base text-muted">{stage.sharedContext}</p>
                  </InlineEdit>
                  </> : null}

                  {view === "stage-style" && stage.plan ? (
                    <div className="mx-auto w-full" style={{ maxWidth: `${(stage.plan.width / stage.plan.height) * 460}px` }}>
                      <StageMapPlan map={stage.plan} names={roomNames} />
                    </div>
                  ) : null}

                  {view === "stage-style" ? (
                    <InlineEdit
                      action={editStage.bind(null, adventureId, specVersionId, stage.id)}
                      label={`Edit map theme for stage ${stage.index + 1}`}
                      editable={isDraft}
                      hiddenInputs={{ title: [stage.title], shared_context: [stage.sharedContext], timer_seconds: [stage.timerSeconds === null ? "" : String(stage.timerSeconds)] }}
                      fields={[{ name: "map_theme", label: "Map theme", defaultValue: stage.mapTheme, options: [{ value: "classic", label: "Classic village" }, { value: "desert", label: "Desert" }, { value: "winter", label: "Winter" }, { value: "forest", label: "Forest" }, { value: "coast", label: "Coast" }] }]}
                    >
                      <p className="text-base text-muted">Map theme: <span className="capitalize text-ink">{stage.mapTheme}</span></p>
                    </InlineEdit>
                  ) : null}

                  {view === "stage-content" ? <>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-base font-semibold text-ink">Rooms</h3>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {stage.rooms.map((room) => (
                        <li key={room.id} className="flex h-full gap-3 rounded-surface border border-line bg-surface p-4">
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <InlineEdit
                              action={editRoom.bind(null, adventureId, specVersionId, stage.id, room.id)}
                              label={`Edit ${room.name}`}
                              editable={isDraft}
                              fields={[
                                { name: "name", label: "Name", defaultValue: room.name },
                                { name: "purpose", label: "Purpose", defaultValue: room.purpose, multiline: true, rows: 3 },
                              ]}
                            >
                              <p className="font-semibold text-ink">
                                {room.name}
                                <span className="font-normal text-muted"> · {room.kind}, {room.size}</span>
                              </p>
                              {room.landmark ? <p className="text-sm font-semibold text-world">{room.landmark.name}</p> : null}
                              <p className="line-clamp-2 text-sm text-muted">{room.landmark?.description ?? room.purpose}</p>
                            </InlineEdit>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-3">
                    <h3 className="text-base font-semibold text-ink">Evidence</h3>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {stage.evidence.map((item) => (
                        <li key={item.id} className="flex h-full flex-col gap-3 rounded-surface border border-line bg-surface p-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0">
                              <InlineEdit
                                action={editEvidence.bind(null, adventureId, specVersionId, stage.id, item.id)}
                                label={`Edit ${item.name}`}
                                editable={isDraft}
                                fields={[
                                  { name: "name", label: "Name", defaultValue: item.name },
                                  { name: "text", label: "Text", defaultValue: item.text, multiline: true, rows: 5 },
                                ]}
                              >
                                <p className="font-semibold text-ink">{item.name}</p>
                                <p className="line-clamp-3 text-sm text-muted">{item.text}</p>
                              </InlineEdit>
                            </div>
                          </div>
                          {item.spans.map((span, i) => (
                            <RecordEntry key={i} quote={span.quote} source={`${span.sourceTitle}, p. ${span.page}`} compact />
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h3 className="text-base font-semibold text-ink">Objectives</h3>
                    <ul className="flex flex-col gap-1.5">
                      {stage.objectives.map((objective) => (
                        <li key={objective.id} className="flex items-baseline gap-2.5 text-base text-ink">
                          <span className="inline-block h-3 w-3 shrink-0 translate-y-px rounded-control border border-line-strong" aria-hidden />
                          <InlineEdit
                            action={editObjective.bind(null, adventureId, specVersionId, stage.id, objective.id)}
                            label={`Edit objective`}
                            editable={isDraft}
                            fields={[{ name: "title", label: "Objective", defaultValue: objective.title }]}
                          >
                            {objective.title}
                          </InlineEdit>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <InlineEdit
                    action={editDecision.bind(null, adventureId, specVersionId, stage.id)}
                    label={`Edit the decision in stage ${stage.index + 1}`}
                    editable={isDraft}
                    hiddenInputs={{ option_id: stage.decision.options.map((o) => o.id) }}
                    fields={[
                      { name: "title", label: "Title", defaultValue: stage.decision.title },
                      { name: "prompt", label: "Prompt", defaultValue: stage.decision.prompt, multiline: true, rows: 3 },
                      ...stage.decision.options.map((o, i) => ({ name: "option_label", label: `Option ${i + 1} (${o.stance})`, defaultValue: o.label })),
                    ]}
                  >
                    <div className="flex flex-col gap-3 rounded-surface border border-line bg-sunken p-4">
                      <p className="font-semibold text-ink">{stage.decision.title}</p>
                      <p className="text-base text-muted">{stage.decision.prompt}</p>
                      <ul className="flex flex-wrap gap-2">
                        {stage.decision.options.map((option, i) => (
                          <li key={i} className="rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
                            {option.label} <span className="text-muted">· {option.stance}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </InlineEdit>

                  {stage.agents.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <h3 className="text-base font-semibold text-ink">People here</h3>
                      <ul className="flex flex-col gap-1.5">
                        {stage.agents.map((agent) => {
                          const person = dossier.stakeholders.find((s) => s.id === agent.stakeholderId);
                          return (
                            <li key={agent.id} className="flex items-baseline gap-2 text-base">
                              <span className="shrink-0 font-semibold text-ink">{person?.name ?? agent.stakeholderId}</span>
                              <InlineEdit
                                action={editAgentPosition.bind(null, adventureId, specVersionId, stage.id, agent.id)}
                                label={`Edit ${person?.name ?? agent.stakeholderId}'s public position`}
                                editable={isDraft}
                                fields={[{ name: "public_position", label: "Public position", defaultValue: agent.publicPosition, multiline: true, rows: 3 }]}
                              >
                                <span className="text-muted">{agent.publicPosition}</span>
                              </InlineEdit>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  </> : null}

                  {view === "stage-style" ? <>
                    <p className="text-base text-muted">The map and ambient effect are previews for this stage.</p>
                    <div className="flex flex-col gap-3">
                      <h3 className="text-base font-semibold text-ink">Places</h3>
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {stage.rooms.filter((room) => room.landmark).map((room) => (
                          <li key={room.id} className="flex gap-3 rounded-surface border border-line bg-surface p-3">
                            <Artwork kind="landmark" alt={room.landmark ? `Artwork of ${room.landmark.name}` : `Room: ${room.name}`} imageUrl={room.imageUrl} imageStatus={room.imageStatus} className="h-24 w-24 shrink-0" />
                            <div className="flex min-w-0 flex-col gap-2">
                              <p className="font-semibold text-ink">{room.name}</p>
                              <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={room.assetId} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col gap-3">
                      <h3 className="text-base font-semibold text-ink">Objects</h3>
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {stage.evidence.map((item) => (
                          <li key={item.id} className="flex gap-3 rounded-surface border border-line bg-surface p-3">
                            <Artwork kind="prop" alt={`Artwork of ${item.name}`} imageUrl={item.imageUrl} imageStatus={item.imageStatus} className="h-24 w-24 shrink-0" />
                            <div className="flex min-w-0 flex-col gap-2">
                              <p className="font-semibold text-ink">{item.name}</p>
                              <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={item.assetId} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      ) : null}

      {view === "story" && dossier.assumptions.length > 0 ? (
        <Section title="Assumptions to review" lede="Details added to fill gaps in the sources. Check them before publishing.">
          <ul className="flex flex-col gap-5">
            {dossier.assumptions.map((assumption) => (
              <li key={assumption.id}>
                <InlineEdit
                  action={editAssumption.bind(null, adventureId, specVersionId, assumption.id)}
                  label="Edit this assumption"
                  editable={isDraft}
                  fields={[
                    { name: "text", label: "Assumption", defaultValue: assumption.text, multiline: true, rows: 3 },
                    { name: "reason", label: "Why it was invented", defaultValue: assumption.reason, multiline: true, rows: 2 },
                  ]}
                >
                  <WorldEntry label={assumption.reason}>{assumption.text}</WorldEntry>
                </InlineEdit>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {view === "story" ? <Section title="Endings">
        <ul className="flex flex-col gap-5">
          {dossier.endings.map((ending) => (
            <li key={ending.id} className="flex flex-col gap-4 rounded-surface border border-line bg-surface p-6">
              <InlineEdit
                action={editEnding.bind(null, adventureId, specVersionId, ending.id)}
                label={`Edit ${ending.title}`}
                editable={isDraft}
                fields={[
                  { name: "title", label: "Title", defaultValue: ending.title },
                  { name: "summary", label: "Summary", defaultValue: ending.summary, multiline: true, rows: 4 },
                  { name: "divergence", label: "Where play can diverge", defaultValue: ending.divergence, multiline: true, rows: 3 },
                  { name: "reflection_questions", label: "Reflection questions", defaultValue: ending.reflectionQuestions.join("\n"), multiline: true, rows: 4, hint: "One question per line." },
                ]}
              >
                <p className="font-serif text-xl text-ink">{ending.title}</p>
                <p className="max-w-[70ch] text-base text-muted">{ending.summary}</p>
                {/* Two columns, each headed by its register, so "record" and "simulation" read as a contrast rather than a wall. */}
                <div className="mt-1 grid gap-4 sm:grid-cols-2">
                  <div className="border-l-[3px] border-record pl-4">
                    <p className="text-sm font-semibold uppercase tracking-wide text-record">What the record shows</p>
                    <p className="mt-1.5 text-base leading-relaxed text-ink">{ending.historicalOutcome}</p>
                  </div>
                  <div className="border-l-[3px] border-world pl-4">
                    <p className="text-sm font-semibold uppercase tracking-wide text-world">Where play can diverge</p>
                    <p className="mt-1.5 text-base leading-relaxed text-ink">{ending.divergence}</p>
                  </div>
                </div>
                {ending.reflectionQuestions.length > 0 ? (
                  <div className="mt-1">
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted">Ask students</p>
                    <ul className="mt-1.5 list-disc pl-5 text-base leading-relaxed text-ink marker:text-muted">
                      {ending.reflectionQuestions.map((question, i) => (
                        <li key={i}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </InlineEdit>
            </li>
          ))}
        </ul>
      </Section> : null}

      {view === "artwork" ? <Section title="Artwork" lede="Portraits, places and objects for this version.">
        <div className="flex flex-col gap-4">
          <p className="text-base text-ink">
            {dossier.assets.generated} of {dossier.assets.eligible} images ready
            {dossier.assets.pending > 0 ? ` · ${dossier.assets.pending} in progress` : ""}
            {dossier.assets.failed > 0 ? ` · ${dossier.assets.failed} failed` : ""}
          </p>
          <ArtworkProgress
            action={generateArtwork.bind(null, adventureId)}
            label={`Generate artwork for ${isDraft ? "draft " : ""}v${version}`}
            assets={dossier.assets}
            watchForArtwork={watchForArtwork}
          />
        </div>
      </Section> : null}
    </>
  );
}
