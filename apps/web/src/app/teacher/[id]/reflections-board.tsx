"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";

import { button } from "@/components/ui";
import {
  REFLECTION_PROMPT_KEYS,
  REFLECTION_PROMPTS,
  STANCE_LABELS,
  type ReflectionSummary,
} from "@/lib/attempts/reflection";

type Filter = { kind: "attempts"; label: string; attemptIds: string[] } | { kind: "word"; label: string } | null;
type Tally = { label: string; count: number; attemptIds: string[] };

const CLOUD_COLORS = ["text-record", "text-world", "text-signal", "text-spark", "text-ink"];

/** Largest words in the middle, the rest alternating outwards, like a Mentimeter cloud. */
function centreOut<T>(items: T[]): T[] {
  const out: T[] = [];
  items.forEach((item, i) => (i % 2 === 0 ? out.push(item) : out.unshift(item)));
  return out;
}

function WordCloud({ words, large, selected, onSelect }: {
  words: { label: string; count: number }[];
  large?: boolean;
  selected: string | null;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(1, ...words.map((w) => w.count));
  const [minRem, maxRem] = large ? [1.75, 7] : [1, 3.75];
  return (
    <ul className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 ${large ? "px-6 py-10" : "px-2 py-6"}`}>
      {centreOut(words).map((word, index) => {
        const size = minRem + (maxRem - minRem) * Math.sqrt(word.count / max);
        const colour = CLOUD_COLORS[(word.label.length + index) % CLOUD_COLORS.length];
        const active = selected === word.label;
        const label = <span className="leading-none">{word.label}</span>;
        return (
          <li key={word.label}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(word.label)}
                aria-pressed={active}
                title={`${word.count} ${word.count === 1 ? "student" : "students"}`}
                className={`cursor-pointer rounded-control px-1.5 py-1 font-extrabold tracking-tight transition-transform hover:-translate-y-0.5 ${colour} ${active ? "bg-sunshine ring-2 ring-ink" : selected ? "opacity-40" : ""}`}
                style={{ fontSize: `${size}rem` }}
              >{label}</button>
            ) : (
              <span className={`font-extrabold tracking-tight ${colour}`} style={{ fontSize: `${size}rem` }}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Bars({ rows, total, large, selected, onSelect }: {
  rows: Tally[];
  total: number;
  large?: boolean;
  selected: string | null;
  onSelect?: (row: Tally) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((row) => {
        const share = total ? Math.round((row.count / total) * 100) : 0;
        const active = selected === row.label;
        const body = (
          <>
            <span className={`flex items-baseline justify-between gap-4 ${large ? "text-2xl" : "text-base"}`}>
              <span className="min-w-0 text-left font-semibold text-ink">{row.label}</span>
              <span className="shrink-0 font-extrabold tabular-nums text-ink">{row.count} <span className="font-semibold text-muted">· {share}%</span></span>
            </span>
            <span className={`mt-1.5 block overflow-hidden rounded-full bg-sunken ${large ? "h-6" : "h-3"}`}>
              <span className="block h-full rounded-full bg-record transition-[width] duration-500" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
          </>
        );
        return (
          <li key={row.label}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row)} aria-pressed={active}
                className={`block w-full cursor-pointer rounded-control px-3 py-2 transition-colors hover:bg-sunken/60 ${active ? "bg-sunshine/60 ring-2 ring-ink" : selected ? "opacity-50" : ""}`}>{body}</button>
            ) : <div className="px-3 py-2">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

const STANCE_COLOURS = { inevitable: "bg-danger", likely: "bg-signal", open: "bg-record", unlikely: "bg-world" } as const;

function StanceSplit({ summary, large, selected, onSelect }: {
  summary: ReflectionSummary;
  large?: boolean;
  selected: string | null;
  onSelect?: (row: Tally) => void;
}) {
  const total = summary.stances.reduce((n, s) => n + s.count, 0);
  if (!total) return <p className="text-muted">No judgements yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className={`flex w-full overflow-hidden rounded-full border-2 border-ink ${large ? "h-16" : "h-9"}`} role="img"
        aria-label={summary.stances.map((s) => `${s.label}: ${s.count}`).join(", ")}>
        {summary.stances.filter((s) => s.count > 0).map((s) => (
          <span key={s.stance} className={`${STANCE_COLOURS[s.stance]} flex items-center justify-center font-extrabold text-on-accent transition-[width] duration-500 ${large ? "text-2xl" : "text-sm"}`}
            style={{ width: `${(s.count / total) * 100}%` }}>{Math.round((s.count / total) * 100)}%</span>
        ))}
      </div>
      <ul className={`flex flex-wrap gap-2 ${large ? "justify-center" : ""}`}>
        {summary.stances.map((s) => {
          const row = { label: s.label, count: s.count, attemptIds: s.attemptIds };
          const active = selected === s.label;
          const content = <><span className={`h-3.5 w-3.5 rounded-full ${STANCE_COLOURS[s.stance]}`} aria-hidden />{s.label} · {s.count}</>;
          return (
            <li key={s.stance}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(row)} aria-pressed={active} disabled={!s.count}
                  className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-bold text-ink disabled:cursor-default disabled:opacity-40 ${active ? "border-ink bg-sunshine" : "border-line-strong bg-surface"}`}>{content}</button>
              ) : <span className={`inline-flex items-center gap-2 font-bold text-ink ${large ? "text-2xl" : "text-sm"}`}>{content}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const SLIDES = ["factors", "turning-point", "evidence", "inevitability", "keywords"] as const;
type Slide = typeof SLIDES[number];
const SLIDE_TITLES: Record<Slide, string> = {
  factors: REFLECTION_PROMPTS.factor.title,
  "turning-point": REFLECTION_PROMPTS["turning-point"].title,
  evidence: REFLECTION_PROMPTS.evidence.title,
  inevitability: REFLECTION_PROMPTS.inevitability.title,
  keywords: "The words the class used to explain itself",
};

function Presenter({ summary, onClose }: { summary: ReflectionSummary; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const slide = SLIDES[index]!;
  const go = useCallback((delta: number) => setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    const node = ref.current;
    node?.focus();
    if (node?.requestFullscreen) node.requestFullscreen().catch(() => undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); go(1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      else if (event.key === "Escape") onClose();
    };
    const onFullscreen = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [go, onClose]);

  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label="Class reflections"
      className="fixed inset-0 z-50 flex flex-col bg-paper outline-none">
      <div className="flex items-center justify-between gap-4 px-8 pt-6">
        <p className="text-sm font-bold uppercase tracking-[.15em] text-muted">Class reflections · {summary.respondents} {summary.respondents === 1 ? "student" : "students"}</p>
        <button type="button" onClick={onClose} className={button.subtle}><X className="h-4 w-4" aria-hidden />Close</button>
      </div>
      <h2 className="px-8 pt-4 text-center text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">{SLIDE_TITLES[slide]}</h2>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center overflow-auto px-8 py-6">
        {slide === "factors" ? (summary.factors.length
          ? <WordCloud large words={summary.factors.map((f) => ({ label: f.phrase, count: f.count }))} selected={null} />
          : <p className="text-center text-2xl text-muted">No factors named yet.</p>) : null}
        {slide === "turning-point" ? (summary.turningPoints.length
          ? <Bars large rows={summary.turningPoints} total={summary.turningPoints.reduce((n, r) => n + r.count, 0)} selected={null} />
          : <p className="text-center text-2xl text-muted">No turning points chosen yet.</p>) : null}
        {slide === "evidence" ? (summary.evidence.length
          ? <Bars large rows={summary.evidence} total={summary.evidence.reduce((n, r) => n + r.count, 0)} selected={null} />
          : <p className="text-center text-2xl text-muted">No evidence chosen yet.</p>) : null}
        {slide === "inevitability" ? <StanceSplit large summary={summary} selected={null} /> : null}
        {slide === "keywords" ? (summary.keywords.length
          ? <WordCloud large words={summary.keywords.map((k) => ({ label: k.word, count: k.count }))} selected={null} />
          : <p className="text-center text-2xl text-muted">No explanations yet.</p>) : null}
      </div>
      <div className="flex items-center justify-center gap-4 pb-8">
        <button type="button" onClick={() => go(-1)} className={button.quiet} aria-label="Previous"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
        <ol className="flex gap-2" aria-label="Slides">
          {SLIDES.map((s, i) => (
            <li key={s}><button type="button" onClick={() => setIndex(i)} aria-current={i === index ? "step" : undefined} aria-label={SLIDE_TITLES[s]}
              className={`h-3 w-3 cursor-pointer rounded-full ${i === index ? "bg-ink" : "bg-line-strong"}`} /></li>
          ))}
        </ol>
        <button type="button" onClick={() => go(1)} className={button.quiet} aria-label="Next"><ChevronRight className="h-5 w-5" aria-hidden /></button>
      </div>
    </div>
  );
}

function Panel({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-surface border border-line bg-surface p-5">
      <div>
        <h3 className="text-lg font-extrabold tracking-tight text-ink">{title}</h3>
        {lede ? <p className="text-sm text-muted">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ReflectionsBoard({ summary, studentNames }: { summary: ReflectionSummary; studentNames: Record<string, string> }) {
  const [filter, setFilter] = useState<Filter>(null);
  const [presenting, setPresenting] = useState(false);
  const close = useCallback(() => setPresenting(false), []);

  const toggleAttempts = (row: Tally) =>
    setFilter((f) => (f?.kind === "attempts" && f.label === row.label ? null : { kind: "attempts", label: row.label, attemptIds: row.attemptIds }));
  const toggleWord = (word: string) => setFilter((f) => (f?.kind === "word" && f.label === word ? null : { kind: "word", label: word }));

  const answers = useMemo(() => {
    if (!filter) return summary.answers;
    if (filter.kind === "attempts") return summary.answers.filter((a) => filter.attemptIds.includes(a.attemptId));
    const pattern = new RegExp(`\\b${filter.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return summary.answers.filter((a) => Object.values(a.byKey).some((answer) => answer && pattern.test(`${answer.response} ${answer.counter ?? ""}`)));
  }, [filter, summary.answers]);

  const selected = filter?.label ?? null;
  const total = (rows: Tally[]) => rows.reduce((n, r) => n + r.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-base text-muted">
          <span className="font-extrabold text-ink">{summary.respondents}</span> {summary.respondents === 1 ? "student has" : "students have"} reflected · <span className="font-extrabold text-ink">{summary.complete}</span> answered all four. Click any word or bar to read those answers.
        </p>
        <button type="button" onClick={() => setPresenting(true)} className={button.quiet}><Maximize2 className="h-4 w-4" aria-hidden />Present to class</button>
      </div>

      <Panel title={REFLECTION_PROMPTS.factor.title} lede="Bigger words were named by more students.">
        {summary.factors.length
          ? <WordCloud words={summary.factors.map((f) => ({ label: f.phrase, count: f.count }))} selected={filter?.kind === "attempts" ? selected : null}
              onSelect={(label) => { const f = summary.factors.find((x) => x.phrase === label); if (f) toggleAttempts({ label, count: f.count, attemptIds: f.attemptIds }); }} />
          : <p className="text-muted">No factors named yet.</p>}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={REFLECTION_PROMPTS["turning-point"].title}>
          {summary.turningPoints.length ? <Bars rows={summary.turningPoints} total={total(summary.turningPoints)} selected={selected} onSelect={toggleAttempts} /> : <p className="text-muted">No turning points chosen yet.</p>}
        </Panel>
        <Panel title={REFLECTION_PROMPTS.evidence.title}>
          {summary.evidence.length ? <Bars rows={summary.evidence} total={total(summary.evidence)} selected={selected} onSelect={toggleAttempts} /> : <p className="text-muted">No evidence chosen yet.</p>}
        </Panel>
      </div>

      <Panel title={REFLECTION_PROMPTS.inevitability.title}>
        <StanceSplit summary={summary} selected={selected} onSelect={toggleAttempts} />
      </Panel>

      <Panel title="Words students used in their explanations" lede="Counted once per student. Common words are left out.">
        {summary.keywords.length
          ? <WordCloud words={summary.keywords.map((k) => ({ label: k.word, count: k.count }))} selected={filter?.kind === "word" ? selected : null} onSelect={toggleWord} />
          : <p className="text-muted">No explanations yet.</p>}
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="reflection-answers">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="reflection-answers" className="text-lg font-extrabold tracking-tight text-ink">
            {filter ? `${answers.length} ${answers.length === 1 ? "student" : "students"}: “${filter.label}”` : "Every student's answers"}
          </h3>
          {filter ? <button type="button" onClick={() => setFilter(null)} className={button.subtle}><X className="h-4 w-4" aria-hidden />Clear filter</button> : null}
        </div>
        {answers.length ? (
          <ul className="flex flex-col gap-3">
            {answers.map((attempt) => (
              <li key={attempt.attemptId}>
                <details className="group rounded-surface border border-line bg-surface" open={Boolean(filter)}>
                  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <span className="font-semibold text-ink">{studentNames[attempt.attemptId] ?? `Student ${attempt.attemptId.slice(0, 8)}`}</span>
                    <span className="text-sm text-muted">{Object.keys(attempt.byKey).length} of 4 answered · {new Date(attempt.updatedAt).toLocaleString()}</span>
                  </summary>
                  <dl className="flex flex-col gap-4 border-t border-line px-4 py-4">
                    {REFLECTION_PROMPT_KEYS.map((key) => {
                      const answer = attempt.byKey[key];
                      return (
                        <div key={key}>
                          <dt className="text-sm font-bold text-muted">{REFLECTION_PROMPTS[key].title}</dt>
                          {answer ? (
                            <dd className="mt-1 flex flex-col gap-1.5 text-ink">
                              {answer.choiceLabel || answer.stance ? (
                                <p className="font-semibold">{answer.stance ? STANCE_LABELS[answer.stance] : answer.choiceLabel}</p>
                              ) : null}
                              <p className="whitespace-pre-line">{answer.response}</p>
                              {answer.counter ? <p className="whitespace-pre-line border-l-2 border-line-strong pl-3 text-muted"><span className="font-semibold">Counter-argument: </span>{answer.counter}</p> : null}
                            </dd>
                          ) : <dd className="mt-1 text-muted">Not answered.</dd>}
                        </div>
                      );
                    })}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">No answers match.</p>}
      </section>

      {presenting ? <Presenter summary={summary} onClose={close} /> : null}
    </div>
  );
}
