"use client";

import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { briefTurn, createAdventure } from "./actions";
import { button, control, ErrorText, Pending, Thinking } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import {
  type BriefInput,
  type BriefState,
  currentSlot,
  initialBriefState,
  quickReplies,
  READING_BAND_LABELS,
  type Slot,
  slotKey,
} from "@/lib/brief/schema";

/**
 * The brief as a conversation. The order of questions is fixed on the server
 * (`currentSlot`); this component only renders the transcript, offers the
 * quick replies the current question allows, and shows the summary once
 * every slot is filled. All state lives here until the teacher creates the
 * adventure, so leaving the page discards the draft.
 */
export function BriefChat() {
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<BriefState>(initialBriefState);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (started) composer.current?.focus();
  }, [started]);

  const slot = currentSlot(state.draft);
  const key = slotKey(slot);
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant" && m.slot === key);
  const acceptLabel = lastAssistant?.proposal ? "Use this" : lastAssistant?.proposedObjectives?.length ? "Use these" : null;
  const replies = quickReplies(state.draft, slot);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.messages.length, pending]);

  function send(input: BriefInput) {
    setError(null);
    startTransition(async () => {
      const result = await briefTurn(state, input);
      if (result.ok) {
        setState(result.state);
        setText("");
      } else {
        setError(result.error);
      }
    });
  }

  function create() {
    setError(null);
    startTransition(async () => {
      track(ANALYTICS_EVENTS.adventureCreated);
      const result = await createAdventure(state);
      if (result?.error) setError(result.error);
    });
  }

  if (!started) return <Start onStart={() => setStarted(true)} />;

  return (
    <div className="flex flex-col gap-5">
      <Progress draft={state.draft} slot={slot} />

      <ol className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1 text-base" aria-live="polite">
        {state.messages.map((message, index) => (
          <li
            key={index}
            className={
              message.role === "user"
                ? "ml-10 self-end rounded-surface rounded-br-sm bg-ink px-4 py-3 text-paper"
                : "mr-10 self-start rounded-surface rounded-bl-sm bg-sunken px-4 py-3 text-ink"
            }
          >
            <p className="whitespace-pre-wrap">{message.text}</p>
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
          <li className="mr-10 self-start px-4 py-2">
            <Thinking label="Working out the next question" />
          </li>
        ) : null}
        <div ref={endRef} />
      </ol>

      {slot.name === "confirm" ? (
        <Summary state={state} pending={pending} onChange={(change) => send({ change })} onCreate={create} />
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
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (text.trim() && !pending) send({ text });
                }
              }}
              rows={2}
              disabled={pending}
              placeholder="Type your answer. Enter sends, Shift+Enter for a new line."
              aria-label="Your answer"
              className={`${control} flex-1 resize-none`}
            />
            <button type="submit" disabled={pending || !text.trim()} className={button.primary}>
              {pending ? <Pending>Sending</Pending> : "Send"}
            </button>
          </form>
        </>
      )}

      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  title: "A title",
  setting: "Where and when it takes place",
  studentRole: "Who the student plays",
  learningObjectives: "What students should be able to explain by the end",
  band: "Reading level",
  ages: "Age range",
  stageCount: "How many stages",
};

/** Before the first question: one line and a button. The questions reveal themselves as they come. */
function Start({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-base text-muted">A few short questions, about five minutes.</p>
      <button type="button" onClick={onStart} className={button.primary}>
        Start the brief
      </button>
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

function Summary({
  state,
  pending,
  onChange,
  onCreate,
}: {
  state: BriefState;
  pending: boolean;
  onChange: (slotKey: string) => void;
  onCreate: () => void;
}) {
  const { draft } = state;
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
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
    <div className="flex flex-col gap-4 border-t border-line pt-4 text-base">
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
      <button type="button" onClick={onCreate} disabled={pending} className={`${button.primary} w-fit`}>
        {pending ? <Pending>Creating the adventure…</Pending> : "Create adventure"}
      </button>
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-control px-3.5 py-1.5 text-base font-semibold transition-colors disabled:opacity-60 ${
        primary
          ? "bg-ink text-paper hover:bg-record"
          : "border border-line-strong text-ink hover:border-ink hover:bg-surface"
      }`}
    >
      {children}
    </button>
  );
}
