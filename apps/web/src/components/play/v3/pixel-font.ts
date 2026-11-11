import { Pixelify_Sans } from "next/font/google";

/** The game's voice for chrome, names and spoken lines. Long source text keeps the readable UI font. */
export const pixelFont = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});
