import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import { compactButton as button, EmptyState, Page } from "@/components/ui";
import { validateSkeleton } from "@adventure/spec-v3";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { briefStateV3Schema } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_LABELS } from "@/lib/v3/generation/labels";
import { loadPublishState } from "@/lib/play/v3/publish";
import { v3PublishDeps } from "@/lib/play/v3/http";
import { viewerSeesCost } from "@/lib/v3/generation/service";
import type { SkeletonShape } from "@adventure/spec-v3";

import { getV3GenerationProgress } from "../actions";
import { V3BriefChat } from "./brief-chat";
import { GenerationProgress } from "./generation-progress";
import { SkeletonEditor } from "./skeleton-editor";
import { StartAgain } from "./review-actions";
import { DraftReady } from "./draft-ready";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

export default async function V3AdventurePage({ params }: { params: Promise<{ id: string }> }) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer)) notFound();

  const row = await supabaseV3BriefStore(createAdminClient()).load(id);
  if (!row || row.ownerId !== viewer.user.id || !v3SchoolAllowed(row.schoolId)) notFound();

  const publish = ["draft", "published", "archived"].includes(row.status) ? await loadPublishState(v3PublishDeps(), viewer.user.id, id) : undefined;
  const blockedReason = publish && publish.kind !== "hidden" ? publish.blockedReason : undefined;

  switch (row.status) {
    case "briefing": {
      const state = briefStateV3Schema.safeParse(row.state);
      if (!state.success) notFound();
      return (
        <Page title="New adventure" lede="A few short questions, then the generator builds the world." width="wide">
          <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col">
            <V3BriefChat initial={state.data} />
          </div>
        </Page>
      );
    }
    case "generating":
      return (
        <Page title="Generating your adventure" lede="The passes run in order — you can leave this page and come back.">
          <GenerationProgress adventureId={id} seesCost={viewerSeesCost(viewer)} />
        </Page>
      );
    case "needs_review": {
      const progress = await getV3GenerationProgress(id);
      // a saved draft may be mid-edit broken — still hand it to the editor (the checks inside flag it)
      const rawSkeleton = progress && !("error" in progress) ? progress.skeleton : undefined;
      const parsed = rawSkeleton !== undefined ? validateSkeleton(rawSkeleton) : undefined;
      const skeleton = parsed?.ok ? parsed.spec : (rawSkeleton as SkeletonShape | undefined);
      const hasDraft = progress && !("error" in progress) && progress.hasDraft === true;
      return (
        <Page title="Check the skeleton" lede="This is what the generator plans to build. Edit anything, then continue when it looks right." width="wide">
          {skeleton ? (
            <SkeletonEditor adventureId={id} initial={skeleton} hasDraft={hasDraft} />
          ) : (
            <EmptyState title="No skeleton">The skeleton could not be loaded.</EmptyState>
          )}
        </Page>
      );
    }
    case "draft": {
      const progress = await getV3GenerationProgress(id);
      const errors = progress && !("error" in progress) ? progress.checkErrors ?? [] : [];
      const warnings = progress && !("error" in progress) ? progress.warnings : [];
      return (
        <Page kicker="Your adventure · Draft" title={row.title ?? "Adventure ready"} lede="Review the story, then share it with your class." width="wide">
          <DraftReady adventureId={id} errors={errors} warnings={warnings} blocked={!!blockedReason}
            publishControl={<V3PublishPanel {...(publish && publish.kind !== "hidden" ? { version: publish.version, publishedVersion: publish.publishedVersion, unpublishedChanges: publish.kind === "published" && publish.unpublishedChanges } : {})} adventureId={id} published={false} compact blockedReason={blockedReason ? "Fix the errors in review before publishing." : undefined} />} />
        </Page>
      );
    }
    case "failed": {
      const progress = await getV3GenerationProgress(id);
      const failed = progress && !("error" in progress) ? progress.steps.find((s) => s.status === "failed") : undefined;
      const label = failed ? (PASS_LABELS[failed.name as keyof typeof PASS_LABELS] ?? failed.name) : "generation";
      return (
        <Page title="Generation stopped" lede={`Generation stopped at ${label}. You can start again with the same sources.`}>
          <StartAgain adventureId={id} />
          {failed?.error ? (
            <details className="mt-6 max-w-2xl text-sm text-muted">
              <summary className="cursor-pointer font-semibold">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-surface border border-line bg-sunken p-3">{failed.error}</pre>
            </details>
          ) : null}
        </Page>
      );
    }
    default:
      return (
        <Page
          title={row.title ?? "Adventure"}
          lede={row.status === "published" ? "Students can play this adventure from its link." : "This adventure is already finished."}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/v3/teacher/${id}/preview`} className={button.primary}>
              Preview
            </Link>
            <Link href={`/v3/teacher/${id}/review`} className={button.subtle}>Review and edit</Link>
            <Link href={`/v3/teacher/${id}/summary`} className={button.quiet}>
              Class summary
            </Link>
          </div>
          <div className="mt-6">
            <V3PublishPanel {...(publish && publish.kind !== "hidden" ? { version: publish.version, publishedVersion: publish.publishedVersion, unpublishedChanges: publish.kind === "published" && publish.unpublishedChanges } : {})} adventureId={id} published={row.status === "published"} compact blockedReason={blockedReason} />
          </div>
        </Page>
      );
  }
}

