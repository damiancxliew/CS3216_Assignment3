"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { saveReflection } from "@/app/play/[attemptId]/actions";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/posthog";
import {
  evidenceOptions,
  REFLECTION_PROMPTS,
  scaffoldFor,
  STANCES,
  STANCE_LABELS,
  turningPointOptions,
  type ReflectionAnswer,
  type ReflectionPromptKey,
} from "@/lib/attempts/reflection";
import type { Debrief } from "@/lib/attempts/debrief";
import styles from "./debrief-journal.module.css";

const COUNTER_LABEL = "What would someone who disagrees argue, and why are you still convinced?";

function responseBucket(length: number): "<50" | "50-149" | "150-399" | "400+" {
  if (length < 50) return "<50";
  if (length < 150) return "50-149";
  if (length < 400) return "150-399";
  return "400+";
}

function ReflectionCard({
  promptKey,
  index,
  debrief,
  answer,
  onSaved,
}: {
  promptKey: ReflectionPromptKey;
  index: number;
  debrief: Debrief;
  answer: ReflectionAnswer | undefined;
  onSaved: (answers: ReflectionAnswer[]) => void;
}) {
  const id = useId();
  const scaffold = scaffoldFor(promptKey, debrief.readingBand);
  const options = promptKey === "turning-point" ? turningPointOptions(debrief)
    : promptKey === "evidence" ? evidenceOptions(debrief) : [];
  const [choice, setChoice] = useState(answer?.choice ?? "");
  const [stance, setStance] = useState<ReflectionAnswer["stance"]>(answer?.stance ?? null);
  const [response, setResponse] = useState(answer?.response ?? "");
  const [counter, setCounter] = useState(answer?.counter ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(Boolean(answer));
  const [pending, startTransition] = useTransition();

  function changed() {
    setSaved(false);
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveReflection(debrief.attemptId, {
        promptKey,
        choice: choice || null,
        stance,
        response,
        counter: counter || null,
      });
      if (!result.ok) {
        setError(result.error);
        setSaved(false);
        return;
      }
      onSaved(result.answers);
      setError(null);
      setSaved(true);
      track(ANALYTICS_EVENTS.reflectionSubmitted, {
        promptKey,
        band: debrief.readingBand,
        lengthBucket: responseBucket(response.trim().length),
        hasCounter: Boolean(counter.trim()),
      });
    });
  }

  return (
    <article className={styles.reflectionCard}>
      <div className={styles.reflectionHeading}>
        <span className={styles.reflectionNumber} aria-hidden="true">{index + 1}</span>
        <h3>{REFLECTION_PROMPTS[promptKey].title}</h3>
      </div>
      <form className={styles.reflectionForm} onSubmit={submit}>
        {promptKey === "factor" ? (
          <div className={styles.reflectionField}>
            <label htmlFor={`${id}-choice`}>{REFLECTION_PROMPTS[promptKey].pickLabel}</label>
            <input
              id={`${id}-choice`}
              type="text"
              maxLength={60}
              value={choice}
              onChange={(event) => { setChoice(event.target.value); changed(); }}
            />
          </div>
        ) : null}

        {promptKey === "turning-point" || promptKey === "evidence" ? (
          options.length ? (
            <fieldset className={styles.reflectionField}>
              <legend>{REFLECTION_PROMPTS[promptKey].pickLabel}</legend>
              <div className={styles.reflectionOptions}>
                {options.map((option, optionIndex) => {
                  const optionId = `${id}-option-${optionIndex}`;
                  return (
                    <label key={option.id} htmlFor={optionId} className={styles.reflectionOption}>
                      <input
                        id={optionId}
                        type="radio"
                        name={`${id}-choice`}
                        value={option.id}
                        checked={choice === option.id}
                        onChange={() => { setChoice(option.id); changed(); }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : <p className="text-sm text-muted">{promptKey === "turning-point" ? "No decisions were recorded." : "No evidence was collected."}</p>
        ) : null}

        {promptKey === "inevitability" ? (
          <fieldset className={styles.reflectionField}>
            <legend>{REFLECTION_PROMPTS[promptKey].pickLabel}</legend>
            <div className={styles.reflectionStances}>
              {STANCES.map((item) => {
                const stanceId = `${id}-stance-${item}`;
                return (
                  <label key={item} htmlFor={stanceId} data-selected={stance === item} className={styles.reflectionStance}>
                    <input
                      id={stanceId}
                      type="radio"
                      name={`${id}-stance`}
                      value={item}
                      checked={stance === item}
                      onChange={() => { setStance(item); changed(); }}
                    />
                    {STANCE_LABELS[item]}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className={styles.reflectionField}>
          <label htmlFor={`${id}-response`}>Your answer</label>
          <textarea
            id={`${id}-response`}
            maxLength={2000}
            placeholder={scaffold.starter ?? "Your answer"}
            value={response}
            onChange={(event) => { setResponse(event.target.value); changed(); }}
            rows={4}
          />
          <span className={styles.reflectionGuidance}>At least 20 characters</span>
          {scaffold.hint ? <p className={styles.reflectionHint}>{scaffold.hint}</p> : null}
        </div>

        {scaffold.askCounter ? (
          <div className={styles.reflectionField}>
            <label htmlFor={`${id}-counter`}>{COUNTER_LABEL}</label>
            <textarea
              id={`${id}-counter`}
              maxLength={2000}
              placeholder="Your response"
              value={counter}
              onChange={(event) => { setCounter(event.target.value); changed(); }}
              rows={3}
            />
          </div>
        ) : null}

        <div className={styles.reflectionActions}>
          <button type="submit" disabled={pending} className={styles.reflectionSave}>
            {pending ? "Saving…" : "Save answer"}
          </button>
          {saved ? <span role="status" className={styles.reflectionSaved}>Saved</span> : null}
          {error ? <p role="alert" className={styles.reflectionError}>{error}</p> : null}
        </div>
      </form>
    </article>
  );
}

export function DebriefReflection({
  debrief,
  answers,
  onAnswersChange,
}: {
  debrief: Debrief;
  answers: ReflectionAnswer[];
  onAnswersChange: (answers: ReflectionAnswer[]) => void;
}) {
  const answerByKey = new Map(answers.map((answer) => [answer.promptKey, answer]));
  return (
    <div className={styles.reflectionList}>
      {(["factor", "turning-point", "evidence", "inevitability"] as const).map((key, index) => (
        <ReflectionCard
          key={key}
          promptKey={key}
          index={index}
          debrief={debrief}
          answer={answerByKey.get(key)}
          onSaved={onAnswersChange}
        />
      ))}
    </div>
  );
}
