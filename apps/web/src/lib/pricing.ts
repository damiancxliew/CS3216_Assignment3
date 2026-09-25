/**
 * The single source of truth for pricing: the landing section renders from
 * this and the JSON-LD offers are generated from it, so the two can't drift.
 * Figures are in SGD and come from docs/writeups/M6-pricing.md, where the allowances
 * are sized against the measured cost per attempt (docs/writeups/M12-play-metrics.md).
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
  /** Lead-in above the list when a tier builds on the one before, e.g. "Everything in Starter, plus:". */
  includes: string | null;
  /** Only what the product does today, or a plan term; nothing unbuilt is listed (M6). */
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
    includes: null,
    features: [
      "Adventures built from your own PDFs and notes",
      "2 published adventures",
      "30 student attempts a month",
      "Stock art only",
      "Historical Adventures watermark on the debrief",
    ],
  },
  {
    id: "teacher",
    name: "Teacher",
    tagline: "The teacher who now runs this every term.",
    monthly: 12,
    annualMonthly: 10,
    annualTotal: 120,
    featured: true,
    cta: { label: "Start free, upgrade later", href: "/teacher" },
    includes: "Everything in Starter, plus:",
    features: [
      "Class results summary",
      "Unlimited published adventures",
      "150 student attempts a month",
      "Custom artwork: covers, portraits and props",
      "No watermark on the debrief",
    ],
  },
  {
    id: "department",
    name: "Department",
    tagline: "A whole history department.",
    monthly: 40,
    annualMonthly: 33,
    annualTotal: 400,
    featured: false,
    cta: { label: "Talk to us", href: "/teacher" },
    includes: "Everything in Teacher, for up to 10 teachers:",
    features: [
      "5,000 student attempts a year, shared across the department",
      "An onboarding session: we build your first adventure with you",
      "Priority support during the pilot",
    ],
  },
] as const satisfies readonly PricingTier[];
