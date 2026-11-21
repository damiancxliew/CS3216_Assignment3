import { resolveAdventureImages } from "@/lib/v3/media/resolvers";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { V3PreviewClient } from "@/components/play/v3/v3-preview-client";
import { v3AdventureScenery } from "@/lib/play/v3/scenery";
import { startPreview } from "@/lib/play/v3/preview";
import { v3PreviewDeps, v3PublishDeps } from "@/lib/play/v3/http";
import { EngineSpec, type PreviewInsight } from "@adventure/engine";
import { validateSpec } from "@adventure/spec-v3";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/auth/viewer";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { reviewAssets } from "@/lib/v3/review-assets";

import type { PlayerView } from "@adventure/play-contract";
import { PreviewWorkspace } from "./preview-workspace";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false },
};

export default async function V3TeacherPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const result = await startPreview(v3PreviewDeps(), user.id, id);
  if (result.status === 404) notFound();
  if (result.status === 409) {
    const body = result.body as { error: { message: string } };
    return (
      <main className="mx-auto grid min-h-[60dvh] max-w-3xl place-items-center px-5 py-12">
        <section className="w-full rounded-3xl border-2 border-ink bg-surface p-8 text-center shadow-[0_5px_0_var(--ink)]">
          <h1 className="text-xl font-black text-ink">
            This adventure can&apos;t be previewed yet.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {body.error.message}
          </p>
          <Link
            href={`/v3/teacher/${id}`}
            className="mt-4 inline-block text-sm underline"
          >
            ← Back to adventure
          </Link>
        </section>
      </main>
    );
  }

  const body = result.body as { token: string; view: PlayerView; insight?: PreviewInsight };
  const adventure = await v3PublishDeps().store.loadAdventure(id);
  const parsed = EngineSpec.safeParse(adventure?.spec);
  const game = {
    ...(adventure && parsed.success
      ? resolveAdventureImages(parsed.data, id, adventure.specVersion)
      : {}),
    scenery: parsed.success ? v3AdventureScenery(parsed.data) : [],
    initialToken: body.token,
    initialView: body.view,
  };
  const editable = adventure ? await editingContext(id, adventure.spec) : null;
  if (!adventure || !editable) return <V3PreviewClient {...game} adventureId={id} />;
  return (
    <PreviewWorkspace
      adventureId={id}
      brief={editable.brief}
      initial={editable.spec}
      initialVersion={adventure.specVersion}
      assets={{ version: adventure.specVersion, items: reviewAssets(editable.spec, id, adventure.specVersion) }}
      capturedSources={(await v3PublishDeps().sources?.(id)) ?? []}
      insight={body.insight ?? null}
      game={game}
    />
  );
}

/** Teachers who can edit the adventure get the edit panel; others see the plain preview. */
async function editingContext(id: string, spec: unknown) {
  const viewer = await getViewer(await createClient());
  const row = await supabaseV3BriefStore(createAdminClient()).load(id);
  const parsed = validateSpec(spec);
  if (!row || !parsed.ok || !canAccessV3Authoring(viewer, row)) return null;
  return { brief: row.state ?? initialBriefStateV3(id), spec: parsed.spec };
}
