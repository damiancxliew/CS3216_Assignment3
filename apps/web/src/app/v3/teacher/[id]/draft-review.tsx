"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdventureSpec, CheckIssue } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import {
  applyV3Edits,
  type CapturedSource,
  type V3Edit,
} from "@/lib/v3/edit/commands";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
import { reviewIssueMessage } from "@/lib/v3/review-presentation";
import { saveV3AdventureEdits, fixV3EditsWithAiAction } from "./edit-actions";
import { ReviewToolbar } from "./review-toolbar";
import { AiFixPanel } from "./review/ai-fix-panel";
import { ExistingIssues } from "./review/existing-issues";
import { useReviewChatTarget } from "./review-chat-context";
import { reviewPrimary } from "./creation-styles";
import { PauseContentCards } from "./review/pause-content-cards";
import { useUnsavedEdits } from "./review/use-unsaved-edits";

export function DraftReview({
  adventureId,
  initial,
  initialVersion,
  initialErrors,
  sources,
}: {
  adventureId: string;
  initial: AdventureSpec;
  initialVersion: number;
  initialErrors: CheckIssue[];
  sources: CapturedSource[];
}) {
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [version, setVersion] = useState(initialVersion);
  const [edits, setEdits] = useState<V3Edit[]>([]);
  const [pending, setPending] = useState(false);
  const [existingErrors, setExistingErrors] = useState(initialErrors);
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<CheckIssue[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();
  useUnsavedEdits(edits.length > 0);
  const replace = (next: V3Edit[]) => {
    try {
      setDraft(applyV3Edits(base, next, sources, true));
      setEdits(next);
      setServerErrors([]);
      setMessage("");
    } catch {
      setMessage("Could not apply that change. Your edits are still here.");
    }
  };
  useReviewChatTarget({
    key: `draft:${version}`,
    revision: JSON.stringify(edits),
    pending,
    input: { pass: "draft", version, edits },
    apply: (proposal) => {
      if (proposal.pass !== "draft") return;
      replace(proposal.edits);
      const changed = proposal.edits
        .slice(edits.length)
        .find((edit) => "path" in edit);
      const root = changed && "path" in changed ? changed.path[0] : "stages";
      setOpen(
        root === "endings" || root === "definingMoments"
          ? "endings"
          : root === "reveal" || root === "teacherQuestions"
            ? "reveal"
            : "details",
      );
    },
  });
  const errors = [...newLocalErrors(base, draft), ...serverErrors];
  return (
    <section
      className="space-y-4"
      aria-label="Saved adventure"
      aria-busy={pending}
    >
      <h3 className="text-lg font-extrabold tracking-tight">{draft.title}</h3>
      <ReviewToolbar>
        <button
          type="button"
          className={reviewPrimary}
          disabled={!edits.length || pending || errors.length > 0}
          onClick={async () => {
            setPending(true);
            setMessage("");
            try {
              const result = await saveV3AdventureEdits(
                adventureId,
                version,
                edits,
              );
              if (result.ok) {
                setBase(result.spec);
                setDraft(result.spec);
                setVersion(result.version);
                setEdits([]);
                setServerErrors([]);
                setExistingErrors(result.errors);
                setMessage("Changes saved.");
                router.refresh();
              } else {
                setMessage(result.message);
                if (result.code === "check-errors")
                  setServerErrors(result.errors);
              }
            } catch {
              setMessage(
                "Could not save. Your edits are still here. Try again.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          Save changes
        </button>
        <button
          type="button"
          className={button.subtle}
          disabled={!edits.length || pending}
          onClick={() => {
            if (window.confirm("Discard your unsaved changes?")) replace([]);
          }}
        >
          Discard changes
        </button>
        <span className="text-sm text-muted">
          {edits.length ? "Unsaved changes" : "Draft saved"}
        </span>
        <AiFixPanel<{ edits: V3Edit[] }>
          floating={false}
          inToolbar
          hasIssues={errors.length + existingErrors.length > 0}
          revision={JSON.stringify([version, edits])}
          disabled={pending}
          request={() => fixV3EditsWithAiAction(adventureId, version, edits)}
          apply={(proposal) => replace(proposal.edits)}
        />
      </ReviewToolbar>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}

      <ExistingIssues issues={existingErrors} />
      {errors.length ? (
        <ul role="alert" className="list-disc pl-5 text-sm">
          {errors.map((error, index) => (
            <li key={index}>{reviewIssueMessage(error)}</li>
          ))}
        </ul>
      ) : null}
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {(
          [
            ["details", "Stages, characters and documents"],
            ["endings", "Decisions and endings"],
            ["reveal", "Reveal and questions"],
          ] as const
        ).map(([pass, title]) => (
          <details
            key={pass}
            className="creation-card rounded-control border border-line-strong bg-surface p-4"
            open={open === pass}
            onToggle={(event) => {
              if (event.currentTarget.open) setOpen(pass);
              else setOpen((previous) => (previous === pass ? null : previous));
            }}
          >
            <summary className="cursor-pointer font-bold marker:text-world">
              {title}
            </summary>
            <div className="mt-4">
              <PauseContentCards
                pass={pass}
                draft={draft}
                sources={sources}
                edit={(command) => replace([...edits, command])}
              />
            </div>
          </details>
        ))}
      </fieldset>
    </section>
  );
}
