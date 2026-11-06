"use client";
import { documentDisplayTitle } from "@/lib/play/v3/document-labels";

import type { DocumentView, MessageView, NoteView, PlayerView } from "@adventure/play-contract";
import {
  Activity,
  BookOpen,
  ChevronDown,
  Info,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  ScrollText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/play/adventure-chrome.module.css";
import { pixelFont } from "@/components/play/v3/dialogue-box";

type IslandTab = "notes" | "documents" | "log";

export const JOURNAL_TAB_HELP: Readonly<Record<IslandTab, string>> = {
  notes: "Notes are key facts saved from conversations and documents. Use them to compare what people said with the record before you decide.",
  documents: "Documents are the sources you have found. Open one to reread it, check what it can and cannot show, and quote it as evidence.",
  log: "The log is every line said so far. Use it to look back at a conversation.",
};

function TabHint({ tab }: { tab: IslandTab }) {
  return (
    <p id={`stage-island-hint-${tab}`} className="mx-3 mt-3 flex items-start gap-1.5 rounded-lg bg-[#1f2433]/[0.06] px-2.5 py-2 text-xs leading-snug text-[#3d4352]">
      <Info size={14} className="mt-px shrink-0" aria-hidden />
      <span>{JOURNAL_TAB_HELP[tab]}</span>
    </p>
  );
}

export const JOURNAL_TAB_KEYS: Readonly<Record<string, IslandTab>> = { "1": "notes", "2": "documents", "3": "log" };

export type JournalShortcut =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "tab"; tab: IslandTab }
  | { type: "roleBrief" };

export function journalShortcut(
  key: string,
  { expanded, activeTab, definingMoment, hasRoleBrief }: { expanded: boolean; activeTab: IslandTab; definingMoment: boolean; hasRoleBrief: boolean },
): JournalShortcut | null {
  const pressed = key.length === 1 ? key.toLowerCase() : key;
  if (pressed === "j") return { type: "toggle" };
  if (pressed === "Escape") return expanded ? { type: "close" } : null;
  if (pressed === "r") return hasRoleBrief ? { type: "roleBrief" } : null;
  const tab = JOURNAL_TAB_KEYS[pressed];
  if (!tab || (tab === "notes" && definingMoment)) return null;
  return expanded && activeTab === tab ? { type: "close" } : { type: "tab", tab };
}

const kbdClass = "inline-grid min-w-4 place-items-center rounded border px-1 font-mono text-[10px] font-bold leading-4";

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
  return messages.length;
}

export function documentActivityText(item: Pick<DocumentView, "title">, count = 1): string {
  const prefix = `+${count} ${count === 1 ? "document" : "documents"}: `;
  return `${prefix}${item.title}`;
}

const STORY_LINE_KINDS = new Set<MessageView["kind"]>(["thought", "notice", "narration"]);
export const STORY_LINES_FILTER = "story-lines";

export function filterStoryLines(messages: MessageView[]): MessageView[] {
  return messages.filter((message) => STORY_LINE_KINDS.has(message.kind));
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
    <span className="mr-auto inline-flex min-w-0 items-center gap-2.5 normal-case text-xs font-bold tracking-normal">
      <span aria-label={`${view.notes.length} ${view.notes.length === 1 ? "note" : "notes"}`} className="inline-flex shrink-0 items-center gap-1">
        <NotebookPen size={15} aria-hidden />
        {view.notes.length}
      </span>
      <span aria-label={`${view.documents.length} ${view.documents.length === 1 ? "document" : "documents"}`} className="inline-flex shrink-0 items-center gap-1">
        <ScrollText size={15} aria-hidden />
        {view.documents.length}
      </span>
      <span aria-label={`${logLineCount(view.messages)} ${logLineCount(view.messages) === 1 ? "log line" : "log lines"}`} className="inline-flex shrink-0 items-center gap-1">
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
          <h3 className={`${pixelFont.className} mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#5c6472]`}>Stage {group.stageIndex + 1}</h3>
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

function DocumentsList({ documents, onOpenDocument }: { documents: PlayerView["documents"]; onOpenDocument: (id: string) => void }) {
  if (documents.length === 0) {
    return (
      <div className="space-y-1 px-4 py-8 text-center text-sm text-[#5c6472]">
        <p>No documents collected yet.</p>
        <p>Walk to a document to read it. Every document you collect will be saved here.</p>
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
              <span className="block font-bold">{documentDisplayTitle(document.title)}</span>
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
  const storyLine = message.kind === "thought"
    ? { label: "Hint", Icon: Lightbulb, tone: "border-[#c98a1b] bg-[#fbf1dc]", textClass: "italic" }
    : message.kind === "notice"
      ? { label: speaker, Icon: Activity, tone: "border-[#b4475a] bg-[#f9e7ea]", textClass: "italic" }
      : message.kind === "narration"
        ? { label: "Story event", Icon: BookOpen, tone: "border-[#3659cf] bg-[#e9edfb]", textClass: "" }
        : null;
  if (storyLine) {
    const { label, Icon, tone, textClass } = storyLine;
    return (
      <article key={message.id} className={`rounded-md border-l-4 px-3 py-2 text-sm ${tone}`}>
        <p className="mb-0.5 flex items-center gap-1.5 text-xs font-bold text-[#3d4352]">
          <Icon size={14} aria-hidden className="shrink-0" />
          {label}
        </p>
        <p className={`whitespace-pre-wrap leading-relaxed ${textClass}`}>{message.text}</p>
      </article>
    );
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
    () => characterId === STORY_LINES_FILTER
      ? filterStoryLines(view.messages)
      : characterId ? filterLogByCharacter(view.messages, characterId) : view.messages,
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
      {view.speakers.length > 0 || filterStoryLines(view.messages).length > 0 ? (
        <div role="group" aria-label="Filter the log" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#1f2433]/15 px-3 py-2">
          {[
            { id: "", name: "All" },
            { id: STORY_LINES_FILTER, name: "Hints & events" },
            ...view.speakers,
          ].map((option) => (
            <button
              key={option.id || "all"}
              type="button"
              aria-pressed={characterId === option.id}
              onClick={() => setCharacterId(option.id)}
              className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3659cf] ${
                characterId === option.id
                  ? "border-[#1f2433] bg-[#1f2433] text-[#fffaf0]"
                  : "border-[#1f2433]/25 bg-white/70 text-[#1f2433] hover:bg-white"
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
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
              <h3 className={`${pixelFont.className} sticky top-0 z-[1] mb-2 bg-[#fffaf0] pt-2 pb-1 text-xs font-bold uppercase tracking-[0.12em] text-[#5c6472]`}>
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
  shortcutsLocked = false,
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
  shortcutsLocked?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [activeTab, setActiveTab] = useState<IslandTab>(definingMoment && initialTab === "notes" ? "documents" : initialTab);
  const [activity, setActivity] = useState("");
  const previousDocumentCount = useRef(view.documents.length);
  const clearActivityTimer = useRef<number | null>(null);
  const lastOpenRequestKey = useRef<number | null>(null);
  const island = useRef<HTMLElement>(null);
  const headerButton = useRef<HTMLButtonElement>(null);
  const activeTabButton = useRef<HTMLButtonElement>(null);
  const focusTabAfterOpen = useRef(false);
  const focusHeaderAfterClose = useRef(false);
  const stage = view.stage;

  const focusInIsland = useCallback(() => Boolean(island.current?.contains(document.activeElement)), []);

  const openIsland = useCallback((moveFocus = true) => {
    setExpanded(true);
    focusTabAfterOpen.current = moveFocus;
  }, []);

  const closeIsland = useCallback(() => {
    focusHeaderAfterClose.current = focusInIsland();
    setExpanded(false);
  }, [focusInIsland]);

  const toggleIsland = useCallback((moveFocus = true) => {
    if (expanded) closeIsland();
    else openIsland(moveFocus);
  }, [closeIsland, expanded, openIsland]);

  useEffect(() => {
    const addedDocuments = view.documents.length - previousDocumentCount.current;
    previousDocumentCount.current = view.documents.length;
    const newestDocument = view.documents.at(-1);
    if (addedDocuments <= 0 || !newestDocument) return;

    setActivity(documentActivityText(newestDocument, addedDocuments));
    if (clearActivityTimer.current !== null) window.clearTimeout(clearActivityTimer.current);
    clearActivityTimer.current = window.setTimeout(() => {
      setActivity("");
      clearActivityTimer.current = null;
    }, 4000);
  }, [view.documents]);

  useEffect(() => () => {
    if (clearActivityTimer.current !== null) window.clearTimeout(clearActivityTimer.current);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shortcutsLocked || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (event.repeat) return;
      const shortcut = journalShortcut(event.key, { expanded, activeTab, definingMoment, hasRoleBrief: Boolean(onOpenRoleBrief) });
      if (!shortcut) return;
      event.preventDefault();
      const moveFocus = focusInIsland();
      if (shortcut.type === "toggle") toggleIsland(moveFocus);
      else if (shortcut.type === "close") closeIsland();
      else if (shortcut.type === "roleBrief") onOpenRoleBrief?.();
      else {
        setActiveTab(shortcut.tab);
        openIsland(moveFocus);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, closeIsland, definingMoment, expanded, focusInIsland, onOpenRoleBrief, openIsland, shortcutsLocked, toggleIsland]);

  useEffect(() => {
    if (expanded && focusTabAfterOpen.current && !activeTabButton.current?.disabled) {
      activeTabButton.current?.focus();
      focusTabAfterOpen.current = false;
    } else if (!expanded && focusHeaderAfterClose.current) {
      headerButton.current?.focus();
      focusHeaderAfterClose.current = false;
    }
  }, [activeTab, expanded]);

  useEffect(() => {
    if (!openRequest || openRequest.key === lastOpenRequestKey.current) return;
    lastOpenRequestKey.current = openRequest.key;
    setActiveTab(openRequest.tab);
    openIsland();
    onOpenRequestHandled?.(openRequest.key);
  }, [onOpenRequestHandled, openIsland, openRequest]);

  useEffect(() => {
    if (definingMoment && activeTab === "notes") setActiveTab("documents");
  }, [activeTab, definingMoment]);

  const showActivity = activity && !view.pendingCheck;
  const layerClass = definingMoment ? "z-30" : "z-10";

  return (
    <section
      ref={island}
      aria-label="Journal"
      className={`absolute bottom-2 left-2 ${expanded ? "w-[min(40rem,calc(100%_-_1rem))] sm:max-w-[calc(100%_-_2rem)]" : "w-[min(22rem,calc(100%_-_1rem))]"} rounded-xl border-[3px] border-[#1f2433] bg-[#fffaf0] text-[#1f2433] shadow-[3px_3px_0_#1f2433] sm:bottom-4 sm:left-4 ${layerClass}`}
    >
      <header className="shrink-0 rounded-t-[9px] bg-[#1f2433] px-3 py-2 text-[#fffaf0]">
        <h2 className="text-xs font-bold">
          <button
            ref={headerButton}
            type="button"
            aria-expanded={expanded}
            aria-controls="stage-island-panel"
            aria-keyshortcuts="J"
            aria-label={`Stage ${stage ? stage.index + 1 : 1} of ${stage?.count ?? 1}; ${view.notes.length} notes, ${view.documents.length} documents, ${logLineCount(view.messages)} log lines, ${expanded ? "collapse" : "expand"} island`}
            onClick={() => toggleIsland()}
            className="grid min-h-7 w-full grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fffaf0]"
          >
            <span className={`${pixelFont.className} mr-auto flex shrink-0 items-center gap-2 text-base font-bold`}>
              Journal
              <kbd aria-hidden className={`${kbdClass} border-[#fffaf0]/40 text-[#fffaf0]/80`}>J</kbd>
            </span>
            <span className="shrink-0 whitespace-nowrap rounded-full border border-[#fffaf0]/35 px-2 py-0.5 text-xs font-bold">
              Stage {stage ? stage.index + 1 : 1}/{stage?.count ?? 1}
            </span>
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md">
              <ChevronDown size={16} className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? "" : "rotate-180"}`} />
            </span>
            <span className={`col-span-3 min-h-5 min-w-0 text-[#fffaf0]/85 ${expanded && !view.pendingCheck && !showActivity ? "hidden" : ""}`}>
              {view.pendingCheck ? (
                <span role="status" className="flex min-w-0 items-center gap-1.5 truncate normal-case text-xs font-bold tracking-normal">
                  <LoaderCircle size={14} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" />
                  <span className="truncate">Adding to your notes…</span>
                </span>
              ) : showActivity ? (
                <span aria-live="polite" className="block min-w-0 truncate normal-case text-xs font-bold tracking-normal">
                  {activity}
                </span>
              ) : (
                <IslandCounts view={view} />
              )}
            </span>
          </button>
        </h2>
      </header>

      <div
        id="stage-island-panel"
        aria-hidden={!expanded}
        inert={!expanded}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
          expanded ? "grid-rows-[1fr] border-t border-[#1f2433]/15 opacity-100 translate-y-0" : "grid-rows-[0fr] opacity-0 -translate-y-1"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex h-[min(55vh,26rem)] min-h-0 flex-col">
            <div role="tablist" aria-label="Journal sections" className="m-2 mb-0 flex shrink-0 gap-1 rounded-lg bg-[#1f2433]/[0.08] p-1">
              {([
                ["notes", "Notes", view.notes.length],
                ["documents", "Documents", view.documents.length],
                ["log", "Log", logLineCount(view.messages)],
              ] as const).map(([tab, label, count], index) => {
                const disabled = tab === "notes" && definingMoment;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`stage-island-tab-${tab}`}
                    aria-selected={activeTab === tab}
                    aria-controls={`stage-island-tabpanel-${tab}`}
                    aria-keyshortcuts={String(index + 1)}
                    ref={activeTab === tab ? activeTabButton : undefined}
                    disabled={disabled}
                    title={disabled ? "Notes are closed during the decision" : JOURNAL_TAB_HELP[tab]}
                    aria-describedby={activeTab === tab ? `stage-island-hint-${tab}` : undefined}
                    onClick={() => setActiveTab(tab)}
                    className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3659cf] ${
                      activeTab === tab ? "bg-[#1f2433] text-[#fffaf0] shadow-sm" : "text-[#3d4352] hover:bg-white/70"
                    } disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[#8a8f99]`}
                  >
                    {label}
                    <span className={`rounded-full px-1.5 text-[10px] leading-4 ${activeTab === tab ? "bg-[#fffaf0]/20" : "bg-[#1f2433]/10"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div role="tabpanel" id={`stage-island-tabpanel-${activeTab}`} aria-labelledby={`stage-island-tab-${activeTab}`} className="h-full min-h-0 overflow-y-auto overscroll-contain">
                <TabHint tab={activeTab} />
                {activeTab === "notes" ? <NotesList notes={view.notes} /> : null}
                {activeTab === "documents" ? <DocumentsList documents={view.documents} onOpenDocument={onOpenDocument} /> : null}
                {activeTab === "log" ? <LogList key="log" view={view} /> : null}
              </div>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#1f2433]/15 px-3 py-2 text-[11px] text-[#5c6472]">
              <span><kbd className={`${kbdClass} border-[#1f2433]/30`}>1</kbd>–<kbd className={`${kbdClass} border-[#1f2433]/30`}>3</kbd> sections</span>
              {onOpenRoleBrief ? <span><kbd className={`${kbdClass} border-[#1f2433]/30`}>R</kbd> role brief</span> : null}
              <span><kbd className={`${kbdClass} border-[#1f2433]/30`}>Esc</kbd> close</span>
            </footer>
          </div>
        </div>
      </div>
      {pulseKey !== null ? (
        <span
          aria-hidden
          key={pulseKey}
          className={`pointer-events-none absolute inset-0 rounded-[inherit] ${styles.islandPulse}`}
        />
      ) : null}
    </section>
  );
}
