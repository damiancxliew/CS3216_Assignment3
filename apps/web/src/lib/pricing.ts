/**
 * The single source of truth for pricing: the landing section renders from
 * this and the JSON-LD offers are generated from it, so the two can't drift.
 * Figures are in SGD. A null price denotes a custom quote.
 */
export type PricingTier = {
  id: string;
  name: string;
  tagline: string;
  price: number | null;
  period: "month" | "year" | null;
  priceNote: string;
  featured: boolean;
  cta: { label: string; href: string };
  /** Proposed plan terms; billing remains in pilot. */
  features: readonly string[];
};

export const PRICING_TIERS = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it on next week's lesson.",
    price: 0,
    period: null,
    priceNote: "One real lesson with your class",
    featured: false,
    cta: { label: "Start free", href: "/teacher" },
    features: [
      "1 published adventure",
      "30 student attempts/month",
    ],
  },
  {
    id: "teacher",
    name: "Teacher",
    tagline: "For individual teachers or a department budget.",
    price: 15,
    period: "month",
    priceNote: "S$180/year with annual billing",
    featured: true,
    cta: { label: "Start free, upgrade later", href: "/teacher" },
    features: [
      "5 class-lessons/month (150 attempts)",
      "Unlimited drafts",
      "Your own source library",
    ],
  },
  {
    id: "department",
    name: "Department",
    tagline: "A whole history department.",
    price: 1500,
    period: "year",
    priceNote: "For up to 10 teachers",
    featured: false,
    cta: { label: "Talk to us", href: "/teacher" },
    features: [
      "500 pooled class-lessons/year (15,000 attempts)",
      "Shared adventure library across your department",
    ],
  },
  {
    id: "school",
    name: "School / district",
    tagline: "Build on a successful term-long pilot.",
    price: null,
    period: null,
    priceNote: "Tailored to your school or district",
    featured: false,
    cta: { label: "Talk to us", href: "/teacher" },
    features: ["SSO", "LMS export", "Admin roster", "Pooled allowance"],
  },
] as const satisfies readonly PricingTier[];
