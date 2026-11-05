import { resolveAdventureImages } from "@/lib/v3/media/resolvers";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { type EngineState } from "@adventure/engine";
import { decodeStoredSpec } from "@adventure/spec-v3";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { v3AdventureScenery } from "@/lib/play/v3/scenery";
import { backdropFromState } from "@/lib/play/v3/backdrop";
import { getAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your adventure",
  robots: { index: false },
};

export default async function V3PlayPage({ params,
}: { params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const supabase = await createClient();
  const { data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const deps = v3PlayDeps();
  const result = await getAttempt(deps, user.id, attemptId);
  if (result.status === 404) notFound();
  if (result.status !== 200) {
    const error = result.body.error as { message?: string } | undefined;
    return <main className="mx-auto max-w-xl p-6"><h1 className="text-xl font-bold">This adventure needs attention</h1><p role="alert" className="mt-3">{error?.message ?? 'This adventure cannot continue. Ask your teacher for help.'}</p></main>;
  }
  const body = result.body as { revision: number; view: Parameters<typeof V3PlayClient>[0]["initialView"];
  };
  const attempt = await deps.store.loadAttempt(attemptId);
  if (!attempt) notFound();
  const phase = body.view.phase;
  const rawSpec = await deps.store.loadVersionSpec(attempt.adventureId, attempt.specVersion,
  );
  const decoded = decodeStoredSpec(rawSpec);
  const spec = decoded.ok ? decoded.spec : null;
  const backdrop = spec && (phase === "epilogue" || phase === "interview") ? backdropFromState(spec, attempt.state as EngineState) : null;
  return (
    <V3PlayClient
      attemptId={attemptId}
      initialView={body.view}
      initialRevision={body.revision}
      {...(spec
        ? resolveAdventureImages(spec, attempt.adventureId, attempt.specVersion)
        : {})}
      scenery={spec ? v3AdventureScenery(spec) : []}
      backdrop={backdrop}
    />
  );
}
