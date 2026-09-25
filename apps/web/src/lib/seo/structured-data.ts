import { PRICING_TIERS, type PricingTier } from "@/lib/pricing";

// Shared with layout.tsx so the tag, the meta description and the JSON-LD all
// quote the same sentence.
export const SITE_NAME = "Historical Adventures";
export const SITE_DESCRIPTION =
  "Turn your own historical sources into a living world students can explore, question and change.";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * JSON-LD for the landing page. The offers are generated from PRICING_TIERS so
 * the structured data can never quote a price the page doesn't show.
 */
export function landingStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: SITE_NAME,
        url: siteUrl,
        logo: `${siteUrl}/icon.svg`,
      },
      {
        "@type": "WebSite",
        name: SITE_NAME,
        url: siteUrl,
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web",
        description: SITE_DESCRIPTION,
        // One offer per price a visitor can pick: the monthly card and, where the Annual switch
        // quotes one, its yearly price.
        offers: PRICING_TIERS.filter((tier) => tier.price !== null).flatMap((tier) => [
          offer(tier.name, tier.price, tier.period, siteUrl),
          ...(tier.annual ? [offer(`${tier.name} (annual)`, tier.annual.price, tier.annual.period, siteUrl)] : []),
        ]),
      },
    ],
  };
}

function offer(name: string, price: number, period: PricingTier["period"], siteUrl: string) {
  return {
    "@type": "Offer",
    name,
    price,
    priceCurrency: "SGD",
    ...(period ? {
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "SGD",
        billingDuration: period === "year" ? "P1Y" : "P1M",
      },
    } : {}),
    url: `${siteUrl}/#pricing`,
  };
}
