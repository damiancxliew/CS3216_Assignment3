import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Literata } from "next/font/google";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { AuthListener } from "@/components/auth-listener";
import { ThemeProvider } from "@/components/theme-provider";
import { themeScript } from "@/lib/theme";
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
const title = "Historical Adventures — history you can play";
const description =
  "Turn your own historical sources into a living world students can explore, question and change.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s — Historical Adventures" },
  description,
  keywords: [
    "history education",
    "AI learning games",
    "classroom simulation",
    "source-based history",
    "secondary school history",
    "interactive history lessons",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl,
    title,
    description,
    siteName: "Historical Adventures",
    locale: "en_SG",
  },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8e9" },
    { media: "(prefers-color-scheme: dark)", color: "#111722" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${ui.variable} ${record.variable}`}>
        <ThemeProvider>
          <Analytics>
            <AuthListener />
            {children}
          </Analytics>
        </ThemeProvider>
        <VercelAnalytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
