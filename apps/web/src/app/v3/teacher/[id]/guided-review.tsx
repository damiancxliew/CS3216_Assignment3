"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AdventureSpec,
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
import { safeSourceUrl, reviewIndex, type ReviewTab } from "@/lib/v3/review";
import {
  continueFromSourcesAction,
  continuePauseAction,
  savePauseEditsAction,
  fixPauseEditsWithAiAction,
} from "./pause-actions";
import { AiFixPanel } from "./review/ai-fix-panel";
import { ReviewEditorFields } from "./review/editor-fields";
import { EditField } from "./review/edit-form";
import { ReviewScreen } from "./review/review-screen";
import { useUnsavedEdits } from "./review/use-unsaved-edits";

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
  return (
    <div className="max-w-3xl space-y-6" aria-busy={pending}>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Your uploads</h2>
        <p className="text-sm text-muted">Uploads stay included.</p>
        <ul className="space-y-2">
          {pause.uploads.map((source) => (
            <li key={source.id}>{source.title} · Included</li>
          ))}
        </ul>
        {!pause.uploads.length ? <p>No uploads.</p> : null}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Outside sources</h2>
        <p className="text-sm">
          Uncheck any outside sources you do not want to use.
        </p>
        {pause.outside.map((source) => (
          <div
            key={source.id}
            className="space-y-1 rounded-surface border border-line p-3"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
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
                className="block break-all text-sm underline"
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
        <h2 className="text-xl font-bold">Rejected results</h2>
        <ul className="space-y-2 text-sm">
          {pause.rejected.map((source, index) => (
            <li key={index} className="break-words">
              {source.url} — {source.reason}
            </li>
          ))}
        </ul>
        {!pause.rejected.length ? (
          <p className="text-sm">No rejected results.</p>
        ) : null}
      </section>
      {empty ? <p role="alert">Keep at least one source.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      <button
        className={button.primary}
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
  const tabs: ReviewTab[] =
    pause.pass === "details"
      ? ["stages", "characters", "documents"]
      : pause.pass === "endings"
        ? ["stages", "endings"]
        : ["reveal"];
  return (
    <div className="space-y-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3">
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
          className={button.primary}
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
            These issues came from generation. Only new errors block Save and
            Continue.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {pause.errors.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div aria-live="polite">
        {errors.length ? (
          <p role="alert">
            {errors.length} new error(s). Fix these before Save or Continue.
          </p>
        ) : null}
      </div>
      <fieldset disabled={pending} className="min-w-0">
        <ReviewScreen
          checksPassedLabel="No new errors"
          spec={draft}
          sources={draft.sources}
          errors={errors}
          warnings={pause.warnings.map((issue) => ({
            ...issue,
            pass: pause.pass,
          }))}
          allowedTabs={tabs}
          indexEntries={(tab, itemId) => {
            const entries = reviewIndex(draft, tab, itemId);
            if (tab !== "stages") return entries;
            const moments = new Set(
              draft.definingMoments.map((moment) => moment.id),
            );
            return entries.filter((entry) =>
              pause.pass === "details"
                ? !moments.has(entry.id)
                : moments.has(entry.id),
            );
          }}
          editMode
          renderEditor={(tab, selected) => {
            if (pause.pass === "endings" && tab === "stages")
              return (
                <section className="space-y-5 rounded-surface border border-line p-4">
                  <h2 className="text-xl font-bold">
                    Decisions ·{" "}
                    {draft.stages.find((stage) => stage.id === selected)?.title}
                  </h2>
                  {draft.definingMoments.map((moment, index) =>
                    moment.stageId === selected ? (
                      <div key={moment.id} className="space-y-4">
                        <EditField
                          spec={draft}
                          schema={AdventureSpec.shape.definingMoments.element}
                          value={moment}
                          path={["definingMoments", index]}
                          name="Decision"
                          onEdit={edit}
                        />
                        <h3 className="font-bold">Endings produced</h3>
                        <ul className="list-disc pl-5">
                          {[
                            ...new Set(
                              moment.outcomes
                                .map((outcome) => outcome.endingId)
                                .filter(Boolean),
                            ),
                          ].map((id) => (
                            <li key={id}>
                              {draft.endings.find((ending) => ending.id === id)
                                ?.title ?? id}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </section>
              );
            return (
              <ReviewEditorFields
                draft={draft}
                sources={sources}
                edit={edit}
                tab={tab}
                selected={selected}
                detailsOnly={pause.pass === "details"}
              />
            );
          }}
        />
      </fieldset>
    </div>
  );
}
