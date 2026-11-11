import type { Metadata } from "next";
import { Suspense } from "react";
import { MockPlay } from "./mock-play";

export const metadata: Metadata = { title: "Showcase play", robots: { index: false, follow: false } };

/** The real player over the scripted mock engine, for checking the UI without a database. Local only. */
export default function ShowcasePlayPage() {
  return <Suspense><MockPlay /></Suspense>;
}
