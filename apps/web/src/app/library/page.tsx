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

import { stageArtUrl, v3StageArtBase } from "@/lib/play/v3/stage-art";

export const metadata: Metadata = { title: "School library", robots: { index: false } };

type LibraryEntry = {
  kind: "v2" | "v3";
  published_version: number | null;
  version_id: string | null;
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

  const { data: libraryRows, error: libraryError } = await supabase.rpc("list_library_all_versions", { p_include_v3: true }).returns<LibraryEntry[]>();
  if (libraryError) console.error("could not load school library", libraryError);
  const adventures = (libraryRows ?? []) as unknown as LibraryEntry[];
  const v2Adventures = adventures.filter((adventure) => adventure.kind === "v2");
  const artworkVersions: AdventureArtworkVersion[] = v2Adventures.length
    ? (await createAdminClient().from("adventure")
        .select("id, published_version")
        .in("id", v2Adventures.map((adventure) => adventure.adventure_id))
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
      {libraryError ? <ErrorText>We couldn’t load your school’s adventures. Please try again.</ErrorText> : adventures.length === 0 ? (
        <EmptyState title="No adventures published in your school yet.">
          Check back after a teacher publishes an adventure.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          {(["v3", "v2"] as const).filter((kind) => adventures.some((adventure) => adventure.kind === kind)).map((kind) => (
            <section key={kind} aria-labelledby={`library-${kind}`} className="space-y-5 border-t-2 border-line pt-6">
              <h2 id={`library-${kind}`} className="text-2xl font-black text-ink">{kind.toUpperCase()} adventures</h2>
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {adventures.filter((adventure) => adventure.kind === kind).map((adventure) => {
                  const version = adventure.published_version;
                  const art = adventure.kind === "v3"
                    ? { cover: { url: stageArtUrl(version === null ? null : v3StageArtBase(adventure.adventure_id, version), 0), kind: "cover" as const }, portraits: [] }
                    : artwork.get(adventure.adventure_id);
                  const playPath = `${adventure.kind === "v3" ? "/v3" : ""}/play/${adventure.latest_attempt_id}`;
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
                          <h3 className="text-2xl font-black leading-tight tracking-tight text-ink">{adventure.title}</h3>
                          {adventure.setting ? <p className="flex items-start gap-2 text-sm text-muted"><MapPin className="mt-1 h-4 w-4 shrink-0 text-signal" aria-hidden />{adventure.setting}</p> : null}
                          {adventure.teacher_name ? <p className="text-sm text-muted">Set by {adventure.teacher_name}</p> : null}
                          <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-4">
                            {activeAttempt ? (
                              <Link href={playPath} className={button.primary}>Resume</Link>
                            ) : adventure.latest_attempt_id ? (
                              <>
                                <Link href={adventure.kind === "v3" ? playPath : `${playPath}/debrief`} className={button.quiet}>{adventure.kind === "v3" ? "View results" : "Debrief"}</Link>
                                {adventure.allow_retries ? (
                                  <form action={startAdventure.bind(null, adventure.adventure_id)}>
                                    <button type="submit" className={button.primary}>Play again</button>
                                  </form>
                                ) : null}
                              </>
                            ) : adventure.kind === "v3" ? (
                              adventure.version_id ? <Link href={`/v3/play/start/${adventure.version_id}`} prefetch={false} className={button.primary}>Start</Link> : <span className="text-sm text-muted">Link unavailable</span>
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
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
