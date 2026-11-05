"use client";
import { Undo2 } from "lucide-react";
import { sourceFailureLabel } from "@adventure/generation/sources-labels";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AdventureSpec as Spec,
  type CheckIssue,
} from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import type { PauseView } from "@/lib/v3/generation/service";
import {
  applyV3Edits,
  type V3Edit,
  type CapturedSource,
} from "@/lib/v3/edit/commands";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
import { safeSourceUrl } from "@/lib/v3/review";
import {
  retrySourcesAction,
  saveSourceSelectionAction,
  continueFromSourcesAction,
  continuePauseAction,
  savePauseEditsAction,
  fixPauseEditsWithAiAction,
} from "./pause-actions";
import { ReviewToolbar } from "./review-toolbar";
import { ConfirmButton } from "./confirm-button";
import { AiFixPanel } from "./review/ai-fix-panel";
import { PauseContentCards } from "./review/pause-content-cards";
import { ExistingIssues } from "./review/existing-issues";
import { IssueList } from "./review/issue-list";
import { useUnsavedEdits } from "./review/use-unsaved-edits";
import { useReviewChatTarget } from "./review-chat-context";
import { reviewDiscard, reviewPrimary } from "./creation-styles";
import styles from "./creation-workspace.module.css";

export function SourcesReview({
  adventureId,
  pause,
}: {
  adventureId: string;
  pause: Extract<PauseView, { pass: "sources" }>;
}) {
  const [removed, setRemoved] = useState<string[]>(pause.excluded ?? []);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const saveSeq = useRef(0);
  const router = useRouter();
  useEffect(() => {
    if (!pause.importing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [pause.importing, router]);
  const busy = pending || !!pause.importing;
  useUnsavedEdits(pending);
  const empty = pause.uploads.length + pause.outside.length === removed.length;
  /** Background save: only the latest selection's outcome is shown. */
  const select = (next: string[]) => {
    setRemoved(next);
    const seq = ++saveSeq.current;
    saveSourceSelectionAction(adventureId, next)
      .then((result) => {
        if (seq === saveSeq.current) setMessage("error" in result ? result.error! : "");
      })
      .catch(() => {
        if (seq === saveSeq.current) setMessage("Could not save source selection. Try again before reloading.");
      });
  };
  useReviewChatTarget({
    key: "sources",
    revision: JSON.stringify(removed),
    pending,
    input: { pass: "sources", removedSourceIds: removed },
    apply: (proposal) => {
      if (proposal.pass === "sources") select(proposal.removedSourceIds);
    },
  });
  const continueGeneration = async () => {
    saveSeq.current += 1; // the continue call is authoritative for the selection
    setPending(true);
    setMessage("");
    try {
      const result = await continueFromSourcesAction(adventureId, removed);
      if ("error" in result) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Could not continue. Your selection is still here. Try again.");
    } finally {
      setPending(false);
    }
  };
  const uploads = pause.uploads.length;
  return (
    <div className={`${styles.card} space-y-6`} aria-busy={pending}>
      {uploads ? (
        <p className="text-sm text-muted">
          Your {uploads === 1 ? "upload is" : `${uploads} uploads are`} always included.
        </p>
      ) : null}
      <section className="space-y-3">
        <h3 className="text-base font-bold">Outside sources</h3>
        <p className="text-sm">Uncheck any you don’t want to use.</p>
        {pause.outside.map((source) => (
          <div
            key={source.id}
            className="space-y-1 rounded-control border border-line bg-paper/50 p-3"
          >
            <label className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="m-0 mt-1 h-4 w-4 accent-record"
                checked={!removed.includes(source.id)}
                disabled={busy}
                onChange={(event) =>
                  select(
                    event.target.checked
                      ? removed.filter((id) => id !== source.id)
                      : [...removed, source.id],
                  )
                }
              />
              <span className="break-words">{source.title}</span>
            </label>
            {safeSourceUrl(source.url) ? (
              <a
                className="ml-7 block text-sm text-record [overflow-wrap:anywhere] underline decoration-record/40 underline-offset-4 transition-colors hover:decoration-record focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-record"
                href={safeSourceUrl(source.url)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.url}
              </a>
            ) : null}
          </div>
        ))}
        {!pause.outside.length ? <p>{pause.noResults ? "Search found no sources." : "No outside sources were imported."}</p> : null}
      </section>
      {pause.rejected.length ? (
        <details className="space-y-3">
          <summary className="cursor-pointer font-bold">Couldn’t import {pause.rejected.length} sources</summary>
          <ul className="space-y-2 text-sm">
            {pause.rejected.map((source, index) => (
              <li key={index} className="break-words">
                {safeSourceUrl(source.url) ? (
                  <a
                    className="text-record underline decoration-record/40 underline-offset-4 hover:decoration-record"
                    href={safeSourceUrl(source.url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.url}
                  </a>
                ) : (
                  source.url
                )}
                <p className="mt-1 text-muted">{sourceFailureLabel(source.reason)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <button type="button" className={button.subtle} disabled={busy} onClick={async () => {
        setPending(true); setMessage("");
        try {
          const result = await retrySourcesAction(adventureId, crypto.randomUUID(), removed);
          if ("error" in result) setMessage(result.error!);
          else router.refresh();
        } catch { setMessage("Could not start source search. Try again."); }
        finally { setPending(false); }
      }}>{pause.importing ? "Importing sources…" : "Retry search"}</button>
      {empty ? <p role="alert">Keep at least one source.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      <ReviewToolbar
        primary={
          <ConfirmButton
            label="Continue"
            ariaLabel="Continue generation"
            pendingLabel="Continuing…"
            title="Continue to the story outline?"
            body="The outline is planned from the sources you keep. You can’t change the selection afterwards."
            confirmLabel="Continue"
            className={reviewPrimary}
            disabled={busy || empty}
            pending={pending}
            onConfirm={() => void continueGeneration()}
          />
        }
      />
    </div>
  );
}

const continueBody = {
  details: "The endings are written from these scenes, including your changes.",
  endings: "The reveal is written from these decisions and endings, including your changes.",
  reveal: "We’ll check the story and save your draft, including your changes.",
} as const;

const AUTOSAVE_DELAY = 1_000;

type EditablePause = Extract<PauseView, { base: Spec }>;
export function PauseEditor({
  adventureId,
  pause,
  sources,
}: {
  adventureId: string;
  pause: EditablePause;
  sources: CapturedSource[];
}) {
  const [edits, setEdits] = useState<V3Edit[]>(pause.edits);
  const [draft, setDraft] = useState(() =>
    applyV3Edits(pause.base, pause.edits, sources, true),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    pause.edits.length ? "Saved edits restored." : "",
  );
  const [serverErrors, setServerErrors] = useState<CheckIssue[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const router = useRouter();
  const errors = [...newLocalErrors(pause.base, draft), ...serverErrors];

  // --- autosave: debounced, latest response wins -----------------------------
  const savedRef = useRef(JSON.stringify(pause.edits)); // what the server holds
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeq = useRef(0);
  const outstanding = useRef(0);
  useUnsavedEdits(saveState === "dirty" || saveState === "saving" || saveState === "error");
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    saveSeq.current += 1;
  }, []);
  const cancelAutosave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    saveSeq.current += 1;
  };
  const save = async (target: V3Edit[]) => {
    const seq = ++saveSeq.current;
    outstanding.current += 1;
    setSaveState("saving");
    try {
      const result = await savePauseEditsAction(adventureId, pause.pass, target);
      if (result.ok) savedRef.current = JSON.stringify(target);
      if (seq !== saveSeq.current) return; // a newer edit won
      if (result.ok) setSaveState("saved");
      else {
        setServerErrors(result.errors);
        setSaveState("error");
        setMessage("These edits add errors. Fix them to save.");
      }
    } catch {
      if (seq === saveSeq.current) setSaveState("error");
    } finally {
      outstanding.current -= 1;
    }
  };
  const schedule = (next: V3Edit[], nextDraft: Spec, delay: number) => {
    cancelAutosave();
    if (JSON.stringify(next) === savedRef.current && !outstanding.current) {
      setSaveState("idle");
      return;
    }
    setSaveState("dirty");
    if (newLocalErrors(pause.base, nextDraft).length) return; // saves once fixed
    if (delay === 0) void save(next);
    else timerRef.current = setTimeout(() => void save(next), delay);
  };

  const replace = (next: V3Edit[], delay = AUTOSAVE_DELAY) => {
    try {
      const nextDraft = applyV3Edits(pause.base, next, sources, true);
      setDraft(nextDraft);
      setEdits(next);
      setServerErrors([]);
      setMessage("");
      schedule(next, nextDraft, delay);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not apply edits.",
      );
    }
  };
  useReviewChatTarget({
    key: pause.pass,
    revision: JSON.stringify(edits),
    pending,
    input: { pass: pause.pass, edits },
    apply: (proposal) => {
      if (proposal.pass === pause.pass && "edits" in proposal)
        replace(proposal.edits);
    },
  });
  const edit = (command: V3Edit) => {
    if (!pending) replace([...edits, command]);
  };
  const continueGeneration = async () => {
    if (errors.length) return;
    cancelAutosave(); // continue sends the edits itself
    setPending(true);
    setMessage("");
    try {
      const result = await continuePauseAction(adventureId, pause.pass, edits);
      if ("error" in result) {
        setMessage(result.error);
        const issues = "issues" in result ? (result.issues ?? []) : [];
        setServerErrors(issues);
        if (issues.length) setSaveState("error");
        else schedule(edits, draft, AUTOSAVE_DELAY);
      } else {
        savedRef.current = JSON.stringify(edits);
        setSaveState("idle");
        router.refresh();
      }
    } catch {
      setMessage("Request failed. Your local edits are still here. Try again.");
      schedule(edits, draft, AUTOSAVE_DELAY);
    } finally {
      setPending(false);
    }
  };
  const status =
    saveState === "dirty" || saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Couldn’t save"
        : null;
  return (
    <div className="space-y-5" aria-busy={pending}>
      <ReviewToolbar
        discard={
          <ConfirmButton
            label={<Undo2 aria-hidden size={16} />}
            ariaLabel="Discard my edits"
            title="Discard your edits?"
            body="This restores the generated content for this step and removes your changes."
            confirmLabel="Discard edits"
            className={reviewDiscard}
            disabled={pending || edits.length === 0}
            onConfirm={() => replace([], 0)}
          />
        }
        primary={
          <ConfirmButton
            label="Continue"
            ariaLabel="Continue generation"
            pendingLabel="Continuing…"
            title="Continue generation?"
            body={continueBody[pause.pass]}
            confirmLabel="Continue"
            className={reviewPrimary}
            disabled={pending || errors.length > 0}
            pending={pending}
            onConfirm={() => void continueGeneration()}
          />
        }
        summary={
          status ? (
            <span role="status" className="text-sm text-muted">
              {status}
            </span>
          ) : null
        }
        resolve={
          <AiFixPanel<{ edits: V3Edit[] }>
            hasIssues={errors.length + pause.errors.length + pause.warnings.length > 0}
            revision={JSON.stringify(edits)}
            disabled={pending}
            request={() =>
              fixPauseEditsWithAiAction(adventureId, pause.pass, edits)
            }
            apply={(proposal) => replace(proposal.edits)}
          />
        }
      />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}

      <ExistingIssues issues={pause.errors} />
      <IssueList issues={errors} />
      <fieldset disabled={pending} className="min-w-0">
        <PauseContentCards
          pass={pause.pass}
          draft={draft}
          sources={sources}
          edit={edit}
        />
      </fieldset>
    </div>
  );
}
