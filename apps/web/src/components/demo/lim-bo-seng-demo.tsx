"use client";
/* eslint-disable @next/next/no-img-element -- Archival originals remain uncropped in the source archive. */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Download, RotateCcw } from "lucide-react";
import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";
import { demoCinematics } from "@/lib/demo/cinematics";
import { sources, sourceById } from "@/lib/demo/lim-bo-seng";
import {
  createDemoV3Client,
  DEMO_SAVE_KEY,
  demoScenery,
  newDemoV3State,
  projectDemoV3,
  restoreDemoV3State,
  type DemoV3State,
} from "@/lib/demo/v3-session";
import chrome from "@/components/play/adventure-chrome.module.css";
import "./historical-portraits.css";
import { useChapterExperience } from "./chapter-experience";
import { useWaterfrontExperience } from "./waterfront-experience";

export function LimBoSengDemo() {
  const [boot, setBoot] = useState<{
    initial: DemoV3State;
    client: PlayClient;
    key: number;
  } | null>(null);
  const saveKey = useRef(DEMO_SAVE_KEY);
  const previewStart = useRef(0);
  const latest = useRef<DemoV3State>(newDemoV3State());
  const waterfrontExperience = useWaterfrontExperience(
    () => latest.current,
    boot?.key ?? 0,
    boot ? saveKey.current : null,
  );
  const chapterExperience = useChapterExperience(
    () => latest.current,
    boot?.key ?? 0,
    boot ? saveKey.current : null,
  );
  const stageExperience: NonNullable<
    React.ComponentProps<typeof V3PlayClient>["stageExperience"]
  > = (view, send) =>
    waterfrontExperience(view, send) ?? chapterExperience(view, send);
  const [archive, setArchive] = useState(false);
  const [selectedSource, setSelectedSource] = useState("life");
  const [restart, setRestart] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const createBoot = useCallback((initial: DemoV3State, key = 0) => {
    latest.current = initial;
    const client = createDemoV3Client(initial, (next) => {
      latest.current = next;
      try {
        localStorage.setItem(saveKey.current, JSON.stringify(next));
      } catch {
        setSaveError(true);
      }
    });
    return { initial, client, key };
  }, []);
  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("preview");
    const chapterPreview = preview?.match(/^chapter-([2-5])$/);
    previewStart.current = chapterPreview ? 1 : 0;
    if (
      preview === "waterfront" ||
      preview === "waterfront-v2" ||
      chapterPreview
    )
      saveKey.current = `${DEMO_SAVE_KEY}.${preview}-preview`;
    let state = newDemoV3State(previewStart.current);
    try {
      const saved = localStorage.getItem(saveKey.current);
      if (saved) state = restoreDemoV3State(saved);
    } catch {
      setSaveError(true);
    }
    setBoot(createBoot(state));
  }, [createBoot]);
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              title: "The Cost of Resistance",
              curriculum: "Chapter 6 · Japanese Occupation",
              ...latest.current,
              caveat:
                "Constructed choices and conversations are not historical records. No automated attainment grade is assigned.",
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "lim-bo-seng-learning-record.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!boot)
    return (
      <div className={`${chrome.shell} grid h-dvh place-items-center`}>
        <p>Opening the adventure…</p>
      </div>
    );
  const source = sourceById(selectedSource);
  return (
    <div className="history-demo">
      <V3PlayClient
        key={boot.key}
        attemptId="standalone-lim-bo-seng"
        initialView={projectDemoV3(boot.initial)}
        initialRevision={boot.initial.revision}
        scenery={demoScenery}
        stageExperience={stageExperience}
        cinematics={demoCinematics}
        portraitBase="/demo/lim-bo-seng/portraits"
        makeClient={() => boot.client}
        busyLabel="Listening…"
        headerActions={
          <>
            <button
              type="button"
              className={`${chrome.tool} inline-flex min-h-9 items-center gap-2 px-2.5 text-sm font-semibold`}
              onClick={() => setArchive(true)}
            >
              <BookOpen size={16} />
              <span className="hidden sm:inline">Source archive</span>
            </button>
            <button
              type="button"
              className={`${chrome.tool} inline-flex min-h-9 items-center px-2.5`}
              aria-label="Restart standalone demo"
              onClick={() => setRestart(true)}
            >
              <RotateCcw size={16} />
            </button>
          </>
        }
        revealFooter={
          <button
            className={`${chrome.primary} inline-flex items-center gap-2 px-4 py-3 font-bold`}
            onClick={download}
          >
            <Download size={16} /> Download learning record
          </button>
        }
      />
      {saveError && (
        <div
          role="status"
          className="fixed left-3 top-20 z-50 max-w-sm rounded-lg bg-amber-100 p-3 text-sm text-amber-950"
        >
          Browser saving is unavailable. Keep this tab open and export your
          record before leaving.
        </div>
      )}
      {archive && (
        <V3ScrollDialog
          eyebrow="Standalone demo · Chapter 6"
          title={source.title}
          kicker={source.date}
          footerText="Real records · clearly labelled reconstructions"
          closeLabel="Close source archive"
          onClose={() => setArchive(false)}
          navigation={{
            items: sources.map((s) => ({ id: s.id, name: s.title })),
            selectedId: selectedSource,
            onSelect: setSelectedSource,
          }}
        >
          <div className="space-y-4 text-sm leading-relaxed">
            <p className="font-bold">{source.kind}</p>
            {source.image && (
              <img
                src={source.image}
                alt={
                  source.imageAlt ??
                  (source.id === "life"
                    ? "Archival portrait of Lim Bo Seng"
                    : "British troops surrendering in Singapore, 15 February 1942, AWM 127902")
                }
                className="mx-auto max-h-80 max-w-full object-contain"
              />
            )}
            <p>{source.summary}</p>
            <p>
              <strong>Source limits: </strong>
              {source.limitation}
            </p>
            <p>{source.credit}</p>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block underline"
            >
              Open source record or labelled contextual reference ↗
            </a>
            {source.license && (
              <a
                href={source.license}
                target="_blank"
                rel="noreferrer"
                className="block underline"
              >
                CC BY-SA 4.0 · unchanged original scan
              </a>
            )}
            <hr />
            <p>
              <strong>How to play:</strong> Walk to buildings, speak to people,
              pick up documents and select passages for your notes. Share a note
              in conversation, then make your recommendation and watch its
              consequence. The story follows Lim from Singapore to training
              abroad and occupied Malaya.
            </p>
            <p>
              <strong>Lesson timing:</strong> Allow 3 minutes for the brief,
              20–25 for two chapters of exploration and discussion, and 5–7 for
              the interview and debrief.
            </p>
            <p>
              <strong>Historical framing:</strong> The named figures are
              historical. Dialogue, meetings and decisions are reconstructions,
              not verbatim testimony. The historical outcome is fixed. Compare
              specific evidence, provenance and limitations; the game does not
              grade your beliefs or choices.
            </p>
            <p>
              <strong>Live conversation:</strong> Questions and recent dialogue
              go to the configured AI provider. Conversations, notes and choices
              save in this browser and are included in the learning-record
              export. Restart clears this demo’s save. Avoid personal
              information. If live conversation is unavailable, a labelled
              curated research note appears. Sources here are summaries and
              identified school adaptations, not a full-text archival corpus.
              Historian review is still needed.
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 underline"
              onClick={download}
            >
              <Download size={15} /> Export current learning record
            </button>
          </div>
        </V3ScrollDialog>
      )}
      {restart && (
        <V3ScrollDialog
          eyebrow="Standalone demo"
          title="Start again?"
          footerText="Only this demo's browser save will reset."
          closeLabel="Keep playing"
          onClose={() => setRestart(false)}
        >
          <p className="mb-5">
            Your current demo progress will be replaced. You can export the
            record first.
          </p>
          <div className="flex gap-4">
            <button className="underline" onClick={download}>
              Export record
            </button>
            <button
              className="rounded-lg bg-ink px-4 py-2 font-bold text-white"
              onClick={() => {
                const fresh = newDemoV3State(previewStart.current);
                try {
                  localStorage.setItem(saveKey.current, JSON.stringify(fresh));
                } catch {
                  setSaveError(true);
                }
                setBoot(createBoot(fresh, boot.key + 1));
                setRestart(false);
              }}
            >
              Restart demo
            </button>
          </div>
        </V3ScrollDialog>
      )}
    </div>
  );
}
