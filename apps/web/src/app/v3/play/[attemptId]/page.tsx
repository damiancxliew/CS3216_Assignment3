import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { getAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";
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

  const result = await getAttempt(v3PlayDeps(), user.id, attemptId);
  if (result.status === 404) notFound();
  const body = result.body as { revision: number; view: Parameters<typeof V3PlayClient>[0]["initialView"] };
  return <V3PlayClient attemptId={attemptId} initialView={body.view} initialRevision={body.revision} />;
}
