import type { Metadata } from "next";
import { Suspense } from "react";
import { ShowcaseScene } from "./scene";

export const metadata: Metadata = { title: "Showcase", robots: { index: false, follow: false } };

/** Scripted scenes for recording presentation clips. Local only. */
export default function ShowcasePage() {
  return <Suspense><ShowcaseScene /></Suspense>;
}
