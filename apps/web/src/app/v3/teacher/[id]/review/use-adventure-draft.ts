"use client";
import { useMemo, useState } from "react";
import {
  checkSpec,
  validateSpec,
  type AdventureSpec as Spec,
  type CheckIssue,
} from "@adventure/spec-v3";
import {
  preserveLegacyStageImages,
  type ReadyCandidate,
} from "@/lib/v3/media/resolvers";
import type { MediaCandidate } from "@/lib/v3/media/repository";
import type { ReviewAsset } from "@/lib/v3/review-assets";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
import {
  applyV3Edits,
  type CapturedSource,
  type V3Edit,
} from "@/lib/v3/edit/commands";
import { saveV3AdventureEdits } from "../edit-actions";
import { useBrowserDraft } from "./use-browser-draft";
import { useUnsavedEdits } from "./use-unsaved-edits";
import { useReviewChatTarget } from "../review-chat-context";

/**
 * The teacher's working copy of a saved adventure: the saved version, local
 * edits on top of it, the checks they produce, browser recovery and the editor
 * chat target. Shared by the editor and the preview so both edit the same draft.
 */
export function useAdventureDraft(props: {
  adventureId: string;
  assets?: { version: number; items: ReviewAsset[] };
  initial: Spec;
  initialVersion: number;
  capturedSources: CapturedSource[];
  errors: CheckIssue[];
  /** Work outside the draft (such as an upgrade) that must block edits. */
  externalPending?: boolean;
  /** Ask before leaving the page with unsaved edits. */
  guardLeaving?: boolean;
  appliedMessage?: string;
  /** Plain-text context for the editor chat, such as what the preview shows. */
  chatContext?: string;
  onSaved?: () => void;
}) {
  const legacyStages = Object.fromEntries(
    (props.assets?.items ?? [])
      .filter((asset) => asset.kind === "stage")
      .map((asset) => [asset.id, asset.url]),
  );
  const preserveStages = (spec: Spec) =>
    preserveLegacyStageImages(spec, props.adventureId, version, legacyStages);
  const [saved, setSaved] = useState(props.initial);
  const [draft, setDraft] = useState(props.initial);
  const [version, setVersion] = useState(props.initialVersion);
  const [mediaCandidates, setMediaCandidates] = useState<
    Record<string, ReadyCandidate>
  >({});
  const [edits, setEdits] = useState<V3Edit[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [localPending, setPending] = useState(false);
  const pending = localPending || Boolean(props.externalPending);
  const [recoveryConflict, setRecoveryConflict] = useState(false);
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
    // Match server review for untouched legacy specs; stricter editing checks
    // report only issues introduced by local changes against that saved baseline.
    const current = checkSpec(parsed.spec);
    return {
      ...current,
      errors: [...current.errors, ...(!parsed.spec.authoring && dirty ? newLocalErrors(saved, draft) : []),
      ],
    };
  }, [draft, saved, dirty]);
  // Generation obligations remain visible locally; authoritative Save replaces this list.
  const errors = [
    ...new Map(
      [...checks.errors, ...savedErrors].map((e) => [
        `${e.code}|${e.path}|${e.message}`,
        e,
      ]),
    ).values(),
  ];
  const browserDraft = useBrowserDraft({
    adventureId: props.adventureId,
    value: { version, base: preserveStages(saved), edits, candidates: mediaCandidates },
    dirty,
    sources: props.capturedSources,
    onRecover: recovered => {
      setSaved(recovered.base);
      setDraft(recovered.draft);
      setVersion(recovered.version);
      setEdits(recovered.edits);
      setMediaCandidates(recovered.candidates);
      setEditMode(true);
      if (recovered.version !== props.initialVersion) {
        setRecoveryConflict(true);
        setFailure(true);
        setMessage("The saved adventure changed while you were away. Download your recovered draft before discarding it to load the latest saved version.");
      }
    },
  });
  useUnsavedEdits(props.guardLeaving !== false && dirty);
  /** Replace all local edits with a proposal built on the saved version. */
  const replaceEdits = (next: V3Edit[], applied: string) => {
    try {
      setDraft(
        applyV3Edits(
          preserveStages(saved),
          next,
          props.capturedSources,
          true,
          { candidates: mediaCandidates },
        ),
      );
      setEdits(next);
      setEditMode(true);
      setMessage(applied);
      setFailure(false);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not apply suggestion.",
      );
      return false;
    }
  };
  useReviewChatTarget({
    key: `draft:${version}`,
    revision: JSON.stringify(edits),
    pending,
    input: { pass: "draft", version, edits, ...(props.chatContext ? { context: props.chatContext } : {}) },
    apply: (proposal) => {
      if (proposal.pass !== "draft" || pending) return;
      if (!replaceEdits(proposal.edits, props.appliedMessage ?? "Suggested changes applied. Save when you’re ready."))
        setFailure(true);
    },
  });
  const edit = (command: V3Edit, candidate?: MediaCandidate) => {
    if (pending) return;
    try {
      const candidates = candidate?.snapshot
        ? {
            ...mediaCandidates,
            [candidate.id]: {
              id: candidate.id,
              adventureId: props.adventureId,
              target: candidate.target,
              snapshot: candidate.snapshot,
            },
          }
        : mediaCandidates;
      setDraft(
        applyV3Edits(
          preserveStages(draft),
          [command],
          props.capturedSources,
          true,
          { candidates },
        ),
      );
      setMediaCandidates(candidates);
      setEditMode(true);
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
        props.onSaved?.();
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
  const discard = () => {
    browserDraft.clear();
    if (recoveryConflict) {
      setSaved(props.initial);
      setDraft(props.initial);
      setVersion(props.initialVersion);
      setSavedErrors(props.errors);
      setRecoveryConflict(false);
    } else setDraft(saved);
    setEdits([]);
    setEditMode(false);
    setMessage("Edits discarded.");
    setFailure(false);
  };
  /** Adopt a new saved version produced outside the draft, such as an upgrade. */
  const adoptSaved = (spec: Spec, nextVersion: number, notice: string) => {
    setSaved(spec); setDraft(spec); setVersion(nextVersion); setEdits([]); setSavedErrors([]); setEditMode(false);
    setMessage(notice);
  };
  return {
    saved, draft, version, edits, editMode, setEditMode,
    localPending, pending, dirty, checks, errors,
    message, failure, recoveryConflict, browserDraft,
    edit, replaceEdits, save, discard, adoptSaved,
  };
}
