"use client";

import Link from "next/link";
import { useEffect } from "react";

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

const studentSteps = [
  {
    title: "Walk in as someone",
    body: "You get a role and a brief, not a quiz. Nobody in the room tells you the whole truth.",
  },
  {
    title: "Ask, compare, decide",
    body: "Question the people there, collect evidence, and commit before the stage timer runs out. Everyone else commits too.",
  },
  {
    title: "Find out what it cost",
    body: "The debrief shows what the record says, with the page and the quote, next to what the simulation assumed.",
  },
];

export default function Home() {
  useEffect(() => {
    track(ANALYTICS_EVENTS.landingViewed);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-24 px-6 py-8 sm:py-10">
      <nav className="flex items-center justify-between gap-4">
        <Wordmark />
        <Link href="/teacher" className={button.link}>
          Open the teacher console
        </Link>
      </nav>

      <section className="grid items-start gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <div className="flex flex-col gap-7">
          <h1 className="max-w-[14ch] font-serif text-5xl text-ink sm:text-[4rem] sm:leading-[1.02]">
            Play the source material.
          </h1>
          <p className="max-w-[54ch] text-lg text-muted sm:text-xl sm:leading-[1.45]">
            A teacher drops in historical sources. The system builds a small world
            around them, fills it with people who each want something different,
            and lets a student find out what their decisions cost.
          </p>
          <SignInButton next="/teacher" label="Sign in with Google to build one" />
        </div>

        {/* The notation the whole product uses, shown before anyone has to read a debrief. */}
        <figure className="flex flex-col gap-6 rounded-surface border border-line bg-surface p-6 sm:p-7">
          <RecordEntry
            quote="Every historical claim carries the source it came from, the page it is on, and the words as they were written."
            source="How the record is shown, p. 1"
          />
          <WorldEntry label="Where the record is silent, the simulation assumed">
            That a character would act on their stated interest. The gap is named, kept apart from the documented claim, and shown to the student.
          </WorldEntry>
          <figcaption className="text-base text-muted">
            Blue is what the documents say. Green is what the game did. They never share a paragraph.
          </figcaption>
        </figure>
      </section>

      <section className="grid gap-12 border-t border-line pt-12 md:grid-cols-2 md:gap-16">
        <Path heading="For teachers" steps={teacherSteps} />
        <Path heading="For students" steps={studentSteps} />
      </section>

      <section className="grid gap-6 border-t border-line pt-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <h2 className="font-serif text-3xl text-ink">A simulation that admits it is one</h2>
        <div className="flex flex-col gap-4 text-lg text-muted">
          <p>
            Generated history invents things. Ours says which things. Every
            historical claim in the debrief carries the source, the page and the
            quote it came from. Anything the record does not cover is labelled as
            an assumption the simulation made, separately and visibly.
          </p>
          <p>
            Students learn to ask of every account the question historians ask:
            who says so, and how do they know.
          </p>
        </div>
      </section>

      <footer className="flex flex-wrap items-baseline justify-between gap-4 border-t border-line pt-8 text-base text-muted">
        <p>Built for CS3216 Assignment 3, National University of Singapore.</p>
        <Link href="https://github.com/damiancxliew/CS3216_Assignment3" className={button.link}>
          Source on GitHub
        </Link>
      </footer>
    </main>
  );
}

function Path({ heading, steps }: { heading: string; steps: { title: string; body: string }[] }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-serif text-3xl text-ink">{heading}</h2>
      <ol className="flex flex-col gap-6">
        {steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
            <span className="font-serif text-2xl leading-none text-muted" aria-hidden>
              {index + 1}
            </span>
            <span className="sr-only">Step {index + 1}:</span>
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
              <p className="max-w-[46ch] text-base text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
