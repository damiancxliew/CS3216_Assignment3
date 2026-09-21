import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Only the landing page is public. Attempts, debriefs, share links and the
 * teacher console are all per-user and must never be crawled — RLS makes them
 * empty to a crawler anyway, but a disallow keeps share tokens out of indexes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/teacher", "/play", "/join", "/api", "/auth"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
