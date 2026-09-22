"use client";

import Link from "next/link";
import { useEffect } from "react";

import { SignInButton } from "@/components/sign-in-button";
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
    title: "Publish and share one link",
    body: "Published versions are frozen: editing afterwards makes a new version and leaves the class currently playing untouched.",
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
    body: "The debrief shows what the record says — with the page and the quote — next to what the simulation assumed, and where your story left history behind.",
  },
];

export default function Home() {
  useEffect(() => {
    track(ANALYTICS_EVENTS.landingViewed);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-20 px-6 py-24">
      <section className="flex flex-col gap-6">
        <p className="text-sm uppercase tracking-widest opacity-60">
          Historical Adventures
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Play the source material.
        </h1>
        <p className="max-w-2xl text-lg opacity-80">
          A teacher drops in historical sources. The system builds a small world
          around them, fills it with people who each want something different,
          and lets a student find out what their decisions cost.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <SignInButton next="/teacher" label="Teacher sign-in with Google" />
          <Link
            href="/teacher"
            className="text-sm underline underline-offset-4 opacity-70"
          >
            Already signed in? Open the console
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          For teachers
        </h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {teacherSteps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span className="text-sm opacity-50">0{index + 1}</span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm opacity-75">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          For students
        </h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {studentSteps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span className="text-sm opacity-50">0{index + 1}</span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm opacity-75">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border-2 border-emerald-700/50 bg-emerald-600/5 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
          A simulation that admits it is one
        </h2>
        <p className="text-sm opacity-85">
          Generated history invents things. Ours says which things: every
          historical claim in the debrief carries the source, the page and the
          quote it came from, and anything the record does not cover is labelled
          as an assumption the simulation made — separately, and visibly.
        </p>
      </section>

      <footer className="flex flex-col gap-2 text-sm opacity-60">
        <p>Built for CS3216 Assignment 3, National University of Singapore.</p>
        <p>
          <Link
            href="https://github.com/damiancxliew/CS3216_Assignment3"
            className="underline underline-offset-4"
          >
            Source on GitHub
          </Link>
        </p>
      </footer>
    </main>
  );
}
