"use client";
import { useState } from "react";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import styles from "./waterfront-experience.module.css";

export const waterfrontRecords = {
  rickshaw: {
    title: "Who did the work of moving a city?",
    date: "Singapore · catalogue dates 1941–1945",
    image: "/demo/lim-bo-seng/rickshaw-singapore.jpg",
    alt: "Two airmen and a rickshaw runner near the ANZAC Club, Singapore",
    context: "Look at the runner beside the airmen and the vehicle. What physical work would each journey require? The catalogue title says 1941; its date fields give 1941–1945. This is a period comparison, not a photograph of Lim’s departure.",
    credit: "Colin Keon-Cohen · Museums Victoria · MM 120698 · Public Domain",
    url: "https://collections.museumsvictoria.com.au/items/1797345",
  },
  newspaper: {
    title: "The newspaper changes hands",
    date: "Later record · 20 February 1942",
    image: "/demo/lim-bo-seng/shonan-times-1942-02-20.jpg",
    alt: "Front page of The Shonan Times, 20 February 1942, first issue under Japanese occupation",
    context: "This issue appeared after the surrender and after Lim left Singapore. The occupation press was censored and promoted Japanese propaganda. Compare the masthead and prominent claims: whose voice reaches the reader, and whose is missing? This later record is available to you as a student observer; it was not on this quay before Lim left.",
    credit: "The Shonan Times · scan via Wikimedia Commons, credited there to The Straits Times · PD-SG-edition",
    url: "https://commons.wikimedia.org/wiki/File:ST20February1942.jpg",
  },
  currency: {
    title: "A familiar purchase, unfamiliar money",
    date: "Occupation-era object · 1942 issue",
    image: "/demo/lim-bo-seng/currency.jpg",
    alt: "Ten-cent note issued for Japanese-occupied Malaya in 1942",
    context: "Look closely at the denomination and lettering. This is a ten-cent note. It shows the currency issued under occupation; it cannot tell you what a sack of rice cost on any particular day. What other evidence would you need to work out whether a family could afford food? This is a later comparison with the departure scene.",
    credit: "National Numismatic Collection, Smithsonian · scan by Godot13 · CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:MAL-M3b-Malaya-Japanese_Occupation-10_Cents_ND_(1942).jpg",
  },
} as const;
export type WaterfrontRecordId = keyof typeof waterfrontRecords;

export function WaterfrontRecord({ id, onClose }: { id: WaterfrontRecordId; onClose: () => void }) {
  const record = waterfrontRecords[id];
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  return <V3ScrollDialog title={record.title} eyebrow={record.date} footerText="Look closely · date the evidence · ask whose view it preserves" closeLabel="Return to the waterfront" onClose={onClose}>
    <div className={styles.activity}>
      {failed ? <p role="status">The archive image could not load. You can still read the context below and open the original record.</p> :
        // eslint-disable-next-line @next/next/no-img-element -- unaltered archival image, preserved at original proportions
        <><button className={styles.primary} aria-pressed={enlarged} onClick={() => setEnlarged(value => !value)}>{enlarged ? "Fit image" : "Enlarge image"}</button><a href={record.image} target="_blank" rel="noreferrer" aria-label="Open full-size historical image"><img className={styles.explorationImage} data-enlarged={enlarged} src={record.image} alt={record.alt} onError={() => setFailed(true)} /></a></>}
      <p>{record.context}</p>
      <p className={styles.credit}>{record.credit}. <a href={record.url} target="_blank" rel="noreferrer">View original catalogue record ↗</a></p>
      {id === "newspaper" && <p className={styles.credit}><a href="https://biblioasia.nlb.gov.sg/all-sections/vol-11-issue-4-jan-mar-2016-syonan-shimbun/" target="_blank" rel="noreferrer">Historical context: NLB, Propaganda Paper ↗</a></p>}
    </div>
  </V3ScrollDialog>;
}
