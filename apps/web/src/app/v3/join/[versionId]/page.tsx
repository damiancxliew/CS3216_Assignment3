import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SignInButton } from "@/components/sign-in-button";
import { ErrorText, SiteHeader, button } from "@/components/ui";
import { loadJoinView } from "@/lib/play/v3/publish";
import { v3PublishDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join an adventure",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function V3JoinPage({ params, searchParams }: {
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<{ release?: string }>;
}) {
  if (!v3Enabled()) notFound();
  const { versionId } = await params;
  if (!UUID.test(versionId)) {
    return <Shell intro="This link isn’t open" title="Ask your teacher for the current one" />;
  }

  // Previously issued version-specific links redirect to the canonical version ID.
  // Bare adventure links have no fallback and remain closed.
  const legacyRelease = (await searchParams)?.release;
  if (legacyRelease && UUID.test(legacyRelease)) {
    const publication = await v3PublishDeps().store.loadPublication(legacyRelease);
    if (publication?.adventureId === versionId) redirect(`/v3/join/${publication.id}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const view = await loadJoinView(v3PublishDeps(), user?.id ?? null, versionId);
  const path = `/v3/join/${versionId}`;

  if (view.kind === "closed") {
    return <Shell intro="This link isn’t open" title="Ask your teacher for the current one" />;
  }
  const title = view.title ?? "A history adventure";
  if (view.kind === "sign_in") {
    return (
      <Shell intro="You’ve been invited to play" title={title}>
        <p className="max-w-[50ch] text-base text-muted">Sign in to save your progress and continue later.</p>
        <SignInButton next={path} label="Sign in with Google" />
      </Shell>
    );
  }
  if (view.kind === "not_member") {
    return (
      <Shell intro="You’ve been invited to play" title={title}>
        <ErrorText>This adventure is only for students of its school. Open your school&apos;s sign-up link first, then come back to this link.</ErrorText>
      </Shell>
    );
  }
  return (
    <Shell intro="You’ve been invited to play" title={title}>
      <div className="pt-2">
        <Link href={`/v3/play/start/${versionId}`} prefetch={false} className={button.primary}>
          Enter the adventure
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ intro, title, children }: { intro: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="game-grid flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <div className="my-auto flex flex-col gap-5 rounded-[2rem] border-[3px] border-ink bg-surface px-7 py-10 shadow-[0_8px_0_var(--ink)] sm:px-12 sm:py-14">
          <p className="w-fit rounded-full bg-sunshine px-4 py-2 text-sm font-black uppercase tracking-wider text-ink">{intro}</p>
          <h1 className="max-w-[15ch] text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
