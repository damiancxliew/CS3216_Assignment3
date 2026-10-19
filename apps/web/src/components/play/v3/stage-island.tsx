"use client";

import type { DocumentView, MessageView, NoteView, PlayerView } from "@adventure/play-contract";
import {
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  ScrollText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import pickupStyles from "@/components/play/v3/note-pickup.module.css";

type IslandTab = "notes" | "scrolls" | "log";

const ISLAND_TRANSITION_MS = 200;

type NoteGroup = {
  stageIndex: number;
  notes: NoteView[];
};

type MessageGroup = {
  stageIndex: number | null;
  messages: MessageView[];
};

export function groupNotesByStage(notes: NoteView[]): NoteGroup[] {
  const groups = new Map<number, NoteView[]>();
  for (const note of [...notes].sort((a, b) => b.stageIndex - a.stageIndex || b.at - a.at)) {
    groups.set(note.stageIndex, [...(groups.get(note.stageIndex) ?? []), note]);
  }
  return [...groups.entries()].sort(([left], [right]) => right - left).map(([stageIndex, groupedNotes]) => ({
    stageIndex,
    notes: groupedNotes,
  }));
}

export function groupMessagesByStage(messages: MessageView[]): MessageGroup[] {
  const groups = new Map<number | null, MessageView[]>();
  for (const message of messages) {
    groups.set(message.stageIndex, [...(groups.get(message.stageIndex) ?? []), message]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left === null ? (right === null ? 0 : -1) : right === null ? 1 : left - right)
    .map(([stageIndex, groupedMessages]) => ({ stageIndex, messages: groupedMessages }));
}

export function logLineCount(messages: MessageView[]): number {
  return messages.filter((message) => message.kind === "player" || message.kind === "character").length;
}

export function islandActivityText(item: Pick<DocumentView, "title">, count = 1): string {
  const prefix = `+${count} ${count === 1 ? "scroll" : "scrolls"}: `;
  return `${prefix}${item.title}`;
}

export function filterLogByCharacter(messages: MessageView[], characterId: string): MessageView[] {
  const included = new Set<number>();
  messages.forEach((message, index) => {
    if (message.kind !== "character" || message.characterId !== characterId) return;
    included.add(index);
    for (let previous = index - 1; previous >= 0 && messages[previous]?.kind === "player"; previous -= 1) {
      included.add(previous);
    }
  });
  return messages.filter((_, index) => included.has(index));
}

function IslandCounts({ view }: { view: PlayerView }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-label={`${view.notes.length} ${view.notes.length === 1 ? "note" : "notes"}`} className="inline-flex items-center gap-1">
        <NotebookPen size={15} aria-hidden />
        {view.notes.length}
      </span>
      <span aria-label={`${view.documents.length} ${view.documents.length === 1 ? "scroll" : "scrolls"}`} className="inline-flex items-center gap-1">
        <ScrollText size={15} aria-hidden />
        {view.documents.length}
      </span>
      <span aria-label={`${logLineCount(view.messages)} ${logLineCount(view.messages) === 1 ? "log line" : "log lines"}`} className="inline-flex items-center gap-1">
        <MessagesSquare size={15} aria-hidden />
        {logLineCount(view.messages)}
      </span>
    </span>
  );
}

function NotesList({ notes }: { notes: NoteView[] }) {
  const groups = useMemo(() => groupNotesByStage(notes), [notes]);
  if (groups.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-[#5c6472]">No notes yet. Talk to people and read documents.</p>;
  }
  return (
    <div className="space-y-4 p-3">
      {groups.map((group) => (
        <section key={group.stageIndex} aria-label={`Stage ${group.stageIndex + 1} notes`}>
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#5c6472]">Stage {group.stageIndex + 1}</h3>
          <div className="space-y-2">
            {group.notes.map((note) => (
              <article key={note.id} className="rounded-lg border border-[#1f2433]/15 bg-white/65 px-3 py-2.5">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-[#5c6472]">
                  {note.source === "document" ? <ScrollText size={14} aria-hidden /> : <MessageCircle size={14} aria-hidden />}
                  {note.source === "document" ? "From the record" : "From a conversation"}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.text}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ScrollsList({ documents, onOpenDocument }: { documents: PlayerView["documents"]; onOpenDocument: (id: string) => void }) {
  if (documents.length === 0) {
    return (
      <div className="space-y-1 px-4 py-8 text-center text-sm text-[#5c6472]">
        <p>No scrolls collected yet.</p>
        <p>Walk to a document to read it. Every scroll you collect will be saved here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2 p-3">
      {documents.map((document) => (
        <li key={document.id}>
          <button
            type="button"
            onClick={() => onOpenDocument(document.id)}
            className="flex min-h-14 w-full items-start gap-2 rounded-lg border border-[#1f2433]/15 bg-white/65 px-3 py-2 text-left hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf]"
          >
            <ScrollText size={17} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{document.title}</span>
              <span className="mt-0.5 block text-xs text-[#5c6472]">
                {[document.kind, document.provenance.date, document.provenance.sender].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LogMessage({
  message,
  speaker,
  noteText,
}: {
  message: MessageView;
  speaker: string;
  noteText: string | null;
}) {
  if (message.kind === "player") {
    return (
      <article key={message.id} className="ml-auto max-w-[88%] rounded-lg rounded-br-none bg-[#e7edff] px-3 py-2 text-sm">
        <p className="mb-0.5 text-xs font-black">You</p>
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        {noteText ? <blockquote className="mt-2 border-l-2 border-[#3659cf] bg-white/65 px-2 py-1.5 text-xs italic">{noteText}</blockquote> : null}
      </article>
    );
  }
  if (message.kind === "thought") {
    return (
      <article key={message.id} className="max-w-[92%] rounded-lg bg-[#f1eadb] px-3 py-2 text-sm italic">
        <p className="mb-0.5 text-xs font-bold not-italic text-[#5c6472]">Your thought</p>
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
      </article>
    );
  }
  if (message.kind === "notice") {
    return <article key={message.id} className="px-2 py-1 text-center text-xs italic text-[#687080]">{message.text}</article>;
  }
  if (message.kind === "narration") {
    return <article key={message.id} className="px-3 py-1 text-center text-sm italic leading-relaxed text-[#5c6472]">{message.text}</article>;
  }
  return (
    <article key={message.id} className="max-w-[92%] rounded-lg border border-[#1f2433]/10 bg-white/65 px-3 py-2 text-sm">
      <p className="mb-0.5 text-xs font-bold text-[#5c6472]">{speaker}</p>
      <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
      {noteText ? <blockquote className="mt-2 border-l-2 border-[#3659cf] bg-[#e7edff] px-2 py-1.5 text-xs italic">{noteText}</blockquote> : null}
    </article>
  );
}

function LogList({ view }: { view: PlayerView }) {
  const [characterId, setCharacterId] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const messages = useMemo(
    () => characterId ? filterLogByCharacter(view.messages, characterId) : view.messages,
    [characterId, view.messages],
  );
  const groups = useMemo(() => groupMessagesByStage(messages), [messages]);

  useEffect(() => {
    const element = scrollArea.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    pinnedToBottom.current = true;
  }, []);

  useEffect(() => {
    const element = scrollArea.current;
    if (element && pinnedToBottom.current) element.scrollTop = element.scrollHeight;
  }, [view.messages.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {view.speakers.length > 0 ? (
        <label className="flex shrink-0 items-center gap-2 border-b border-[#1f2433]/15 px-3 py-2 text-xs font-bold">
          <span className="shrink-0">Person</span>
          <select
            aria-label="Filter by person"
            value={characterId}
            onChange={(event) => setCharacterId(event.target.value)}
            className="min-h-8 min-w-0 flex-1 rounded-md border border-[#1f2433]/25 bg-white px-2 text-sm font-medium"
          >
            <option value="">Everyone</option>
            {view.speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
          </select>
        </label>
      ) : null}
      <div
        ref={scrollArea}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        {groups.length === 0 ? <p className="py-8 text-center text-sm text-[#5c6472]">No story lines yet.</p> : null}
        {groups.map((group) => (
          <section key={group.stageIndex ?? "briefing"} aria-label={group.stageIndex === null ? undefined : `Stage ${group.stageIndex + 1}`}>
            {group.stageIndex !== null ? (
              <h3 className="sticky top-0 z-[1] mb-2 bg-[#fffaf0] pt-2 pb-1 text-[11px] font-black uppercase tracking-[0.14em] text-[#5c6472]">
                Stage {group.stageIndex + 1}
              </h3>
            ) : null}
            <div className="space-y-2">
              {group.messages.map((message) => {
                const speaker = view.speakers.find((candidate) => candidate.id === message.characterId)
                  ?? view.characters.find((candidate) => candidate.id === message.characterId)
                  ?? null;
                const noteText = message.insertedNoteId
                  ? view.notes.find((note) => note.id === message.insertedNoteId)?.text ?? "Note shared"
                  : null;
                return <LogMessage key={message.id} message={message} speaker={speaker?.name ?? "Someone"} noteText={noteText} />;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function StageIsland({
  view,
  onOpenDocument,
  onOpenRoleBrief,
  definingMoment = false,
  initialExpanded = false,
  initialTab = "notes",
  pulseKey = null,
  openRequest = null,
  onOpenRequestHandled,
}: {
  view: PlayerView;
  onOpenDocument: (id: string) => void;
  onOpenRoleBrief?: () => void;
  definingMoment?: boolean;
  initialExpanded?: boolean;
  initialTab?: IslandTab;
  pulseKey?: string | null;
  openRequest?: { tab: IslandTab; key: number } | null;
  onOpenRequestHandled?: (key: number) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [panelVisible, setPanelVisible] = useState(initialExpanded);
  const [panelOpen, setPanelOpen] = useState(initialExpanded);
  const [activeTab, setActiveTab] = useState<IslandTab>(definingMoment && initialTab === "notes" ? "scrolls" : initialTab);
  const [activity, setActivity] = useState("");
  const previousDocumentCount = useRef(view.documents.length);
  const clearActivityTimer = useRef<number | null>(null);
  const panelTimer = useRef<number | null>(null);
  const panelFrame = useRef<number | null>(null);
  const lastOpenRequestKey = useRef<number | null>(null);
  const pillButton = useRef<HTMLButtonElement>(null);
  const activeTabButton = useRef<HTMLButtonElement>(null);
  const focusTabAfterOpen = useRef(false);
  const focusPillAfterClose = useRef(false);
  const stage = view.stage;

  const openIsland = useCallback(() => {
    if (panelTimer.current !== null) {
      window.clearTimeout(panelTimer.current);
      panelTimer.current = null;
    }
    if (panelFrame.current !== null) {
      window.cancelAnimationFrame(panelFrame.current);
      panelFrame.current = null;
    }
    setPanelVisible(true);
    setPanelOpen(false);
    setExpanded(true);
    focusTabAfterOpen.current = true;
    panelFrame.current = window.requestAnimationFrame(() => {
      setPanelOpen(true);
      panelFrame.current = null;
    });
  }, []);

  const closeIsland = useCallback(() => {
    if (panelFrame.current !== null) {
      window.cancelAnimationFrame(panelFrame.current);
      panelFrame.current = null;
    }
    setExpanded(false);
    setPanelOpen(false);
    focusPillAfterClose.current = true;
    if (panelTimer.current !== null) window.clearTimeout(panelTimer.current);
    panelTimer.current = window.setTimeout(() => {
      setPanelVisible(false);
      panelTimer.current = null;
    }, ISLAND_TRANSITION_MS);
  }, []);

  const toggleIsland = useCallback(() => {
    if (expanded) closeIsland();
    else openIsland();
  }, [closeIsland, expanded, openIsland]);

  useEffect(() => {
    const addedDocuments = view.documents.length - previousDocumentCount.current;
    previousDocumentCount.current = view.documents.length;
    const newestDocument = view.documents.at(-1);
    if (addedDocuments <= 0 || !newestDocument) return;

    setActivity(islandActivityText(newestDocument, addedDocuments));
    if (clearActivityTimer.current !== null) window.clearTimeout(clearActivityTimer.current);
    clearActivityTimer.current = window.setTimeout(() => {
      setActivity("");
      clearActivityTimer.current = null;
    }, 4000);
  }, [view.documents]);

  useEffect(() => () => {
    if (clearActivityTimer.current !== null) window.clearTimeout(clearActivityTimer.current);
    if (panelTimer.current !== null) window.clearTimeout(panelTimer.current);
    if (panelFrame.current !== null) window.cancelAnimationFrame(panelFrame.current);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleIsland();
      } else if (event.key === "Escape" && expanded) {
        event.preventDefault();
        closeIsland();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeIsland, expanded, toggleIsland]);

  useEffect(() => {
    if (expanded && panelVisible && focusTabAfterOpen.current && !activeTabButton.current?.disabled) {
      activeTabButton.current?.focus();
      focusTabAfterOpen.current = false;
    } else if (!expanded && !panelVisible && focusPillAfterClose.current) {
      pillButton.current?.focus();
      focusPillAfterClose.current = false;
    }
  }, [activeTab, expanded, panelVisible]);

  useEffect(() => {
    if (!openRequest || openRequest.key === lastOpenRequestKey.current) return;
    lastOpenRequestKey.current = openRequest.key;
    setActiveTab(openRequest.tab);
    openIsland();
    onOpenRequestHandled?.(openRequest.key);
  }, [onOpenRequestHandled, openIsland, openRequest]);

  useEffect(() => {
    if (definingMoment && activeTab === "notes") setActiveTab("scrolls");
  }, [activeTab, definingMoment]);

  const showActivity = activity && !view.pendingCheck;
  const positionClass = definingMoment ? "left-16 z-10" : "left-3 z-10";

  return (
    <div className={`absolute bottom-3 ${positionClass}`}>
      {!panelVisible ? (
        <button
          ref={pillButton}
          key={pulseKey ?? "pill"}
          type="button"
          aria-expanded={false}
          aria-controls="stage-island-panel"
          aria-label={`Stage ${stage ? stage.index + 1 : 1} of ${stage?.count ?? 1}; ${view.notes.length} notes, ${view.documents.length} scrolls, ${logLineCount(view.messages)} log lines, expand island`}
          onClick={toggleIsland}
          className={`${styles.tool} ${styles.islandPill} ${pulseKey === null ? "" : pickupStyles.pulse} flex min-h-10 max-w-[calc(100vw-1.5rem)] items-center gap-2 px-3 text-sm font-bold transition-all duration-300 motion-reduce:transition-none`}
        >
          <IslandCounts view={view} />
          {stage ? (
            <span className="whitespace-nowrap rounded-full border border-[#c5aa79]/60 bg-black/15 px-2 py-0.5 text-xs">
              Stage {stage.index + 1}/{stage.count}
            </span>
          ) : null}
          {view.pendingCheck ? (
            <span role="status" className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs">
              <LoaderCircle size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
              Adding to your notes…
            </span>
          ) : showActivity ? (
            <span aria-live="polite" className="max-w-[min(20rem,45vw)] truncate text-xs">
              {activity}
            </span>
          ) : null}
          <ChevronDown size={16} aria-hidden className="shrink-0" />
        </button>
      ) : null}

      {panelVisible ? (
          <section
            id="stage-island-panel"
            aria-label="Notes, scrolls, and story log"
            className={`flex h-[min(60vh,28rem)] w-[min(26rem,calc(100vw-1.5rem))] origin-bottom-left flex-col overflow-hidden rounded-xl border-[3px] border-[#1f2433] bg-[#fffaf0] text-[#1f2433] shadow-[3px_3px_0_#1f2433] transition-[opacity,transform] duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
              panelOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-[#1f2433]/15 px-3 py-2.5">
              <IslandCounts view={view} />
              {stage ? <span className="ml-auto whitespace-nowrap rounded-full bg-[#1f2433]/5 px-2 py-1 text-xs font-bold">Stage {stage.index + 1}/{stage.count}</span> : null}
              <button
                type="button"
                aria-label="Collapse island"
                onClick={closeIsland}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-[#1f2433]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf]"
              >
                <ChevronDown size={17} aria-hidden />
              </button>
            </header>
            <div role="tablist" aria-label="Island sections" className="flex shrink-0 border-b border-[#1f2433]/15 px-2 pt-1">
              {([
                ["notes", "Notes", view.notes.length],
                ["scrolls", "Scrolls", view.documents.length],
                ["log", "Log", logLineCount(view.messages)],
              ] as const).map(([tab, label, count]) => {
                const disabled = tab === "notes" && definingMoment;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`stage-island-tab-${tab}`}
                    aria-selected={activeTab === tab}
                    aria-controls={`stage-island-tabpanel-${tab}`}
                    ref={activeTab === tab ? activeTabButton : undefined}
                    disabled={disabled}
                    title={disabled ? "Notes are closed during the decision" : undefined}
                    onClick={() => setActiveTab(tab)}
                    className={`min-h-10 flex-1 rounded-t-md px-2 text-xs font-bold sm:text-sm ${
                      activeTab === tab ? "border-b-2 border-[#3659cf] text-[#263e99]" : "text-[#5c6472] hover:bg-[#1f2433]/5"
                    } disabled:cursor-not-allowed disabled:text-[#8a8f99] disabled:hover:bg-transparent`}
                  >
                    {label} <span className="text-[11px] font-semibold">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div role="tabpanel" id={`stage-island-tabpanel-${activeTab}`} aria-labelledby={`stage-island-tab-${activeTab}`} className="h-full min-h-0 overflow-y-auto overscroll-contain">
                {activeTab === "notes" ? <NotesList notes={view.notes} /> : null}
                {activeTab === "scrolls" ? <ScrollsList documents={view.documents} onOpenDocument={onOpenDocument} /> : null}
                {activeTab === "log" ? <LogList key="log" view={view} /> : null}
              </div>
            </div>
            {onOpenRoleBrief ? (
              <footer className="flex shrink-0 justify-end border-t border-[#1f2433]/15 px-3 py-2">
                <button
                  type="button"
                  onClick={onOpenRoleBrief}
                  className="min-h-8 rounded-md px-2 text-xs font-bold text-[#3659cf] underline decoration-[#3659cf]/50 underline-offset-2 hover:bg-[#1f2433]/5"
                >
                  Role brief
                </button>
              </footer>
            ) : null}
          </section>
      ) : null}
    </div>
  );
}
