"use client";

import React, {
  useLayoutEffect,
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
import { FieldIssueProvider } from "./field-issues";
import { ReviewIssue } from "@/components/teacher/review-issue";
import {
  reviewNames,
  REVIEW_PASS_LABELS,
  REVIEW_EVENT_LABELS,
} from "@/lib/v3/review-presentation";
import {
  conditionText,
  documentSegments,
  issueTarget,
  reviewAnchor,
  reviewStanceId,
  reviewIndex,
  reviewDiscoveryTitle,
  reviewSectionId,
  type ReviewIndexEntry,
  reviewTargets,
  safeSourceUrl,
  type ReviewTab,
  type ReviewTarget,
} from "@/lib/v3/review";

type ScreenTab = ReviewTab | "assets";

const tabs: { id: ReviewTab; label: string }[] = [
  { id: "stages", label: "Stages" },
  { id: "characters", label: "Characters" },
  { id: "documents", label: "Documents" },
  { id: "endings", label: "Endings" },
  { id: "settings", label: "Settings" },
  { id: "reveal", label: "Reveal and questions" },
];

function Block({
  id,
  title,
  reference,
  children,
  card = false,
}: {
  id?: string;
  title: string;
  reference?: string;
  children: ReactNode;
  card?: boolean;
}) {
  return (
    <section
      id={id ? reviewAnchor(id) : undefined}
      tabIndex={id ? -1 : undefined}
      className={
        card
          ? "scroll-mt-4 space-y-4 rounded-surface border border-line bg-surface p-5 shadow-[0_2px_10px_rgb(0_0_0/0.10)] sm:p-6"
          : "scroll-mt-4 space-y-3 border-t border-line pt-5 first:border-0 first:pt-0"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-bold">{title}</h3>
        {reference ? (
          <code className="break-all text-xs font-normal text-muted">
            {reference}
          </code>
        ) : null}
      </div>
      {children}
    </section>
  );
}
function Card(props: { id?: string; title: string; children: ReactNode }) {
  return <Block {...props} card />;
}

function IndexBranch({
  entries,
  activeAnchor,
  onChoose,
}: {
  entries: ReviewIndexEntry[];
  activeAnchor: string;
  onChoose: (id: string) => void;
}) {
  return (
    <ul className="ml-3 space-y-1 border-l border-line pl-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onChoose(entry.id)}
            aria-controls={reviewAnchor(entry.id)}
            aria-current={
              activeAnchor === reviewAnchor(entry.id) ? "location" : undefined
            }
            className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-sunken ${activeAnchor === reviewAnchor(entry.id) ? "bg-sunken font-bold text-ink" : "text-muted"}`}
          >
            <span className="line-clamp-2">{entry.label}</span>
          </button>
          {entry.children?.length ? (
            <IndexBranch
              entries={entry.children}
              activeAnchor={activeAnchor}
              onChoose={onChoose}
            />
          ) : null}
        </li>
      ))}
    </ul>
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
                  {source ? (
                    <p>
                      {source.origin === "teacher"
                        ? "Teacher-provided source"
                        : "Outside source"}
                    </p>
                  ) : null}
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
                    <div className="flex flex-wrap items-baseline gap-3">
                      <p className="font-semibold">
                        {source?.title ?? "Source unavailable"}
                      </p>
                      {!source ? (
                        <code className="text-xs text-muted">
                          {citation.sourceId}
                        </code>
                      ) : null}
                    </div>
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
  editMode = false,
  renderEditor,
  allowedTabs,
  indexEntries,
  checksPassedLabel = "Checks passed",
  renderHeader,
  onEditIssue,
  sidebar,
  floatingChecks = false,
  issueActions,
  assets,
}: {
  checksPassedLabel?: string;
  renderHeader?: (checks: ReactNode) => ReactNode;
  onEditIssue?: () => void;
  sidebar?: ReactNode;
  floatingChecks?: boolean;
  issueActions?: ReactNode;
  assets?: ReactNode;
  allowedTabs?: ReviewTab[];
  indexEntries?: (tab: ReviewTab, itemId: string) => ReviewIndexEntry[];
  editMode?: boolean;
  renderEditor?: (tab: ReviewTab, selected: string) => ReactNode;
  spec: AdventureSpec;
  sources: SpecSource[];
  errors: CheckIssue[];
  warnings: (CheckIssue & { pass: string })[];
}) {
  const visibleTabs: { id: ScreenTab; label: string }[] = [
    ...tabs.filter((t) => !allowedTabs || allowedTabs.includes(t.id)),
    ...(assets ? [{ id: "assets" as const, label: "Generated assets" }] : []),
  ];
  const [tab, setTab] = useState<ScreenTab>(allowedTabs?.[0] ?? "stages");
  const [selection, setSelection] = useState<Record<ScreenTab, string>>(() => ({
    stages: spec.stages[0]?.id ?? "",
    characters: spec.characters[0]?.id ?? "",
    documents: spec.documents[0]?.id ?? "",
    endings: spec.endings[0]?.id ?? "",
    settings: "settings",
    reveal: "reveal",
    assets: "assets",
  }));
  const tabItems =
    tab === "assets" || tab === "settings" || tab === "reveal" ? [{ id: tab }] : spec[tab];
  const selected = tabItems.some((item) => item.id === selection[tab])
    ? selection[tab]
    : (tabItems[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [activeAnchor, setActiveAnchor] = useState(reviewAnchor(selected));
  const [destination, setDestination] = useState<(ReviewTarget & { fieldPath?: string }) | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const checksDisclosure = useRef<HTMLDetailsElement>(null);
  const targets = useMemo(() => reviewTargets(spec), [spec]);
  const names = useMemo(() => reviewNames(spec), [spec]);
  const name = (id: string) =>
    id === "settings" ? "Settings" : id === "reveal" ? "Reveal and questions" :
      names.get(id) ?? "Unavailable item";
  const choose = (target: ReviewTarget & { fieldPath?: string }) => {
    if (allowedTabs && !allowedTabs.includes(target.tab)) return;
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(`${target.tab}:${target.itemId}`);
      return next;
    });
    setTab(target.tab);
    setSelection((current) => ({ ...current, [target.tab]: target.itemId }));
    setActiveAnchor(target.anchor);
    setDestination({ ...target });
  };
  // Keep content-length changes inside the workspace; cancel any in-flight scroll
  // before the new selection paints instead of moving the page's scroll position.
  useLayoutEffect(() => {
    detail.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, selected]);
  useLayoutEffect(() => {
    if (!destination || !detail.current) return;
    const container = detail.current;
    const field = destination.fieldPath
      ? [...container.querySelectorAll<HTMLElement>("[data-edit-path]")]
          .filter((node) =>
            destination.fieldPath === node.dataset.editPath ||
            destination.fieldPath?.startsWith(node.dataset.editPath + "."),
          )
          .sort((a, b) =>
            (b.dataset.editPath?.length ?? 0) - (a.dataset.editPath?.length ?? 0),
          )[0]
      : undefined;
    const element = field ?? document.getElementById(destination.anchor);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "instant"
      : "smooth";
    if (element && container.contains(element)) {
      const top =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        12;
      container.scrollTo({ top, behavior });
      const control = destination.fieldPath && editMode
        ? element.querySelector<HTMLElement>(
            "textarea, input, button[role=combobox], select",
          )
        : null;
      (control ?? element).focus({ preventScroll: true });
    } else {
      container.focus({ preventScroll: true });
    }
    container.scrollIntoView({ block: "nearest", behavior });
  }, [destination, editMode]);
  const activateTab = (next: ScreenTab) => {
    if (next === tab) return;
    setDestination(null);
    setTab(next);
    setActiveAnchor(reviewAnchor(selection[next]));
  };
  const link = (id: string) => {
    const target = targets.get(id);
    return target && (!allowedTabs || allowedTabs.includes(target.tab)) ? (
      <button
        type="button"
        className="text-left underline"
        onClick={() => choose(target)}
      >
        {name(id)}
      </button>
    ) : (
      <span className="inline-flex flex-wrap items-baseline gap-2">
        {name(id)}
        {!names.has(id) ? (
          <code className="text-xs text-muted">{id}</code>
        ) : null}
      </span>
    );
  };
  const issueList = (issues: CheckIssue[], expandFirst = false) => (
    <ul className="space-y-2">
      {issues.map((issue, i) => {
        const target = issueTarget(spec, issue, targets);
        return (
          <li key={i} className="text-sm">
            <ReviewIssue
              issue={issue}
              expanded={expandFirst && i === 0}
              onSelect={
                target && (!allowedTabs || allowedTabs.includes(target.tab))
                  ? () => {
                      if (floatingChecks && checksDisclosure.current)
                        checksDisclosure.current.open = false;
                      onEditIssue?.();
                      choose({ ...target, fieldPath: issue.path.replace(/\[(\d+)\]/g, ".$1") });
                    }
                  : undefined
              }
              location={target ? name(target.itemId) : undefined}
            />
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
    tab === "assets" || tab === "settings" || tab === "reveal"
      ? [
          {
            id: tab,
            title: tab === "settings" ? "Settings" : "Reveal and questions",
          },
        ]
      : tab === "characters"
        ? spec.characters.map((c) => ({ id: c.id, title: name(c.id) }))
        : spec[tab].map((item) => ({ id: item.id, title: name(item.id) }));
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

  const checkDetails = (
    <>
      <h2
        id="needs-fixing"
        className={`text-xl font-bold ${errors.length ? "text-ink" : "text-world"}`}
      >
        {errors.length
          ? `Needs fixing (${errors.length})`
          : checksPassedLabel}
      </h2>
      {errors.length ? issueList(errors, floatingChecks) : null}
      {warnings.length || spec.conflicts.length ? (
        <details open={errors.length ? true : undefined} className="text-sm">
          <summary className="w-fit cursor-pointer font-semibold">
            View details
          </summary>
          <div className="mt-4 space-y-4">
            {[...warningGroups].map(([pass, list]) => (
              <div key={pass}>
                <h3 className="mb-2 font-bold">
                  {REVIEW_PASS_LABELS[pass] ?? "Other checks"} warnings
                </h3>
                {issueList(list)}
              </div>
            ))}
            {spec.conflicts.length ? (
              <>
                <h3 className="font-bold">
                  Conflicts ({spec.conflicts.length})
                </h3>
                <ul className="space-y-4">
                  {spec.conflicts.map((conflict) => (
                    <li key={conflict.id} className="space-y-2 text-sm">
                      <Field title="Teacher brief">
                        {conflict.teacherSays}
                      </Field>
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
              </>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
  const checks = floatingChecks && !errors.length && !warnings.length && !spec.conflicts.length ? (
    <p className="px-3 py-2 text-sm font-semibold text-muted">No issues</p>
  ) : renderHeader || floatingChecks ? (
    <details
      ref={checksDisclosure}
      aria-label="Adventure checks"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !floatingChecks) return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      className={floatingChecks ? "relative text-sm" : "rounded-control border border-line bg-surface p-3 text-sm"}
    >
      <summary className={floatingChecks ? "cursor-pointer whitespace-nowrap rounded-control px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" : "cursor-pointer font-semibold"}>
        {errors.length
          ? `${errors.length} ${errors.length === 1 ? "issue" : "issues"} to fix`
          : checksPassedLabel}
        {warnings.length ? ` · ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}
        {spec.conflicts.length ? ` · ${spec.conflicts.length} conflicts` : ""}
      </summary>
      <div className={floatingChecks ? "absolute bottom-full right-0 mb-4 max-h-[min(60dvh,32rem)] w-[min(32rem,calc(100vw-2rem))] space-y-3 overflow-y-auto overscroll-contain rounded-surface border border-line-strong bg-surface p-4 text-ink shadow-lg" : "mt-3 max-h-72 space-y-3 overflow-y-auto overscroll-contain pr-2"}>
        {checkDetails}
      </div>
    </details>
  ) : (
    <section
      className={`space-y-3 rounded-surface border p-5 ${errors.length ? "border-line bg-surface" : "border-world/30 bg-world-wash"}`}
      aria-labelledby="needs-fixing"
    >
      {checkDetails}
    </section>
  );
  return (
    <div data-review-screen className="space-y-6 text-ink">
      {renderHeader ? renderHeader(floatingChecks ? null : checks) : floatingChecks ? null : checks}
      {floatingChecks ? (
        <aside aria-label="Adventure issue controls" className="fixed bottom-5 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-surface border border-line bg-paper p-2 shadow-lg sm:right-6">
          {checks}
          {issueActions}
        </aside>
      ) : null}
      <div
        data-review-workspace
        className="min-h-dvh space-y-5 md:flex md:h-dvh md:flex-col md:gap-5 md:space-y-0 md:pb-4"
      >
        <div
          role="tablist"
          aria-label="Adventure content"
          className="flex shrink-0 w-fit max-w-full flex-wrap gap-2 rounded-[1.75rem] bg-paper/95 p-2 shadow-[0_2px_10px_rgb(0_0_0/0.10)] backdrop-blur-sm"
        >
          {visibleTabs.map((t, i) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="review-content"
              tabIndex={tab === t.id ? 0 : -1}
              className={`inline-flex h-10 items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition-colors motion-reduce:transition-none ${tab === t.id ? "border-ink bg-signal text-on-signal" : "border-line bg-surface text-muted hover:border-ink hover:text-ink"}`}
              onClick={() => activateTab(t.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (i + 1) % visibleTabs.length
                    : event.key === "ArrowLeft"
                      ? (i + visibleTabs.length - 1) % visibleTabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? visibleTabs.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                const t = visibleTabs[next];
                activateTab(t.id);
                document
                  .getElementById(`tab-${t.id}`)
                  ?.focus({ preventScroll: true });
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
          className={tab === "assets" ? "min-w-0" : `grid min-w-0 gap-5 md:grid-cols-[16rem_minmax(0,1fr)] ${sidebar ? "xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(20rem,0.9fr)_15rem_minmax(0,2fr)]" : "md:min-h-0 md:flex-1"}`}
        >
          {tab === "assets" ? assets : <>
          {sidebar ? <div className="min-h-0 min-w-0 md:col-span-2 xl:col-span-1">{sidebar}</div> : null}
          <nav
            aria-label={`${tabs.find((t) => t.id === tab)?.label} items`}
            className="h-56 min-w-0 overflow-y-auto overscroll-contain rounded-surface border border-line bg-surface p-3 shadow-[0_2px_10px_rgb(0_0_0/0.10)] [scrollbar-gutter:stable] md:h-full"
          >
            <h2 className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted">
              Index
            </h2>
            {items.length ? (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={selected === item.id ? "true" : undefined}
                      aria-expanded={
                        selected === item.id &&
                        !collapsed.has(`${tab}:${item.id}`)
                      }
                      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected === item.id ? "bg-sunken font-bold" : "hover:bg-sunken"}`}
                      onClick={() => {
                        if (selected === item.id) {
                          setCollapsed((current) => {
                            const next = new Set(current);
                            const key = `${tab}:${item.id}`;
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        } else {
                          choose({
                            tab,
                            itemId: item.id,
                            anchor: reviewAnchor(item.id),
                          });
                        }
                      }}
                    >
                      <span aria-hidden className="mt-0.5 shrink-0 text-muted">
                        {selected === item.id &&
                        !collapsed.has(`${tab}:${item.id}`)
                          ? "▾"
                          : "▸"}
                      </span>
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {item.title}
                      </span>
                    </button>
                    {selected === item.id &&
                    !collapsed.has(`${tab}:${item.id}`) ? (
                      <div className="my-2">
                        <IndexBranch
                          entries={
                            indexEntries
                              ? indexEntries(tab, item.id)
                              : reviewIndex(spec, tab, item.id)
                          }
                          activeAnchor={activeAnchor}
                          onChoose={(id) =>
                            choose({
                              tab,
                              itemId: item.id,
                              anchor: reviewAnchor(id),
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted">No {tab}.</p>
            )}
          </nav>
          <div
            ref={detail}
            data-review-scroll
            tabIndex={-1}
            role="region"
            aria-label="Review details"
            className="h-[clamp(28rem,72dvh,56rem)] min-w-0 space-y-5 overflow-y-auto overscroll-contain break-words p-1 [overflow-anchor:none] [overflow-wrap:anywhere] [scrollbar-gutter:stable] md:h-full"
          >
            <React.Fragment key={`${tab}:${selected}`}>
              {editMode && renderEditor ? (
                <FieldIssueProvider value={errors}>
                  {renderEditor(tab, selected)}
                </FieldIssueProvider>
              ) : (
                <>
                  {tab === "settings" ? (
                    <Card title="Settings">
                      <Field title="Title">{spec.title}</Field>
                      <Field title="Reading level">{spec.readingLevel}</Field>
                      <Field title="Timer">
                        {spec.timer.enabled
                          ? spec.timer.stageMinutes.join(", ") + " minutes"
                          : "Disabled"}
                      </Field>
                      <Field title="Source policy">
                        {spec.authoring?.sourcePolicy?.allowAny
                          ? "Any public source"
                          : "Default allowed domains and teacher additions"}
                      </Field>
                    </Card>
                  ) : null}
                  {tab === "reveal" ? (
                    <Card title="Reveal and questions">
                      {Object.entries(spec.reveal ?? {}).map(([key, value]) => (
                        <Field key={key} title={key}>
                          {Array.isArray(value) ? value.join("\n") : value}
                        </Field>
                      ))}
                      <Field title="Teacher questions">
                        {spec.teacherQuestions.join("\n") ||
                          "No teacher questions."}
                      </Field>
                    </Card>
                  ) : null}
                  {stage ? (
                    <>
                      <Card id={stage.id} title={name(stage.id)}>
                        <p>{stage.timePlace}</p>
                        <Field title="Central question">
                          {stage.centralQuestion}
                        </Field>
                        <Field title="Opening narration">
                          {stage.openingNarration}
                        </Field>
                        {sourceSummary([
                          ...spec.discoveries.filter(
                            (d) => d.stageId === stage.id,
                          ),
                          ...spec.documents.filter(
                            (d) => d.id in stage.documentPlacement,
                          ),
                        ])}
                      </Card>
                      <Card
                        id={reviewSectionId(stage.id, "rooms")}
                        title="Rooms and placements"
                      >
                        {stage.rooms.map((room) => (
                          <div
                            id={reviewAnchor(room.id)}
                            tabIndex={-1}
                            key={room.id}
                            className="scroll-mt-4 space-y-2 rounded-xl border border-line bg-sunken/40 p-4"
                          >
                            <h4 className="font-bold">
                              {room.name}
                              {room.id === stage.startRoomId
                                ? " · Start room"
                                : ""}
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
                            title={`After: ${name(s.whenOutcome.outcomeId)}`}
                          >
                            <p>{s.openingNarration}</p>
                            <p>
                              Character placements:{" "}
                              {Object.entries(s.placement ?? {})
                                .map(
                                  ([id, room]) => `${name(id)} → ${name(room)}`,
                                )
                                .join(", ") || "Unchanged"}
                            </p>
                            <p>
                              Document placements:{" "}
                              {Object.entries(s.documentPlacement ?? {})
                                .map(
                                  ([id, room]) => `${name(id)} → ${name(room)}`,
                                )
                                .join(", ") || "Unchanged"}
                            </p>
                            <p>
                              Stances:{" "}
                              {Object.entries(s.stances ?? {})
                                .map(
                                  ([id, stance]) =>
                                    `${name(id)} → ${name(reviewStanceId(id, stance))}`,
                                )
                                .join(", ") || "Unchanged"}
                            </p>
                          </Field>
                        ))}
                      </Card>
                      <Card
                        id={reviewSectionId(stage.id, "discoveries")}
                        title="Discoveries"
                      >
                        {spec.discoveries
                          .filter((d) => d.stageId === stage.id)
                          .map((d) => (
                            <Block
                              key={d.id}
                              id={d.id}
                              title={reviewDiscoveryTitle(spec, d)}
                            >
                              <p className="text-sm">
                                {d.core
                                  ? "Essential discovery"
                                  : "Optional discovery"}{" "}
                                · Held by{" "}
                                {"characterId" in d.holder
                                  ? link(d.holder.characterId)
                                  : link(d.holder.documentId)}
                              </p>
                              <Field title="Fact">{d.text}</Field>
                              <Field title="Student note">{d.note}</Field>
                              {d.condition ? (
                                <Field title="Available when">
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
                      </Card>
                      <Card
                        id={reviewSectionId(stage.id, "events")}
                        title="Events"
                      >
                        {spec.storyEvents
                          .filter((e) => e.stageId === stage.id)
                          .map((e) => (
                            <Block
                              key={e.id}
                              id={e.id}
                              title={REVIEW_EVENT_LABELS[e.effect]}
                            >
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
                      </Card>
                      {spec.definingMoments
                        .filter((m) => m.stageId === stage.id)
                        .map((m) => (
                          <Card key={m.id} id={m.id} title="Defining moment">
                            <Field title="Who decides">
                              {link(m.deciderId)}
                            </Field>
                            <Field title="Scene">{m.scene}</Field>
                            <Field title="Prompt for the student">
                              {m.nudge}
                            </Field>
                            <Field title="Decision narration">
                              {m.finalCallNarration}
                            </Field>
                            <Block
                              id={reviewSectionId(m.id, "choices")}
                              title="Choices"
                            >
                              {m.acts.map((a) => (
                                <Block key={a.id} id={a.id} title={name(a.id)}>
                                  <p>{a.reaction}</p>
                                  {a.deception ? <p>Deception</p> : null}
                                  {a.secret ? (
                                    <Field title="How to reveal this choice">{`Meet ${a.secret.minMet} of: ${a.secret.unlock.map((c) => conditionText(c, name)).join("; ")}`}</Field>
                                  ) : null}
                                </Block>
                              ))}
                            </Block>
                            <Block
                              id={reviewSectionId(m.id, "outcomes")}
                              title="Outcomes"
                            >
                              {m.outcomes.map((o) => (
                                <Block key={o.id} id={o.id} title={name(o.id)}>
                                  <p>
                                    {o.historical
                                      ? "Historical outcome"
                                      : "Alternative outcome"}
                                    {o.secret ? " · Secret" : ""}
                                  </p>
                                  <Field title="Prediction">
                                    {o.predictionText}
                                  </Field>
                                  <Field title="Because">{o.because}</Field>
                                  {o.endingId ? (
                                    <p>Ending: {link(o.endingId)}</p>
                                  ) : null}
                                  {o.closesEndingIds.length ? (
                                    <p>
                                      Closes:{" "}
                                      {o.closesEndingIds.map(name).join(", ")}
                                    </p>
                                  ) : null}
                                </Block>
                              ))}
                            </Block>
                            <Field title="How choices lead to outcomes">
                              {m.rules.map((r, i) => (
                                <p key={i}>
                                  {name(r.actId)} → {name(r.outcomeId)}
                                  {r.when
                                    ? ` when ${conditionText(r.when, name)}`
                                    : ""}
                                </p>
                              ))}
                            </Field>
                          </Card>
                        ))}
                    </>
                  ) : null}
                  {character ? (
                    <>
                      <Card id={character.id} title={name(character.id)}>
                        <p>
                          {character.title} ·{" "}
                          {character.tier === "major"
                            ? "Main character"
                            : "Supporting character"}{" "}
                          ·{" "}
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
                      </Card>
                      <Card
                        id={reviewSectionId(character.id, "persona")}
                        title="Persona"
                      >
                        {(
                          [
                            ["Voice", character.persona.voice],
                            ["What they know", character.persona.knewThen],
                            [
                              "Wants from the student",
                              character.persona.wantsFromStudent,
                            ],
                            [
                              "Public position",
                              character.persona.publicPosition,
                            ],
                            ["Private agenda", character.persona.privateAgenda],
                          ] as const
                        ).map(([title, text]) => (
                          <Field key={title} title={title}>
                            {text}
                          </Field>
                        ))}
                        <Field title="What they keep to themselves">
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
                      </Card>
                      <Card
                        id={reviewSectionId(character.id, "stances")}
                        title="Stances"
                      >
                        {character.stances.map((s) => (
                          <Block
                            key={s.id}
                            id={reviewStanceId(character.id, s.id)}
                            title={s.label}
                          >
                            <p>{s.demeanour}</p>
                            <p>
                              {s.id === character.initialStanceId
                                ? "Initial stance"
                                : ""}
                              {s.hidden ? " · Hidden" : ""}
                            </p>
                          </Block>
                        ))}
                      </Card>
                      <Card
                        id={reviewSectionId(character.id, "slants")}
                        title="Biased claims"
                      >
                        {character.slants.map((s) => (
                          <Block key={s.id} id={s.id} title={name(s.id)}>
                            <div className="flex flex-wrap gap-3">
                              Evidence that challenges this claim:{" "}
                              {s.contradictedBy.map((id) => (
                                <span key={id}>{link(id)}</span>
                              ))}
                            </div>
                            {s.unlocksDiscoveryId ? (
                              <p>Unlocks: {link(s.unlocksDiscoveryId)}</p>
                            ) : null}
                          </Block>
                        ))}
                      </Card>
                      <Card
                        id={reviewSectionId(character.id, "reactions")}
                        title="Reactions and trust"
                      >
                        {character.trustNotice ? (
                          <p>{character.trustNotice}</p>
                        ) : null}
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
                                <Field title="Only when">
                                  {conditionText(t.requires, name)}
                                </Field>
                              ) : null}
                              <Field title="What changes">
                                {"toStance" in t.effect
                                  ? `Change stance to ${name(t.effect.toStance)}`
                                  : t.effect.stanceDelta > 0
                                    ? "Becomes more receptive"
                                    : "Becomes less receptive"}
                              </Field>
                              {t.handsOver?.length ? (
                                <p>
                                  Hands over: {t.handsOver.map(name).join(", ")}
                                </p>
                              ) : null}
                            </Block>
                          ))}
                      </Card>
                    </>
                  ) : null}
                  {doc ? (
                    <>
                      <Card id={doc.id} title={name(doc.id)}>
                        <p>
                          {doc.kind} ·{" "}
                          {doc.real
                            ? "Real historical document"
                            : "Invented document"}
                        </p>
                        <p className="text-sm">
                          {Object.values(doc.provenance)
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <Citations
                          label={doc.sourceLabel}
                          citations={doc.citations}
                          sources={sources}
                        />
                      </Card>
                      <Card
                        id={reviewSectionId(doc.id, "text")}
                        title="Document text"
                      >
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                          {documentSegments(doc).map((s) =>
                            s.passageIds.length ? (
                              <mark
                                key={s.start}
                                className="rounded-sm bg-sunshine text-ink"
                              >
                                {s.text}
                              </mark>
                            ) : (
                              <span key={s.start}>{s.text}</span>
                            ),
                          )}
                        </div>
                      </Card>
                      <Card
                        id={reviewSectionId(doc.id, "passages")}
                        title="Key passages"
                      >
                        {doc.keyPassages.map((p, passageIndex) => (
                          <Block
                            key={p.id}
                            id={p.id}
                            title={`Passage ${passageIndex + 1}`}
                            reference={p.id}
                          >
                            <blockquote>
                              {doc.body.slice(p.start, p.end)}
                            </blockquote>
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
                      </Card>
                      <Card
                        id={reviewSectionId(doc.id, "glossary")}
                        title="Glossary"
                      >
                        {doc.glossary.map((g, i) => (
                          <Field key={i} title={g.term}>
                            {g.meaning}
                          </Field>
                        ))}
                      </Card>
                    </>
                  ) : null}
                  {ending ? (
                    <>
                      <Card id={ending.id} title={name(ending.id)}>
                        <p>
                          {ending.type === "historical"
                            ? "Historical ending"
                            : ending.type === "alternative"
                              ? "Alternative ending"
                              : "Hidden ending"}
                        </p>
                        <Field title="Summary">{ending.summary}</Field>
                        <Field title="Epilogue">{ending.epilogue}</Field>
                        <Citations
                          label={ending.sourceLabel}
                          citations={ending.citations}
                          sources={sources}
                        />
                      </Card>
                      <Card
                        id={reviewSectionId(ending.id, "interview")}
                        title="Interview"
                      >
                        <Field title="Interviewer">
                          {ending.interview.interviewer}
                        </Field>
                        <Field title="Question">
                          {ending.interview.question}
                        </Field>
                        {ending.interview.verdicts.map((v) => (
                          <Block key={v.id} id={v.id} title={name(v.id)}>
                            <div className="flex flex-wrap gap-3">
                              Evidence to discuss:{" "}
                              {v.counterPoints.map((id) => (
                                <span key={id}>{link(id)}</span>
                              ))}
                            </div>
                          </Block>
                        ))}
                        <Field title="Follow-up response">
                          {ending.interview.generalCounter}
                        </Field>
                      </Card>
                    </>
                  ) : null}
                </>
              )}
            </React.Fragment>
          </div>
          </>}
        </div>
      </div>
    </div>
  );
}
