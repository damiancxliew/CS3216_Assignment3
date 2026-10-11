import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { startAdventure } from "./actions";
import { AdventureCover } from "@/components/teacher/adventure-cover";
import { SignInButton } from "@/components/sign-in-button";
import { button, EmptyState, ErrorText, Page, StatusBadge } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadLibraryArtwork } from "@/lib/teacher/library";

export const metadata: Metadata = { title: "School library", robots: { index: false } };

type LibraryEntry = {
  adventure_id: string;
  organization_id: string;
  title: string;
  setting: string | null;
  teacher_name: string | null;
  allow_retries: boolean;
  latest_attempt_id: string | null;
  latest_attempt_status: "active" | "spectating" | "completed" | "abandoned" | null;
  updated_at: string;
};

type AdventureArtworkVersion = { id: string; published_version: number | null };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user) {
    return (
      <Page title="Your school library" lede="Sign in to find adventures published by your school.">
        <SignInButton next="/library" label="Sign in with Google" />
      </Page>
    );
  }
  if (!viewer.membership) {
    return (
      <Page title="Your school library">
        <EmptyState title="Your account isn&apos;t part of a school yet.">
          Open your school&apos;s sign-up link to join and see its published adventures.
        </EmptyState>
      </Page>
    );
  }

  const { data: libraryRows, error: libraryError } = await supabase.rpc("list_library").returns<LibraryEntry[]>();
  if (libraryError) console.error("could not load school library", libraryError);
  const adventures = (libraryRows ?? []) as unknown as LibraryEntry[];
  const artworkVersions: AdventureArtworkVersion[] = adventures.length
    ? (await createAdminClient().from("adventure")
        .select("id, published_version")
        .in("id", adventures.map((adventure) => adventure.adventure_id))
        .returns<AdventureArtworkVersion[]>()).data ?? []
    : [];
  const artwork = await loadLibraryArtwork(createAdminClient(), artworkVersions, { publishedOnly: true });

  return (
    <Page
      title="Your school library"
      lede="Every published adventure your school has shared with students."
      width="wide"
    >
      {error === "start" ? <ErrorText>We couldn’t start that adventure. Please try again.</ErrorText> : null}
      {adventures.length === 0 ? (
        <EmptyState title="No adventures published in your school yet.">
          Check back after a teacher publishes an adventure.
        </EmptyState>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {adventures.map((adventure) => {
            const art = artwork.get(adventure.adventure_id);
            const version = artworkVersions.find((item) => item.id === adventure.adventure_id)?.published_version ?? null;
            const activeAttempt = adventure.latest_attempt_id
              && (adventure.latest_attempt_status === "active" || adventure.latest_attempt_status === "spectating");
            return (
              <li key={adventure.adventure_id}>
                <article className="flex h-full flex-col overflow-hidden rounded-surface border-2 border-line bg-surface shadow-[0_4px_0_color-mix(in_srgb,var(--shadow)_8%,transparent)]">
                  <div className="relative aspect-[4/3] border-b-2 border-line">
                    <AdventureCover src={art?.cover?.url ?? null} kind={art?.cover?.kind} />
                    <div className="absolute left-3 top-3 rounded-full bg-surface p-1 shadow-sm">
                      <StatusBadge status="published" version={version} />
                    </div>
                    {art?.portraits.length ? <div className="absolute bottom-3 left-3 flex -space-x-2" aria-hidden="true">
                      {art.portraits.map((portrait) => <span key={portrait} className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-surface shadow-md"><AdventureCover src={portrait} /></span>)}
                    </div> : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <h2 className="text-2xl font-black leading-tight tracking-tight text-ink">{adventure.title}</h2>
                    {adventure.setting ? <p className="flex items-start gap-2 text-sm text-muted"><MapPin className="mt-1 h-4 w-4 shrink-0 text-signal" aria-hidden />{adventure.setting}</p> : null}
                    {adventure.teacher_name ? <p className="text-sm text-muted">Set by {adventure.teacher_name}</p> : null}
                    <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-4">
                      {activeAttempt ? (
                        <Link href={`/play/${adventure.latest_attempt_id}`} className={button.primary}>Resume</Link>
                      ) : adventure.latest_attempt_id ? (
                        <>
                          <Link href={`/play/${adventure.latest_attempt_id}/debrief`} className={button.quiet}>Debrief</Link>
                          {adventure.allow_retries ? (
                            <form action={startAdventure.bind(null, adventure.adventure_id)}>
                              <button type="submit" className={button.primary}>Play again</button>
                            </form>
                          ) : null}
                        </>
                      ) : (
                        <form action={startAdventure.bind(null, adventure.adventure_id)}>
                          <button type="submit" className={button.primary}>Start</button>
                        </form>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
