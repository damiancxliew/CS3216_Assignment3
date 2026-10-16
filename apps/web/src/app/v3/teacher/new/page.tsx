import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Page } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";

import { StartBriefButton } from "./start-button";

export const metadata: Metadata = {
  title: "New adventure",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function NewV3AdventurePage() {
  if (!v3Enabled()) notFound();
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) notFound();
  if (!v3SchoolAllowed(viewer.membership.organizationId)) notFound();
  return (
    <Page title="New adventure" lede="A few short questions about your sources and your class, then the generator builds the world.">
      <StartBriefButton />
    </Page>
  );
}
