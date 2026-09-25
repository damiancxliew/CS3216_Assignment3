import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DebriefViewed } from "@/components/debrief-viewed";
import { DebriefScreen } from "@/components/play/debrief-screen";
import { loadDebrief } from "@/lib/attempts/debrief";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Debrief", robots: { index: false } };

export default async function DebriefPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const debrief = await loadDebrief(supabase, attemptId);
  if (!debrief) notFound();
  return <><DebriefViewed endingId={debrief.ending.id} /><DebriefScreen debrief={debrief} /></>;
}
