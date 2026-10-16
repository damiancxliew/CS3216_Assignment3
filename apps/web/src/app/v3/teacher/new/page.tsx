import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";

import { startV3Brief } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New adventure",
  robots: { index: false },
};

export default async function NewV3AdventurePage() {
  if (!v3Enabled()) notFound();
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) notFound();
  if (!v3SchoolAllowed(viewer.membership.organizationId)) notFound();

  const result = await startV3Brief();
  if ("error" in result || !("adventureId" in result)) notFound();
  redirect(`/v3/teacher/${result.adventureId}`);
}
