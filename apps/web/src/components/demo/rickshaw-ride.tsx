"use client";
import { useEffect, useState } from "react";
import { V3CardDialog } from "@/components/play/v3/card-dialog";
import styles from "./waterfront-experience.module.css";

const lines = [
  {
    speaker: "Rickshaw puller",
    text: "Mind the step. I’ll take you along the shophouses to the river.",
  },
  {
    speaker: "You",
    text: "The shops are still here. Has daily life really changed so much?",
  },
  {
    speaker: "Rickshaw puller",
    text: "There have been air raids since December. You think about where to take cover, even on an ordinary journey.",
  },
  { speaker: "You", text: "And what are families worrying about at home?" },
  {
    speaker: "Rickshaw puller",
    text: "Food. People have been putting provisions aside, but rising prices make that harder. Not every family can prepare in the same way.",
  },
  { speaker: "You", text: "Could they move somewhere safer?" },
  {
    speaker: "Rickshaw puller",
    text: "Some have relatives away from the town. Others have work and family to look after here. Leaving is not equally possible for everyone.",
  },
  {
    speaker: "You",
    text: "I’ll ask Gan about the work that remains at home, and Lim about what leaving means for his family.",
  },
];
export function RickshawRide({ onClose }: { onClose: () => void }) {
  const [beat, setBeat] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const change = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (paused || hidden || beat === lines.length - 1) return;
    const timer = setTimeout(() => setBeat((v) => v + 1), 6500);
    return () => clearTimeout(timer);
  }, [beat, paused, hidden]);
  const line = lines[beat];
  return (
    <V3CardDialog
      title="A ride along River Street"
      eyebrow="Singapore · February 1942 · before the surrender"
      footerText="Reconstructed driver and dialogue · optional street encounter"
      closeLabel="Step off the rickshaw"
      onClose={onClose}
    >
      <div
        className={styles.rickshawScene}
        data-paused={paused || hidden}
        aria-label="Animated rickshaw journey past Singapore shophouses; you ride while the driver pulls the vehicle"
      >
        <div className={styles.rideStreet} />
        <div className={styles.rideRoad} />
        <div className={styles.rideVehicle}>
          <span className={styles.ridePassenger} />
          <span className={styles.ridePuller} />
        </div>
        <span className={styles.sceneLabel}>
          RIVER STREET · {beat + 1} / {lines.length}
        </span>
        <div className={styles.speech} role="status" aria-live="polite">
          <strong>{line.speaker}</strong>
          <p>{line.text}</p>
        </div>
      </div>
      <div className={styles.activity}>
        <div className={styles.sceneControls}>
          <button
            className={styles.primary}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? "Resume ride" : "Pause ride"}
          </button>
          <button
            className={styles.primary}
            disabled={beat === 0}
            onClick={() => setBeat((v) => Math.max(0, v - 1))}
          >
            Previous line
          </button>
          <button
            className={styles.primary}
            onClick={() =>
              beat === lines.length - 1 ? onClose() : setBeat((v) => v + 1)
            }
          >
            {beat === lines.length - 1 ? "Arrive · step off" : "Next line"}
          </button>
        </div>
        <p>
          The driver is a fictional civilian guide. The route is illustrative;
          this is not a recorded encounter with Lim Bo Seng.
        </p>
        <details>
          <summary>Read the conversation & historical context</summary>
          {lines.map((l, i) => (
            <p key={i}>
              <strong>{l.speaker}:</strong> {l.text}
            </p>
          ))}
          <p>
            The civilian context draws on oral histories discussed by the
            National Library. Individual circumstances varied.
          </p>
          <a
            href="https://biblioasia.nlb.gov.sg/all-sections/vol-18-issue-4-jan-mar-2023-preparing-war-singapore/"
            target="_blank"
            rel="noreferrer"
          >
            NLB · Preparing for War in Singapore ↗
          </a>
        </details>
      </div>
    </V3CardDialog>
  );
}
