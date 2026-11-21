import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseJobStore, type JobStep } from "@adventure/jobs";
import {
  validateSkeleton,
  validateSpec,
  type SkeletonShape,
} from "@adventure/spec-v3";
import { SiteHeader, Thinking } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { canAccessV3Authoring } from "@/lib/v3/access";
import { AdventureTransfer } from "@/components/teacher/v3-version-controls";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { PASS_ORDER, type PassName } from "@/lib/v3/generation/labels";
import {
  loadPause,
  storedBrief,
  viewerSeesCost,
  type GuidedPass,
} from "@/lib/v3/generation/service";
import { capturedSources } from "@/lib/v3/edit/apply";
import { getV3GenerationProgress } from "../actions";
import { GenerationProgress, GenerationProgressCard } from "./generation-progress";
import { SkeletonEditor } from "./skeleton-editor";
import { PendingContent, StartAgain } from "./review-actions";
import AdventureWorkspace from "./review/adventure-workspace";
import { SourcesReview, PauseEditor } from "./guided-review";
import { GenerationToolbar, ReviewToolbar } from "./review-toolbar";
import { DraftLinks } from "./draft-links";
import { CreationWorkspace } from "./creation-workspace";
import { SourceMaterial } from "./brief-sources";
import { BriefSummary } from "./brief-overview";
import creationStyles from "./creation-workspace.module.css";
import { GenerationHistory } from "./generation-history";
import { GenerationSection, generationSections, type SectionKey } from "./generation-section";
import { DraftReview } from "./draft-review";
import { validateEditedSpec } from "@/lib/v3/edit/validation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

const sectionOf = (name: PassName): SectionKey => (name === "check" || name === "save" ? "finish" : name);
const GUIDED_STEPS: GuidedPass[] = ["sources", "skeleton", "details", "endings", "reveal"];
const activity: Record<SectionKey, string> = {
  sources: "Reading your sources…", skeleton: "Planning the story…", details: "Writing scenes, characters and documents…",
  endings: "Writing decisions and endings…", reveal: "Writing the reveal and questions…", finish: "Checking the story and saving your draft…",
};
const stoppedAt: Record<SectionKey, string> = {
  sources: "reading the sources", skeleton: "planning the outline", details: "writing the scenes",
  endings: "writing the endings", reveal: "writing the reveal", finish: "the final checks",
};

/** The section being written now: the first pass that hasn't succeeded, else the one after the last success. */
function workingSection(steps: readonly JobStep[]): SectionKey {
  const status = (name: PassName) => steps.find((step) => step.name === name)?.status;
  const open = PASS_ORDER.find((name) => status(name) !== undefined && status(name) !== "succeeded");
  if (open) return sectionOf(open);
  const next = PASS_ORDER.find((name) => status(name) === undefined);
  return sectionOf(next ?? "save");
}

export default async function V3AdventurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer(await createClient());
  if (!viewer.user || (!isStaff(viewer) && !viewer.isSysadmin)) notFound();
  const admin = createAdminClient();
  const row = await supabaseV3BriefStore(admin).load(id);
  if (!row || !canAccessV3Authoring(viewer, row))
    notFound();
  const query = await searchParams;
  // Every mode finishes in this workspace; only rows without a brief, or an explicit request, open the editor.
  if (
    ["published", "archived"].includes(row.status) ||
    (row.status === "draft" && (!row.state || query?.view === "editor"))
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
  const guided = validProgress?.mode === "guided";
  const pause =
    row.status === "needs_review" && guided
      ? await loadPause(deps, store, {
          id,
          schoolId: row.schoolId,
          ownerId: row.ownerId,
          status: "needs_review",
        })
      : null;
  const pass = pause?.pass ?? validProgress?.pausedAt;
  // A pass marks the row for review a moment before its step is recorded as done.
  const generating =
    row.status === "generating" || (row.status === "needs_review" && !pass);
  const failed = row.status === "failed";
  const working = generating ? workingSection(steps) : null;
  // Without a pause (quick/standard), each finished step is what to read next; Guided reviews it at the pause instead.
  const justDone = generating && !guided
    ? (["reveal", "endings", "details", "skeleton", "sources"] as const).find((name) => steps.some((step) => step.name === name && step.status === "succeeded")) ?? null
    : null;
  const failedStep = failed ? steps.find((step) => step.status === "failed") : undefined;
  const failedSection = failedStep && (PASS_ORDER as readonly string[]).includes(failedStep.name)
    ? sectionOf(failedStep.name as PassName) : null;
  const title =
    row.status === "draft"
      ? "Your adventure is ready"
      : failed
        ? "Generation stopped"
        : generationSections[pass ?? working ?? "sources"].title;
  // Guided mode counts its five review steps; the step label stays put while each is written.
  const stepSection = pass ?? working;
  const stepLabel = guided && row.status !== "draft" && !failed && stepSection
    ? stepSection === "finish" ? "Final checks" : `Step ${GUIDED_STEPS.indexOf(stepSection) + 1} of 5`
    : null;
  const statusMessage =
    row.status === "briefing"
      ? ""
      : row.status === "draft"
        ? "Preview the adventure to see what students will play. You can keep editing the cards or ask for changes here."
        : failed
          ? `Generation stopped${failedSection ? ` while ${stoppedAt[failedSection]}` : ""}. Your sources and answers are saved, so you can start again with them.`
          : generating
            ? "Working on the next step. Each part appears here when it’s ready."
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
  const sources = capturedSources([...documents]);
  const placeholder = (key: SectionKey) => (
    <div className={creationStyles.card} data-generation-placeholder>
      <Thinking label={activity[key]} />
    </div>
  );

  return (
    <div className="min-h-screen md:flex md:h-dvh md:flex-col md:overflow-hidden">
      <SiteHeader />
      <main className="md:min-h-0 md:flex-1">
        <CreationWorkspace
          key={id}
          brief={brief}
          active={row.status === "briefing"}
          complete={row.status === "draft"}
          failed={failed}
          generating={generating}
          statusMessage={statusMessage}
          generationProgress={row.status === "briefing" ? null : generating ? <GenerationProgress adventureId={id} seesCost={viewerSeesCost(viewer)} initial={validProgress} /> : validProgress ? <GenerationProgressCard progress={validProgress} seesCost={viewerSeesCost(viewer)} now={Date.now()} /> : null}
          contentHeader={row.status !== "briefing" ? <header className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold tracking-tight text-ink">
                  {title}
                </h2>
                {row.status === "draft" && final?.data ? <AdventureTransfer adventureId={id} version={final.data.spec_version} publishedVersion={null} /> : null}
                {stepLabel ? <span className="text-xs text-muted">{stepLabel}</span> : null}
              </header> : null}
        >
          {row.status !== "briefing" ? (
            <>
              {row.state ? <BriefSummary brief={row.state} /> : null}
              <GenerationSection pass="sources" current={justDone === "sources" || (!justDone && working === "sources") || pause?.pass === "sources"} pending={!justDone && working === "sources"}>
                <SourceMaterial adventureId={id} sources={documents.length ? documents.map(({ id, title, kind }) => ({ id, title, kind })) : brief.sources} />
                {!generating && pause?.pass === "sources" ? <SourcesReview adventureId={id} pause={pause} /> : null}
                {working === "sources" ? placeholder("sources") : null}
              </GenerationSection>
              <GenerationHistory
                steps={
                  row.status === "draft"
                    ? steps.filter((step) => step.name === "skeleton")
                    : [...steps]
                }
                documents={[...documents]}
                current={pass}
                focus={justDone ?? undefined}
              />
              {row.status === "draft" && finalSpec?.ok && final?.data ? (
                <DraftReview
                  adventureId={id}
                  initial={finalSpec.spec}
                  initialVersion={final.data.spec_version}
                  initialErrors={validateEditedSpec(finalSpec.spec, sources, validProgress?.checkErrors).errors}
                  sources={sources}
                />
              ) : null}
              {generating ? (
                <>
                  {working && working !== "sources" ? <GenerationSection pass={working} current={!justDone} pending>{placeholder(working)}</GenerationSection> : null}
                  <GenerationToolbar />
                </>
              ) : pause?.pass === "sources" ? null : pause && "base" in pause ? (
                <GenerationSection pass={pause.pass} current><PauseEditor
                  key={pause.pass}
                  adventureId={id}
                  pause={pause}
                  sources={sources}
                /></GenerationSection>
              ) : skeleton && pass === "skeleton" ? (
                <GenerationSection pass="skeleton" current><SkeletonEditor
                  adventureId={id}
                  initial={skeleton}
                  hasDraft={validProgress?.hasDraft === true}
                /></GenerationSection>
              ) : row.status === "draft" ? (
                // DraftReview carries these links in its bar; this covers a draft whose spec didn't parse.
                finalSpec?.ok ? null : <ReviewToolbar discard={null} resolve={null} primary={<DraftLinks adventureId={id} />} />
              ) : failed ? (
                <StartAgain adventureId={id} />
              ) : (
                <>
                  <PendingContent />
                  <GenerationToolbar />
                </>
              )}
            </>
          ) : null}
        </CreationWorkspace>
      </main>
    </div>
  );
}
