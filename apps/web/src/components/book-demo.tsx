"use client";

import { ArrowRight, Mail, School, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";

import { button } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";

export const DEMO_CONTACT_EMAIL = "e1355571@u.nus.edu";

const audiences = [
  { icon: UserRound, title: "For one teacher", body: "Try it on next week’s lesson." },
  { icon: UsersRound, title: "For a department", body: "A shared adventure library across your team." },
  { icon: School, title: "For a school", body: "SSO, LMS export and an admin roster." },
] as const;

export function BookDemo() {
  return (
    <section id="demo" aria-labelledby="demo-heading" className="flex scroll-mt-6 flex-col gap-10">
      <div className="max-w-2xl">
        <p className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-world">Schools &amp; departments</p>
        <h2 id="demo-heading" className="text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">
          See it with your own sources.
        </h2>
        <p className="mt-3 max-w-[54ch] text-lg font-medium leading-relaxed text-muted">
          Plans are tailored to your teachers, classes and school. Book a short demo and we’ll build an adventure from a lesson you already teach.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {audiences.map(({ icon: Icon, title, body }) => (
          <article key={title} className="game-shadow flex flex-col gap-4 rounded-surface border-2 border-ink bg-surface p-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface shadow-[0_3px_0_var(--ink)]">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 className="text-2xl font-black tracking-tight text-ink">{title}</h3>
              <p className="mt-1 text-base leading-relaxed text-muted">{body}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={`mailto:${DEMO_CONTACT_EMAIL}?subject=${encodeURIComponent("Historical Adventures demo")}`}
            className={button.primary}
            onClick={() => track(ANALYTICS_EVENTS.demoCtaClicked, { source: "demo_section" })}
          >
            Contact us for a demo <Mail className="h-4 w-4" aria-hidden />
          </a>
          <Link href="/teacher" className={button.quiet}>
            Try it free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <p className="text-sm font-semibold text-muted">Free while we pilot with schools.</p>
      </div>
    </section>
  );
}
