import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EngineSpec, type EngineState } from "@adventure/engine";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { backdropFromState } from "@/lib/play/v3/backdrop";
import { getAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { versionedPortraitBase } from "@/lib/play/v3/portraits";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";

export const metadata: Metadata = {
  title: "Your adventure",
  robots: { index: false },
};

export default async function V3PlayPage({ params }: { params: Promise<{ attemptId: string }> }) {
  if (!v3Enabled()) notFound();
  const { attemptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const deps = v3PlayDeps();
  const result = await getAttempt(deps, user.id, attemptId);
  if (result.status === 404) notFound();
  const body = result.body as { revision: number; view: Parameters<typeof V3PlayClient>[0]["initialView"] };
  const attempt = await deps.store.loadAttempt(attemptId);
  if (!attempt) notFound();
  const phase = body.view.phase;
  const rawSpec = await deps.store.loadVersionSpec(attempt.adventureId, attempt.specVersion);
  const spec = rawSpec === null ? null : EngineSpec.parse(rawSpec);
  const backdrop = spec && (phase === "epilogue" || phase === "interview") ? backdropFromState(spec, attempt.state as EngineState) : null;
  return (
    <V3PlayClient
      attemptId={attemptId}
      initialView={body.view}
      initialRevision={body.revision}
      portraitBase={versionedPortraitBase(attempt.adventureId, attempt.specVersion, spec?.authoring?.portraitVersions)}
      backdrop={backdrop}
    />
  );
}
