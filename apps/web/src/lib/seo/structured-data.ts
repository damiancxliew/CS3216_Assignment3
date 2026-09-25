import { PRICING_TIERS } from "@/lib/pricing";

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
        offers: PRICING_TIERS.map((tier) => ({
          "@type": "Offer",
          name: tier.name,
          price: tier.monthly,
          priceCurrency: "SGD",
          url: `${siteUrl}/#pricing`,
        })),
      },
    ],
  };
}
