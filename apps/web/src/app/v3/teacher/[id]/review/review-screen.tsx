"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AdventureSpec,
  CheckIssue,
  SpecCitation,
  SpecSource,
} from "@adventure/spec-v3";
import { button } from "@/components/ui";
import { PASS_LABELS } from "@/lib/v3/generation/labels";
import {
  conditionText,
  documentSegments,
  issueTarget,
  reviewAnchor,
  reviewTargets,
  safeSourceUrl,
  type ReviewTab,
  type ReviewTarget,
} from "@/lib/v3/review";

const tabs: { id: ReviewTab; label: string }[] = [
  { id: "stages", label: "Stages" },
  { id: "characters", label: "Characters" },
  { id: "documents", label: "Documents" },
  { id: "endings", label: "Endings" },
];

function Block({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id ? reviewAnchor(id) : undefined}
      tabIndex={id ? -1 : undefined}
      className="scroll-mt-6 space-y-3 border-t border-line pt-5 first:border-0 first:pt-0"
    >
      <h3 className="text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-muted">{title}</h4>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function Citations({
  label,
  citations = [],
  sources,
}: {
  label?: string;
  citations?: SpecCitation[];
  sources: SpecSource[];
}) {
  return (
    <div className="space-y-2 text-sm">
      {label ? <p className="font-semibold">{label}</p> : null}
      {citations.length ? (
        <details className="rounded-surface border border-line p-3">
          <summary className="cursor-pointer font-semibold">
            Sources ({citations.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {citations.map((citation, i) => {
              const source = sources.find((s) => s.id === citation.sourceId);
              const url = safeSourceUrl(source?.url);
              return (
                <li key={`${citation.sourceId}-${i}`}>
                  <p>
                    {source
                      ? source.origin === "teacher"
                        ? "Teacher-provided source"
                        : "Outside source"
                      : "Source unavailable"}
                  </p>
                  {url ? (
                    <a
                      className="underline"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source?.title}
                    </a>
                  ) : (
                    <p className="font-semibold">
                      {source?.title ?? citation.sourceId}
                    </p>
                  )}
                  {citation.quote ? (
                    <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3">
                      {citation.quote}
                    </blockquote>
                  ) : (
                    <p className="text-muted">No quoted passage available.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : label ? (
        <p className="text-muted">No citations available.</p>
      ) : null}
    </div>
  );
}

export function ReviewScreen({
  spec,
  sources,
  errors,
  warnings,
}: {
  spec: AdventureSpec;
  sources: SpecSource[];
  errors: CheckIssue[];
  warnings: (CheckIssue & { pass: string })[];
}) {
  const [tab, setTab] = useState<ReviewTab>("stages");
  const [selected, setSelected] = useState(spec.stages[0]?.id ?? "");
  const [destination, setDestination] = useState<ReviewTarget | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => reviewTargets(spec), [spec]);
  const names = useMemo(
    () =>
      new Map([
        ...spec.stages.map((s) => [s.id, s.title] as const),
        ...spec.stages.flatMap((s) =>
          s.rooms.map((r) => [r.id, r.name] as const),
        ),
        ...spec.characters.map((c) => [c.id, c.name] as const),
        ...spec.documents.map((d) => [d.id, d.title] as const),
        ...spec.discoveries.map((d) => [d.id, d.topic || d.text] as const),
        ...spec.definingMoments.flatMap((m) => [
          ...m.acts.map((a) => [a.id, a.text] as const),
          ...m.outcomes.map((o) => [o.id, o.summary] as const),
        ]),
        ...spec.endings.map((e) => [e.id, e.title] as const),
        ...spec.characters.flatMap((c) =>
          c.stances.map((s) => [s.id, s.label] as const),
        ),
      ]),
    [spec],
  );
  const name = (id: string) => names.get(id) ?? id;
  const choose = (target: ReviewTarget) => {
    setTab(target.tab);
    setSelected(target.itemId);
    setDestination({ ...target });
  };
  useEffect(() => {
    if (!destination) return;
    const element =
      document.getElementById(destination.anchor) ?? detail.current;
    element?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    element?.focus({ preventScroll: true });
  }, [destination]);
  const link = (id: string) => {
    const target = targets.get(id);
    return target ? (
      <button
        type="button"
        className="text-left underline"
        onClick={() => choose(target)}
      >
        {name(id)}
      </button>
    ) : (
      name(id)
    );
  };
  const issueList = (issues: CheckIssue[]) => (
    <ul className="space-y-2">
      {issues.map((issue, i) => {
        const target = issueTarget(spec, issue, targets);
        return (
          <li key={i} className="text-sm">
            {target ? (
              <button
                type="button"
                onClick={() => choose(target)}
                className="text-left underline"
              >
                {issue.message}
              </button>
            ) : (
              issue.message
            )}
            <span className="ml-2 text-xs text-muted">{issue.code}</span>
          </li>
        );
      })}
    </ul>
  );
  const warningGroups = new Map<string, CheckIssue[]>();
  for (const warning of warnings)
    warningGroups.set(warning.pass, [
      ...(warningGroups.get(warning.pass) ?? []),
      warning,
    ]);
  const sourceSummary = (items: { citations?: SpecCitation[] }[]) => {
    const ids = [
      ...new Set(
        items.flatMap((item) => (item.citations ?? []).map((c) => c.sourceId)),
      ),
    ];
    return ids.length ? (
      <Citations
        citations={ids.map((sourceId) => ({ sourceId }))}
        sources={sources}
      />
    ) : (
      <p className="text-sm text-muted">
        No citations available for this item.
      </p>
    );
  };
  const items =
    tab === "characters"
      ? spec.characters.map((c) => ({ id: c.id, title: c.name }))
      : spec[tab].map((item) => ({ id: item.id, title: item.title }));
  const stage =
    tab === "stages" ? spec.stages.find((s) => s.id === selected) : undefined;
  const character =
    tab === "characters"
      ? spec.characters.find((c) => c.id === selected)
      : undefined;
  const doc =
    tab === "documents"
      ? spec.documents.find((d) => d.id === selected)
      : undefined;
  const ending =
    tab === "endings" ? spec.endings.find((e) => e.id === selected) : undefined;

  return (
    <div className="space-y-6 text-ink">
      <section
        className="space-y-3 rounded-surface border border-line bg-surface p-5"
        aria-labelledby="needs-fixing"
      >
        <h2 id="needs-fixing" className="text-xl font-bold">
          Needs fixing ({errors.length})
        </h2>
        {errors.length ? (
          issueList(errors)
        ) : (
          <p className="text-sm">No blocking errors.</p>
        )}
        {[...warningGroups].map(([pass, list]) => (
          <div key={pass}>
            <h3 className="mb-2 font-bold">
              {PASS_LABELS[pass as keyof typeof PASS_LABELS] ?? pass} warnings
            </h3>
            {issueList(list)}
          </div>
        ))}
        <h3 className="font-bold">Conflicts ({spec.conflicts.length})</h3>
        {spec.conflicts.length ? (
          <ul className="space-y-4">
            {spec.conflicts.map((conflict) => (
              <li key={conflict.id} className="space-y-2 text-sm">
                <Field title="Teacher brief">{conflict.teacherSays}</Field>
                <Field title="Source says">{conflict.sourceSays}</Field>
                <div className="flex flex-wrap gap-3">
                  {conflict.itemIds.map((id) => (
                    <span key={id}>{link(id)}</span>
                  ))}
                </div>
                <Citations
                  citations={[{ sourceId: conflict.sourceId }]}
                  sources={sources}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Conflict detection pending. No generated conflicts are available
            yet.
          </p>
        )}
      </section>
      <div
        role="tablist"
        aria-label="Adventure content"
        className="flex flex-wrap gap-2"
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="review-content"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? button.primary : button.subtle}
            onClick={() => {
              setTab(t.id);
              setSelected(spec[t.id][0]?.id ?? "");
            }}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (i + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (i + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              const t = tabs[next];
              setTab(t.id);
              setSelected(spec[t.id][0]?.id ?? "");
              document.getElementById(`tab-${t.id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="review-content"
        aria-labelledby={`tab-${tab}`}
        className="grid min-w-0 gap-5 md:grid-cols-[15rem_minmax(0,1fr)]"
      >
        <nav
          aria-label={`${tabs.find((t) => t.id === tab)?.label} items`}
          className="flex flex-col gap-2 self-start rounded-surface border border-line bg-surface p-3"
        >
          {items.length ? (
            items.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={selected === item.id ? "true" : undefined}
                className={`rounded-lg p-3 text-left text-sm ${selected === item.id ? "bg-sunken font-bold" : "hover:bg-sunken"}`}
                onClick={() => setSelected(item.id)}
              >
                {item.title}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted">No {tab}.</p>
          )}
        </nav>
        <div
          ref={detail}
          tabIndex={-1}
          className="min-w-0 space-y-6 break-words rounded-surface border border-line bg-surface p-5 [overflow-wrap:anywhere]"
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              aria-describedby="edit-coming-soon"
              className={button.subtle}
            >
              Edit
            </button>
            <span id="edit-coming-soon" className="text-sm text-muted">
              Coming soon
            </span>
          </div>
          {stage ? (
            <>
              <Block id={stage.id} title={stage.title}>
                <p>{stage.timePlace}</p>
                <Field title="Central question">{stage.centralQuestion}</Field>
                <Field title="Opening narration">
                  {stage.openingNarration}
                </Field>
                {sourceSummary([
                  ...spec.discoveries.filter((d) => d.stageId === stage.id),
                  ...spec.documents.filter(
                    (d) => d.id in stage.documentPlacement,
                  ),
                ])}
              </Block>
              <Block title="Rooms and placements">
                {stage.rooms.map((room) => (
                  <div
                    id={reviewAnchor(room.id)}
                    tabIndex={-1}
                    key={room.id}
                    className="scroll-mt-6 space-y-2"
                  >
                    <h4 className="font-bold">
                      {room.name}
                      {room.id === stage.startRoomId ? " · Start room" : ""}
                    </h4>
                    <p className="text-sm">{room.description}</p>
                    <p className="text-sm">
                      Characters:{" "}
                      {Object.entries(stage.placement)
                        .filter(([, roomId]) => roomId === room.id)
                        .map(([id]) => name(id))
                        .join(", ") || "None"}
                    </p>
                    <p className="text-sm">
                      Documents:{" "}
                      {Object.entries(stage.documentPlacement)
                        .filter(([, roomId]) => roomId === room.id)
                        .map(([id]) => name(id))
                        .join(", ") || "None"}
                    </p>
                  </div>
                ))}
                <Field title="Documents held at start">
                  {Object.entries(stage.documentPlacement)
                    .filter(([, room]) => room === "held")
                    .map(([id]) => name(id))
                    .join(", ") || "None"}
                </Field>
                {stage.situations.map((s, i) => (
                  <Field
                    key={i}
                    title={`Situation after ${s.whenOutcome.outcomeId}`}
                  >
                    <p>{s.openingNarration}</p>
                    <p>
                      Character placements:{" "}
                      {Object.entries(s.placement ?? {})
                        .map(([id, room]) => `${name(id)} → ${name(room)}`)
                        .join(", ") || "Unchanged"}
                    </p>
                    <p>
                      Document placements:{" "}
                      {Object.entries(s.documentPlacement ?? {})
                        .map(([id, room]) => `${name(id)} → ${name(room)}`)
                        .join(", ") || "Unchanged"}
                    </p>
                    <p>
                      Stances:{" "}
                      {Object.entries(s.stances ?? {})
                        .map(([id, stance]) => `${name(id)} → ${stance}`)
                        .join(", ") || "Unchanged"}
                    </p>
                  </Field>
                ))}
              </Block>
              <Block title="Discoveries">
                {spec.discoveries
                  .filter((d) => d.stageId === stage.id)
                  .map((d) => (
                    <Block key={d.id} id={d.id} title={d.topic || d.id}>
                      <p className="text-sm">
                        {d.core ? "Core discovery" : "Optional discovery"} ·
                        Held by{" "}
                        {"characterId" in d.holder
                          ? link(d.holder.characterId)
                          : link(d.holder.documentId)}
                      </p>
                      <Field title="Fact">{d.text}</Field>
                      <Field title="Student note">{d.note}</Field>
                      {d.condition ? (
                        <Field title="Unlock condition">
                          {conditionText(d.condition, name)}
                        </Field>
                      ) : null}
                      <Citations
                        label={d.sourceLabel}
                        citations={d.citations}
                        sources={sources}
                      />
                    </Block>
                  ))}
              </Block>
              <Block title="Events">
                {spec.storyEvents
                  .filter((e) => e.stageId === stage.id)
                  .map((e) => (
                    <Block key={e.id} id={e.id} title={e.effect}>
                      <p>{e.text}</p>
                      <Field title="When">
                        {"atSeconds" in e.when
                          ? `After ${e.when.atSeconds} seconds`
                          : "condition" in e.when
                            ? conditionText(e.when.condition, name)
                            : "stuck" in e.when
                              ? "When the student is stuck"
                              : "When time runs out"}
                      </Field>
                      {"characterId" in e && e.characterId ? (
                        <p>Character: {link(e.characterId)}</p>
                      ) : null}
                      {"documentId" in e ? (
                        <p>Document: {link(e.documentId)}</p>
                      ) : null}
                      {"toRoomId" in e ? (
                        <p>Destination: {name(e.toRoomId)}</p>
                      ) : null}
                    </Block>
                  ))}
              </Block>
              {spec.definingMoments
                .filter((m) => m.stageId === stage.id)
                .map((m) => (
                  <Block key={m.id} id={m.id} title="Defining moment">
                    <Field title="Decider">{link(m.deciderId)}</Field>
                    <Field title="Scene">{m.scene}</Field>
                    <Field title="Nudge">{m.nudge}</Field>
                    <Field title="Final call">{m.finalCallNarration}</Field>
                    {m.acts.map((a) => (
                      <Block key={a.id} id={a.id} title={a.text}>
                        <p>{a.reaction}</p>
                        {a.deception ? <p>Deception</p> : null}
                        {a.secret ? (
                          <Field title="Secret requirements">{`Meet ${a.secret.minMet} of: ${a.secret.unlock.map((c) => conditionText(c, name)).join("; ")}`}</Field>
                        ) : null}
                      </Block>
                    ))}
                    {m.outcomes.map((o) => (
                      <Block key={o.id} id={o.id} title={o.summary}>
                        <p>
                          {o.historical
                            ? "Historical outcome"
                            : "Alternative outcome"}
                          {o.secret ? " · Secret" : ""}
                        </p>
                        <Field title="Prediction">{o.predictionText}</Field>
                        <Field title="Because">{o.because}</Field>
                        {o.endingId ? <p>Ending: {link(o.endingId)}</p> : null}
                        {o.closesEndingIds.length ? (
                          <p>Closes: {o.closesEndingIds.join(", ")}</p>
                        ) : null}
                      </Block>
                    ))}
                    <Field title="Outcome rules">
                      {m.rules.map((r, i) => (
                        <p key={i}>
                          {m.acts.find((a) => a.id === r.actId)?.text ??
                            r.actId}{" "}
                          →{" "}
                          {m.outcomes.find((o) => o.id === r.outcomeId)
                            ?.summary ?? r.outcomeId}
                          {r.when ? ` when ${conditionText(r.when, name)}` : ""}
                        </p>
                      ))}
                    </Field>
                  </Block>
                ))}
            </>
          ) : null}
          {character ? (
            <>
              <Block id={character.id} title={character.name}>
                <p>
                  {character.title} · {character.tier} ·{" "}
                  {character.real
                    ? "Real historical person"
                    : "Invented character"}
                </p>
                {sourceSummary([
                  ...character.persona.phrases,
                  ...spec.discoveries.filter(
                    (d) =>
                      "characterId" in d.holder &&
                      d.holder.characterId === character.id,
                  ),
                ])}
              </Block>
              <Block title="Persona">
                {(
                  [
                    ["Voice", character.persona.voice],
                    ["Knew then", character.persona.knewThen],
                    [
                      "Wants from the student",
                      character.persona.wantsFromStudent,
                    ],
                    ["Public position", character.persona.publicPosition],
                    ["Private agenda", character.persona.privateAgenda],
                  ] as const
                ).map(([title, text]) => (
                  <Field key={title} title={title}>
                    {text}
                  </Field>
                ))}
                <Field title="Withholds">
                  {character.persona.withholds.join("\n")}
                </Field>
                {character.persona.phrases.map((phrase, i) => (
                  <div key={i} className="space-y-2">
                    <p>{phrase.text}</p>
                    <Citations
                      label={phrase.sourceLabel}
                      citations={phrase.citations}
                      sources={sources}
                    />
                  </div>
                ))}
              </Block>
              <Block title="Stances">
                {character.stances.map((s) => (
                  <Block key={s.id} id={s.id} title={s.label}>
                    <p>{s.demeanour}</p>
                    <p>
                      {s.id === character.initialStanceId
                        ? "Initial stance"
                        : ""}
                      {s.hidden ? " · Hidden" : ""}
                    </p>
                  </Block>
                ))}
              </Block>
              <Block title="Slants">
                {character.slants.map((s) => (
                  <Block key={s.id} id={s.id} title={s.claim}>
                    <div className="flex flex-wrap gap-3">
                      Contradicted by:{" "}
                      {s.contradictedBy.map((id) => (
                        <span key={id}>{link(id)}</span>
                      ))}
                    </div>
                    {s.unlocksDiscoveryId ? (
                      <p>Unlocks: {link(s.unlocksDiscoveryId)}</p>
                    ) : null}
                  </Block>
                ))}
              </Block>
              <Block title="Reactions and trust">
                {character.trustNotice ? <p>{character.trustNotice}</p> : null}
                {spec.triggers
                  .filter((t) => t.characterId === character.id)
                  .map((t) => (
                    <Block key={t.id} id={t.id} title={t.notice}>
                      <Field title="When">
                        {"notePassed" in t.on
                          ? `Pass on ${name(t.on.notePassed)}`
                          : "slantConfronted" in t.on
                            ? `Confront ${name(t.on.slantConfronted)}`
                            : `Discover ${name(t.on.discovered)}`}
                      </Field>
                      {t.requires ? (
                        <Field title="Requires">
                          {conditionText(t.requires, name)}
                        </Field>
                      ) : null}
                      <Field title="Effect">
                        {"toStance" in t.effect
                          ? `Change stance to ${name(t.effect.toStance)}`
                          : t.effect.stanceDelta > 0
                            ? "Gain one stance"
                            : "Lose one stance"}
                      </Field>
                      {t.handsOver?.length ? (
                        <p>Hands over: {t.handsOver.map(name).join(", ")}</p>
                      ) : null}
                    </Block>
                  ))}
              </Block>
            </>
          ) : null}
          {doc ? (
            <>
              <Block id={doc.id} title={doc.title}>
                <p>
                  {doc.kind} ·{" "}
                  {doc.real ? "Real historical document" : "Invented document"}
                </p>
                <p className="text-sm">
                  {Object.values(doc.provenance).filter(Boolean).join(" · ")}
                </p>
                <Citations
                  label={doc.sourceLabel}
                  citations={doc.citations}
                  sources={sources}
                />
              </Block>
              <Block title="Document text">
                <p className="text-sm text-muted">
                  Highlighted passages unlock discoveries.
                </p>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {documentSegments(doc).map((s) =>
                    s.passageIds.length ? (
                      <mark key={s.start} className="bg-amber-100 text-ink">
                        {s.text}
                      </mark>
                    ) : (
                      <span key={s.start}>{s.text}</span>
                    ),
                  )}
                </div>
              </Block>
              <Block title="Key passages">
                {doc.keyPassages.map((p) => (
                  <Block key={p.id} id={p.id} title={p.id}>
                    <blockquote>{doc.body.slice(p.start, p.end)}</blockquote>
                    {spec.discoveries
                      .filter(
                        (d) =>
                          "documentId" in d.holder &&
                          d.holder.documentId === doc.id &&
                          d.holder.keyPassageId === p.id,
                      )
                      .map((d) => (
                        <div key={d.id}>
                          <p>{link(d.id)}</p>
                          <p>{d.text}</p>
                          <Citations
                            label={d.sourceLabel}
                            citations={d.citations}
                            sources={sources}
                          />
                        </div>
                      ))}
                  </Block>
                ))}
              </Block>
              <Block title="Glossary">
                {doc.glossary.map((g, i) => (
                  <Field key={i} title={g.term}>
                    {g.meaning}
                  </Field>
                ))}
              </Block>
            </>
          ) : null}
          {ending ? (
            <>
              <Block id={ending.id} title={ending.title}>
                <p>{ending.type}</p>
                <Field title="Summary">{ending.summary}</Field>
                <Field title="Epilogue">{ending.epilogue}</Field>
                <Citations
                  label={ending.sourceLabel}
                  citations={ending.citations}
                  sources={sources}
                />
              </Block>
              <Block title="Interview">
                <Field title="Interviewer">
                  {ending.interview.interviewer}
                </Field>
                <Field title="Question">{ending.interview.question}</Field>
                {ending.interview.verdicts.map((v) => (
                  <Block key={v.id} id={v.id} title={v.text}>
                    <div className="flex flex-wrap gap-3">
                      Counterpoints:{" "}
                      {v.counterPoints.map((id) => (
                        <span key={id}>{link(id)}</span>
                      ))}
                    </div>
                  </Block>
                ))}
                <Field title="General counter">
                  {ending.interview.generalCounter}
                </Field>
              </Block>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
