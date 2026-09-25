"use client";

import { ArrowRight, Clock3, Gamepad2, Map, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ThemeSelect } from "@/components/theme-provider";
import { LandingCta } from "@/components/landing-cta";
import { LandingLiveDemo } from "@/components/landing-live-demo";
import { LandingQuestPreview } from "@/components/landing-quest-preview";
import { Pricing } from "@/components/pricing";
import { button, Wordmark } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { landingStructuredData } from "@/lib/seo/structured-data";

const teacherSteps = [
  { number: "01", title: "Drop in your sources", body: "Use the handouts, treaties and textbook pages you already teach." },
  { number: "02", title: "Get a playable world", body: "We turn them into places, people, evidence and high-stakes choices." },
  { number: "03", title: "Send one link", body: "Students jump in. You keep control of the sources, stages and timing." },
] as const;

const beats = [
  { index: "01", icon: Map, title: "Walk the world", body: "Explore the map, enter rooms and hunt for the people who know more.", tone: "bg-world-wash" },
  { index: "02", icon: MessageCircle, title: "Question everyone", body: "Characters have competing interests. Students decide who to trust.", tone: "bg-record-wash" },
  { index: "03", icon: Clock3, title: "Choose under pressure", body: "The clock keeps moving, and the evidence students find changes their options.", tone: "bg-signal-wash" },
  { index: "04", icon: ShieldCheck, title: "Know fact from fiction", body: "Every ending separates documented history from the simulation’s assumptions.", tone: "bg-spark-wash" },
] as const;

export default function Home() {
  const [stage, setStage] = useState<{ index: number; count: number } | null>(null);
  useEffect(() => {
    track(ANALYTICS_EVENTS.landingViewed);
  }, []);

  const structuredDataJson = JSON.stringify(landingStructuredData()).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-20 overflow-hidden px-5 py-6 sm:px-8 sm:py-8 lg:gap-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredDataJson }} />
      <nav className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSelect />
          <a href="#pricing" className={button.subtle}>Pricing</a>
          <Link href="/teacher" className={button.quiet}>
            Teacher console <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </nav>

      <section aria-labelledby="hero-heading" className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="relative z-10 flex flex-col items-start gap-7">
          <div className="sticker inline-flex items-center gap-2 rounded-full border-2 border-ink bg-sunshine px-4 py-2 text-sm font-black uppercase tracking-wider text-ink">
            <Gamepad2 className="h-5 w-5" aria-hidden /> History you can play
          </div>
          <h1 id="hero-heading" className="max-w-[11ch] text-5xl font-black leading-[0.94] tracking-[-0.06em] text-ink sm:text-7xl lg:text-[5.4rem]">
            Don’t just teach history. <span className="text-signal">Drop them into it.</span>
          </h1>
          <p className="max-w-[54ch] text-lg font-medium leading-relaxed text-muted sm:text-xl">
            Turn your own source material into a living world students can explore, question and change.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <LandingCta label="Build your first adventure" />
            <a href="#gameplay" className={button.quiet}>See the game <ArrowRight className="h-4 w-4" aria-hidden /></a>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 text-sm font-bold text-muted">
            <span className="rounded-full bg-world-wash px-3 py-1.5 text-world">No coding</span>
            <span className="rounded-full bg-record-wash px-3 py-1.5 text-record">Source-grounded</span>
            <span className="rounded-full bg-signal-wash px-3 py-1.5 text-signal">Made for classrooms</span>
          </div>
        </div>

        <div className="game-grid relative -mx-5 px-5 py-10 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
          <div className="absolute -right-16 -top-2 h-44 w-44 rounded-full bg-sunshine opacity-70 blur-2xl" aria-hidden />
          <div className="absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-world-wash blur-xl" aria-hidden />
          <figure className="game-shadow relative rotate-1 overflow-hidden rounded-[1.75rem] border-[3px] border-ink bg-inverse p-2 transition-transform hover:rotate-0">
            <div className="flex items-center gap-2 px-2 pb-2 text-on-inverse">
              <span className="h-2.5 w-2.5 rounded-full bg-signal" />
              <span className="h-2.5 w-2.5 rounded-full bg-sunshine" />
              <span className="h-2.5 w-2.5 rounded-full bg-world" />
              <span className="ml-2 text-xs font-bold uppercase tracking-widest text-on-inverse/70">Live adventure</span>
            </div>
            <LandingLiveDemo onStage={setStage} />
          </figure>
          <div className="sticker absolute -bottom-2 left-8 flex max-w-56 items-center gap-3 rounded-2xl border-2 border-ink bg-surface px-4 py-3 font-bold text-ink sm:left-0">
            <Sparkles className="h-6 w-6 shrink-0 text-signal" aria-hidden /> You’re Raffles’ interpreter. Who do you trust?
          </div>
          <div className="absolute -right-1 top-2 rounded-2xl border-2 border-ink bg-record px-4 py-3 text-sm font-black text-on-accent shadow-[0_4px_0_var(--ink)] sm:right-1">{stage ? `Stage ${stage.index + 1} of ${stage.count}` : "Singapore, 1819"}</div>
        </div>
      </section>

      <section id="gameplay" aria-labelledby="gameplay-heading" className="flex scroll-mt-6 flex-col gap-10 rounded-[2rem] bg-inverse px-5 py-10 text-on-inverse sm:px-8 sm:py-14 lg:px-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-[#ffe66d]">Inside every adventure</p>
            <h2 id="gameplay-heading" className="max-w-[14ch] text-4xl font-black tracking-[-0.045em] sm:text-6xl">Read less. Do more. Remember it.</h2>
          </div>
          <p className="max-w-md text-base text-on-inverse/70 sm:text-lg">Students learn the context because they need it to make the next move.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {beats.map((beat) => {
            const Icon = beat.icon;
            return (
              <article key={beat.index} className={`flex flex-col overflow-hidden rounded-surface ${beat.tone} text-ink`}>
                <div className="flex gap-3 px-5 pb-5 pt-6 sm:gap-4 sm:px-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface shadow-[0_3px_0_var(--ink)]"><Icon className="h-5 w-5" aria-hidden /></span>
                  <div>
                    <p className="mb-1 text-xs font-black uppercase tracking-widest text-muted">Quest {beat.index}</p>
                    <h3 className="text-2xl font-black tracking-tight">{beat.title}</h3>
                    <p className="mt-1 text-base leading-relaxed text-muted">{beat.body}</p>
                  </div>
                </div>
                <div className="mx-3 mb-3 flex-1 sm:mx-4 sm:mb-4">
                  <LandingQuestPreview quest={beat.index} />
                </div>
              </article>
            );
          })}
        </div>
        <p className="-mt-5 text-sm text-on-inverse/70">Illustrative examples of play. Characters, evidence and choices come from each adventure.</p>
      </section>

      <section aria-labelledby="teacher-steps-heading" className="flex flex-col gap-10">
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-record">From PDF to playtime</p>
          <h2 id="teacher-steps-heading" className="text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">Your lesson. Now with a world inside.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {teacherSteps.map((step, index) => (
            <article key={step.title} className={`game-shadow flex min-h-64 flex-col justify-between rounded-surface border-2 border-ink p-6 ${index === 0 ? "bg-sunshine" : index === 1 ? "bg-world-wash" : "bg-record-wash"}`}>
              <span className="text-5xl font-black text-ink/20">{step.number}</span>
              <div><h3 className="text-2xl font-black tracking-tight text-ink">{step.title}</h3><p className="mt-2 text-base leading-relaxed text-muted">{step.body}</p></div>
            </article>
          ))}
        </div>
      </section>

      <Pricing />

      <section aria-labelledby="cta-heading" className="game-grid flex flex-col items-start justify-between gap-8 rounded-[2rem] border-[3px] border-ink bg-signal-wash px-7 py-10 sm:flex-row sm:items-center sm:px-10">
        <div><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Ready, teacher?</p><h2 id="cta-heading" className="mt-2 max-w-xl text-4xl font-black tracking-[-0.04em] text-ink sm:text-5xl">Make the next lesson feel like an adventure.</h2></div>
        <LandingCta label="Start building" />
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-line py-7 text-sm font-semibold text-muted">
        <Wordmark />
        <Link href="https://github.com/damiancxliew/CS3216_Assignment3" className={button.subtle}>Source on GitHub</Link>
      </footer>
    </main>
  );
}
