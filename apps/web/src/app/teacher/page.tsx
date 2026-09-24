import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BookOpen, MapPin, Route } from "lucide-react";

import { TeacherWorkspace } from "./workspace";
import { SignInButton } from "@/components/sign-in-button";
import { EmptyState, Page, StatusBadge } from "@/components/ui";
import { briefStateSchema } from "@/lib/brief/schema";
import { createClient } from "@/lib/supabase/server";
import { loadLibraryArtwork } from "@/lib/teacher/library";
import { AdventureCover } from "@/components/teacher/adventure-cover";

export const metadata: Metadata = {
  title: "Your adventures",
  robots: { index: false },
};

type AdventureRow = {
  id: string;
  title: string;
  setting: string | null;
  status: "draft" | "published" | "archived";
  published_version: number | null;
  updated_at: string;
  stage_outline: { title: string; focus: string }[] | null;
};

export default async function TeacherHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Page title="Your adventures" lede="Sign in to build an adventure from your own source material.">
        <SignInButton next="/teacher" label="Sign in with Google" />
      </Page>
    );
  }

  // `adventure_select` also admits students playing a published adventure, so
  // the authoring surface filters on ownership rather than leaning on RLS.
  // A row still carrying a brief conversation is not an adventure yet: it is
  // offered back to the chat to resume instead of being listed.
  const [{ data }, { data: unfinished }] = await Promise.all([
    supabase
      .from("adventure")
      .select("id, title, setting, status, published_version, updated_at, stage_outline")
      .eq("owner_id", user.id)
      .is("brief_state", null)
      .order("updated_at", { ascending: false })
      .returns<AdventureRow[]>(),
    supabase
      .from("adventure")
      .select("brief_state")
      .eq("owner_id", user.id)
      .not("brief_state", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ brief_state: unknown }>(),
  ]);
  const adventures = data ?? [];
  const resume = briefStateSchema.safeParse(unfinished?.brief_state);
  const artwork = await loadLibraryArtwork(supabase, adventures);

  return (
    <Page
      title="Choose your next adventure"
      lede="Build a new historical world or jump back into one you already started."
      kicker={<form action="/auth/signout" method="post"><button type="submit" className="hover:text-ink">Sign out</button></form>}
      width="wide"
    >
      <TeacherWorkspace
        resume={resume.success ? resume.data : undefined}
        adventures={
          adventures.length === 0 ? (
            <EmptyState title="No adventures yet">Start with the class you are teaching next.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.12em] text-muted"><BookOpen className="h-4 w-4" aria-hidden />Your worlds</h2>
              <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold text-muted">{adventures.length} adventure{adventures.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2">
              {adventures.map((adventure) => {
                const art = artwork.get(adventure.id);
                const stages = adventure.stage_outline?.length ?? 0;
                return (
                <li key={adventure.id}>
                  <Link
                    href={`/teacher/${adventure.id}`}
                    className="group flex h-full flex-col overflow-hidden rounded-surface border-2 border-line bg-surface shadow-[0_4px_0_color-mix(in_srgb,var(--shadow)_8%,transparent)] transition-all duration-200 hover:border-ink hover:shadow-[0_7px_0_var(--ink)] motion-safe:hover:-translate-y-1"
                  >
                    <div className="relative aspect-[4/3] border-b-2 border-line">
                      <AdventureCover src={art?.cover ?? null} />
                      <div className="absolute left-3 top-3 rounded-full bg-surface p-1 shadow-sm"><StatusBadge status={adventure.status} version={adventure.published_version} /></div>
                      {art?.portraits.length ? <div className="absolute bottom-3 left-3 flex -space-x-2" aria-hidden="true">
                        {art.portraits.map((portrait) => <span key={portrait} className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-surface shadow-md"><AdventureCover src={portrait} /></span>)}
                      </div> : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <h3 className="text-2xl font-black leading-tight tracking-tight text-ink transition-colors group-hover:text-record">{adventure.title}</h3>
                      {adventure.setting ? <p className="flex items-start gap-2 text-sm text-muted"><MapPin className="mt-1 h-4 w-4 shrink-0 text-signal" aria-hidden />{adventure.setting}</p> : null}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted"><Route className="h-4 w-4" aria-hidden />{stages ? `${stages} chapter${stages === 1 ? "" : "s"}` : "A world in the making"}</span>
                        <span className="inline-flex items-center gap-1 text-sm font-extrabold text-record">{adventure.status === "draft" ? "Continue building" : "Open adventure"}<ArrowUpRight className="h-4 w-4 transition-transform motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" aria-hidden /></span>
                      </div>
                    </div>
                  </Link>
                </li>
              );})}
            </ul>
            </div>
          )
        }
      />
    </Page>
  );
}
