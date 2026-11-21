"use client";
import { Undo2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdventureSpec, CheckIssue } from "@adventure/spec-v3";
import {
  applyV3Edits,
  type CapturedSource,
  type V3Edit,
} from "@/lib/v3/edit/commands";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
import { saveV3AdventureEdits, fixV3EditsWithAiAction } from "./edit-actions";
import { ReviewToolbar } from "./review-toolbar";
import { AiFixPanel } from "./review/ai-fix-panel";
import { ExistingIssues } from "./review/existing-issues";
import { IssueList } from "./review/issue-list";
import { useReviewChatTarget } from "./review-chat-context";
import { reviewDiscard, reviewPrimary } from "./creation-styles";
import { ConfirmButton } from "./confirm-button";
import { GenerationSection } from "./generation-section";
import { PauseContentCards } from "./review/pause-content-cards";
import { useUnsavedEdits } from "./review/use-unsaved-edits";
import { UpgradePanel } from "./upgrade-panel";
import { DraftLinks } from "./draft-links";

const draftPasses = ["details", "endings", "reveal"] as const;

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
  const [localPending, setPending] = useState(false);
  const [upgradePending, setUpgradePending] = useState(false);
  const pending = localPending || upgradePending;
  const [existingErrors, setExistingErrors] = useState(initialErrors);
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<CheckIssue[]>([]);
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
    },
  });
  const errors = [...newLocalErrors(base, draft), ...serverErrors];
  // Each save creates a new version, so saving stays explicit (no autosave).
  const save = async () => {
    setPending(true);
    setMessage("");
    try {
      const result = await saveV3AdventureEdits(adventureId, version, edits);
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
        if (result.code === "check-errors") setServerErrors(result.errors);
      }
    } catch {
      setMessage("Could not save. Your edits are still here. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="space-y-4"
      aria-label="Saved adventure"
      aria-busy={pending}
    >
      <UpgradePanel adventureId={adventureId} spec={base} revision={version} dirty={edits.length > 0} disabled={localPending} onPendingChange={setUpgradePending} onApplied={(spec, nextVersion) => {
        setBase(spec); setDraft(spec); setVersion(nextVersion); setEdits([]); setServerErrors([]); setExistingErrors([]);
        setMessage('Draft saved. Preview it before publishing.'); router.refresh();
      }} />
      <ReviewToolbar
        discard={
          <ConfirmButton
            label={<Undo2 aria-hidden size={16} />}
            ariaLabel="Discard changes"
            className={reviewDiscard}
            title="Discard your changes?"
            body="Your unsaved changes are removed. The saved draft stays as it is."
            confirmLabel="Discard changes"
            disabled={!edits.length || pending}
            onConfirm={() => replace([])}
          />
        }
        primary={
          <button
            type="button"
            className={reviewPrimary}
            aria-label="Save changes"
            disabled={!edits.length || pending || errors.length > 0}
            onClick={save}
          >
            Save
          </button>
        }
        secondary={<DraftLinks adventureId={adventureId} />}
        summary={edits.length ? <span className="text-sm text-muted">Unsaved</span> : null}
        resolve={
          <AiFixPanel<{ edits: V3Edit[] }>
            hasIssues={errors.length + existingErrors.length > 0}
            revision={JSON.stringify([version, edits])}
            disabled={pending}
            request={() => fixV3EditsWithAiAction(adventureId, version, edits)}
            apply={(proposal) => replace(proposal.edits)}
          />
        }
      />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}

      <ExistingIssues issues={existingErrors} />
      <IssueList issues={errors} />
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {draftPasses.map((pass) => (
          <GenerationSection key={pass} pass={pass} current={pass === "details"}>
            <PauseContentCards
              pass={pass}
              draft={draft}
              sources={sources}
              edit={(command) => replace([...edits, command])}
            />
          </GenerationSection>
        ))}
      </fieldset>
    </section>
  );
}
