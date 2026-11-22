"use client";
import { AdventureTransfer } from "@/components/teacher/v3-version-controls";
import { AdventureAccess } from "@/components/teacher/adventure-access";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Pencil, Play, Save, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { reviewAssets } from "@/lib/v3/review-assets";
import type { ReviewAsset } from "@/lib/v3/review-assets";
import { GeneratedAssets } from "./generated-assets";
import { V3AdventureNav } from "@/components/teacher/v3-adventure-nav";
import {
  type AdventureSpec as Spec,
  type CheckIssue,
  type SpecSource,
} from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import { type CapturedSource, type V3Edit } from "@/lib/v3/edit/commands";
import { AiFixPanel } from "./ai-fix-panel";
import { fixV3EditsWithAiAction } from "../edit-actions";
import { useAdventureDraft } from "./use-adventure-draft";
import { ReviewEditorFields } from "./editor-fields";
import { ReviewScreen } from "./review-screen";
import { EditorConversation } from "./editor-chat-workspace";
import { UpgradePanel } from "../upgrade-panel";

type Props = {
  adventureId: string;
  assets?: { version: number; items: ReviewAsset[] };
  initial: Spec;
  initialVersion: number;
  publishedVersion: number | null;
  published: boolean;
  isPublic: boolean;
  sources: SpecSource[];
  capturedSources: CapturedSource[];
  errors: CheckIssue[];
  warnings: (CheckIssue & { pass: string })[];
};
export function EditorWorkspace(props: Props) {
  const router = useRouter();
  const [published, setPublished] = useState(props.published);
  const [publishedVersion, setPublishedVersion] = useState(
    props.publishedVersion,
  );
  // Keep publication state in sync after a server refresh.
  useEffect(() => {
    setPublished(props.published);
    setPublishedVersion(props.publishedVersion);
  }, [props.published, props.publishedVersion]);
  const [chatClosed, setChatClosed] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradePending, setUpgradePending] = useState(false);
  const {
    saved, draft, version, edits, editMode, setEditMode,
    localPending, pending, dirty, checks, errors,
    message, failure, recoveryConflict, browserDraft,
    edit, replaceEdits, save, discard, adoptSaved,
  } = useAdventureDraft({
    adventureId: props.adventureId,
    assets: props.assets,
    initial: props.initial,
    initialVersion: props.initialVersion,
    capturedSources: props.capturedSources,
    errors: props.errors,
    externalPending: upgradePending,
    onSaved: () => router.refresh(),
  });

  return (
    <>
      <ReviewScreen
        assets={
          <fieldset
            disabled={pending}
            className="m-0 min-w-0 border-0 p-0"
            aria-busy={pending}
          >
            <GeneratedAssets
              assets={reviewAssets(
                draft,
                props.adventureId,
                version,
                props.assets?.items,
              )}
              savedAssets={reviewAssets(
                saved,
                props.adventureId,
                version,
                props.assets?.items,
              )}
              version={version}
              adventureId={props.adventureId}
              onEdit={edit}
            />
          </fieldset>
        }
        sidebar={(editMode || upgradeOpen) && !chatClosed ? <EditorConversation onClose={() => setChatClosed(true)} /> : undefined}
        floatingChecks
        issueActions={
          <AiFixPanel<{ edits: V3Edit[] }>
            hasIssues={
              errors.length + props.warnings.length + checks.warnings.length > 0
            }
            revision={`${version}:${JSON.stringify(edits)}`}
            disabled={pending}
            request={() =>
              fixV3EditsWithAiAction(props.adventureId, version, edits)
            }
            apply={(proposal) => { replaceEdits(proposal.edits, ""); }}
          />
        }
        onEditIssue={() => setEditMode(true)}
        renderHeader={() => (
          <header className="space-y-3" aria-busy={pending}>
            <V3AdventureNav adventureId={props.adventureId} page="adventure" />
            <UpgradePanel adventureId={props.adventureId} spec={saved} revision={version} dirty={dirty} disabled={localPending} onPendingChange={setUpgradePending} onReviewOpen={setUpgradeOpen} onApplied={(spec, nextVersion) => {
              adoptSaved(spec, nextVersion, 'Draft saved. Preview it before publishing.'); router.refresh();
            }} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div role="group" aria-label="Draft" className="flex flex-wrap items-center gap-2">
                {!editMode ? (
                  <button type="button" className={button.quiet + " max-sm:w-10 max-sm:px-0"} title="Edit" onClick={() => setEditMode(true)}>
                    <Pencil className="size-4" aria-hidden /><span className="max-sm:sr-only">Edit</span>
                  </button>
                ) : (
                  <>
                    {dirty || pending ? (
                      <button type="button" className={button.primary + " max-sm:w-10 max-sm:px-0"} title="Save" disabled={pending} onClick={save}>
                        <Save className="size-4" aria-hidden /><span className="max-sm:sr-only">{pending ? "Saving…" : "Save"}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={button.subtle + " max-sm:w-10 max-sm:px-0"}
                      title="Discard edits"
                      disabled={pending}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm("Discard your unsaved edits?")
                      ) {
                        discard();
                      }
                    }}
                    >
                      <Undo2 className="size-4" aria-hidden /><span className="max-sm:sr-only">Discard edits</span>
                    </button>
                  </>
                )}
                {dirty || pending ? (
                  <button type="button" disabled className={button.quiet + " max-sm:w-10 max-sm:px-0"} title="Preview">
                    <Play className="size-4" aria-hidden /><span className="max-sm:sr-only">Preview</span>
                  </button>
                ) : (
                  <Link href={`/v3/teacher/${props.adventureId}/preview`} className={button.quiet + " max-sm:w-10 max-sm:px-0"} title="Preview">
                    <Play className="size-4" aria-hidden /><span className="max-sm:sr-only">Preview</span>
                  </Link>
                )}
                {chatClosed ? <button type="button" className={button.quiet + " max-sm:w-10 max-sm:px-0"} title="Edit with chat" onClick={() => { setChatClosed(false); setEditMode(true); }}><MessageSquare className="size-4" aria-hidden /><span className="max-sm:sr-only">Edit with chat</span></button> : null}
              </div>
              <span aria-hidden className="hidden h-6 w-px bg-line-strong sm:block" />
              <div role="group" aria-label="Sharing" className="flex flex-wrap items-center gap-2">
                <AdventureTransfer adventureId={props.adventureId} version={version} publishedVersion={publishedVersion} disabled={dirty || pending} variant="subtle" />
                <AdventureAccess adventureId={props.adventureId} kind="v3" isPublic={props.isPublic} compact />
              </div>
              <div className="ml-auto">
                  <V3PublishPanel
                    key={`${version}:${publishedVersion}`}
                    adventureId={props.adventureId}
                    version={version}
                    publishedVersion={publishedVersion}
                    published={published}
                    unpublishedChanges={published && version !== publishedVersion}
                    onPublicationChange={(live, pointer) => {
                      setPublished(live);
                      setPublishedVersion(pointer);
                    }}
                    disabled={dirty || pending}
                    blockedReason={
                      errors.length
                        ? "Fix blocking errors before publishing."
                        : undefined
                    }
                    compact
                  />
              </div>
            </div>
            {dirty ? (
              <p className="text-sm">
                {browserDraft.notice ? "Unsaved edits recovered from this browser." : "Unsaved edits."} Save them before previewing, transferring or publishing.
              </p>
            ) : null}
            {browserDraft.notice && !dirty ? <p role="status" className="text-sm">{browserDraft.notice}</p> : null}
            {browserDraft.error ? <p role="alert" className="text-sm">{browserDraft.error}</p> : null}
            {recoveryConflict ? <button type="button" className={button.subtle} onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = `recovered-adventure-${props.adventureId}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}>Download recovered draft</button> : null}
            {message ? (
              <p
                className="text-sm"
                role={failure ? "alert" : "status"}
                aria-live="polite"
              >
                {message}
              </p>
            ) : null}
            {failure ? (
              <button
                type="button"
                className={button.subtle}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm(
                      "Reload the saved version and discard local edits?",
                    )
                  ) {
                    browserDraft.clear();
                    window.location.reload();
                  }
                }}
              >
                Reload saved version
              </button>
            ) : null}
          </header>
        )}
        spec={draft}
        sources={props.sources}
        errors={errors}
        warnings={[
          ...props.warnings,
          ...checks.warnings.map((w) => ({ ...w, pass: "editing" })),
        ]}
        editMode={editMode}
        renderEditor={(tab, selected) => (
          <ReviewEditorFields
            draft={draft}
            sources={props.capturedSources}
            edit={edit}
            tab={tab}
            selected={selected}
          />
        )}
      />
    </>
  );
}
