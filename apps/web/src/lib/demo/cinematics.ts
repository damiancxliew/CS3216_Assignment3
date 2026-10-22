import type { V3CinematicBeat } from "@/lib/play/v3/cinematic";
import { stages, sourceById } from "./lim-bo-seng";

const portrait = {
  src: "/demo/lim-bo-seng/portrait.jpg",
  alt: "Archival portrait of Lim Bo Seng, dated to the 1930s",
  caption: "Lim Bo Seng, 1930s.",
  credit: "Wikimedia Commons · public-domain record",
  href: "https://commons.wikimedia.org/wiki/File:LimBoSeng-1930s.jpg",
};
const surrender = {
  src: "/demo/lim-bo-seng/surrender.png",
  alt: "British troops surrendering in Singapore on 15 February 1942",
  caption:
    "Singapore, 15 February 1942. British troops surrender in the city.",
  credit: "Australian War Memorial · 127902 · public domain",
  href: "https://commons.wikimedia.org/wiki/File:British_troops_surrender_in_Singapore.png",
};
const stops = ["Singapore · 1942", "Malaya · late 1943–1944"];
const briefing: V3CinematicBeat[] = [
  {
    id: "person",
    kicker: "Your role · student observer",
    title: "Meet the people behind the history",
    image: portrait,
    body: "Follow Lim Bo Seng’s story and ask him about the commitments behind resistance. Hear Gan Choo Neo’s family perspective, compare Tham Sien Yen and Tan Chong Tee’s accounts, and investigate Elizabeth Choy’s civilian assistance.",
    items: [
      "Walk the map. Speak to the named figures. Collect evidence before recommending an action.",
      "The people are historical. Dialogue, maps and decisions are learning reconstructions, not quotations or documented meetings.",
    ],
  },
  {
    id: "occupation",
    kicker: "Chapter 6 · Japanese Occupation",
    title: "A change of rule. Unequal choices.",
    image: surrender,
    body: "Begin before Singapore’s surrender, then follow the regional story of training, resistance and civilian survival. Your decisions explore competing needs; they do not change Lim’s documented fate.",
    journey: { stops, current: 0 },
    items: [
      "25–35 minutes including discussion and debrief.",
      "Two substantial chapters: Singapore, then the Malayan resistance. Training is part of the journey, with one final debrief.",
    ],
  },
];
export const demoCinematics = {
  briefing,
  stages: stages.map((stage, index): V3CinematicBeat[] => [
    {
      id: `scene-${stage.id}`,
      kicker: `Chapter ${index + 1} of ${stages.length} · ${stage.date}`,
      title: stage.title,
      body: stage.intro,
      ...(index === 0 ? { image: surrender } : {}),
      journey: {
        stops,
        current: index,
      },
      items: [
        stage.question,
        "One decision in this chapter. Other encounters and discoveries are optional.",
      ],
    },
    ...stage.npcs.map((npc): V3CinematicBeat => {
      const record = npc.id === "lim" ? null : sourceById(`${npc.id}-photo`);
      return {
        id: `person-${stage.id}-${npc.id}`,
        kicker: "People to meet · archival photograph",
        title: npc.name,
        body: npc.role,
        image: record
          ? {
              src: record.image!,
              alt: record.imageAlt!,
              caption: `${record.imageAlt}.`,
              credit: record.displayCredit ?? record.credit,
              href: record.url,
            }
          : portrait,
        items: [npc.prompts[0]],
      };
    }),
  ]),
};
