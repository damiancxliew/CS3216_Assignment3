import React from "react";
import { notFound } from "next/navigation";
import { validateSpec } from "@adventure/spec-v3";
import { validateEditedSpec } from "@/lib/v3/edit/validation";
import { Page } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { reviewErrors, reviewSources } from "@/lib/v3/review";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { getV3GenerationProgress } from "../../actions";
import { ReviewIssue } from "@/components/teacher/review-issue";
import { EditorWorkspace } from "./editor-workspace";

export default async function AdventureWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const viewer = await getViewer(await createClient());
  if (!viewer.user || !isStaff(viewer)) notFound();
  const admin = createAdminClient();
  const row = await supabaseV3BriefStore(admin).load(id);
  if (
    !row ||
    row.ownerId !== viewer.user.id ||
    !v3SchoolAllowed(row.schoolId) ||
    !["draft", "published", "archived"].includes(row.status)
  )
    notFound();
  const [adventure, progress, documents] = await Promise.all([
    new SupabaseV3PlayStore(admin).loadAdventure(id),
    getV3GenerationProgress(id),
    supabaseV3SourceStore(() => admin).load(id),
  ]);
  if (!adventure) notFound();
  // A failed progress read must not silently remove the final part errors.
  if (!progress || "error" in progress)
    throw new Error("Could not load generation checks");
  const parsed = validateSpec(adventure.spec);
  const sources = documents.map((d) => ({
    id: d.id,
    title: d.title,
    text: d.pages.map((p) => p.text).join("\n"),
  }));
  const checks =
    parsed.ok && parsed.spec.authoring
      ? validateEditedSpec(parsed.spec, sources, progress.checkErrors)
      : null;
  const errors =
    checks?.errors ?? reviewErrors(adventure.spec, progress.checkErrors);
  return (
    <Page
      title={parsed.ok ? parsed.spec.title : "Adventure"}
      width="wide"
      className="md:pb-0"
    >
      {parsed.ok ? (
        <EditorWorkspace
          adventureId={id}
          initialVersion={adventure.specVersion}
          publishedVersion={adventure.publishedVersion ?? null}
          published={adventure.status === "published"}
          capturedSources={sources}
          initial={parsed.spec}
          sources={reviewSources(parsed.spec, documents)}
          errors={errors}
          warnings={progress.warnings}
        />
      ) : (
        <section className="rounded-surface border border-line bg-surface p-5">
          <h2 className="text-xl font-bold">Needs fixing</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {errors.map((error, i) => (
              <li key={i}>
                <ReviewIssue issue={error} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
