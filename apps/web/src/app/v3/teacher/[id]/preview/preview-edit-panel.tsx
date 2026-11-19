"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare, Pencil, X } from "lucide-react";
import type { PreviewContext, ContextEdit, ContextEntry, ContextLine } from "@/lib/v3/preview/context";
import type { V3Edit } from "@/lib/v3/edit/commands";
import { EditorConversation } from "../review/editor-chat-workspace";
import { useReviewChat } from "../review-chat-context";

const pathKey = (path: ContextEdit["path"]) => path.join(".");

function InlineEditor({ edit, label, onDone }: { edit: ContextEdit; label: string; onDone(value: string | null): void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  return (
    <textarea
      ref={box}
      aria-label={`Edit ${label}`}
      defaultValue={edit.value}
      rows={Math.min(10, Math.max(3, Math.ceil(edit.value.length / 48)))}
      className="mt-1 w-full resize-y rounded-control border border-record bg-surface px-3 py-2 font-serif text-[15px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-record"
      onBlur={(event) => onDone(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(null); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.blur(); }
      }}
    />
  );
}

function EditButton({ label, onClick, disabled }: { label: string; onClick(): void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-label={`Edit ${label}`}
      title={`Edit ${label}`}
      disabled={disabled}
      onClick={onClick}
      className="rounded-control p-1.5 text-muted opacity-0 hover:bg-sunken hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ink group-hover:opacity-100 disabled:hidden"
    >
      <Pencil size={14} aria-hidden />
    </button>
  );
}

/**
 * The teacher's panel beside the running preview: the readable text the game gives the model for
 * whatever is in focus, editable in place, with the editor chat floating over it on demand.
 */
export function PreviewEditPanel({ context, edited, pending, onEdit, onClose }: {
  context: PreviewContext | null;
  /** Paths changed by unsaved edits. */
  edited: ReadonlySet<string>;
  pending: boolean;
  onEdit(command: V3Edit): void;
  onClose(): void;
}) {
  const chat = useReviewChat();
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const title = context?.title ?? "Preview";
  useEffect(() => setEditing(null), [title]);
  const closeChat = () => {
    setChatOpen(false);
    requestAnimationFrame(() => fab.current?.focus());
  };

  const lineBody = (entry: ContextEntry, line: ContextLine, index: number) => {
    const key = line.edit ? pathKey(line.edit.path) : `${entry.label}:${index}`;
    const changed = line.edit ? edited.has(key) : false;
    if (line.edit && editing === key)
      return (
        <InlineEditor
          edit={line.edit}
          label={entry.label}
          onDone={(value) => {
            setEditing(null);
            if (value !== null && value !== line.edit!.value)
              onEdit({ type: "set", path: line.edit!.path, value });
          }}
        />
      );
    return (
      <span className={`whitespace-pre-wrap ${changed ? "rounded-[4px] bg-world-wash shadow-[-6px_0_0_var(--world-wash),6px_0_0_var(--world-wash)] [box-decoration-break:clone]" : ""}`}>
        {line.text}
      </span>
    );
  };

  const entryView = (entry: ContextEntry, live = false) => {
    const single = !entry.list && entry.lines.length === 1 ? entry.lines[0] : null;
    const singleKey = single?.edit ? pathKey(single.edit.path) : null;
    const changed = entry.lines.some((line) => line.edit && edited.has(pathKey(line.edit.path)));
    return (
      <section key={entry.label} className={`group ${live ? "pt-2" : "pt-4"}`}>
        <h3 className="flex min-h-7 items-center gap-2 text-sm font-semibold text-muted">
          <span>{entry.label}</span>
          {changed ? <span className="text-world">Edited</span> : null}
          <span className="ml-auto">
            {single?.edit && editing !== singleKey ? (
              <EditButton label={entry.label} disabled={pending} onClick={() => setEditing(singleKey)} />
            ) : null}
          </span>
        </h3>
        {entry.list ? (
          <ul className="list-disc space-y-1 pl-5 font-serif text-[15px] leading-[1.62]">
            {entry.lines.map((line, index) => {
              const key = line.edit ? pathKey(line.edit.path) : null;
              return (
                <li key={key ?? index} className="group/line">
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">{lineBody(entry, line, index)}</div>
                    {line.edit && editing !== key ? (
                      <span className="[&_button]:group-hover/line:opacity-100">
                        <EditButton label={`${entry.label} ${index + 1}`} disabled={pending} onClick={() => setEditing(key)} />
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="max-w-[62ch] font-serif text-[15px] leading-[1.62]">
            {entry.lines.map((line, index) => <div key={index}>{lineBody(entry, line, index)}</div>)}
          </div>
        )}
      </section>
    );
  };

  return (
    <aside aria-label="Edit as you preview" className="relative flex min-h-0 w-full shrink-0 flex-col border-t-4 border-[#1f2433] bg-paper text-ink lg:w-[27rem] lg:border-l-4 lg:border-t-0">
      <header className="flex items-center gap-3 px-5 pb-3 pt-4">
        <h2 className="min-w-0 flex-1 font-serif text-2xl font-semibold leading-tight">{title}</h2>
        <button type="button" aria-label="Close edit panel" onClick={onClose} className="rounded-control p-1.5 text-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line px-5 pb-24 [overflow-wrap:anywhere]" inert={chatOpen || undefined}>
        {!context ? (
          <p className="pt-4 text-sm text-muted">Talk to a character, open a document or walk the map to see what the game uses here.</p>
        ) : (
          <>
            {context.live.length ? (
              <section aria-label="Right now in this preview" className="mt-4 border-l-[3px] border-world pb-2 pl-4">
                <p className="pt-1 text-sm font-semibold text-world">Right now in this preview</p>
                {context.live.map((entry) => entryView(entry, true))}
              </section>
            ) : null}
            {context.entries.map((entry) => entryView(entry))}
          </>
        )}
      </div>
      {chatOpen ? <div aria-hidden className="absolute inset-0 z-10 bg-ink/40" onClick={closeChat} /> : null}
      <div
        hidden={!chatOpen}
        className="absolute inset-x-3 bottom-3 z-20 h-[68%] min-h-0"
        onKeyDown={(event) => { if (event.key === "Escape") closeChat(); }}
      >
        <EditorConversation
          onClose={closeChat}
          closeLabel="Minimise chat"
          closeIcon={<ChevronDown size={18} aria-hidden />}
          className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-surface border border-line bg-surface p-4 shadow-[0_18px_40px_rgb(23_32_51/0.35)]"
        />
      </div>
      {chatOpen ? null : (
        <button
          ref={fab}
          type="button"
          onClick={() => setChatOpen(true)}
          className="absolute bottom-5 right-5 z-20 inline-flex items-center gap-2 rounded-full bg-signal py-2.5 pl-3.5 pr-4 font-bold text-on-accent shadow-[0_8px_22px_rgb(23_32_51/0.28)] hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <MessageSquare size={18} aria-hidden />
          Edit with chat
          {chat?.suggestionWaiting ? <span className="rounded-full bg-surface px-2 text-xs text-signal">1 suggestion</span> : null}
        </button>
      )}
    </aside>
  );
}
