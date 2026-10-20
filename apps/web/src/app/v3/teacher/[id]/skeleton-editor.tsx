"use client";

import { ChevronRight, Plus, Trash2, Pencil, Check as CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { checkSkeleton, validateSkeleton, DOCUMENT_KINDS } from "@adventure/spec-v3";
import type { CheckIssue, SkeletonShape } from "@adventure/spec-v3";

import { button, compactButton, control, ErrorText, Section, StableLabel } from "@/components/ui";
import { addItem, dependentsOf, issuesAt, removeItem, type AddKind, type Ref } from "@/lib/v3/skeleton-edit";

import { approveV3Skeleton, discardV3SkeletonDraft, saveV3SkeletonDraft, getV3GenerationProgress } from "../actions";
import { AiFixPanel } from "./review/ai-fix-panel";
import { fixSkeletonWithAiAction } from "./pause-actions";
import { useUnsavedEdits } from "./review/use-unsaved-edits";
import { ConfirmButton } from "./confirm-button";
import { useReviewChatTarget } from "./review-chat-context";
import { reviewToolbar, reviewPrimary, reviewEdit } from "./creation-styles";

type Draft = SkeletonShape;
type Moment = Draft["definingMoments"][number];
type Stage = Draft["stages"][number];

/** Server-side check codes the teacher sees: plain language, no ids or dev jargon. */
function friendlyMessage(issue: CheckIssue): string {
  switch (issue.code) {
    case "quote-not-in-source":
      return "This quote isn't in the source it cites";
    case "ref":
      return "This cites a source that doesn't exist";
    case "schema":
      return issue.message;
    default:
      return issue.message;
  }
}

/**
 * The needs_review editor: every skeleton field, add/remove with dangling
 * references left for `checkSkeleton` to flag in place, and autosaved drafts
 * on the server. Item cards are collapsed by default — they open on their own
 * when they carry errors or were just added. Continue is blocked while errors
 * remain.
 */
export function SkeletonEditor({ adventureId, initial, hasDraft, compact = false }: { adventureId: string; initial: SkeletonShape; hasDraft: boolean; compact?: boolean }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [editing, setEditing] = useState(!compact);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [discardPending, startDiscard] = useTransition();
  const [continuePending, startContinue] = useTransition();
  const [continueError, setContinueError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<CheckIssue[]>([]);
  const router = useRouter();
  useUnsavedEdits(saveState === "dirty" || saveState === "saving" || saveState === "error");

  useReviewChatTarget({ key: "skeleton", revision: JSON.stringify(draft), pending: continuePending || discardPending, input: { pass: "skeleton", skeleton: draft }, apply: proposal => { if (proposal.pass === "skeleton") { update(proposal.skeleton); setEditing(true); } } });
  const { errors: checkErrors, warnings } = checkSkeleton(draft);
  const errors = [...checkErrors, ...serverIssues];

  // --- autosave: 1 s debounce, latest wins, failure retries with backoff ------
  const pendingRef = useRef<Draft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const inFlight = useRef(0);
  const saving = useRef(new Set<Promise<unknown>>());

  async function save(target: Draft, attempt: number, retry = 0) {
    const seq = ++inFlight.current;
    let result: Awaited<ReturnType<typeof saveV3SkeletonDraft>>;
    const request = saveV3SkeletonDraft(adventureId, target as unknown);
    saving.current.add(request);
    try {
      result = await request;
    } catch {
      result = { error: "Could not save" };
    } finally {
      saving.current.delete(request);
    }
    if (seq !== inFlight.current || attempt !== attemptRef.current) return; // a newer edit won
    if ("ok" in result) {
      pendingRef.current = null;
      setSaveState("saved");
      setSavedAt(new Date(result.savedAt));
      return;
    }
    setSaveState("error");
    timerRef.current = setTimeout(() => {
      if (pendingRef.current) void save(pendingRef.current, ++attemptRef.current, retry + 1);
    }, Math.min(30_000, 2_000 * 2 ** retry));
  }

  function update(change: Draft | ((draft: Draft) => void)) {
    const next = structuredClone(typeof change === "function" ? draft : change);
    if (typeof change === "function") change(next);
    setDraft(next);
    // drop server issues under any subtree this edit touched
    setServerIssues((current) =>
      current.filter((issue) => {
        const [array, index] = issue.path.split(".");
        const before = (draft as unknown as Record<string, unknown[]>)[array]?.[Number(index)];
        const after = (next as unknown as Record<string, unknown[]>)[array]?.[Number(index)];
        return JSON.stringify(before) === JSON.stringify(after);
      }),
    );
    pendingRef.current = next;
    attemptRef.current += 1;
    setSaveState((s) => (s === "error" ? "error" : "dirty"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const target = pendingRef.current;
      if (target) {
        setSaveState("saving");
        void save(target, ++attemptRef.current);
      }
    }, 1_000);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    inFlight.current += 1;
  }, []);

  const add = (kind: AddKind, parentRef: Ref | undefined, path: string) => {
    update((s) => Object.assign(s, addItem(s, kind, parentRef)));
    setAddedPaths((prev) => new Set(prev).add(path));
    setOpen((o) => ({ ...o, [path]: true }));
  };
  const remove = (ref: Ref) => update((s) => Object.assign(s, removeItem(s, ref)));

  /** Expands every ancestor card of `path` and scrolls to its deepest anchor. */
  const openTo = (path: string) => {
    const segments = path.split(".");
    setEditing(true);
    setOpen((o) => {
      const next = { ...o };
      for (let i = 1; i < segments.length; i += 1) next[segments.slice(0, i).join(".")] = true;
      return next;
    });
    requestAnimationFrame(() => {
      for (let i = segments.length; i > 0; i -= 1) {
        const el = document.getElementById(`sk-${segments.slice(0, i).join(".")}`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
      }
    });
  };

  const isOpen = (path: string, issueCount: number) => open[path] ?? (issueCount > 0 || addedPaths.has(path));

  const continueConfirm = () =>
    startContinue(async () => {
      setContinueError(null);
      let result: Awaited<ReturnType<typeof approveV3Skeleton>>;
      try {
        result = await approveV3Skeleton(adventureId, draft);
      } catch {
        setContinueError("Couldn't continue. Your edits are still here. Please try again.");
        return;
      }
      if ("error" in result) {
        const issues = ("issues" in result ? result.issues : []) as CheckIssue[];
        setServerIssues(issues.map((issue) => ({ ...issue, message: friendlyMessage(issue) })));
        // expand every card an issue belongs to
        setOpen((o) => {
          const next = { ...o };
          for (const issue of issues) {
            const segments = issue.path.split(".");
            for (let i = 1; i < segments.length; i += 1) next[segments.slice(0, i).join(".")] = true;
          }
          return next;
        });
        setContinueError(
          issues.length > 0
            ? `Some things need fixing before generation can continue: ${issues.length} issue${issues.length === 1 ? "" : "s"}.`
            : "Couldn't continue generation. Please try again.",
        );
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        inFlight.current += 1;
        pendingRef.current = null;
        setSaveState("idle");
        router.refresh();
      }
    });

  const momentOf = (stage: Stage): Moment | undefined => draft.definingMoments.find((m) => m.id === stage.definingMomentId);
  const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

  return (
    <fieldset disabled={continuePending || discardPending} aria-label="Skeleton review" className="min-w-0 flex flex-col gap-4">
      {/* sticky status bar */}
      <div className={compact ? reviewToolbar : "sticky top-0 z-30 -mx-2 flex flex-wrap items-center gap-3 border-b border-line bg-paper/95 px-2 py-3 backdrop-blur"} data-review-toolbar>
        <button type="button" onClick={() => setShowIssues((v) => !v)} className={compact ? compactButton.subtle : `${button.subtle} text-sm`} aria-expanded={showIssues}>
          <StableLabel label={`${errors.length} error${errors.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`} pending={false} pendingLabel="" />
        </button>
        <span className="text-sm text-muted" role="status">
          {saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : saveState === "error" ? "Couldn't save — retrying" : saveState === "dirty" ? "Saving…" : hasDraft ? "Draft restored" : "No unsaved changes"}
        </span>
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <ConfirmButton
            label="Discard my edits"
            className={compact ? compactButton.subtle : button.subtle}
            pendingLabel="Discarding…"
            title="Discard your edits?"
            body="This restores the generated outline and removes your changes."
            confirmLabel="Discard edits"
            pending={discardPending}
            onConfirm={() =>
              startDiscard(async () => {
                if (timerRef.current) clearTimeout(timerRef.current);
                inFlight.current += 1;
                attemptRef.current += 1;
                pendingRef.current = null;
                try {
                  await Promise.allSettled([...saving.current]);
                  const result = await discardV3SkeletonDraft(adventureId);
                  if ("error" in result) { setContinueError("Couldn't discard edits. Please try again."); return; }
                  const progress = await getV3GenerationProgress(adventureId);
                  const generated = validateSkeleton("error" in progress ? undefined : progress.skeleton);
                  if (!generated.ok) { setContinueError("Couldn't reload the generated skeleton. Please try again."); return; }
                  setDraft(generated.spec);
                  setSaveState("idle");
                  setSavedAt(null);
                  setServerIssues([]);
                  router.refresh();
                } catch { setContinueError("Couldn't discard edits. Please try again."); }
              })
            }
          />
          <ConfirmButton
            label="Continue generation"
            pendingLabel="Continuing…"
            title="Continue generation?"
            body="The next step will use this outline, including your changes."
            confirmLabel="Continue"
            className={compact ? reviewPrimary : button.primary}
            disabled={errors.length > 0 || continuePending}
            pending={continuePending}
            onConfirm={continueConfirm}
          />
        </div>
      </div>
      <AiFixPanel<{ skeleton: SkeletonShape }> floating={compact} revision={JSON.stringify(draft)} disabled={continuePending || discardPending} request={() => fixSkeletonWithAiAction(adventureId, draft)} apply={proposal => update(proposal.skeleton)} />
      {continueError ? <ErrorText>{continueError}</ErrorText> : null}
      {showIssues ? (
        <ul className="flex flex-col gap-1 rounded-surface border-2 border-line bg-sunken p-4 text-sm">
          {[...errors, ...warnings].map((issue, i) => (
            <li key={i}>
              <button type="button" onClick={() => openTo(issue.path)} className="text-left underline decoration-dotted underline-offset-2">
                <span className={i < errors.length ? "text-record" : "text-muted"}>{issue.path || "(top)"} — {issue.message}</span>
              </button>
            </li>
          ))}
          {errors.length === 0 && warnings.length === 0 ? <li className="text-muted">No issues.</li> : null}
        </ul>
      ) : null}

      {compact ? <section className="creation-card rounded-surface border border-line-strong bg-surface p-5" aria-label="Adventure plan" data-review-card><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold tracking-tight">{draft.title}</h2><button type="button" className={reviewEdit} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? <CheckIcon size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}{editing ? "Done" : "Edit plan"}</button></div><p className="text-sm leading-relaxed">{draft.arc}</p><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">{draft.stages.map(stage => <li key={stage.id}><span className="font-semibold">{stage.title}</span><p className="text-muted">{stage.centralQuestion}</p></li>)}</ol><p className="mt-4 text-xs text-muted">{draft.characters.length} characters · {draft.documents.length} documents · {draft.endings.length} endings</p></section> : null}
      {editing ? <div className={compact ? "creation-card space-y-6 rounded-surface border border-line-strong bg-surface p-5 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0" : "space-y-8"}>
      {/* 1. Overview — always expanded */}
      <Section title="Overview">
        <ItemIssues issues={issuesAt(errors, "title")} />
        <Text label="Title" value={draft.title} onChange={(v) => update((s) => void (s.title = v))} />
        <Area label="Arc" value={draft.arc ?? ""} onChange={(v) => update((s) => void (s.arc = v))} />
        <div id="sk-role" className="flex flex-col gap-3 rounded-surface border-2 border-line bg-surface p-5">
          <ItemIssues issues={issuesAt(errors, "role")} />
          <Text label="Role name" value={draft.role.name} onChange={(v) => update((s) => void (s.role.name = v))} />
          <Text label="Position" value={draft.role.position} onChange={(v) => update((s) => void (s.role.position = v))} />
          <Area label="Situation" value={draft.role.situation} onChange={(v) => update((s) => void (s.role.situation = v))} />
          <Area label="Reputation" value={draft.role.reputation} onChange={(v) => update((s) => void (s.role.reputation = v))} />
          <Area label="Stakes" value={draft.role.stakes} onChange={(v) => update((s) => void (s.role.stakes = v))} />
          <Lines label="Relationships" values={draft.role.relationships} onChange={(v) => update((s) => void (s.role.relationships = v))} />
          <Lines label="Goals" values={draft.role.privateBrief.goals} onChange={(v) => update((s) => void (s.role.privateBrief.goals = v))} />
          <Lines label="Fears" values={draft.role.privateBrief.fears} onChange={(v) => update((s) => void (s.role.privateBrief.fears = v))} />
          <Lines label="Constraints" values={draft.role.privateBrief.constraints} onChange={(v) => update((s) => void (s.role.privateBrief.constraints = v))} />
          <Lines label="Knows" values={draft.role.privateBrief.knows} onChange={(v) => update((s) => void (s.role.privateBrief.knows = v))} />
        </div>
      </Section>

      {/* 2. Characters */}
      <Section title="Characters">
        {draft.characters.map((character, i) => {
          const path = `characters.${i}`;
          const count = issuesAt(errors, path).length;
          return (
            <ItemCard key={character.id} path={path} title={character.name || "New character"} issueCount={count} isOpen={isOpen(path, count)} onToggle={() => setOpen((o) => ({ ...o, [path]: !isOpen(path, count) }))}
              remove={<RemoveButton draft={draft} ref_={`character:${character.id}`} itemLabel={character.name || "this character"} onRemove={remove} />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text label="Name" value={character.name} onChange={(v) => update((s) => void (s.characters[i].name = v))} />
                <Text label="Title" value={character.title} onChange={(v) => update((s) => void (s.characters[i].title = v))} />
                <Select label="Tier" value={character.tier} options={["major", "minor"]} onChange={(v) => update((s) => void (s.characters[i].tier = v as "major" | "minor"))} />
                <Check label="Real historical figure" checked={character.real} onChange={(v) => update((s) => void (s.characters[i].real = v))} />
              </div>
              <Area label="Public position" value={character.persona.publicPosition} onChange={(v) => update((s) => void (s.characters[i].persona.publicPosition = v))} />
              <Area label="Private agenda" value={character.persona.privateAgenda} onChange={(v) => update((s) => void (s.characters[i].persona.privateAgenda = v))} />
            </ItemCard>
          );
        })}
        <AddButton label="Add character" onClick={() => add("character", undefined, `characters.${draft.characters.length}`)} />
      </Section>

      {/* 3. Documents */}
      <Section title="Documents">
        {draft.documents.map((document, i) => {
          const path = `documents.${i}`;
          const count = issuesAt(errors, path).length;
          return (
            <ItemCard key={document.id} path={path} title={document.title || "New document"} issueCount={count} isOpen={isOpen(path, count)} onToggle={() => setOpen((o) => ({ ...o, [path]: !isOpen(path, count) }))}
              remove={<RemoveButton draft={draft} ref_={`document:${document.id}`} itemLabel={document.title || "this document"} onRemove={remove} />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text label="Title" value={document.title} onChange={(v) => update((s) => void (s.documents[i].title = v))} />
                <Select label="Kind" value={document.kind} options={DOCUMENT_KINDS} onChange={(v) => update((s) => void (s.documents[i].kind = v as typeof document.kind))} />
                <Check label="Real artefact" checked={document.real} onChange={(v) => update((s) => void (s.documents[i].real = v))} />
              </div>
            </ItemCard>
          );
        })}
        <AddButton label="Add document" onClick={() => add("document", undefined, `documents.${draft.documents.length}`)} />
      </Section>

      {/* 4. Stages */}
      <Section title="Stages">
        {draft.stages.map((stage, i) => {
          const path = `stages.${i}`;
          const moment = momentOf(stage);
          const mIndex = moment ? draft.definingMoments.indexOf(moment) : -1;
          const stageCore = draft.discoveries.map((d, dIndex) => ({ d, dIndex })).filter(({ d }) => d.stageId === stage.id && d.core);
          const count =
            issuesAt(errors, path).length +
            (moment ? issuesAt(errors, `definingMoments.${mIndex}`).length : 0) +
            stageCore.reduce((sum, { dIndex }) => sum + issuesAt(errors, `discoveries.${dIndex}`).length, 0);
          return (
            <ItemCard key={stage.id} path={path} title={stage.title || `Stage ${i + 1}`} issueCount={count} isOpen={isOpen(path, count)} onToggle={() => setOpen((o) => ({ ...o, [path]: !isOpen(path, count) }))}
              remove={<RemoveButton draft={draft} ref_={`stage:${stage.id}`} itemLabel={stage.title || `stage ${i + 1}`} onRemove={remove} />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text label="Title" value={stage.title} onChange={(v) => update((s) => void (s.stages[i].title = v))} />
                <Text label="Time and place" value={stage.timePlace} onChange={(v) => update((s) => void (s.stages[i].timePlace = v))} />
              </div>
              <Area label="Central question" value={stage.centralQuestion} onChange={(v) => update((s) => void (s.stages[i].centralQuestion = v))} />

              <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted">Rooms</h4>
              {stage.rooms.map((room, j) => {
                const rPath = `${path}.rooms.${j}`;
                const rCount = issuesAt(errors, rPath).length;
                return (
                  <ItemCard key={room.id} path={rPath} title={room.name || `Room ${j + 1}`} issueCount={rCount} isOpen={isOpen(rPath, rCount)} onToggle={() => setOpen((o) => ({ ...o, [rPath]: !isOpen(rPath, rCount) }))} nested
                    remove={<RemoveButton draft={draft} ref_={`room:${stage.id}/${room.id}`} itemLabel={room.name || `room ${j + 1}`} onRemove={remove} />}>
                    <Text label="Name" value={room.name} onChange={(v) => update((s) => void (s.stages[i].rooms[j].name = v))} />
                    <Area label="Description" value={room.description} onChange={(v) => update((s) => void (s.stages[i].rooms[j].description = v))} />
                  </ItemCard>
                );
              })}
              <AddButton label="Add room" onClick={() => add("room", `stage:${stage.id}`, `${path}.rooms.${stage.rooms.length}`)} />

              <Select label="Start room" value={stage.startRoomId} options={stage.rooms.map((r) => r.id)} labels={Object.fromEntries(stage.rooms.map((r) => [r.id, r.name || r.id]))} onChange={(v) => update((s) => void (s.stages[i].startRoomId = v))} />

              <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted">Placement</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.characters.map((character) => (
                  <Select
                    key={character.id}
                    label={character.name || character.id}
                    value={stage.placement[character.id] ?? ""}
                    options={["", ...stage.rooms.map((r) => r.id)]}
                    labels={{ "": "— not placed —", ...Object.fromEntries(stage.rooms.map((r) => [r.id, r.name || r.id])) }}
                    onChange={(v) =>
                      update((s) => {
                        if (v === "") delete s.stages[i].placement[character.id];
                        else s.stages[i].placement[character.id] = v;
                      })
                    }
                  />
                ))}
              </div>

              {moment && mIndex >= 0 ? (
                <MomentEditor
                  moment={moment}
                  path={`definingMoments.${mIndex}`}
                  errors={errors}
                  characters={draft.characters}
                  endings={draft.endings}
                  update={update}
                  mIndex={mIndex}
                  draft={draft}
                  onAdd={(kind, addedPath) => add(kind, `moment:${moment.id}`, addedPath)}
                  onRemove={remove}
                />
              ) : null}

              <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted">Core discoveries</h4>
              {stageCore.map(({ d: discovery, dIndex }) => {
                const dPath = `discoveries.${dIndex}`;
                const dCount = issuesAt(errors, dPath).length;
                return (
                  <ItemCard key={discovery.id} path={dPath} title={truncate(discovery.text || discovery.note, 40) || `Discovery ${dIndex + 1}`} issueCount={dCount} isOpen={isOpen(dPath, dCount)} onToggle={() => setOpen((o) => ({ ...o, [dPath]: !isOpen(dPath, dCount) }))} nested
                    remove={<RemoveButton draft={draft} ref_={`discovery:${discovery.id}`} itemLabel={truncate(discovery.text || discovery.note, 40) || "this discovery"} onRemove={remove} />}>
                    <Area label="Text" value={discovery.text} onChange={(v) => update((s) => void (s.discoveries[dIndex].text = v))} />
                    <Area label="Note" value={discovery.note} onChange={(v) => update((s) => void (s.discoveries[dIndex].note = v))} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select
                        label="Held by"
                        value={"characterId" in discovery.holder ? `char:${discovery.holder.characterId}` : `doc:${discovery.holder.documentId}`}
                        options={[...draft.characters.map((c) => `char:${c.id}`), ...draft.documents.map((d) => `doc:${d.id}`)]}
                        labels={Object.fromEntries([
                          ...draft.characters.map((c) => [`char:${c.id}`, c.name || c.id] as const),
                          ...draft.documents.map((d) => [`doc:${d.id}`, d.title || d.id] as const),
                        ])}
                        onChange={(v) =>
                          update((s) => {
                            const [kind, id] = v.split(":");
                            s.discoveries[dIndex].holder = kind === "char" ? { characterId: id! } : { documentId: id! };
                          })
                        }
                      />
                      <Text label="Source label" value={discovery.sourceLabel} onChange={(v) => update((s) => void (s.discoveries[dIndex].sourceLabel = v))} />
                    </div>
                    <CitationsEditor
                      citations={discovery.citations ?? []}
                      sources={draft.sources}
                      onChange={(citations) => update((s) => void (s.discoveries[dIndex].citations = citations))}
                    />
                  </ItemCard>
                );
              })}
              <AddButton label="Add core discovery" onClick={() => add("discovery", `stage:${stage.id}`, `discoveries.${draft.discoveries.length}`)} />
            </ItemCard>
          );
        })}
        <AddButton label="Add stage" onClick={() => add("stage", undefined, `stages.${draft.stages.length}`)} />
      </Section>

      {/* 6. Endings */}
      <Section title="Endings">
        {draft.endings.map((ending, i) => {
          const path = `endings.${i}`;
          const count = issuesAt(errors, path).length;
          return (
            <ItemCard key={ending.id} path={path} title={ending.title || `Ending ${i + 1}`} issueCount={count} isOpen={isOpen(path, count)} onToggle={() => setOpen((o) => ({ ...o, [path]: !isOpen(path, count) }))}
              remove={<RemoveButton draft={draft} ref_={`ending:${ending.id}`} itemLabel={ending.title || `ending ${i + 1}`} onRemove={remove} />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Type" value={ending.type} options={["historical", "alternative", "secret"]} onChange={(v) => update((s) => void (s.endings[i].type = v as typeof ending.type))} />
                <Text label="Title" value={ending.title} onChange={(v) => update((s) => void (s.endings[i].title = v))} />
              </div>
              <Area label="Summary" value={ending.summary} onChange={(v) => update((s) => void (s.endings[i].summary = v))} />
              <Text label="Source label" value={ending.sourceLabel} onChange={(v) => update((s) => void (s.endings[i].sourceLabel = v))} />
              <CitationsEditor citations={ending.citations ?? []} sources={draft.sources} onChange={(citations) => update((s) => void (s.endings[i].citations = citations))} />
            </ItemCard>
          );
        })}
        <AddButton label="Add ending" onClick={() => add("ending", undefined, `endings.${draft.endings.length}`)} />
      </Section>
      </div> : null}
    </fieldset>
  );
}

function MomentEditor({
  moment,
  path,
  errors,
  characters,
  endings,
  update,
  mIndex,
  draft,
  onAdd,
  onRemove,
}: {
  moment: Moment;
  path: string;
  errors: CheckIssue[];
  characters: Draft["characters"];
  endings: Draft["endings"];
  update: (mutate: (draft: Draft) => void) => void;
  mIndex: number;
  draft: Draft;
  onAdd: (kind: "act" | "outcome" | "rule", addedPath: string) => void;
  onRemove: (ref: Ref) => void;
}) {
  const count = issuesAt(errors, path).length;
  return (
    <div id={`sk-${path}`} className="flex flex-col gap-3 rounded-surface border-2 border-line bg-sunken p-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted">Defining moment</h4>
        {count > 0 ? <IssueBadge count={count} /> : null}
      </div>
      <ItemIssues issues={issuesAt(errors, path)} />
      <Select
        label="Decider"
        value={moment.deciderId}
        options={["", ...characters.map((c) => c.id)]}
        labels={{ "": "— choose —", ...Object.fromEntries(characters.map((c) => [c.id, c.name || c.id])) }}
        onChange={(v) => update((s) => void (s.definingMoments[mIndex].deciderId = v))}
      />
      <Area label="Scene" value={moment.scene} onChange={(v) => update((s) => void (s.definingMoments[mIndex].scene = v))} />

      <h5 className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Acts</h5>
      {moment.acts.map((act, j) => {
        const aPath = `${path}.acts.${j}`;
        return (
          <div key={act.id} id={`sk-${aPath}`} className="flex items-start gap-2 rounded-surface border border-line bg-surface p-3">
            <div className="flex-1">
              <ItemIssues issues={issuesAt(errors, aPath)} />
              <Text label={`Act ${j + 1}`} value={act.text} onChange={(v) => update((s) => void (s.definingMoments[mIndex].acts[j].text = v))} />
            </div>
            <RemoveButton draft={draft} ref_={`act:${moment.id}/${act.id}`} itemLabel={act.text || `Act ${j + 1}`} onRemove={onRemove} rulesUsedBy={moment.rules.filter((r) => r.actId === act.id).length} />
          </div>
        );
      })}
      <AddButton label="Add act" onClick={() => onAdd("act", `${path}.acts.${moment.acts.length}`)} />

      <h5 className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Outcomes</h5>
      {moment.outcomes.map((outcome, j) => {
        const oPath = `${path}.outcomes.${j}`;
        return (
          <div key={outcome.id} id={`sk-${oPath}`} className="flex flex-col gap-2 rounded-surface border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <ItemIssues issues={issuesAt(errors, oPath)} />
              <RemoveButton draft={draft} ref_={`outcome:${moment.id}/${outcome.id}`} itemLabel={outcome.summary || `Outcome ${j + 1}`} onRemove={onRemove} rulesUsedBy={moment.rules.filter((r) => r.outcomeId === outcome.id).length} />
            </div>
            <Area label="Summary" value={outcome.summary} onChange={(v) => update((s) => void (s.definingMoments[mIndex].outcomes[j].summary = v))} />
            <div className="flex flex-wrap items-center gap-4">
              <Check label="Historical" checked={outcome.historical === true} onChange={(v) => update((s) => void (s.definingMoments[mIndex].outcomes[j].historical = v || undefined))} />
              <Check label="Secret" checked={outcome.secret === true} onChange={(v) => update((s) => void (s.definingMoments[mIndex].outcomes[j].secret = v || undefined))} />
              <Select
                label="Leads to ending"
                value={outcome.endingId ?? ""}
                options={["", ...endings.map((e) => e.id)]}
                labels={{ "": "— none —", ...Object.fromEntries(endings.map((e) => [e.id, e.title || e.id])) }}
                onChange={(v) => update((s) => void (s.definingMoments[mIndex].outcomes[j].endingId = v === "" ? undefined : v))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-ink">Closes endings:</span>
              {endings.map((ending) => (
                <label key={ending.id} className="inline-flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={outcome.closesEndingIds.includes(ending.id)}
                    onChange={(event) =>
                      update((s) => {
                        const o = s.definingMoments[mIndex].outcomes[j];
                        o.closesEndingIds = event.target.checked ? [...o.closesEndingIds, ending.id] : o.closesEndingIds.filter((id) => id !== ending.id);
                      })
                    }
                  />
                  {ending.title || ending.id}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <AddButton label="Add outcome" onClick={() => onAdd("outcome", `${path}.outcomes.${moment.outcomes.length}`)} />

      <h5 className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Rules</h5>
      {moment.rules.map((rule, j) => (
        <div key={j} id={`sk-${path}.rules.${j}`} className="flex items-end gap-2">
          <Select
            label="When act"
            value={rule.actId}
            options={["", ...moment.acts.map((a) => a.id)]}
            labels={{ "": "— act —", ...Object.fromEntries(moment.acts.map((a, k) => [a.id, a.text || `Act ${k + 1}`])) }}
            onChange={(v) => update((s) => void (s.definingMoments[mIndex].rules[j].actId = v))}
            grow
          />
          <span className="pb-3 text-muted">→</span>
          <Select
            label="Outcome"
            value={rule.outcomeId}
            options={["", ...moment.outcomes.map((o) => o.id)]}
            labels={{ "": "— outcome —", ...Object.fromEntries(moment.outcomes.map((o, k) => [o.id, o.summary || `Outcome ${k + 1}`])) }}
            onChange={(v) => update((s) => void (s.definingMoments[mIndex].rules[j].outcomeId = v))}
            grow
          />
          <RemoveButton draft={draft} ref_={`rule:${moment.id}/${rule.actId}/${rule.outcomeId}`} itemLabel={`rule ${j + 1}`} onRemove={onRemove} />
        </div>
      ))}
      <AddButton label="Add rule" onClick={() => onAdd("rule", `${path}.rules.${moment.rules.length}`)} />
    </div>
  );
}

function CitationsEditor({
  citations,
  sources,
  onChange,
}: {
  citations: { sourceId: string; quote?: string | undefined }[];
  sources: Draft["sources"];
  onChange: (citations: { sourceId: string; quote?: string }[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Citations</h5>
      {citations.map((citation, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <Select
              label="Source"
              value={citation.sourceId}
              options={["", ...sources.map((s) => s.id)]}
              labels={{ "": "— source —", ...Object.fromEntries(sources.map((s) => [s.id, s.title || s.id])) }}
              onChange={(v) => onChange(citations.map((c, k) => (k === i ? { ...c, sourceId: v } : c)))}
            />
            <Area label="Quote" value={citation.quote ?? ""} onChange={(v) => onChange(citations.map((c, k) => (k === i ? { ...c, quote: v } : c)))} />
          </div>
          <RemoveIconButton label={`Remove citation ${i + 1}`} onClick={() => onChange(citations.filter((_, k) => k !== i))} />
        </div>
      ))}
      <AddButton label="Add citation" onClick={() => onChange([...citations, { sourceId: sources[0]?.id ?? "", quote: "" }])} />
    </div>
  );
}

// --- small primitives ---------------------------------------------------------

/** Collapsible card: collapsed by default, expanded when it has errors or was just added. */
function ItemCard({
  path,
  title,
  issueCount,
  isOpen,
  onToggle,
  nested,
  remove,
  children,
}: {
  path: string;
  title: string;
  issueCount: number;
  isOpen: boolean;
  onToggle: () => void;
  nested?: boolean;
  remove: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={`sk-${path}`} className={`rounded-surface border-2 ${issueCount > 0 ? "border-record" : "border-line"} ${nested ? "bg-sunken" : "bg-surface"}`}>
      <div className="flex items-center gap-2 px-4 py-2">
        <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
          <span className="min-w-0 truncate font-bold text-ink">{title}</span>
          <IssueBadge count={issueCount} />
        </button>
        {remove}
      </div>
      {isOpen ? <div className="flex flex-col gap-3 border-t border-line px-4 py-4">{children}</div> : null}
    </div>
  );
}

function IssueBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="shrink-0 rounded-full bg-record px-2 py-0.5 text-xs font-extrabold text-paper">{count}</span>;
}

function RemoveButton({ draft, ref_, itemLabel, onRemove, rulesUsedBy }: { draft: Draft; ref_: Ref; itemLabel: string; onRemove: (ref: Ref) => void; rulesUsedBy?: number }) {
  const dependents = dependentsOf(draft, ref_);
  return (
    <ConfirmButton
      label={<Trash2 className="h-4 w-4" aria-hidden />}
      title={`Remove ${itemLabel}?`}
      body={
        dependents.length > 0 ? (
          <>
            These will be left pointing at it:
            <ul className="mt-1 list-disc pl-5">
              {dependents.map((d, i) => (
                <li key={i}>{d.label}</li>
              ))}
            </ul>
          </>
        ) : rulesUsedBy && rulesUsedBy > 0 ? (
          `This also removes ${rulesUsedBy} rule${rulesUsedBy === 1 ? "" : "s"} that use it.`
        ) : (
          "Nothing else points at it."
        )
      }
      confirmLabel="Remove"
      className={`${button.subtle} h-9 w-9 shrink-0 !px-0 inline-flex items-center justify-center`}
      ariaLabel={`Remove ${itemLabel}`}
      onConfirm={() => onRemove(ref_)}
    />
  );
}

function RemoveIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`${button.subtle} shrink-0 !px-2`}>
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  );
}

function ItemIssues({ issues }: { issues: CheckIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-sm text-record">
      {issues.map((issue, i) => (
        <li key={i}>{issue.path ? `${issue.path} — ` : ""}{issue.message}</li>
      ))}
    </ul>
  );
}

function Text({ label, value, onChange, grow }: { label: string; value: string; onChange: (v: string) => void; grow?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${grow ? "flex-1" : ""}`}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={control} />
    </label>
  );
}

function Area({ label, value, onChange, grow }: { label: string; value: string; onChange: (v: string) => void; grow?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${grow ? "flex-1" : ""}`}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea value={value} rows={2} onChange={(e) => onChange(e.target.value)} className={`${control} resize-y py-2`} />
    </label>
  );
}

function Lines({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">{label} <span className="font-normal text-muted">(one per line)</span></span>
      <textarea value={values.join("\n")} rows={Math.max(2, values.length)} onChange={(e) => onChange(e.target.value.split("\n"))} className={`${control} resize-y py-2`} />
    </label>
  );
}

function Select({ label, value, options, labels, onChange, grow }: { label: string; value: string; options: readonly string[]; labels?: Record<string, string>; onChange: (v: string) => void; grow?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${grow ? "flex-1" : ""}`}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={control}>
        {options.map((option) => (
          <option key={option} value={option}>{labels?.[option] ?? option}</option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${button.subtle} inline-flex w-fit items-center gap-1.5`}>
      <Plus className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
