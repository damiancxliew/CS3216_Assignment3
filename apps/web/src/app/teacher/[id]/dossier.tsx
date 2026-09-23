/**
 * The visual dossier for the version currently shown: generated artwork where
 * it has settled, curated/styled placeholders where it hasn't, and nothing
 * from `privateContext` — the dossier type has no field that could carry it
 * (FR-21). All server-rendered; the only client islands are the action
 * buttons and the progress poller.
 */
import { generateArtwork, regenerateAsset } from "../actions";
import { ActionButton } from "@/components/action-form";
import { StageMapPlan } from "@/components/teacher/stage-map";
import { ArtworkPoller } from "@/components/teacher/artwork-poller";
import { RecordEntry, Section, Skeleton, WorldEntry } from "@/components/ui";
import type { Dossier, ImageStatus } from "@/lib/teacher/dossier";

const INTENSITY_LABELS = ["", "light", "moderate", "heavy"] as const;

/** One inline glyph per asset kind, drawn in the muted register. */
function KindGlyph({ kind, className = "h-6 w-6" }: { kind: "portrait" | "landmark" | "prop"; className?: string }) {
  const paths = {
    portrait: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
    landmark: "M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5",
    prop: "M12 3l7 4v10l-7 4-7-4V7z",
  } as const;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={paths[kind]} />
    </svg>
  );
}

/**
 * An asset tile with a fixed aspect ratio, so the four states (generated,
 * curated placeholder, still drawing, failed) never shift the layout. The
 * curated `/assets/curated/*` urls are never rendered — they don't exist in
 * the bundle; a faceset or this styled block stands in instead.
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
  if (imageStatus === "generated" && imageUrl) {
    return <img src={imageUrl} alt={alt} width={800} height={800} loading="lazy" className={`rounded-surface object-cover ${className}`} />;
  }
  if (kind === "portrait" && imageStatus === "placeholder" && imageUrl) {
    // Portraits have a curated faceset as their placeholder (D6).
    return <img src={imageUrl} alt={alt} width={800} height={800} loading="lazy" className={`rounded-surface object-cover ${className}`} />;
  }
  return (
    <div role="img" aria-label={alt} className={`flex flex-col items-center justify-center gap-2 rounded-surface bg-sunken text-muted ${className}`}>
      {imageStatus === "pending" ? <Skeleton className="h-2/3 w-2/3" /> : <KindGlyph kind={kind} />}
      {imageStatus === "failed" ? <span className="text-sm">Artwork failed</span> : null}
    </div>
  );
}

function RegenerateButton({ adventureId, specVersionId, assetId }: { adventureId: string; specVersionId: string; assetId: string | null }) {
  if (!assetId) return null;
  return (
    <ActionButton
      action={regenerateAsset.bind(null, adventureId, specVersionId, assetId)}
      label="Regenerate"
      pendingLabel="Regenerating…"
      variant="quiet"
    />
  );
}

export function DossierSections({
  dossier,
  adventureId,
  specVersionId,
  version,
  isDraft,
}: {
  dossier: Dossier;
  adventureId: string;
  specVersionId: string;
  version: number;
  isDraft: boolean;
}) {
  return (
    <>
      <Section title="Cast">
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {dossier.stakeholders.map((person) => (
            <li key={person.id} className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-4">
              <Artwork kind="portrait" alt={`Portrait of ${person.name}`} imageUrl={person.imageUrl} imageStatus={person.imageStatus} />
              <div className="flex flex-col gap-0.5">
                <p className="font-serif text-lg leading-snug text-ink">{person.name}</p>
                <p className="text-sm text-muted">{person.role}</p>
              </div>
              <p className="line-clamp-3 text-base text-muted">{person.summary}</p>
              <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={person.assetId} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Stages">
        <ol className="flex flex-col gap-8">
          {dossier.stages.map((stage) => {
            const banner = stage.rooms.find((r) => r.landmark) ?? stage.rooms[0];
            const roomNames = Object.fromEntries(stage.rooms.map((r) => [r.id, r.name]));
            return (
              <li key={stage.id} className="flex flex-col gap-6 overflow-hidden rounded-surface border border-line bg-surface">
                <div className="relative">
                  {banner?.imageStatus === "generated" && banner.imageUrl ? (
                    <img
                      src={banner.imageUrl}
                      alt={banner.landmark ? `Artwork of ${banner.landmark.name}` : `Stage ${stage.index + 1}`}
                      width={1536}
                      height={512}
                      loading="lazy"
                      className="w-full aspect-[3/1] object-cover"
                    />
                  ) : (
                    // No generated banner: a modest band, not a tile — the
                    // stage title below already says everything a glyph would.
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
                  </div>
                </div>

                <div className="flex flex-col gap-6 px-6 pb-6">
                  <p className="max-w-[64ch] text-base text-muted">{stage.sharedContext}</p>

                  {stage.plan ? (
                    <div className="mx-auto w-full" style={{ maxWidth: `${(stage.plan.width / stage.plan.height) * 460}px` }}>
                      <StageMapPlan map={stage.plan} names={roomNames} />
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3">
                    <h3 className="text-base font-semibold text-ink">Rooms</h3>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {stage.rooms.map((room) => (
                        <li key={room.id} className="flex gap-3 rounded-surface border border-line bg-surface p-3">
                          <Artwork
                            kind="landmark"
                            alt={room.landmark ? `Artwork of ${room.landmark.name}` : `Room: ${room.name}`}
                            imageUrl={room.imageUrl}
                            imageStatus={room.imageStatus}
                            className="h-20 w-20 shrink-0"
                          />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="font-semibold text-ink">
                              {room.name}
                              <span className="font-normal text-muted"> · {room.kind}, {room.size}</span>
                            </p>
                            {room.landmark ? <p className="text-sm font-semibold text-world">{room.landmark.name}</p> : null}
                            <p className="line-clamp-2 text-sm text-muted">{room.landmark?.description ?? room.purpose}</p>
                            <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={room.assetId} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-3">
                    <h3 className="text-base font-semibold text-ink">Evidence</h3>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {stage.evidence.map((item) => (
                        <li key={item.id} className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-4">
                          <div className="flex items-start gap-3">
                            <Artwork
                              kind="prop"
                              alt={`Artwork of ${item.name}`}
                              imageUrl={item.imageUrl}
                              imageStatus={item.imageStatus}
                              className="h-16 w-16 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-ink">{item.name}</p>
                              <p className="line-clamp-3 text-sm text-muted">{item.text}</p>
                            </div>
                          </div>
                          {item.spans.map((span, i) => (
                            <RecordEntry key={i} quote={span.quote} source={`${span.sourceTitle}, p. ${span.page}`} />
                          ))}
                          <RegenerateButton adventureId={adventureId} specVersionId={specVersionId} assetId={item.assetId} />
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
                          {objective.title}
                        </li>
                      ))}
                    </ul>
                  </div>

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
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {dossier.assumptions.length > 0 ? (
        <Section title="What the simulation assumes" lede="Inventions the planner made to fill gaps in the record — worth checking before you publish.">
          <ul className="flex flex-col gap-5">
            {dossier.assumptions.map((assumption) => (
              <li key={assumption.id}>
                <WorldEntry label={assumption.reason}>{assumption.text}</WorldEntry>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Endings">
        <ul className="flex flex-col gap-5">
          {dossier.endings.map((ending) => (
            <li key={ending.id} className="flex flex-col gap-4 rounded-surface border border-line bg-surface p-6">
              <p className="font-serif text-xl text-ink">{ending.title}</p>
              <p className="text-base text-muted">{ending.summary}</p>
              <RecordEntry source="What the record shows">{ending.historicalOutcome}</RecordEntry>
              <WorldEntry label="Where play can diverge">{ending.divergence}</WorldEntry>
              <ul className="flex flex-col gap-1.5">
                {ending.reflectionQuestions.map((question, i) => (
                  <li key={i} className="text-base text-ink">
                    {question}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Artwork" lede="Portraits, landmarks and props drawn by the image model for this version.">
        <div className="flex flex-col gap-4">
          <p className="text-base text-ink">
            {dossier.assets.generated} of {dossier.assets.eligible} generated
            {dossier.assets.pending > 0 ? ` · ${dossier.assets.pending} in progress` : ""}
            {dossier.assets.failed > 0 ? ` · ${dossier.assets.failed} failed` : ""}
            {dossier.assets.costUsd > 0 ? ` · $${dossier.assets.costUsd.toFixed(2)}` : ""}
          </p>
          <ActionButton
            action={generateArtwork.bind(null, adventureId)}
            label={`Generate artwork for ${isDraft ? "draft " : ""}v${version}`}
            pendingLabel="Starting…"
          />
          <ArtworkPoller pending={dossier.assets.pending} />
        </div>
      </Section>
    </>
  );
}
