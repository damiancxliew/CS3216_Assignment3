"use client";
/* eslint-disable @next/next/no-img-element -- Archival originals remain uncropped in the source archive. */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Download, RotateCcw } from "lucide-react";
import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { V3ScrollDialog } from "@/components/play/v3/scroll-dialog";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";
import { learningReportHtml } from "@/lib/demo/learning-report";
import { isSubmitted, restoreSourceTask, SOURCE_TASK, sourceTaskKey } from "@/lib/demo/inference-task";
import { INFERENCE_NOTE_ID, INFERENCE_SOURCE_ID, INFERENCE_STAGE } from "@/lib/demo/chapter-progress";
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
import { SourceQuestion, SourceFootnote, SourceRewards } from "./source-question";
import { useChapterExperience } from "./chapter-experience";
import { useWaterfrontExperience } from "./waterfront-experience";
import { SourceInferenceTask } from "./source-inference-task";

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
  > = (view, send) => ({
    ...(waterfrontExperience(view, send) ?? chapterExperience(view, send)),
    activeDocumentId: view.documents.find((document) => document.open)?.id ?? null,
    documentHint: view.documents.find((document) => document.open)?.id === INFERENCE_SOURCE_ID
      ? "Read Source D, then write what it reveals. Submitting your answer saves your evidence note."
      : view.definingMoment
        ? "Revisit your sources and hints while considering your recommendation."
        : "Read the source, then answer its question to unlock a hint and save an evidence note. You can also highlight a passage.",
    documentSupplement: (document) => document.id === INFERENCE_SOURCE_ID ? (
      <SourceInferenceTask
        storageKey={sourceTaskKey(saveKey.current)}
        briefing={<InferenceBriefing />}
        showSource={false}
        hasNote={view.notes.some((n) => n.id === INFERENCE_NOTE_ID)}
        onSubmitted={view.stage?.index === INFERENCE_STAGE
          ? (settled) => send({ type: "selectPassage", documentId: document.id, start: 0, end: document.body.length }, settled)
          : undefined}
      />
    ) : <>
      <SourceQuestion id={document.id}
        hasNote={view.notes.some((n) => n.id === `source-${view.stage?.index}-${document.id}`)}
        onReward={view.definingMoment ? undefined : (settled) => send({ type: "selectPassage", documentId: document.id, start: 0, end: sourceById(document.id).summary.length }, settled)} />
      <SourceFootnote id={document.id} />
    </>,
  });
  const [archive, setArchive] = useState(false);
  const [selectedSource, setSelectedSource] = useState("life");
  const [restart, setRestart] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const createBoot = useCallback((initial: DemoV3State, key = 0) => {
    latest.current = initial;
    const client = createDemoV3Client(
      initial,
      (next) => {
        latest.current = next;
        try {
          localStorage.setItem(saveKey.current, JSON.stringify(next));
        } catch {
          setSaveError(true);
        }
      },
      undefined,
      {
        inferenceSubmitted: () => {
          try {
            return isSubmitted(restoreSourceTask(localStorage.getItem(sourceTaskKey(saveKey.current))));
          } catch {
            return false;
          }
        },
      },
    );
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
    let task = restoreSourceTask(null);
    try {
      task = restoreSourceTask(localStorage.getItem(sourceTaskKey(saveKey.current)));
    } catch {
      // The report still downloads without the source task if storage is blocked.
    }
    const url = URL.createObjectURL(
      new Blob([learningReportHtml(latest.current, new Date(), task)], {
        type: "text/html;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "lim-bo-seng-learning-report.html";
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
    <SourceRewards key={boot.key} storageKey={`${saveKey.current}.source-hints`}><div className="history-demo">
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
            <Download size={16} /> Download learning report
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
          kicker={
            source.id === "currency"
              ? "Japanese occupation · 1942 issue"
              : source.date
          }
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
            {source.id === INFERENCE_SOURCE_ID
              ? SOURCE_TASK.text.map((p) => <p key={p.slice(0, 24)}>{p}</p>)
              : <p>{source.summary}</p>}
            <SourceQuestion id={source.id} />
            <SourceFootnote id={source.id} />
            <details>
              <summary>Source credits & catalogue details</summary>
              <p>{source.credit}</p>
              <p>{source.limitation}</p>
              <p>{source.date}</p>
            </details>
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
              pick up documents and answer their questions to earn notes. Share a note
              in conversation, then make your recommendation and watch its
              consequence. The story follows Lim from Singapore to training
              abroad and occupied Malaya.
            </p>
            <p>
              <strong>Lesson timing:</strong> Allow 3 minutes for the brief,
              25–35 for two chapters of exploration and discussion (Chapter 2
              includes about 10 for the written inference on the occupation
              newspaper: answer, feedback, one revision), and 5–7 for the
              interview and debrief.
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
              <Download size={15} /> Download current learning report
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
              Download report
            </button>
            <button
              className="min-h-11 rounded-lg border-2 border-[#183e35] bg-[#285c4d] px-4 py-2 font-bold text-[#fff9e9] hover:bg-[#193f35] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b87522]"
              onClick={() => {
                const fresh = newDemoV3State(previewStart.current);
                try {
                  localStorage.setItem(saveKey.current, JSON.stringify(fresh));
                  localStorage.removeItem(`${saveKey.current}.source-hints`);
                  localStorage.removeItem(sourceTaskKey(saveKey.current));
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
    </div></SourceRewards>
  );
}

/** In-world reason for the written task. Narration, not a quotation from a historical figure. */
function InferenceBriefing() {
  return (
    <aside style={{ margin: "0 0 1rem", padding: ".85rem 1rem", borderLeft: "4px solid #b08a43", background: "rgba(176,138,67,.12)", borderRadius: ".25rem" }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Before the network decides what to rely on</p>
      <p style={{ margin: ".35rem 0 0" }}>
        This occupation newspaper has reached the coast. Rumours travel faster than facts, so the group wants a
        careful reading: not what the paper promises, but what it reveals about how the Japanese saw the people
        of Syonan. Write your inference and back it with the paper&rsquo;s own words; it becomes your evidence for
        this chapter&rsquo;s judgement.
      </p>
    </aside>
  );
}
