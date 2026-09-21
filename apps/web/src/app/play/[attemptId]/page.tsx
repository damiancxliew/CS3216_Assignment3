import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your attempt",
  robots: { index: false },
};

/**
 * Placeholder for the game client (Yi Hao's slice). It exists so the share
 * link has somewhere to land and so admission is provably enforced: the attempt
 * row is read as the signed-in user, so RLS returns nothing for someone else's
 * attempt and the page 404s.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: attempt } = await supabase
    .from("attempt")
    .select("id, status, current_stage_id, stage_deadline_at")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">You’re in.</h1>
      <p className="opacity-80">
        The game view lands with the renderer. Until then, this attempt is live
        and the server is holding your stage deadline.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="opacity-60">Attempt</dt>
        <dd className="font-mono">{attempt.id}</dd>
        <dt className="opacity-60">Status</dt>
        <dd>{attempt.status}</dd>
        <dt className="opacity-60">Deadline</dt>
        <dd>{attempt.stage_deadline_at ?? "no timer"}</dd>
      </dl>
    </main>
  );
}
