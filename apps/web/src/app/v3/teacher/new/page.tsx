import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

import { StartBriefRedirect } from "./start-button";

export const metadata: Metadata = {
  title: "New adventure",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function NewV3AdventurePage() {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) notFound();

  return <StartBriefRedirect />;
}
