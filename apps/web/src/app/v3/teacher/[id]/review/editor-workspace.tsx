"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  AdventureSpec,
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
import { fieldLabel, template, unwrap } from "@/lib/v3/edit/form";
import { reviewAnchor, reviewSectionId, type ReviewTab } from "@/lib/v3/review";
import { saveV3AdventureEdits } from "../edit-actions";
import { EditField, EvidenceControls, Remove } from "./edit-form";
import { ReviewScreen } from "./review-screen";

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
    return parsed.ok
      ? {
          ...checkSpec(parsed.spec),
          errors: [
            ...checkSpec(parsed.spec).errors,
            ...(!parsed.spec.authoring ? editableIssues(parsed.spec) : []),
          ],
        }
      : {
          errors: parsed.issues.map((i) => ({ ...i, code: "schema" })),
          warnings: [],
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
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      const link = (e.target as Element).closest("a[href]");
      if (
        link &&
        !link.getAttribute("href")?.startsWith("#") &&
        !window.confirm("You have unsaved edits. Leave and discard them?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
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
  const renderEditor = (tab: ReviewTab, selected: string) => {
    const field = (key: keyof Spec) => (
      <EditField
        key={key}
        spec={draft}
        schema={AdventureSpec.shape[key]}
        value={draft[key]}
        path={[key]}
        name={fieldLabel(key)}
        onEdit={edit}
      />
    );
    if (tab === "settings")
      return (
        <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
          <p className="text-sm">
            Reading level and source policy do not rewrite existing prose or
            fetch new sources.
          </p>
          {(["title", "arc", "readingLevel", "timer", "role"] as const).map(
            field,
          )}
          <EditField
            spec={draft}
            schema={AdventureSpec.shape.authoring
              .unwrap()
              .shape.sourcePolicy.unwrap()}
            value={
              draft.authoring?.sourcePolicy ?? {
                allowAny: false,
                extraDomains: [],
              }
            }
            path={["sourcePolicy"]}
            name="Source policy"
            onEdit={(command) => {
              const policy = structuredClone(
                draft.authoring?.sourcePolicy ?? {
                  allowAny: false,
                  extraDomains: [],
                },
              );
              // Reuse the reducer on a small, schema-shaped settings wrapper.
              const holder = {
                ...draft,
                sourcePolicy: policy,
              } as unknown as Spec;
              const updated = applyV3Edits(
                holder,
                [command],
                [],
                true,
              ) as unknown as {
                sourcePolicy: NonNullable<
                  NonNullable<Spec["authoring"]>["sourcePolicy"]
                >;
              };
              edit({ type: "sourcePolicy", value: updated.sourcePolicy });
            }}
          />
        </div>
      );
    if (tab === "reveal")
      return (
        <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
          {field("reveal")}
          {field("teacherQuestions")}
        </div>
      );
    const index = draft[tab].findIndex((item) => item.id === selected);
    const list = draft[tab];
    const associated =
      tab === "stages"
        ? ([
            "discoveries",
            "definingMoments",
            "storyEvents",
            "openQuestions",
            "hintAngles",
          ] as const)
        : tab === "characters"
          ? (["triggers"] as const)
          : [];
    return (
      <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
        {index >= 0 ? (
          <>
            {tab === "documents" ? (
              <EvidenceControls
                spec={draft}
                index={index}
                sources={props.capturedSources}
                onEdit={edit}
              />
            ) : null}
            <EditField
              spec={draft}
              schema={AdventureSpec.shape[tab].element as z.ZodType}
              value={list[index]}
              path={[tab, index]}
              name={fieldLabel(tab)}
              onEdit={edit}
            />
            <div className="flex flex-wrap gap-2">
              <Remove
                spec={draft}
                value={list[index]}
                path={[tab, index]}
                onEdit={edit}
              />
              <button
                type="button"
                className={button.subtle}
                disabled={index === 0}
                onClick={() =>
                  edit({
                    type: "move",
                    path: [tab],
                    from: index,
                    to: index - 1,
                  })
                }
              >
                Move item up
              </button>
              <button
                type="button"
                className={button.subtle}
                disabled={index === list.length - 1}
                onClick={() =>
                  edit({
                    type: "move",
                    path: [tab],
                    from: index,
                    to: index + 1,
                  })
                }
              >
                Move item down
              </button>
            </div>
          </>
        ) : (
          <p>Select an item from the index.</p>
        )}

        <button
          type="button"
          className={button.quiet}
          onClick={() =>
            edit({
              type: "insert",
              path: [tab],
              index: list.length,
              value: template(AdventureSpec.shape[tab].element as z.ZodType),
            })
          }
        >
          Add {tab === "characters" ? "character" : tab.slice(0, -1)}
        </button>
        {associated.map((key) => {
          const schema = AdventureSpec.shape[key];
          const element = (unwrap(schema) as z.ZodArray<z.ZodType>).element;
          return (
            <section
              key={key}
              className="space-y-4"
              id={reviewAnchor(
                reviewSectionId(
                  selected,
                  key === "storyEvents" ? "events" : key,
                ),
              )}
              tabIndex={-1}
            >
              <h3 className="font-bold">{fieldLabel(key)}</h3>
              {draft[key].map((item, i) => {
                const belongs =
                  "stageId" in item
                    ? item.stageId === selected
                    : "characterId" in item
                      ? item.characterId === selected
                      : "discoveryId" in item
                        ? draft.discoveries.find(
                            (d) => d.id === item.discoveryId,
                          )?.stageId === selected
                        : true;
                return belongs ? (
                  <div key={item.id} className="space-y-2">
                    <EditField
                      spec={draft}
                      schema={element}
                      value={item}
                      path={[key, i]}
                      name={fieldLabel(key)}
                      onEdit={edit}
                    />
                    <Remove
                      spec={draft}
                      value={item}
                      path={[key, i]}
                      onEdit={edit}
                    />
                    <button
                      type="button"
                      className={button.subtle}
                      disabled={i === 0}
                      onClick={() =>
                        edit({ type: "move", path: [key], from: i, to: i - 1 })
                      }
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className={button.subtle}
                      disabled={i === draft[key].length - 1}
                      onClick={() =>
                        edit({ type: "move", path: [key], from: i, to: i + 1 })
                      }
                    >
                      Move down
                    </button>
                  </div>
                ) : null;
              })}
              <button
                type="button"
                className={button.quiet}
                onClick={() => {
                  const value = template(element) as Record<string, unknown>;
                  if ("stageId" in value) value.stageId = selected;
                  if (key === "triggers") value.characterId = selected;
                  edit({
                    type: "insert",
                    path: [key],
                    index: draft[key].length,
                    value,
                  });
                }}
              >
                Add {fieldLabel(key)}
              </button>
            </section>
          );
        })}
      </div>
    );
  };
  return (
    <>
      <header className="mb-6 space-y-4" aria-busy={pending}>
        <nav
          aria-label="Adventure navigation"
          className="flex items-center justify-between gap-4 border-b border-line pb-3 text-sm"
        >
          <Link
            href={`/v3/teacher/${props.adventureId}`}
            className="text-muted hover:text-ink"
          >
            ← Back to adventure
          </Link>
          <Link
            href={`/v3/teacher/${props.adventureId}/links`}
            className="text-muted underline underline-offset-4 hover:text-ink"
          >
            Version history
          </Link>
        </nav>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
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
              ) : dirty || pending ? (
                <>
                  <button
                    type="button"
                    className={button.primary}
                    disabled={pending}
                    onClick={save}
                  >
                    {pending ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className={button.subtle}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm("Discard your unsaved edits?")) {
                        setDraft(saved);
                        setEdits([]);
                        setEditMode(false);
                        setMessage("Edits discarded.");
                        setFailure(false);
                      }
                    }}
                  >
                    Discard
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={button.subtle}
                  onClick={() => setEditMode(false)}
                >
                  Done editing
                </button>
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
          <div className="rounded-xl border border-line bg-surface px-4 py-3 md:min-w-64">
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
              showHistory={false}
            />
          </div>
        </div>
        <p
          className="w-full text-sm"
          role={failure ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
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
      <ReviewScreen
        spec={draft}
        sources={props.sources}
        errors={errors}
        warnings={[
          ...props.warnings,
          ...checks.warnings.map((w) => ({ ...w, pass: "editing" })),
        ]}
        editMode={editMode}
        renderEditor={renderEditor}
      />
    </>
  );
}
