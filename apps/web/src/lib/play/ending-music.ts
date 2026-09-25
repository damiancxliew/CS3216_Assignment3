const TRACKS = ["peaceful", "quiet", "mystical", "calm-village", "road", "tension"] as const;
type Ending = { id: string; title: string; summary: string };

function preferredTrack(ending: Ending): typeof TRACKS[number] {
  // Titles describe the result; summaries often mention several paths, including rejected ones.
  const title = ending.title.toLowerCase();
  if (/\b(war|violence|siege|conflict|revolt|resistance|blood\w*)\b/.test(title)) return "tension";
  if (/\b(fall|loss|lost|defeat|collapse|ruin|end|silence|exile)\b/.test(title)) return "quiet";
  if (/\b(agreement|peace|accord|treaty|reconcile\w*|unity|settlement)\b/.test(title)) return "peaceful";
  if (/\b(victory|freedom|independence|reform|renewal|dawn|hope)\b/.test(title)) return "road";
  return "mystical";
}

/** Assign distinct scores across an adventure's endings, without exposing unreached branches. */
export function selectEndingMusic(endings: readonly Ending[], endingId: string): string {
  const used = new Set<string>();
  for (const ending of endings) {
    const preferred = preferredTrack(ending);
    const track = !used.has(preferred) ? preferred : TRACKS.find((candidate) => !used.has(candidate)) ?? preferred;
    used.add(track);
    if (ending.id === endingId) return `/game/ninja/audio/music/${track}.ogg`;
  }
  return "/game/ninja/audio/music/peaceful.ogg";
}
