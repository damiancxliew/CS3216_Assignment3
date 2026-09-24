"use client";

import { Check, FileText, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { addBriefSource, briefTurn, discardBrief, finishBrief, startBrief } from "./actions";
import { extractPdfPagesInBrowser } from "@/lib/brief/extract-pdf-client";
import { button, control, ErrorText, Pending, Thinking } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import {
  type BriefInput,
  type BriefState,
  currentSlot,
  MAX_CLIENT_PDF_BYTES,
  MAX_UPLOAD_BYTES,
  quickReplies,
  READING_BAND_LABELS,
  type Slot,
  slotKey,
  SOURCES_DONE,
} from "@/lib/brief/schema";

/**
 * The brief as a conversation. It opens on the source material: the teacher
 * uploads what students will play from, the assistant reads it and proposes
 * the rest of the brief from it, one question at a time, and the teacher
 * accepts or overrides each. The order of questions is fixed on the server
 * (`currentSlot`); this component renders the transcript, the controls the
 * current question allows, and the summary once every slot is filled. The
 * state is mirrored onto the adventure row after every turn, so a brief left
 * half-done is offered again next visit.
 */
export function BriefChat({ resume, onComposingChange }: { resume?: BriefState; onComposingChange?: (composing: boolean) => void }) {
  const [state, setState] = useState<BriefState | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const slot = state ? currentSlot(state.draft) : null;

  useEffect(() => {
    onComposingChange?.(state !== null);
  }, [state, onComposingChange]);

  useEffect(() => {
    if (slot && slot.name !== "sources" && slot.name !== "confirm") composer.current?.focus();
  }, [slot]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state?.messages.length, pending]);

  useEffect(() => {
    autoGrow(composer.current, 240);
  }, [text]);

  function run(work: () => Promise<{ ok: true; state: BriefState } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (result.ok) {
          setState(result.state);
          setText("");
        } else {
          setError(result.error);
        }
      } catch {
        setError("That didn’t reach the server — the file may be too large. Try again, or paste the text instead.");
      }
    });
  }

  function send(input: BriefInput) {
    if (state) run(() => briefTurn(state, input));
  }

  function upload(formData: FormData, form: HTMLFormElement) {
    if (!state) return;
    const file = formData.get("file");
    const isPdf = file instanceof File && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (file instanceof File && isPdf && file.size > MAX_CLIENT_PDF_BYTES) {
      setError(`That file is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${MAX_CLIENT_PDF_BYTES / 1_048_576} MB`);
      return;
    }
    if (file instanceof File && !isPdf && file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1_048_576} MB`);
      return;
    }
    run(async () => {
      let payload = formData;
      if (file instanceof File && isPdf) {
        try {
          const pages = await extractPdfPagesInBrowser(file);
          payload = new FormData();
          payload.set("pages", JSON.stringify(pages));
          payload.set("filename", file.name);
        } catch {
          if (file.size > MAX_UPLOAD_BYTES) {
            return { ok: false as const, error: "Could not read that PDF in the browser, and it’s too large to send — paste the text instead." };
          }
        }
      }
      const result = await addBriefSource(state, payload);
      if (result.ok) {
        track(ANALYTICS_EVENTS.sourceUploaded);
        form.reset();
      }
      return result;
    });
  }

  function discard() {
    if (!state) return;
    setError(null);
    startTransition(async () => {
      const result = await discardBrief(state.adventureId);
      if (result.error) setError(result.error);
      else setState(null);
    });
  }

  function create() {
    if (!state) return;
    setError(null);
    startTransition(async () => {
      track(ANALYTICS_EVENTS.adventureCreated);
      const result = await finishBrief(state);
      if (result?.error) setError(result.error);
    });
  }

  if (!state || !slot) {
    return (
      <Start
        resume={resume}
        pending={pending}
        error={error}
        onStart={() => run(startBrief)}
        onResume={() => resume && setState(resume)}
        onDiscard={() => {
          if (!resume) return;
          setError(null);
          startTransition(async () => {
            const result = await discardBrief(resume.adventureId);
            if (result.error) setError(result.error);
            else router.refresh();
          });
        }}
      />
    );
  }

  const key = slotKey(slot);
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant" && m.slot === key);
  const acceptLabel = lastAssistant?.proposal || lastAssistant?.proposedText ? "Use this" : lastAssistant?.proposedObjectives?.length ? "Use these" : null;
  const replies = quickReplies(state.draft, slot);
  const thinking = slot.name === "sources" ? "Reading your sources" : "Working out the next question";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl text-ink">New adventure</h2>
          <button type="button" onClick={discard} disabled={pending} className={button.subtle}>
            Discard this brief
          </button>
        </div>
        <Progress draft={state.draft} slot={slot} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ol className="flex flex-col gap-3 text-base" aria-live="polite">
          {state.messages.map((message, index) => (
            <li
              key={index}
              className={
                message.role === "user"
                  ? "ml-10 self-end rounded-surface rounded-br-sm bg-ink px-4 py-3 text-paper sm:ml-24"
                  : "mr-10 self-start rounded-surface rounded-bl-sm bg-sunken px-4 py-3 text-ink sm:mr-24"
              }
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.role === "assistant" && message.proposedText ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3 font-semibold">{message.proposedText}</p>
              ) : null}
              {message.role === "assistant" && message.proposal ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3">
                  <span className="font-semibold">{message.proposal.title}.</span> {message.proposal.focus}
                </p>
              ) : null}
              {message.role === "assistant" && message.proposedObjectives?.length ? (
                <ol className="mt-3 list-decimal space-y-1 border-l-2 border-line-strong pl-7">
                  {message.proposedObjectives.map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
          {pending ? (
            <li className="mr-10 self-start px-4 py-2 sm:mr-24">
              <Thinking label={thinking} />
            </li>
          ) : null}
        </ol>
        {slot.name === "sources" && state.sources.length > 0 ? <SourceList sources={state.sources} /> : null}
        {slot.name === "confirm" ? <SummaryRows state={state} pending={pending} onChange={(change) => send({ change })} /> : null}
        <div ref={endRef} />
      </div>

      <footer className="flex flex-col gap-3 border-t border-line pt-4">
        {error ? <ErrorText>{error}</ErrorText> : null}
        {slot.name === "confirm" ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={create} disabled={pending} className={button.primary}>
              {pending ? <Pending>Creating the adventure…</Pending> : "Create adventure"}
            </button>
          </div>
        ) : slot.name === "sources" ? (
          <SourceStep state={state} pending={pending} onUpload={upload} onDone={() => send({ text: SOURCES_DONE })} />
        ) : (
          <>
            {replies.length > 0 || acceptLabel ? (
              <div className="flex flex-wrap gap-2">
                {acceptLabel ? (
                  <Chip onClick={() => send({ accept: true })} disabled={pending} primary>
                    <Check className="h-4 w-4" aria-hidden /> {acceptLabel}
                  </Chip>
                ) : null}
                {replies.map((reply) => (
                  <Chip key={reply} onClick={() => send({ text: reply })} disabled={pending}>
                    {reply}
                  </Chip>
                ))}
              </div>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) send({ text });
              }}
            >
              <textarea
                ref={composer}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  autoGrow(event.currentTarget, 240);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (text.trim() && !pending) send({ text });
                  }
                }}
                rows={2}
                disabled={pending}
                placeholder={acceptLabel ? "Or type your own. Enter sends, Shift+Enter for a new line." : "Type your answer. Enter sends, Shift+Enter for a new line."}
                aria-label="Your answer"
                className={`${control} flex-1 resize-none`}
              />
              <button type="submit" disabled={pending || !text.trim()} className={button.primary}>
                {pending ? <Pending>Sending</Pending> : "Send"}
              </button>
            </form>
          </>
        )}
      </footer>
    </div>
  );
}

/** The composer grows with what is typed, up to a share of the viewport, instead of scrolling. */
function autoGrow(field: HTMLTextAreaElement | null, maxPx: number) {
  if (!field) return;
  field.style.height = "auto";
  const chrome = field.offsetHeight - field.clientHeight; // borders, which scrollHeight omits
  const cap = Math.min(maxPx, Math.round(window.innerHeight * 0.25));
  field.style.height = `${Math.min(field.scrollHeight + chrome, cap)}px`;
}

const STEP_LABELS: Record<string, string> = {
  sources: "Your source material",
  title: "A title",
  setting: "Where and when it takes place",
  studentRole: "Who the student plays",
  learningObjectives: "What students should be able to explain by the end",
  band: "Reading level",
  ages: "Age range",
  stageCount: "How many stages",
};

/** Before the first question: one line and a button, or the brief left unfinished last time. */
function Start({
  resume,
  pending,
  error,
  onStart,
  onResume,
  onDiscard,
}: {
  resume?: BriefState;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  if (resume) {
    const answered = Object.keys(resume.draft).length;
    const sources = resume.sources.length;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink">
          <span className="font-semibold">You have a brief half-done</span>
          <span className="text-muted">
            {" "}
            — {sources} source{sources === 1 ? "" : "s"} uploaded, {answered} question{answered === 1 ? "" : "s"} answered.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onResume} disabled={pending} className={button.primary}>
            Continue
          </button>
          <button type="button" onClick={onDiscard} disabled={pending} className={button.quiet}>
            {pending ? <Pending>Discarding</Pending> : "Discard and start over"}
          </button>
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">Bring the reading your students will play from. The rest is a few short questions.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onStart} disabled={pending} className={button.primary}>
          {pending ? <Pending>Starting</Pending> : "Start the brief"}
        </button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

/** What has been read in so far, listed above the dock. */
function SourceList({ sources }: { sources: BriefState["sources"] }) {
  return (
    <ul className="mt-3 flex flex-col divide-y divide-line border-y border-line text-base">
      {sources.map((source) => (
        <li key={source.id} className="flex items-baseline justify-between gap-4 py-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{source.title}</span>
          </span>
          <span className="shrink-0 text-muted">{source.pages} page{source.pages === 1 ? "" : "s"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The first question is a drop zone, not a text box: upload a file or paste a
 * passage, as many times as needed, then say they are all in.
 */
function SourceStep({
  state,
  pending,
  onUpload,
  onDone,
}: {
  state: BriefState;
  pending: boolean;
  onUpload: (formData: FormData, form: HTMLFormElement) => void;
  onDone: () => void;
}) {
  const [pasting, setPasting] = useState(false);
  const pasteField = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex flex-col gap-3 text-base">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPasting((p) => !p)} disabled={pending} className={button.quiet}>
          {pasting ? "Upload a file instead" : "Paste text instead"}
        </button>
        <Chip onClick={onDone} disabled={pending || state.sources.length === 0} primary>
          <Check className="h-4 w-4" aria-hidden /> {SOURCES_DONE}
        </Chip>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const fileInput = event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
          if (fileInput) fileInput.value = "";
          onUpload(formData, event.currentTarget);
        }}
      >
        {pasting ? (
          <textarea
            ref={pasteField}
            name="body"
            rows={3}
            placeholder="Paste the passage students will play from…"
            aria-label="Source text"
            disabled={pending}
            onInput={(event) => autoGrow(event.currentTarget, 240)}
            className={`${control} flex-1 resize-none`}
          />
        ) : (
          <input
            type="file"
            name="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            aria-label="PDF, .txt or .md"
            disabled={pending}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className={`${control} flex-1 file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1 file:text-sm file:font-semibold file:text-paper`}
          />
        )}
        {pasting ? (
          <button type="submit" disabled={pending} className={button.primary}>
            {pending ? <Pending>Reading</Pending> : "Add the passage"}
          </button>
        ) : pending ? (
          <span className={button.quiet}>
            <Pending>Reading</Pending>
          </span>
        ) : null}
      </form>
      {!pasting ? (
        <p className="text-sm text-muted">Any size PDF — the text is read here in your browser. A scanned PDF has no text layer; paste its text instead.</p>
      ) : null}
    </div>
  );
}

/**
 * The brief as a stepper: one segment per question, filled as it is answered.
 * Stage questions only appear once the teacher has said how many stages there are.
 */
function Progress({ draft, slot }: { draft: BriefState["draft"]; slot: Slot }) {
  const steps: { key: string; label: string; done: boolean }[] = Object.entries(STEP_LABELS).map(([k, label]) => ({
    key: k,
    label,
    done: draft[k as keyof typeof draft] !== undefined,
  }));
  for (let index = 0; index < (draft.stageCount ?? 0); index += 1) {
    steps.push({ key: `stage:${index}`, label: `What stage ${index + 1} is about`, done: Boolean(draft.stageOutline?.[index]) });
  }
  const current = slotKey(slot);
  const position = steps.findIndex((step) => step.key === current);
  const finished = slot.name === "confirm";
  const next = position >= 0 ? steps[position + 1] : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-base">
        {finished ? (
          <p className="font-semibold text-world">All {steps.length} questions answered</p>
        ) : (
          <>
            <p className="text-ink">
              <span className="font-semibold">Question {position + 1} of {steps.length}</span>
              {draft.stageCount === undefined ? <span className="text-muted">, then one per stage</span> : null}
            </p>
            <p className="text-muted">{next ? `Next: ${next.label.toLowerCase()}` : "Last one"}</p>
          </>
        )}
      </div>
      <ol className="flex gap-1" aria-label="Questions in the brief">
        {steps.map((step, index) => {
          const isCurrent = step.key === current;
          return (
            <li
              key={step.key}
              className={`h-1.5 flex-1 rounded-full transition-colors ${step.done ? "bg-world" : isCurrent ? "bg-ink" : "bg-line"}`}
              aria-current={isCurrent ? "step" : undefined}
              title={`${index + 1}. ${step.label}`}
            >
              <span className="sr-only">
                {index + 1}. {step.label}: {step.done ? "answered" : isCurrent ? "current" : "not yet"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SummaryRows({
  state,
  pending,
  onChange,
}: {
  state: BriefState;
  pending: boolean;
  onChange: (slotKey: string) => void;
}) {
  const { draft, sources } = state;
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "sources",
      label: "Sources",
      value: (
        <ul className="flex flex-col gap-0.5">
          {sources.map((source) => (
            <li key={source.id}>
              {source.title} <span className="text-muted">({source.pages} page{source.pages === 1 ? "" : "s"})</span>
            </li>
          ))}
        </ul>
      ),
    },
    { key: "title", label: "Title", value: draft.title },
    { key: "setting", label: "Setting", value: draft.setting },
    { key: "studentRole", label: "Student plays", value: draft.studentRole },
    {
      key: "learningObjectives",
      label: "Objectives",
      value: (
        <ul className="list-disc pl-4">
          {draft.learningObjectives?.map((objective) => <li key={objective}>{objective}</li>)}
        </ul>
      ),
    },
    { key: "band", label: "Reading level", value: draft.band ? READING_BAND_LABELS[draft.band] : null },
    { key: "ages", label: "Ages", value: draft.ages ? `${draft.ages.ageMin} to ${draft.ages.ageMax}` : null },
    { key: "stageCount", label: "Stages", value: draft.stageCount },
    ...(draft.stageOutline ?? []).map((stage, index) => ({
      key: `stage:${index}`,
      label: `Stage ${index + 1}`,
      value: stage ? (
        <>
          <span className="font-semibold">{stage.title}.</span> {stage.focus}
        </>
      ) : null,
    })),
  ];

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-line pt-4 text-base">
      <p className="text-muted">Everything below is settled. Change anything, then create the adventure.</p>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-3 py-2.5">
            <dt className="w-32 shrink-0 text-muted">{row.label}</dt>
            <dd className="flex-1 text-ink">{row.value}</dd>
            <button
              type="button"
              onClick={() => onChange(row.key)}
              disabled={pending}
              aria-label={`Change ${row.label.toLowerCase()}`}
              className="rounded-control p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  primary,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 w-fit items-center gap-1.5 rounded-control px-3.5 py-1.5 text-base font-semibold transition-colors disabled:opacity-60 ${
        primary
          ? "bg-ink text-paper hover:bg-record"
          : "border border-line-strong text-ink hover:border-ink hover:bg-surface"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
