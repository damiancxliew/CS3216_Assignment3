"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { V3AdventureNav } from "@/components/teacher/v3-adventure-nav";
import {
  editableIssues,
  checkSpec,
  validateSpec,
  type AdventureSpec as Spec,
  type CheckIssue,
  type SpecSource,
} from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import {
  applyV3Edits,
  type CapturedSource,
  type V3Edit,
} from "@/lib/v3/edit/commands";
import { AiFixPanel } from "./ai-fix-panel";
import { saveV3AdventureEdits, fixV3EditsWithAiAction } from "../edit-actions";
import { useUnsavedEdits } from "./use-unsaved-edits";
import { ReviewEditorFields } from "./editor-fields";
import { ReviewScreen } from "./review-screen";
import { EditorConversation } from "./editor-chat-workspace";
import { useReviewChatTarget } from "../review-chat-context";

type Props = {
  adventureId: string;
  initial: Spec;
  initialVersion: number;
  publishedVersion: number | null;
  published: boolean;
  sources: SpecSource[];
  capturedSources: CapturedSource[];
  errors: CheckIssue[];
  warnings: (CheckIssue & { pass: string })[];
};
export function EditorWorkspace(props: Props) {
  const [published, setPublished] = useState(props.published);
  const [publishedVersion, setPublishedVersion] = useState(
    props.publishedVersion,
  );
  const [saved, setSaved] = useState(props.initial);
  const [draft, setDraft] = useState(props.initial);
  const [version, setVersion] = useState(props.initialVersion);
  const [edits, setEdits] = useState<V3Edit[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(false);
  const [savedErrors, setSavedErrors] = useState(props.errors);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const checks = useMemo(() => {
    const parsed = validateSpec(draft);
    if (!parsed.ok)
      return {
        errors: parsed.issues.map((i) => ({ ...i, code: "schema" })),
        warnings: [],
      };
    const current = checkSpec(parsed.spec);
    return {
      ...current,
      errors: [
        ...current.errors,
        ...(!parsed.spec.authoring ? editableIssues(parsed.spec) : []),
      ],
    };
  }, [draft]);
  // Generation obligations remain visible locally; authoritative Save replaces this list.
  const errors = [
    ...new Map(
      [...checks.errors, ...savedErrors].map((e) => [
        `${e.code}|${e.path}|${e.message}`,
        e,
      ]),
    ).values(),
  ];
  useUnsavedEdits(dirty);
  useReviewChatTarget({
    key: `draft:${version}`,
    revision: JSON.stringify(edits),
    pending,
    input: { pass: "draft", version, edits },
    apply: (proposal) => {
      if (proposal.pass !== "draft" || pending) return;
      try {
        setDraft(applyV3Edits(saved, proposal.edits, props.capturedSources, true));
        setEdits(proposal.edits);
        setEditMode(true);
        setMessage("Suggested changes applied. Save when you’re ready.");
        setFailure(false);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not apply suggestion.");
        setFailure(true);
      }
    },
  });
  const edit = (command: V3Edit) => {
    if (pending) return;
    try {
      setDraft(applyV3Edits(draft, [command], props.capturedSources, true));
      setEdits([...edits, command]);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not apply that edit.",
      );
    }
  };
  const save = async () => {
    setPending(true);
    setFailure(false);
    setMessage("Saving…");
    try {
      const result = await saveV3AdventureEdits(
        props.adventureId,
        version,
        edits,
      );
      if (result.ok) {
        setSaved(result.spec);
        setDraft(result.spec);
        setVersion(result.version);
        setEdits([]);
        setEditMode(false);
        setSavedErrors(result.errors);
        setMessage(
          `Saved version ${result.version}.${result.errors.length ? " Fix blocking errors before publishing." : ""}`,
        );
      } else {
        setMessage(result.message);
        setFailure(true);
      }
    } catch {
      setMessage(
        "Could not save. Your local work is still here. Try Save again.",
      );
      setFailure(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <ReviewScreen
        sidebar={editMode ? <EditorConversation /> : undefined}
        floatingChecks
        issueActions={
          <AiFixPanel<{ edits: V3Edit[] }>
            floating={false}
            inToolbar
            hasIssues={errors.length + props.warnings.length + checks.warnings.length > 0}
            revision={`${version}:${JSON.stringify(edits)}`}
            disabled={pending}
            request={() =>
              fixV3EditsWithAiAction(props.adventureId, version, edits)
            }
            apply={(proposal) => {
              try {
                setDraft(
                  applyV3Edits(
                    saved,
                    proposal.edits,
                    props.capturedSources,
                    true,
                  ),
                );
                setEdits(proposal.edits);
                setEditMode(true);
                setMessage("");
                setFailure(false);
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Could not apply suggestion.",
                );
              }
            }}
          />
        }
        onEditIssue={() => setEditMode(true)}
        renderHeader={() => (
          <header className="space-y-4" aria-busy={pending}>
            <V3AdventureNav adventureId={props.adventureId} page="adventure" />
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
                            setDraft(saved);
                            setEdits([]);
                            setEditMode(false);
                            setMessage("Edits discarded.");
                            setFailure(false);
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
                </div>
                {dirty ? (
                  <span className="text-sm">
                    Unsaved edits. Save before Preview or Publish.
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
                  )
                    window.location.reload();
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
