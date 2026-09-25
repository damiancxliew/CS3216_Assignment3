"use client";

import { Check } from "lucide-react";
import Link from "next/link";

import { button } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { PRICING_TIERS } from "@/lib/pricing";

/**
 * The landing page's pricing band. Cards reuse the same sticker / game-shadow
 * language as the rest of the page. Billing isn't live — the pilot note says so.
 */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="flex scroll-mt-6 flex-col gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-world">Pricing</p>
          <h2 id="pricing-heading" className="text-4xl font-black tracking-[-0.045em] text-ink sm:text-6xl">
            Priced for the person who decides.
          </h2>
          <p className="mt-3 max-w-[54ch] text-lg font-medium leading-relaxed text-muted">
            Start free on a real lesson. Pay only when it becomes the way you teach.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {PRICING_TIERS.map((tier) => {
          return (
            <article
              key={tier.id}
              className={`relative flex flex-col rounded-surface p-6 ${
                tier.featured
                  ? "game-shadow border-[3px] border-ink bg-signal-wash"
                  : "game-shadow border-2 border-ink bg-surface"
              }`}
            >
              {tier.featured ? (
                <span className="sticker absolute -top-4 left-6 rounded-full border-2 border-ink bg-sunshine px-3 py-1 text-xs font-black uppercase tracking-wider text-ink">
                  For teachers
                </span>
              ) : null}
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-black tracking-tight text-ink">{tier.name}</h3>
                <p className="text-sm font-semibold text-muted">{tier.tagline}</p>
              </div>
              <div className="mt-5 flex flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-x-1 text-4xl font-black tracking-tight text-ink">
                  <span>{tier.price === null ? "Quoted" : `S$${tier.price.toLocaleString("en-SG")}`}</span>
                  {tier.period ? <span className="text-lg font-bold text-muted">/{tier.period}</span> : null}
                </p>
                <p className="text-sm font-semibold text-muted">{tier.priceNote}</p>
              </div>
              <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-base font-semibold text-ink">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-world" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={`mt-7 ${tier.featured ? button.primary : button.quiet}`}
                onClick={() => track(ANALYTICS_EVENTS.pricingCtaClicked, { tier: tier.id, period: tier.period })}
              >
                {tier.cta.label}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="rounded-surface border-2 border-ink bg-world-wash p-6 text-ink">
        <h3 className="text-xl font-black">Need another class? S$3 per class pack.</h3>
        <p className="mt-2 font-semibold">Each pack adds 30 student attempts. Extra usage is covered by class packs, so a class won’t stop playing because an allowance ran out.</p>
      </div>

      <div className="flex flex-col gap-1 text-sm font-semibold text-muted">
        <p>
          Billing isn’t live yet: every tier is free while we pilot with schools, and we’ll tell you before that changes.
        </p>
        <p>Prices in SGD. One class-lesson includes 30 attempts. Attempts are counted per student per adventure.</p>
      </div>
    </section>
  );
}
