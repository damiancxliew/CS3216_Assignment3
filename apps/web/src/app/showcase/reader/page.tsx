import type { Metadata } from "next";
import { Suspense } from "react";
import { ShowcaseReader } from "./reader";

export const metadata: Metadata = { title: "Showcase reader", robots: { index: false, follow: false } };

/** The real document reader, reading check and note pickup, driven by a scripted browser. Local only. */
export default function ShowcaseReaderPage() {
  return <Suspense><ShowcaseReader /></Suspense>;
}
