import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { V3PreviewClient } from "@/components/play/v3/v3-preview-client";
import { startPreview } from "@/lib/play/v3/preview";
import { v3PreviewDeps, v3PublishDeps } from "@/lib/play/v3/http";
import { EngineSpec } from "@adventure/engine";
import { v3MapContext } from "@/lib/play/v3/map-context";
import { versionedPortraitBase } from "@/lib/play/v3/portraits";
import { v3StageArtBase } from "@/lib/play/v3/stage-art";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";
import type { PlayerView } from "@adventure/play-contract";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false },
};

export default async function V3TeacherPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!v3Enabled()) notFound();
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

  const body = result.body as { token: string; view: PlayerView };
  const adventure = await v3PublishDeps().store.loadAdventure(id);
  const parsed = EngineSpec.safeParse(adventure?.spec);
  return (
    <V3PreviewClient
      portraitBase={
        adventure && parsed.success
          ? versionedPortraitBase(
              id,
              adventure.specVersion,
              parsed.data.authoring?.portraitVersions,
            )
          : null
      }
      stageArtBase={adventure ? v3StageArtBase(id, adventure.specVersion) : null}
      mapContext={parsed.success ? v3MapContext(parsed.data) : null}
      adventureId={id}
      initialToken={body.token}
      initialView={body.view}
    />
  );
}
