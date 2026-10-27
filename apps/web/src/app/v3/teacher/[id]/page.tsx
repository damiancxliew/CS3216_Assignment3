import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseJobStore } from "@adventure/jobs";
import {
  validateSkeleton,
  validateSpec,
  type SkeletonShape,
} from "@adventure/spec-v3";
import { SiteHeader, compactButton as button } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import {
  loadPause,
  storedBrief,
  viewerSeesCost,
} from "@/lib/v3/generation/service";
import { capturedSources } from "@/lib/v3/edit/apply";
import { getV3GenerationProgress } from "../actions";
import { GenerationProgress } from "./generation-progress";
import { SkeletonEditor } from "./skeleton-editor";
import { StartAgain } from "./review-actions";
import AdventureWorkspace from "./review/adventure-workspace";
import { SourcesReview, PauseEditor } from "./guided-review";
import { CreationWorkspace } from "./creation-workspace";
import { GenerationHistory } from "./generation-history";
import { DraftReview } from "./draft-review";
import { validateEditedSpec } from "@/lib/v3/edit/validation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

export default async function V3AdventurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const viewer = await getViewer(await createClient());
  if (!viewer.user || !isStaff(viewer)) notFound();
  const admin = createAdminClient();
  const row = await supabaseV3BriefStore(admin).load(id);
  if (!row || row.ownerId !== viewer.user.id || !v3SchoolAllowed(row.schoolId))
    notFound();
  const query = await searchParams;
  if (
    ["published", "archived"].includes(row.status) ||
    (row.status === "draft" &&
      (row.state?.draft.mode !== "guided" || query?.view === "editor"))
  )
    return AdventureWorkspace({ params: Promise.resolve({ id }) });

  const store = supabaseJobStore(admin);
  const deps = defaultGenerationDeps();
  const [steps, documents, progress] =
    row.status === "briefing"
      ? ([[], [], null] as const)
      : await Promise.all([
          store.list(id),
          deps.sources.load(id),
          getV3GenerationProgress(id),
        ]);
  const brief = row.state ?? initialBriefStateV3(id);
  if (!row.state && row.status !== "briefing") {
    const generationBrief = await storedBrief(store, id);
    brief.draft.episode = generationBrief?.episode ?? row.title ?? undefined;
    brief.draft.mode = generationBrief?.mode;
    brief.messages = [
      {
        role: "assistant",
        text: "Your adventure is taking shape. You can review the generated content here as each part is ready.",
        slot: "generation",
      },
    ];
  }
  const validProgress = progress && !("error" in progress) ? progress : null;
  const pause =
    row.status === "needs_review" && validProgress?.mode === "guided"
      ? await loadPause(deps, store, {
          id,
          schoolId: row.schoolId,
          ownerId: row.ownerId,
          status: "needs_review",
        })
      : null;
  const pass = pause?.pass ?? validProgress?.pausedAt;
  const generating =
    row.status === "generating" || (row.status === "needs_review" && !pass);
  const title =
    pass === "skeleton"
      ? "Story outline"
      : pass
        ? {
            sources: "Choose sources",
            details: "Stages and characters",
            endings: "Decisions and endings",
            reveal: "Reveal and questions",
          }[pass]
        : row.status === "draft"
          ? "Your adventure is ready"
          : row.status === "failed"
            ? "Generation paused"
            : "Building your adventure";
  const statusMessage =
    row.status === "briefing"
      ? ""
      : row.status === "draft"
        ? "Preview the adventure to see what students will play. You can keep editing the cards or ask for changes here."
        : row.status === "failed"
          ? "Something went wrong. You can start again with the same sources."
          : generating
            ? "Working on the next step…"
            : pass === "sources"
              ? "Choose which sources to use. Your uploads stay included."
              : pass === "skeleton"
                ? "Read through the outline before we write the scenes."
                : pass === "details"
                  ? "The scenes are ready. Make any changes before we write the endings."
                  : pass === "endings"
                    ? "Check where each decision leads. You can edit the choices and endings."
                    : "Read through the reveal and discussion questions, then finish the draft.";
  const rawSkeleton = validProgress?.skeleton;
  const parsedSkeleton =
    rawSkeleton !== undefined ? validateSkeleton(rawSkeleton) : null;
  const skeleton = parsedSkeleton?.ok
    ? parsedSkeleton.spec
    : (rawSkeleton as SkeletonShape | undefined);
  const final =
    row.status === "draft"
      ? await admin
          .from("adventures_v3")
          .select("spec,spec_version")
          .eq("id", id)
          .single()
      : null;
  const finalSpec = final?.data ? validateSpec(final.data.spec) : null;

  return (
    <div className="min-h-screen md:flex md:h-dvh md:flex-col md:overflow-hidden">
      <SiteHeader />
      <main className="md:min-h-0 md:flex-1">
        <CreationWorkspace
          key={id}
          brief={brief}
          active={row.status === "briefing"}
          complete={row.status === "draft"}
          generating={generating}
          statusMessage={statusMessage}
        >
          {row.status !== "briefing" ? (
            <>
              <header className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold tracking-tight text-ink">
                  {title}
                </h2>
                {row.status === "draft" ? <a className={button.quiet} href={`/api/v3/adventures/${id}/export`} download>Export saved JSON</a> : null}
                {pass && validProgress?.mode === "guided" ? (
                  <span className="text-xs text-muted">
                    Step {pause?.index ?? 2} of 5
                  </span>
                ) : null}
              </header>
              <GenerationHistory
                steps={
                  row.status === "draft"
                    ? steps.filter(
                        (step) =>
                          step.name === "sources" || step.name === "skeleton",
                      )
                    : [...steps]
                }
                documents={[...documents]}
                current={pass}
                finalSpec={finalSpec?.ok ? finalSpec.spec : undefined}
              />
              {row.status === "draft" && finalSpec?.ok && final?.data ? (
                <DraftReview
                  adventureId={id}
                  initial={finalSpec.spec}
                  initialVersion={final.data.spec_version}
                  initialErrors={
                    validateEditedSpec(
                      finalSpec.spec,
                      capturedSources([...documents]),
                      validProgress?.checkErrors,
                    ).errors
                  }
                  sources={capturedSources([...documents])}
                />
              ) : null}
              {generating ? (
                <GenerationProgress
                  adventureId={id}
                  seesCost={viewerSeesCost(viewer)}
                  compact
                />
              ) : pause?.pass === "sources" ? (
                <SourcesReview adventureId={id} pause={pause} />
              ) : pause && "base" in pause ? (
                <PauseEditor
                  key={pause.pass}
                  adventureId={id}
                  pause={pause}
                  sources={capturedSources([...documents])}
                />
              ) : skeleton && pass === "skeleton" ? (
                <SkeletonEditor
                  adventureId={id}
                  initial={skeleton}
                  hasDraft={validProgress?.hasDraft === true}
                  compact
                />
              ) : row.status === "draft" ? (
                <section className="creation-card rounded-surface border-2 border-ink bg-surface p-5">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={button.primary}
                      href={`/v3/teacher/${id}/preview`}
                    >
                      Preview adventure
                    </Link>
                    <Link
                      className={button.quiet}
                      href={`/v3/teacher/${id}?view=editor`}
                    >
                      Open adventure editor
                    </Link>
                  </div>
                </section>
              ) : row.status === "failed" ? (
                <StartAgain adventureId={id} />
              ) : (
                <>
                  <p role="status" className="text-sm text-muted">
                    The content is arriving. Retrying…
                  </p>
                  <GenerationProgress
                    adventureId={id}
                    seesCost={viewerSeesCost(viewer)}
                    compact
                  />
                </>
              )}
            </>
          ) : null}
        </CreationWorkspace>
      </main>
    </div>
  );
}
