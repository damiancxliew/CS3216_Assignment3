"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SignInButton } from "@/components/sign-in-button";
import { button, RecordEntry, WorldEntry, Wordmark } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

const teacherSteps = [
  {
    title: "Drop in your sources",
    body: "A dispatch, a treaty, three pages of a textbook chapter. Whatever you already teach from.",
  },
  {
    title: "Get a world back",
    body: "Locations, stakeholders who each want something different, evidence worth finding, and a decision at the end of every stage.",
  },
  {
    title: "Publish one link",
    body: "Published versions are frozen. Editing afterwards makes a new version and leaves the class currently playing untouched.",
  },
];

const beats = [
  {
    index: "01",
    clip: { src: "/media/world.mp4", poster: "/media/world.jpg" },
    title: "A place you can walk.",
    body: "The map, the goals, the people who are actually in the room with you.",
  },
  {
    index: "02",
    clip: { src: "/media/dialogue.mp4", poster: "/media/dialogue.jpg" },
    title: "People who want different things.",
    body: "Each stakeholder answers in character, from their own interests. Nobody hands over the whole truth.",
  },
  {
    index: "03",
    clip: { src: "/media/decision.mp4", poster: "/media/decision.jpg" },
    title: "A decision, with a clock.",
    body: "The stage ends on the student's commitment. The evidence they found either carries it or it doesn't.",
  },
  {
    index: "04",
    clip: { src: "/media/debrief.mp4", poster: "/media/debrief.jpg" },
    title: "A debrief that shows its sources.",
    body: null,
  },
] as const;

function Clip({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.25) {
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { threshold: [0, 0.25] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      controls={reduced}
      poster={poster}
      aria-label={label}
      className={className}
      src={src}
    />
  );
}

export default function Home() {
  useEffect(() => {
    track(ANALYTICS_EVENTS.landingViewed);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-24 px-6 py-8 sm:py-10">
      <nav className="flex items-center justify-between gap-4">
        <Wordmark />
        <Link href="/teacher" className={button.quiet}>
          Open the teacher console
        </Link>
      </nav>

      <section className="flex flex-col gap-10">
        <div className="flex flex-col gap-7">
          <h1 className="max-w-[14ch] font-serif text-5xl text-ink sm:text-[4rem] sm:leading-[1.02]">
            Play the source material.
          </h1>
          <p className="max-w-[52ch] text-lg text-muted sm:text-xl sm:leading-[1.45]">
            A teacher drops in their sources. The system builds a world around
            them. A student finds out what their decisions cost.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <SignInButton next="/teacher" label="Sign in with Google to build one" />
            <a href="#reel" className={button.quiet}>
              See a real run
            </a>
          </div>
        </div>

        <figure className="flex flex-col gap-3">
          <div className="relative rounded-surface border border-line bg-ink p-2 sm:p-3">
            <Clip
              src="/media/dialogue.mp4"
              poster="/media/dialogue.jpg"
              label="Gameplay footage: a student questioning Sir Stamford Raffles at Singapore, 1819"
              className="w-full rounded-control"
            />
            <span className="absolute left-5 top-5 hidden rounded-control border border-record/40 bg-record-wash px-3 py-1.5 text-sm font-semibold text-record shadow backdrop-blur-sm lg:flex">
              handout, p. 3 — cited in the game
            </span>
            <span className="absolute bottom-5 right-5 hidden rounded-control border border-world/40 bg-world-wash px-3 py-1.5 text-sm font-semibold text-world shadow backdrop-blur-sm lg:flex">
              what the simulation assumed
            </span>
          </div>
          <figcaption className="text-base text-muted">
            Real footage. A student questioning Sir Stamford Raffles at Singapore, 1819.
          </figcaption>
        </figure>
      </section>

      <section id="reel" className="flex flex-col gap-20 border-t border-line pt-12">
        {beats.map((beat, i) => (
          <div key={beat.index} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <figure
              className={`rounded-surface border border-line bg-ink p-2 sm:p-3 ${
                i % 2 === 0 ? "lg:order-1" : "lg:order-2"
              }`}
            >
              <Clip
                src={beat.clip.src}
                poster={beat.clip.poster}
                label={`Gameplay footage: ${beat.title}`}
                className="w-full rounded-control"
              />
            </figure>
            <div className={`flex flex-col gap-4 ${i % 2 === 0 ? "lg:order-2" : "lg:order-1"}`}>
              <p className="text-sm font-semibold text-muted" aria-hidden>
                {beat.index}
              </p>
              <h3 className="font-serif text-3xl text-ink">{beat.title}</h3>
              {beat.body ? <p className="max-w-[46ch] text-lg text-muted">{beat.body}</p> : null}
              {beat.index === "04" ? (
                <div className="flex flex-col gap-5 pt-1">
                  <RecordEntry
                    quote="in 1823 dismissed Farquhar, replacing him with John Crawfurd"
                    source="The Founding of a Trading Post at Singapore, 1819 (classroom handout), p. 4"
                  />
                  <WorldEntry label="Where the record is silent, the simulation assumed">
                    The game names its own inventions and keeps them out of the cited paragraph.
                  </WorldEntry>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-10 border-t border-line pt-12">
        <div className="grid gap-8 sm:grid-cols-3">
          {teacherSteps.map((step) => (
            <div key={step.title} className="flex flex-col gap-2">
              <h3 className="font-serif text-2xl text-ink">{step.title}</h3>
              <p className="text-base text-muted">{step.body}</p>
            </div>
          ))}
        </div>
        <SignInButton next="/teacher" />
      </section>

      <footer className="flex flex-wrap items-baseline justify-between gap-4 border-t border-line pt-8 text-base text-muted">
        <p>Built for CS3216 Assignment 3, National University of Singapore.</p>
        <Link href="https://github.com/damiancxliew/CS3216_Assignment3" className={button.subtle}>
          Source on GitHub
        </Link>
      </footer>
    </main>
  );
}
