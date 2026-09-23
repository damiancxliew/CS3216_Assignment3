import type { Metadata } from "next";
import Link from "next/link";

import { BriefChat } from "./brief-chat";
import { SignInButton } from "@/components/sign-in-button";
import { EmptyState, Page, StatusBadge } from "@/components/ui";
import { briefStateSchema } from "@/lib/brief/schema";
import { createClient } from "@/lib/supabase/server";

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
      .select("id, title, setting, status, published_version, updated_at")
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

  return (
    <Page
      title="Your adventures"
      kicker={<form action="/auth/signout" method="post"><button type="submit" className="hover:text-ink">Sign out</button></form>}
      width="wide"
      fill
    >
      <div className="grid gap-12 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16">
        <section className="flex flex-col gap-4 lg:max-h-full lg:overflow-y-auto">
          {adventures.length === 0 ? (
            <EmptyState title="No adventures yet">Start with the class you are teaching next.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {adventures.map((adventure) => (
                <li key={adventure.id}>
                  <Link
                    href={`/teacher/${adventure.id}`}
                    className="group flex items-baseline justify-between gap-4 py-4 transition-colors hover:text-record"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-serif text-xl text-ink group-hover:text-record">{adventure.title}</span>
                      {adventure.setting ? <span className="text-base text-muted">{adventure.setting}</span> : null}
                    </span>
                    <StatusBadge status={adventure.status} version={adventure.published_version} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-5 rounded-surface border border-line bg-surface p-6 lg:max-h-full lg:overflow-hidden">
          <h2 className="font-serif text-2xl text-ink">New adventure</h2>
          <BriefChat resume={resume.success ? resume.data : undefined} />
        </section>
      </div>
    </Page>
  );
}
