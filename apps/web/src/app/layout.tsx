import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Literata } from "next/font/google";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { AuthListener } from "@/components/auth-listener";
import { Analytics } from "@/lib/analytics/posthog";
import "./globals.css";

// The interface voice. Chosen for the same reason the product has reading
// bands: thirteen-year-olds on school laptops have to read it quickly.
const ui = Atkinson_Hyperlegible_Next({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});

// The record's voice: headings and anything quoted from the sources.
const record = Literata({
  variable: "--font-record",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const title = "Historical Adventures — play the source material";
const description =
  "Teachers drop in historical sources; students explore a generated world, question the people in it, and live with what they decide.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s — Historical Adventures" },
  description,
  openGraph: {
    type: "website",
    url: siteUrl,
    title,
    description,
    siteName: "Historical Adventures",
  },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${record.variable}`}>
        <Analytics>
          <AuthListener />
          {children}
        </Analytics>
        <VercelAnalytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
