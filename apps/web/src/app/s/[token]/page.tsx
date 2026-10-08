import type { Metadata } from "next";
import Link from "next/link";

import { enrollWithSchoolToken } from "./actions";
import { EnterButton } from "@/app/join/[token]/enter-button";
import { SignInButton } from "@/components/sign-in-button";
import { SiteNavigation } from "@/components/site-navigation";
import { ThemeSelect } from "@/components/theme-provider";
import { button, ErrorText, Wordmark } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

type SchoolPreview = { organization_id: string; name: string; expires_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRED_MESSAGE = "This sign-up link has expired or is no longer valid. Ask your teacher for a new one.";

export const metadata: Metadata = {
  title: "Join your school",
  robots: { index: false },
};

export default async function SchoolSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const { user } = viewer;

  const preview = UUID.test(token)
    ? (await supabase.rpc("school_link_preview", { p_token: token }).maybeSingle<SchoolPreview>()).data
    : null;
  if (!preview) return <Shell intro="Sign-up link closed" title="Ask your teacher for a new one"><p className="text-lg text-muted">{EXPIRED_MESSAGE}</p></Shell>;

  const errorMessage = error === "42501"
    ? "You were removed from this school. Ask a teacher to restore you."
    : error === "23505"
      ? "Your account already belongs to another school."
      : error === "P0002"
        ? EXPIRED_MESSAGE
        : error
          ? "We couldn't join your school right now. Please try again."
          : null;
  const alreadyMember = viewer.membership?.organizationId === preview.organization_id;

  return (
    <Shell intro="Join your school" title={preview.name}>
      <p className="max-w-[54ch] text-lg text-muted">Join your school to see its published adventures.</p>
      {user ? (
        alreadyMember ? (
          <Link href="/library" className={`${button.primary} w-fit`}>Open your library</Link>
        ) : (
          <form action={async () => {
            "use server";
            await enrollWithSchoolToken(token);
          }}>
            <EnterButton label={`Join ${preview.name}`} pendingLabel={`Joining ${preview.name}…`} />
          </form>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="max-w-[50ch] text-base text-muted">Sign in to join this school and see its adventures.</p>
          <SignInButton next={`/s/${token}`} label="Sign in with Google" />
        </div>
      )}
      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
    </Shell>
  );
}

function Shell({ intro, title, children }: { intro: string; title: string; children: React.ReactNode }) {
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
