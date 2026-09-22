import type { Metadata } from "next";

import { joinAdventure } from "./actions";
import { SignInButton } from "@/components/sign-in-button";
import { button, ErrorText, Wordmark } from "@/components/ui";
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
      <Shell intro="This link isn’t open" title="Ask your teacher for the current one">
        <p className="max-w-[50ch] text-lg text-muted">
          Either this adventure hasn’t been published yet, or the link has been replaced.
        </p>
      </Shell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell intro="You’ve been invited to play" title={adventure.title}>
      {adventure.setting ? <p className="max-w-[54ch] text-lg text-muted">{adventure.setting}</p> : null}
      {adventure.teacher_name ? <p className="text-base text-muted">Set by {adventure.teacher_name}</p> : null}

      <div className="pt-2">
        {user ? (
          <form
            action={async () => {
              "use server";
              await joinAdventure(token);
            }}
          >
            <button type="submit" className={`${button.primary} min-h-12 px-6 text-base`}>
              Enter the adventure
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="max-w-[50ch] text-base text-muted">Sign in so your progress is saved and you can pick the attempt back up later.</p>
            <SignInButton next={`/join/${token}`} label="Sign in with Google" />
          </div>
        )}
      </div>

      {error ? <ErrorText>We couldn’t let you in. The adventure may have been unpublished.</ErrorText> : null}
    </Shell>
  );
}

function Shell({
  intro,
  title,
  children,
}: {
  intro: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8">
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-5 py-16">
        <p className="text-base text-muted">{intro}</p>
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}
