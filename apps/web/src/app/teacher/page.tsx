import type { Metadata } from "next";
import Link from "next/link";

import { createAdventure } from "./actions";
import { ActionForm } from "@/components/action-form";
import { SignInButton } from "@/components/sign-in-button";
import { Field, StatusBadge } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
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
      <Shell>
        <p className="opacity-80">
          Sign in to build an adventure from your own source material.
        </p>
        <SignInButton next="/teacher" label="Teacher sign-in with Google" />
      </Shell>
    );
  }

  // RLS returns only this teacher's adventures; no owner filter is needed here
  // and adding one would hide the fact that the database is the one enforcing it.
  const { data } = await supabase
    .from("adventure")
    .select("id, title, setting, status, published_version, updated_at")
    .order("updated_at", { ascending: false })
    .returns<AdventureRow[]>();
  const adventures = data ?? [];

  return (
    <Shell>
      <section className="flex flex-col gap-4">
        {adventures.length === 0 ? (
          <p className="opacity-70">
            Nothing here yet. Start with the class you are teaching next.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {adventures.map((adventure) => (
              <li key={adventure.id}>
                <Link
                  href={`/teacher/${adventure.id}`}
                  className="flex items-baseline justify-between gap-4 py-3 transition hover:opacity-70"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{adventure.title}</span>
                    {adventure.setting ? (
                      <span className="text-sm opacity-60">{adventure.setting}</span>
                    ) : null}
                  </span>
                  <StatusBadge
                    status={adventure.status}
                    version={adventure.published_version}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-medium">New adventure</h2>
        <ActionForm
          action={createAdventure}
          submitLabel="Create"
          pendingLabel="Creating…"
          event={ANALYTICS_EVENTS.adventureCreated}
        >
          <Field name="title" label="Title" placeholder="The founding of Singapore, 1819" />
          <Field
            name="setting"
            label="Setting"
            placeholder="Singapore, February 1819"
            optional
          />
        </ActionForm>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-widest opacity-60">Teacher console</p>
        <h1 className="text-3xl font-semibold tracking-tight">Your adventures</h1>
      </header>
      {children}
    </main>
  );
}
