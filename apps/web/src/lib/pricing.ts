/**
 * The single source of truth for pricing: the landing section renders from
 * this and the JSON-LD offers are generated from it, so the two can't drift.
 * Figures are in SGD and come from docs/writeups/M6-pricing.md.
 */
export type PricingTier = {
  id: string;
  name: string;
  tagline: string;
  /** SGD per month on monthly billing; 0 for the free tier. */
  monthly: number;
  /** SGD per month on annual billing; null when the tier has no paid annual plan. */
  annualMonthly: number | null;
  /** SGD charged once a year on annual billing. */
  annualTotal: number | null;
  featured: boolean;
  cta: { label: string; href: string };
  features: readonly string[];
};

export const PRICING_TIERS = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Try it on next week's lesson.",
    monthly: 0,
    annualMonthly: null,
    annualTotal: null,
    featured: false,
    cta: { label: "Start free", href: "/teacher" },
    features: [
      "2 published adventures",
      "60 student attempts a month",
      "Full debrief with citations",
      "Our branding on the debrief",
    ],
  },
  {
    id: "classroom",
    name: "Classroom",
    tagline: "The teacher who now runs this every term.",
    monthly: 12,
    annualMonthly: 10,
    annualTotal: 120,
    featured: true,
    cta: { label: "Start free, upgrade later", href: "/teacher" },
    features: [
      "Unlimited published adventures",
      "600 student attempts a month",
      "Your own source library",
      "No Historical Adventures branding",
      "Attempt packs if a class runs over",
    ],
  },
  {
    id: "staffroom",
    name: "Staffroom",
    tagline: "A whole history department.",
    monthly: 40,
    annualMonthly: 33,
    annualTotal: 400,
    featured: false,
    cta: { label: "Talk to us", href: "/teacher" },
    features: [
      "Up to 10 teachers",
      "8,000 pooled attempts a year",
      "Shared department library",
      "Teacher-corrected forks across the department",
      "Priority support during a pilot",
    ],
  },
] as const satisfies readonly PricingTier[];
