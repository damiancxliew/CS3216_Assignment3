"use client";
import { AdventureTransfer } from "@/components/teacher/v3-version-controls";
import { AdventureAccess } from "@/components/teacher/adventure-access";
import React, { useEffect, useState } from "react";
import Link from "next/link";
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
          <header className="space-y-4" aria-busy={pending}>
            <V3AdventureNav adventureId={props.adventureId} page="adventure" />
            <UpgradePanel adventureId={props.adventureId} spec={saved} revision={version} dirty={dirty} disabled={localPending} onPendingChange={setUpgradePending} onReviewOpen={setUpgradeOpen} onApplied={(spec, nextVersion) => {
              adoptSaved(spec, nextVersion, 'Draft saved. Preview it before publishing.'); router.refresh();
            }} />
            <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <section aria-label="Draft controls" className="space-y-3 py-2">
                <p className="text-sm font-bold">
                  {editMode ? "Editing draft" : "Adventure draft"}{" "}
                  <span className="font-normal text-muted">· v{version}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!editMode ? (
                    <button
                      type="button"
                      className={button.quiet}
                      onClick={() => setEditMode(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      {dirty || pending ? (
                        <button
                          type="button"
                          className={button.primary}
                          disabled={pending}
                          onClick={save}
                        >
                          {pending ? "Saving…" : "Save"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={button.subtle}
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
                        Discard edits
                      </button>
                    </>
                  )}
                  {dirty || pending ? (
                    <button type="button" disabled className={button.subtle}>
                      Preview
                    </button>
                  ) : (
                    <Link
                      href={`/v3/teacher/${props.adventureId}/preview`}
                      className={button.quiet}
                    >
                      Preview
                    </Link>
                  )}
                  {chatClosed ? <button type="button" className={button.quiet} onClick={() => { setChatClosed(false); setEditMode(true); }}>Edit with chat</button> : null}
                  <AdventureTransfer adventureId={props.adventureId} version={version} publishedVersion={publishedVersion} disabled={dirty || pending} />
                  <AdventureAccess adventureId={props.adventureId} kind="v3" isPublic={props.isPublic} compact />
                </div>
                {dirty ? (
                  <span className="text-sm">
                    Unsaved edits. Save before previewing, transferring or publishing.
                  </span>
                ) : null}
              </section>
              <div className="py-2 md:border-l md:border-line md:pl-6">
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
            {browserDraft.notice ? <p role="status" className="text-sm">{browserDraft.notice}</p> : null}
            {browserDraft.error ? <p role="alert" className="text-sm">{browserDraft.error}</p> : dirty ? <p className="text-sm text-muted">Draft kept in this browser. Press Save to create a saved version.</p> : null}
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
