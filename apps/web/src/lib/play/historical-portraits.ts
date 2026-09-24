/** Bundled, documented historical likenesses. Match a verified full name only;
 * never guess somebody's identity from a surname or a political role. */
export function historicalPortraitFor(name: string): string | null {
  const normalized = name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized === "adolf hitler" ? "/game/portraits/adolf-hitler.jpg" : null;
}
