import type { Metadata } from "next";
import { LimBoSengDemo } from "@/components/demo/lim-bo-seng-demo";
export const metadata: Metadata = {
  title: "The Cost of Resistance · Lim Bo Seng",
  description:
    "A standalone source-based historical adventure through Singapore and occupied Malaya.",
  robots: { index: false, follow: false },
};
export default function DemoPage() {
  return <LimBoSengDemo />;
}
