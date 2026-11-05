/** Script-style speaker labels are never appropriate inside a one-person chat. */
const aliases: Record<string, string> = {
  lim: "lim", "lim bo seng": "lim", gan: "gan", "gan choo neo": "gan",
  tan: "tan", "tan chong tee": "tan", tham: "tham", "tham sien yen": "tham",
  elizabeth: "elizabeth", "elizabeth choy": "elizabeth", choy: "elizabeth",
  student: "student", observer: "student", you: "student", player: "student",
};
const labels = /(?:^|\s)(?:\*\*)?(Lim Bo Seng|Gan Choo Neo|Tan Chong Tee|Tham Sien Yen|Elizabeth Choy|Lim|Gan|Tan|Tham|Elizabeth|Choy|Student|Observer|You|Player)(?:\*\*)?\s*:(?:\*\*)?\s*/gi;
export function hasOtherSpeaker(text: string, npcId: string) {
  return [...text.matchAll(labels)].some((m) => aliases[m[1].toLowerCase()] !== npcId);
}
/** Repair old generated scripts by preserving only the selected speaker's words. */
export function selectedSpeakerText(text: string, npcId: string) {
  const matches = [...text.matchAll(labels)];
  if (!matches.length) return text;
  const kept = [text.slice(0, matches[0].index).trim()];
  matches.forEach((match, index) => {
    if (aliases[match[1].toLowerCase()] === npcId)
      kept.push(text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length).trim());
  });
  return kept.filter(Boolean).join("\n\n");
}
