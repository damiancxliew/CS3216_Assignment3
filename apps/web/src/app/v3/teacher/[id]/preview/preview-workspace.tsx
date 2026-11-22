"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { PreviewInsight } from "@adventure/engine";
import type { PreviewLock } from "@/lib/play/v3/preview-client";
import type { PlayerView } from "@adventure/play-contract";
import type { AdventureSpec as Spec } from "@adventure/spec-v3";
import { ModalDialogsProvider } from "@/components/play/dialog-mode";
import type { PlayFocus } from "@/components/play/v3/play-focus";
import { V3PreviewClient } from "@/components/play/v3/v3-preview-client";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import type { CapturedSource } from "@/lib/v3/edit/commands";
import { previewContext, previewContextText } from "@/lib/v3/preview/context";
import type { ReviewAsset } from "@/lib/v3/review-assets";
import { EditorChatWorkspace } from "../review/editor-chat-workspace";
import { useAdventureDraft } from "../review/use-adventure-draft";
import { PreviewEditPanel } from "./preview-edit-panel";

type Props = {
  adventureId: string;
  brief: BriefStateV3;
  initial: Spec;
  initialVersion: number;
  assets: { version: number; items: ReviewAsset[] };
  capturedSources: CapturedSource[];
  insight: PreviewInsight | null;
  game: Omit<ComponentProps<typeof V3PreviewClient>, "adventureId" | "draft" | "onUpdate" | "onFocusChange" | "panel">;
};

const PANEL_KEY = "v3-preview-edit-panel";

/** The teacher preview with the edit panel: the game plays the unsaved draft the panel edits. */
export function PreviewWorkspace(props: Props) {
  return (
    <EditorChatWorkspace brief={props.brief}>
      <PreviewEditing {...props} />
    </EditorChatWorkspace>
  );
}

function PreviewEditing(props: Props) {
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState<PlayFocus>({ kind: "role" });
  const [live, setLive] = useState<{ insight: PreviewInsight | null; view: PlayerView }>({
    insight: props.insight,
    view: props.game.initialView,
  });
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PANEL_KEY);
      if (saved) setOpen(saved === "open");
      else if (window.innerWidth < 1024) setOpen(false);
    } catch { /* Open by default without storage. */ }
  }, []);
  const toggle = useCallback(() => setOpen((current) => {
    try { sessionStorage.setItem(PANEL_KEY, current ? "closed" : "open"); } catch { /* Keep the in-memory choice. */ }
    return !current;
  }), []);
  // The chat reads the context of the previous render; it settles as soon as the draft does.
  const [chatContext, setChatContext] = useState<string>();
  const draft = useAdventureDraft({
    adventureId: props.adventureId,
    assets: props.assets,
    initial: props.initial,
    initialVersion: props.initialVersion,
    capturedSources: props.capturedSources,
    errors: [],
    guardLeaving: false,
    ignoreStaleRecovery: true,
    appliedMessage: "",
    chatContext,
  });
  const context = useMemo(
    () => previewContext(draft.draft, focus, live.insight, live.view),
    [draft.draft, focus, live],
  );
  const contextText = context ? previewContextText(context) : undefined;
  useEffect(() => setChatContext(contextText), [contextText]);
  const edited = useMemo(
    () => new Set(draft.edits.flatMap((edit) => edit.type === "set" ? [edit.path.join(".")] : [])),
    [draft.edits],
  );
  const { version, edits } = draft;
  // On narrow screens the panel covers the game, so it steps aside while a game dialog is open.
  const game = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    const root = game.current;
    if (!root) return;
    const update = () => setDialogOpen(Boolean(root.querySelector('dialog[open], [aria-modal="true"], [data-game-dialog]')));
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal", "data-game-dialog"] });
    update();
    return () => observer.disconnect();
  }, []);
  const stale = draft.recoveryConflict;
  const readDraft = useCallback(() => (stale ? null : { version, edits }), [stale, version, edits]);
  const [locked, setLocked] = useState<PreviewLock[]>([]);
  const focusId = focus.kind === "character" || focus.kind === "document" ? focus.id
    : focus.kind === "stage" ? draft.draft.stages[focus.index]?.id : undefined;
  const lock = locked.find((item) => item.kind === focus.kind && item.id === focusId);
  const notice = draft.failure && draft.message
    ? draft.message
    : stale
      ? "Unsaved edits made on an older version are waiting in the editor. The preview plays the saved version until you keep or discard them there."
      : lock
        ? `Paused in the preview until this is fixed: ${lock.message}`
        : undefined;
  return (
    <div className="flex h-dvh min-h-0 flex-col lg:flex-row">
      <div ref={game} className="relative min-h-0 min-w-0 flex-1 overflow-hidden [transform:translateZ(0)]">
        <ModalDialogsProvider value={false}>
          <V3PreviewClient
            {...props.game}
            adventureId={props.adventureId}
            draft={readDraft}
            onUpdate={setLive}
            onLocked={setLocked}
            onFocusChange={setFocus}
            panel={{ open, toggle }}
          />
        </ModalDialogsProvider>
      </div>
      <div className={open ? `${dialogOpen ? "max-lg:hidden " : ""}fixed inset-x-0 bottom-0 z-50 flex h-[60dvh] min-h-0 shadow-[0_-4px_20px_rgb(0_0_0/0.15)] lg:static lg:h-auto lg:shadow-none` : "hidden"}>
          <PreviewEditPanel
            context={context}
            edited={edited}
            pending={draft.pending || stale}
            notice={notice}
            onEdit={draft.edit}
            onClose={toggle}
          />
      </div>
    </div>
  );
}
