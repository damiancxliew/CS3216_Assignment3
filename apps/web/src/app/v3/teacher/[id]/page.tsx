import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Page } from "@/components/ui";
import { validateSkeleton } from "@adventure/spec-v3";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { briefStateV3Schema } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_LABELS } from "@/lib/v3/generation/labels";
import { viewerSeesCost } from "@/lib/v3/generation/service";
import type { SkeletonShape } from "@adventure/spec-v3";

import { getV3GenerationProgress } from "../actions";
import { V3BriefChat } from "./brief-chat";
import { GenerationProgress } from "./generation-progress";
import { SkeletonEditor } from "./skeleton-editor";
import { StartAgain } from "./review-actions";
import AdventureWorkspace from "./review/adventure-workspace";

import { supabaseJobStore } from "@adventure/jobs";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { loadPause } from "@/lib/v3/generation/service";
import { capturedSources } from "@/lib/v3/edit/apply";
import { GuidedSteps, SourcesReview, PauseEditor } from "./guided-review";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

export default async function V3AdventurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer)) notFound();

  const row = await supabaseV3BriefStore(createAdminClient()).load(id);
  if (!row || row.ownerId !== viewer.user.id || !v3SchoolAllowed(row.schoolId))
    notFound();

  switch (row.status) {
    case "briefing": {
      const state = briefStateV3Schema.safeParse(row.state);
      if (!state.success) notFound();
      return (
        <Page
          title="New adventure"
          lede="A few short questions, then the generator builds the world."
          width="wide"
        >
          <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col">
            <V3BriefChat initial={state.data} />
          </div>
        </Page>
      );
    }
    case "generating":
      return (
        <Page
          title="Generating your adventure"
          lede="The passes run in order — you can leave this page and come back."
        >
          <GenerationProgress
            adventureId={id}
            seesCost={viewerSeesCost(viewer)}
          />
        </Page>
      );
    case "needs_review": {
      const progress = await getV3GenerationProgress(id);
      const guided =
        progress && !("error" in progress) && progress.mode === "guided";
      if (guided) {
        const deps = defaultGenerationDeps();
        const adventure = await deps.adventures.get(id);
        const pause = adventure
          ? await loadPause(
              deps,
              supabaseJobStore(createAdminClient()),
              adventure,
            )
          : null;
        if (pause && pause.pass !== "skeleton")
          return (
            <Page
              title={`Check ${pause.pass}`}
              lede="Review this step, then continue generation when you are ready."
              width="wide"
            >
              <GuidedSteps pass={pause.pass} />
              {pause.pass === "sources" ? (
                <SourcesReview adventureId={id} pause={pause} />
              ) : (
                <PauseEditor
                  key={pause.pass}
                  adventureId={id}
                  pause={pause}
                  sources={capturedSources(await deps.sources.load(id))}
                />
              )}
            </Page>
          );
        if (!pause || !progress.pausedAt)
          return (
            <Page title="Loading your review">
              <p role="status">Waiting for the generated output. Retrying…</p>
              <GenerationProgress
                adventureId={id}
                seesCost={viewerSeesCost(viewer)}
              />
            </Page>
          );
      }
      // a saved draft may be mid-edit broken — still hand it to the editor (the checks inside flag it)
      const rawSkeleton =
        progress && !("error" in progress) ? progress.skeleton : undefined;
      const parsed =
        rawSkeleton !== undefined ? validateSkeleton(rawSkeleton) : undefined;
      const skeleton = parsed?.ok
        ? parsed.spec
        : (rawSkeleton as SkeletonShape | undefined);
      const hasDraft =
        progress && !("error" in progress) && progress.hasDraft === true;
      return (
        <Page
          title="Check the skeleton"
          lede="This is what the generator plans to build. Edit anything, then continue when it looks right."
          width="wide"
        >
          {guided ? <GuidedSteps pass="skeleton" /> : null}
          {skeleton ? (
            <SkeletonEditor
              adventureId={id}
              initial={skeleton}
              hasDraft={hasDraft}
            />
          ) : (
            <>
              <p role="status">Waiting for the skeleton. Retrying…</p>
              <GenerationProgress
                adventureId={id}
                seesCost={viewerSeesCost(viewer)}
              />
            </>
          )}
        </Page>
      );
    }
    case "draft":
    case "published":
    case "archived":
      return AdventureWorkspace({ params: Promise.resolve({ id }) });
    case "failed": {
      const progress = await getV3GenerationProgress(id);
      const failed =
        progress && !("error" in progress)
          ? progress.steps.find((s) => s.status === "failed")
          : undefined;
      const label = failed
        ? (PASS_LABELS[failed.name as keyof typeof PASS_LABELS] ?? failed.name)
        : "generation";
      return (
        <Page
          title="Generation stopped"
          lede={`Generation stopped at ${label}. You can start again with the same sources.`}
        >
          <StartAgain adventureId={id} />
          {failed?.error ? (
            <details className="mt-6 max-w-2xl text-sm text-muted">
              <summary className="cursor-pointer font-semibold">
                Technical details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-surface border border-line bg-sunken p-3">
                {failed.error}
              </pre>
            </details>
          ) : null}
        </Page>
      );
    }
    default:
      notFound();
  }
}
