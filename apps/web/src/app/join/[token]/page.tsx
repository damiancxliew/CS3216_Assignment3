import type { Metadata } from "next";

import { joinAdventure } from "./actions";
import { SignInButton } from "@/components/sign-in-button";
import { createClient } from "@/lib/supabase/server";

type Preview = {
  adventure_id: string;
  title: string;
  setting: string | null;
  teacher_name: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function preview(token: string): Promise<Preview | null> {
  if (!UUID.test(token)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("share_link_preview", { p_token: token })
    .maybeSingle<Preview>();
  return data ?? null;
}

export const metadata: Metadata = {
  title: "Join an adventure",
  robots: { index: false },
};

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const adventure = await preview(token);

  // A draft, archived or nonexistent adventure is indistinguishable from here:
  // the link is simply not a way in until the teacher publishes (P3).
  if (!adventure) {
    return (
      <Shell title="This link isn’t open">
        <p className="opacity-80">
          Either this adventure hasn’t been published yet, or the link has been
          replaced. Ask your teacher for the current one.
        </p>
      </Shell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell title={adventure.title}>
      {adventure.setting ? (
        <p className="opacity-80">{adventure.setting}</p>
      ) : null}
      {adventure.teacher_name ? (
        <p className="text-sm opacity-60">Set by {adventure.teacher_name}</p>
      ) : null}

      {user ? (
        <form
          action={async () => {
            "use server";
            await joinAdventure(token);
          }}
        >
          <button
            type="submit"
            className="inline-flex w-fit items-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
          >
            Enter the adventure
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            Sign in so your progress is saved and you can pick the attempt back
            up later.
          </p>
          <SignInButton next={`/join/${token}`} label="Sign in with Google" />
        </div>
      )}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          We couldn’t let you in. The adventure may have been unpublished.
        </p>
      ) : null}
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm uppercase tracking-widest opacity-60">
        You’ve been invited to play
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      {children}
    </main>
  );
}
