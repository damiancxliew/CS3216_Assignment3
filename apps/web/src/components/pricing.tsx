"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { button } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import { PRICING_TIERS } from "@/lib/pricing";

type Period = "monthly" | "annual";

/**
 * The landing page's pricing band. Cards reuse the same sticker / game-shadow
 * language as the rest of the page; the only state is which price the cards
 * quote. Billing isn't live — the honesty line under the grid says so.
 */
export function Pricing() {
  const [period, setPeriod] = useState<Period>("annual");

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
        <div role="group" aria-label="Billing period" className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border-2 border-ink bg-surface p-1 shadow-[0_3px_0_var(--ink)]">
          <button
            type="button"
            aria-pressed={period === "monthly"}
            onClick={() => setPeriod("monthly")}
            className={`rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${period === "monthly" ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={period === "annual"}
            onClick={() => setPeriod("annual")}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${period === "annual" ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
          >
            Annual
            <span className="rounded-full border border-ink bg-sunshine px-2 py-0.5 text-xs font-black text-ink">2 months free</span>
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PRICING_TIERS.map((tier) => {
          const paid = tier.monthly > 0;
          const price = period === "annual" && tier.annualMonthly !== null ? tier.annualMonthly : tier.monthly;
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
                  Most popular
                </span>
              ) : null}
              <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-black tracking-tight text-ink">{tier.name}</h3>
                <p className="text-sm font-semibold text-muted">{tier.tagline}</p>
              </div>
              <div className="mt-5 flex flex-col gap-1">
                {paid ? (
                  <>
                    <p className="text-5xl font-black tracking-tight text-ink">
                      S${price}
                      <span className="text-lg font-bold text-muted">/month</span>
                    </p>
                    <p className="text-sm font-semibold text-muted">
                      {period === "annual" && tier.annualTotal !== null
                        ? `billed yearly — S$${tier.annualTotal}`
                        : "billed monthly"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-5xl font-black tracking-tight text-ink">S$0</p>
                    <p className="text-sm font-semibold text-muted">Free forever</p>
                  </>
                )}
              </div>
              {tier.includes ? <p className="mt-6 text-sm font-black uppercase tracking-[0.12em] text-muted">{tier.includes}</p> : null}
              <ul className={`${tier.includes ? "mt-3" : "mt-6"} flex flex-1 flex-col gap-2.5`}>
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
                onClick={() => track(ANALYTICS_EVENTS.pricingCtaClicked, { tier: tier.id, period })}
              >
                {tier.cta.label}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 text-sm font-semibold text-muted">
        <p>
          Billing isn’t live yet: every tier is free while we pilot with schools, and we’ll tell you before that changes.
        </p>
        <p>Prices in SGD. Attempts are counted per student per adventure.</p>
      </div>
    </section>
  );
}
