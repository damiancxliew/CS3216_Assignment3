"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AdventureSpec as Spec,
  type CheckIssue,
} from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import type { PauseView, GuidedPass } from "@/lib/v3/generation/service";
import {
  applyV3Edits,
  type V3Edit,
  type CapturedSource,
} from "@/lib/v3/edit/commands";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
import { safeSourceUrl } from "@/lib/v3/review";
import { reviewIssueMessage } from "@/lib/v3/review-presentation";
import {
  continueFromSourcesAction,
  continuePauseAction,
  savePauseEditsAction,
  fixPauseEditsWithAiAction,
} from "./pause-actions";
import { AiFixPanel } from "./review/ai-fix-panel";
import { PauseContentCards } from "./review/pause-content-cards";
import { useUnsavedEdits } from "./review/use-unsaved-edits";
import { useReviewChatTarget } from "./review-chat-context";

const steps: GuidedPass[] = [
  "sources",
  "skeleton",
  "details",
  "endings",
  "reveal",
];
export function GuidedSteps({ pass }: { pass: GuidedPass }) {
  return (
    <nav aria-label="Guided generation" className="mb-6">
      <ol className="flex flex-wrap gap-3 text-sm">
        {steps.map((step, i) => (
          <li
            key={step}
            aria-current={step === pass ? "step" : undefined}
            className={step === pass ? "font-bold text-ink" : "text-muted"}
          >
            {i + 1}. {step[0].toUpperCase() + step.slice(1)}
            {step === pass ? " · Review now" : ""}
          </li>
        ))}
      </ol>
    </nav>
  );
}
export function SourcesReview({
  adventureId,
  pause,
}: {
  adventureId: string;
  pause: Extract<PauseView, { pass: "sources" }>;
}) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  useUnsavedEdits(removed.length > 0 && !pending);
  const empty = pause.uploads.length + pause.outside.length === removed.length;
  useReviewChatTarget({
    key: "sources",
    revision: JSON.stringify(removed),
    pending,
    input: { pass: "sources", removedSourceIds: removed },
    apply: (proposal) => {
      if (proposal.pass === "sources") setRemoved(proposal.removedSourceIds);
    },
  });
  return (
    <div
      className="creation-card space-y-6 rounded-surface border-2 border-ink bg-surface p-5 sm:p-6"
      aria-busy={pending}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Uploads</h2>
        <p className="text-sm text-muted">These are always included.</p>
        <ul className="space-y-2">
          {pause.uploads.map((source) => (
            <li key={source.id}>{source.title} · Included</li>
          ))}
        </ul>
        {!pause.uploads.length ? <p>No uploads.</p> : null}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Outside sources</h2>
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
                disabled={pending}
                onChange={(event) =>
                  setRemoved(
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
        {!pause.outside.length ? <p>No outside sources.</p> : null}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Not used</h2>
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
              <p className="mt-1 text-muted">{source.reason}</p>
            </li>
          ))}
        </ul>
        {!pause.rejected.length ? (
          <p className="text-sm text-muted">No sources were rejected.</p>
        ) : null}
      </section>
      {empty ? <p role="alert">Keep at least one source.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      <button
        className={`${button.primary} border-2 font-bold shadow-[0_3px_0_var(--ink)]`}
        disabled={pending || empty}
        onClick={async () => {
          setPending(true);
          setMessage("");
          try {
            const result = await continueFromSourcesAction(
              adventureId,
              removed,
            );
            if ("error" in result) setMessage(result.error);
            else router.refresh();
          } catch {
            setMessage(
              "Could not continue. Your selection is still here. Try again.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Continuing…" : "Continue generation"}
      </button>
    </div>
  );
}

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
  const [checkpoint, setCheckpoint] = useState<V3Edit[]>(pause.edits);
  const [draft, setDraft] = useState(() =>
    applyV3Edits(pause.base, pause.edits, sources, true),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    pause.edits.length ? "Saved edits restored." : "",
  );
  const [serverErrors, setServerErrors] = useState<CheckIssue[]>([]);
  const router = useRouter();
  const dirty = JSON.stringify(edits) !== JSON.stringify(checkpoint);
  useUnsavedEdits(dirty);
  const errors = [...newLocalErrors(pause.base, draft), ...serverErrors];
  const replace = (next: V3Edit[]) => {
    try {
      setDraft(applyV3Edits(pause.base, next, sources, true));
      setEdits(next);
      setServerErrors([]);
      setMessage("");
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
  const submit = async (advance: boolean) => {
    if (errors.length) return;
    setPending(true);
    setMessage("");
    try {
      if (advance) {
        const result = await continuePauseAction(
          adventureId,
          pause.pass,
          edits,
        );
        if ("error" in result) {
          setMessage(result.error);
          setServerErrors("issues" in result ? (result.issues ?? []) : []);
        } else {
          setCheckpoint(edits);
          router.refresh();
        }
      } else {
        const result = await savePauseEditsAction(
          adventureId,
          pause.pass,
          edits,
        );
        if (result.ok) {
          setCheckpoint(edits);
          setMessage("Edits saved.");
        } else {
          setServerErrors(result.errors);
          setMessage(
            "These edits add errors. Fix them before saving or continuing.",
          );
        }
      }
    } catch {
      setMessage("Request failed. Your local edits are still here. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-5" aria-busy={pending}>
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-control border border-line-strong bg-surface/95 px-3 py-3 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          className={button.quiet}
          disabled={pending || errors.length > 0 || !dirty}
          onClick={() => void submit(false)}
        >
          Save
        </button>
        <button
          type="button"
          className={button.subtle}
          disabled={pending || !dirty}
          onClick={() => {
            if (
              window.confirm(
                "Discard unsaved edits and restore your last save?",
              )
            ) {
              replace(checkpoint);
              setMessage("Last saved edits restored.");
            }
          }}
        >
          Discard unsaved edits
        </button>
        <button
          type="button"
          className={`${button.primary} border-2 font-bold shadow-[0_3px_0_var(--ink)]`}
          disabled={pending || errors.length > 0}
          onClick={() => void submit(true)}
        >
          {pending ? "Working…" : "Continue generation"}
        </button>
        <span className="text-sm text-muted">
          {dirty ? "Unsaved edits" : "All edits saved"}
        </span>
      </div>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <AiFixPanel<{ edits: V3Edit[] }>
        floating
        revision={JSON.stringify(edits)}
        disabled={pending}
        request={() =>
          fixPauseEditsWithAiAction(adventureId, pause.pass, edits)
        }
        apply={(proposal) => replace(proposal.edits)}
      />
      {pause.errors.length ? (
        <details className="rounded-surface border border-line p-4">
          <summary className="cursor-pointer font-bold">
            Existing generation issues ({pause.errors.length})
          </summary>
          <p className="my-2 text-sm">
            These were already in the generated draft. You can keep editing;
            only new errors will stop you from saving or continuing.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {pause.errors.map((issue, index) => (
              <li key={index}>{reviewIssueMessage(issue)}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div aria-live="polite">
        {errors.length ? (
          <p role="alert">
            {errors.length === 1
              ? "One issue needs attention"
              : `${errors.length} issues need attention`}{" "}
            before you can save or continue.
          </p>
        ) : null}
      </div>
      <fieldset disabled={pending} className="min-w-0">
        {errors.length ? (
          <section
            className="mb-4 rounded-surface border border-signal/40 bg-surface p-4"
            aria-label="Issues to resolve"
          >
            <ul className="list-disc space-y-2 pl-4 text-sm">
              {errors.map((issue, index) => (
                <li key={index}>{reviewIssueMessage(issue)}</li>
              ))}
            </ul>
          </section>
        ) : null}
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
