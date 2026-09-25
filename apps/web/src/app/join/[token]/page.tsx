import type { Metadata } from "next";

import { joinAdventure } from "./actions";
import { EnterButton } from "./enter-button";
import { SignInButton } from "@/components/sign-in-button";
import { SiteNavigation } from "@/components/site-navigation";
import { ThemeSelect } from "@/components/theme-provider";
import { ErrorText, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type Preview = {
  adventure_id: string;
  title: string;
  setting: string | null;
  teacher_name: string | null;
  assets_ready: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function preview(token: string): Promise<Preview | null> {
  if (!UUID.test(token)) return null;
  const supabase = await createClient();
  const [details, readiness] = await Promise.all([
    supabase.rpc("share_link_preview", { p_token: token }).maybeSingle<Omit<Preview, "assets_ready">>(),
    supabase.rpc("share_link_ready", { p_token: token }),
  ]);
  return details.data ? { ...details.data, assets_ready: readiness.data === true } : null;
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
    return <Shell intro="This link isn’t open" title="Ask your teacher for the current one" />;
  }
  if (!adventure.assets_ready) {
    return <Shell intro="Preparing the adventure" title={adventure.title}>
      <p className="text-lg text-muted">Artwork and walking characters are being generated. Refresh this page shortly.</p>
    </Shell>;
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
            <EnterButton />
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="max-w-[50ch] text-base text-muted">Sign in to save your progress and continue later.</p>
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
  children?: React.ReactNode;
}) {
  return (
    <main className="game-grid mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-2"><SiteNavigation /><ThemeSelect /></div>
      </div>
      <div className="my-auto flex flex-col gap-5 rounded-[2rem] border-[3px] border-ink bg-surface px-7 py-10 shadow-[0_8px_0_var(--ink)] sm:px-12 sm:py-14">
        <p className="w-fit rounded-full bg-sunshine px-4 py-2 text-sm font-black uppercase tracking-wider text-ink">{intro}</p>
        <h1 className="max-w-[15ch] text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}
