import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { validateSpec } from "@adventure/spec-v3";
import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import { button, Page } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { reviewErrors, reviewSources } from "@/lib/v3/review";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { getV3GenerationProgress } from "../../actions";
import { ReviewScreen } from "./review-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review adventure",
  robots: { index: false },
};

export default async function ReviewPage({
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
  const errors = reviewErrors(adventure.spec, progress.checkErrors);
  const parsed = validateSpec(adventure.spec);
  return (
    <Page
      title={parsed.ok ? parsed.spec.title : "Review adventure"}
      lede="Review the story, its evidence and the final checks before publishing."
      width="wide"
    >
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <Link href={`/v3/teacher/${id}`} className={button.subtle}>
            Back to adventure
          </Link>
          <Link href={`/v3/teacher/${id}/preview`} className={button.primary}>
            Preview
          </Link>
        </div>
        <V3PublishPanel
          adventureId={id}
          published={row.status === "published"}
          blockedReason={
            errors.length
              ? "Fix the blocking errors before publishing."
              : undefined
          }
        />
      </header>
      {parsed.ok ? (
        <ReviewScreen
          spec={parsed.spec}
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
                {error.path ? `${error.path}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
