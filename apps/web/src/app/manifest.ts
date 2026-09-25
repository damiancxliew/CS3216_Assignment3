import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION } from "@/lib/seo/structured-data";

// The installable shell of the product: same paper background as the OG card
// so a saved icon never flashes a colour the site itself doesn't use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Historical Adventures",
    short_name: "Adventures",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#fff8e9",
    theme_color: "#fff8e9",
    icons: [
      { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
