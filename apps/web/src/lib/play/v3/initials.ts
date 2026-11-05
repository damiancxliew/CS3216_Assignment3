const SKIPPED = new Set(["a", "an", "the", "of", "from", "at", "in", "sir", "lady", "lord", "major", "captain", "colonel", "general", "dr", "mr", "mrs", "ms"]);

/** Two letters for a portrait placeholder: "Sir Thomas Stamford Raffles" → "TR", "A Company clerk at Singapore" → "CC". */
export function nameInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}'’-]+/u).filter((word) => word && !SKIPPED.has(word.toLowerCase()));
  if (words.length === 0) return "?";
  const properName = words.every((word) => /^\p{Lu}/u.test(word));
  const picked = properName && words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 2);
  return picked.map((word) => word[0]!).join("").toUpperCase();
}
