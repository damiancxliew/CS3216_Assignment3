"use client";

import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { briefTurn, createAdventure } from "./actions";
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
  const [state, setState] = useState<BriefState>(initialBriefState);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex flex-col gap-4">
      <Progress draft={state.draft} slot={slot} />

      <ol className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {state.messages.map((message, index) => (
          <li
            key={index}
            className={
              message.role === "user"
                ? "ml-10 self-end rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-background"
                : "mr-10 self-start rounded-2xl rounded-bl-sm border border-black/10 px-4 py-2 dark:border-white/15"
            }
          >
            <p className="whitespace-pre-wrap">{message.text}</p>
            {message.role === "assistant" && message.proposal ? (
              <p className="mt-2 rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
                <span className="font-medium">{message.proposal.title}</span> — {message.proposal.focus}
              </p>
            ) : null}
            {message.role === "assistant" && message.proposedObjectives?.length ? (
              <ol className="mt-2 list-decimal space-y-1 rounded-lg bg-black/5 px-3 py-2 pl-7 text-xs dark:bg-white/10">
                {message.proposedObjectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
        {pending ? <li className="mr-10 self-start px-4 py-2 text-xs opacity-50">Thinking…</li> : null}
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
                  <Check className="h-3.5 w-3.5" aria-hidden /> {acceptLabel}
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
              placeholder="Type your answer… (Enter to send, Shift+Enter for a new line)"
              aria-label="Your answer"
              className="flex-1 resize-none rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground disabled:opacity-50 dark:border-white/20"
            />
            <button
              type="submit"
              disabled={pending || !text.trim()}
              className="inline-flex items-center rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  title: "Title",
  setting: "Setting",
  studentRole: "Role",
  learningObjectives: "Objectives",
  band: "Level",
  ages: "Ages",
  stageCount: "Stages",
};

/** One dot per question, so the teacher can see how long the conversation is. */
function Progress({ draft, slot }: { draft: BriefState["draft"]; slot: Slot }) {
  const steps: { key: string; label: string; done: boolean }[] = Object.entries(STEP_LABELS).map(([k, label]) => ({
    key: k,
    label,
    done: draft[k as keyof typeof draft] !== undefined,
  }));
  for (let index = 0; index < (draft.stageCount ?? 0); index += 1) {
    steps.push({ key: `stage:${index}`, label: `Stage ${index + 1}`, done: Boolean(draft.stageOutline?.[index]) });
  }
  const current = slotKey(slot);
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {steps.map((step) => (
        <li
          key={step.key}
          className={`flex items-center gap-1 ${step.key === current ? "font-medium" : step.done ? "opacity-70" : "opacity-40"}`}
          aria-current={step.key === current ? "step" : undefined}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${step.done ? "bg-foreground" : "border border-current"}`} aria-hidden />
          {step.label}
        </li>
      ))}
    </ol>
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
    { key: "ages", label: "Ages", value: draft.ages ? `${draft.ages.ageMin}–${draft.ages.ageMax}` : null },
    { key: "stageCount", label: "Stages", value: draft.stageCount },
    ...(draft.stageOutline ?? []).map((stage, index) => ({
      key: `stage:${index}`,
      label: `Stage ${index + 1}`,
      value: stage ? (
        <>
          <span className="font-medium">{stage.title}</span> — {stage.focus}
        </>
      ) : null,
    })),
  ];

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/10 p-5 text-sm dark:border-white/15">
      <dl className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-3 py-2">
            <dt className="w-28 shrink-0 opacity-60">{row.label}</dt>
            <dd className="flex-1">{row.value}</dd>
            <button
              type="button"
              onClick={() => onChange(row.key)}
              disabled={pending}
              aria-label={`Change ${row.label.toLowerCase()}`}
              className="rounded-full p-1 opacity-50 transition hover:bg-black/5 hover:opacity-100 disabled:opacity-30 dark:hover:bg-white/10"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        className="inline-flex w-fit items-center rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create adventure"}
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
      className={`inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-sm transition disabled:opacity-50 ${
        primary
          ? "bg-foreground text-background hover:opacity-90"
          : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
