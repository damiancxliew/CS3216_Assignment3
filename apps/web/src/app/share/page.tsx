import type { Metadata } from "next";
import Link from "next/link";
import { SiteNavigation } from "@/components/site-navigation";

import { button, Wordmark } from "@/components/ui";

type ShareSearchParams = Promise<{ title?: string; adventure?: string }>;

function ogImagePath(title?: string, adventure?: string) {
  const params = new URLSearchParams();
  if (title) params.set("title", title);
  if (adventure) params.set("adventure", adventure);
  const query = params.toString();
  return `/share/og${query ? `?${query}` : ""}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: ShareSearchParams;
}): Promise<Metadata> {
  const { title, adventure } = await searchParams;
  const image = ogImagePath(title, adventure);
  const pageTitle = title
    ? `${title} — an ending in ${adventure ?? "Historical Adventures"}`
    : "An ending in Historical Adventures";
  const description =
    "Someone finished a Historical Adventures simulation and reached this ending. Play the history yourself.";
  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description, images: [image] },
    twitter: { card: "summary_large_image", title: pageTitle, description, images: [image] },
    robots: { index: false },
  };
}

/**
 * The landing spot for a shared ending. The card the crawler renders lives at
 * /share/og; this page only has to tell a person what they are looking at and
 * give them somewhere to go. The URL carries just the two public titles — no
 * attempt ids or share tokens.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: ShareSearchParams;
}) {
  const { title, adventure } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 px-6 py-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark /><SiteNavigation />
      </div>

      <section className="game-shadow flex flex-col gap-6 rounded-[2rem] border-[3px] border-ink bg-surface px-7 py-10 sm:px-10">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-record">Shared ending</p>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">
          {title ? `Someone finished ${adventure ?? "an adventure"} — ${title}` : "Someone finished a Historical Adventures simulation."}
        </h1>
        <p className="max-w-[58ch] text-lg leading-relaxed text-muted">
          Historical Adventures turns a teacher’s sources into a world students can explore, question and change.
        </p>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Link href="/" className={button.primary}>
            See how it works
          </Link>
          <Link href="/teacher" className={button.quiet}>
            Teacher sign-in
          </Link>
        </div>
      </section>
    </main>
  );
}
