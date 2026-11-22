import type { Metadata } from "next";
import { Suspense } from "react";
import { ShowcaseBox } from "./box";

export const metadata: Metadata = { title: "Showcase box", robots: { index: false, follow: false } };

/** The real speaker box, one typing step per load, for compositing into clips. Local only. */
export default function ShowcaseBoxPage() {
  return <Suspense><ShowcaseBox /></Suspense>;
}
