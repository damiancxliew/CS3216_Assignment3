import type { Metadata } from "next";
import Link from "next/link";
import { V3AdventureNav } from "@/components/teacher/v3-adventure-nav";
import { notFound, redirect } from "next/navigation";

import { EmptyState, Page, Section } from "@/components/ui";
import {
  loadClassSummary,
  type FlaggedMessage,
  type FlaggedStudent,
} from "@/lib/play/v3/summary";
import { v3SummaryDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";

import type { ClassSummary, FlagSeverity } from "@adventure/play-contract";
import { V3ReadingSummary } from "@/components/teacher/v3-reading-summary";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Class summary",
  robots: { index: false },
};

const SUMMARY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stuck", label: "Stuck" },
  { id: "predictions", label: "Predictions" },
  { id: "interview", label: "Interview" },
  { id: "discoveries", label: "Discoveries" },
  { id: "flags", label: "Flags" },
] as const;

type SummaryTab = (typeof SUMMARY_TABS)[number]["id"];

export default async function V3ClassSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requestedTab =
    SUMMARY_TABS.find((item) => item.id === query.tab)?.id ?? "overview";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const result = await loadClassSummary(
    v3SummaryDeps(),
    user.id,
    id,
    Number(query.version) || undefined,
  );
  if (result.status === 404) notFound();

  if (result.status === 409) {
    return (
      <Page
        title={
          <span className="break-words">{result.title ?? "Class summary"}</span>
        }
        lede="Class summary"
        width="wide"
      >
        <V3AdventureNav adventureId={id} page="summary" />
        <div className="mx-auto w-full max-w-xl">
          <EmptyState title="Publish this adventure to see your class's results." />
        </div>
      </Page>
    );
  }

  const { summary, version, versions, flagged } = result;
  const summaryHref = (nextVersion: number, tab: SummaryTab) =>
    `/v3/teacher/${encodeURIComponent(id)}/summary?version=${nextVersion}&tab=${tab}`;

  return (
    <Page
      title={<span className="break-words">{result.title}</span>}
      lede="Class summary"
      width="wide"
    >
      <V3AdventureNav adventureId={id} page="summary" />
      {versions.length > 1 ? (
        <nav aria-label="Published versions" className="flex flex-wrap gap-2">
          {versions.map((item) => (
            <Link
              key={item.version}
              href={summaryHref(item.version, requestedTab)}
              aria-current={version === item.version ? "page" : undefined}
              className={`inline-flex min-h-10 items-center rounded-control border px-3 text-sm font-semibold transition-colors ${
                version === item.version
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-muted hover:bg-surface hover:text-ink"
              }`}
            >
              Version {item.version}{" "}
              <span className="ml-1">({item.attempts})</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <nav
        aria-label="Class summary sections"
        className="flex flex-wrap gap-2 border-b border-line pb-2"
      >
        {SUMMARY_TABS.map((item) => (
          <Link
            key={item.id}
            href={summaryHref(version, item.id)}
            aria-current={requestedTab === item.id ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-control px-4 text-base font-semibold transition-colors ${
              requestedTab === item.id
                ? "bg-ink text-paper"
                : "text-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {summary.attempts === 0 ? (
        <EmptyState title="No one has played this version yet.">
          Results appear here as students finish stages.
        </EmptyState>
      ) : (
        <SummaryContent
          tab={requestedTab}
          summary={summary}
          flagged={flagged}
        />
      )}
    </Page>
  );
}

function SummaryContent({
  tab,
  summary,
  flagged,
}: {
  tab: SummaryTab;
  summary: ClassSummary;
  flagged: FlaggedStudent[];
}) {
  switch (tab) {
    case "stuck":
      return <StuckSummary summary={summary} />;
    case "predictions":
      return <PredictionSummary summary={summary} />;
    case "interview":
      return <InterviewSummary summary={summary} />;
    case "discoveries":
      return <DiscoverySummary summary={summary} />;
    case "flags":
      return <FlagSummary flagged={flagged} />;
    default:
      return (
        <OverviewSummary
          summary={summary}
          flaggedCount={flagged.length}
          urgentCount={
            flagged.filter((item) => item.severity === "urgent").length
          }
        />
      );
  }
}

function OverviewSummary({
  summary,
  flaggedCount,
  urgentCount,
}: {
  summary: ClassSummary;
  flaggedCount: number;
  urgentCount: number;
}) {
  const endingTotal = Math.max(summary.attempts, 1);
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Attempts" value={summary.attempts} />
        <Stat label="Completed / reached reveal" value={summary.completed} />
        <Stat
          label="Flagged attempts"
          value={flaggedCount}
          note={urgentCount > 0 ? `${urgentCount} urgent` : undefined}
        />
      </dl>
      <Section title="Endings reached">
        {summary.endings.length ? (
          <div className="flex flex-col gap-4">
            {summary.endings.map((ending) => (
              <div key={ending.endingId} className="flex flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-words font-semibold text-ink">
                    {ending.label}
                  </span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-bold capitalize text-muted">
                    {ending.type}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {ending.count}
                  </span>
                </div>
                <Bar count={ending.count} total={endingTotal} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-base text-muted">
            No endings have been reached yet.
          </p>
        )}
      </Section>
    </>
  );
}

function StuckSummary({ summary }: { summary: ClassSummary }) {
  const byStage = new Map<number, typeof summary.stuck>();
  for (const row of summary.stuck) {
    byStage.set(row.stageIndex, [...(byStage.get(row.stageIndex) ?? []), row]);
  }
  return (
    <Section title="Where students got stuck">
      {summary.stuck.length === 0 ? (
        <EmptyState title="No one needed a hint yet." />
      ) : (
        <div className="flex flex-col gap-6">
          {[...byStage.entries()]
            .sort(([a], [b]) => a - b)
            .map(([stageIndex, rows]) => (
              <div key={stageIndex} className="flex flex-col gap-3">
                <h3 className="text-lg font-extrabold text-ink">
                  Stage {stageIndex + 1}
                </h3>
                {rows.map((row) => (
                  <CountRow
                    key={`${row.stageIndex}-${row.targetDiscoveryId ?? "none"}`}
                    label={row.label}
                    count={row.count}
                    total={summary.attempts}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </Section>
  );
}

function PredictionSummary({ summary }: { summary: ClassSummary }) {
  return (
    <Section title="Predictions">
      <div className="flex flex-col gap-6">
        {summary.predictions.map((prediction) => (
          <div key={prediction.momentId} className="flex flex-col gap-3">
            <h3 className="text-lg font-extrabold text-ink">
              {prediction.question}
            </h3>
            {prediction.options.map((option) => (
              <CountRow
                key={option.outcomeId}
                label={option.label}
                count={option.count}
                total={summary.attempts}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm text-muted">
        This shows how the class split, not who was right.
      </p>
    </Section>
  );
}

function InterviewSummary({ summary }: { summary: ClassSummary }) {
  return (
    <Section title="Interview">
      <div className="flex flex-col gap-8">
        {summary.verdicts.map((ending) => {
          const answers = summary.answers.filter(
            (answer) => answer.endingId === ending.endingId,
          );
          return (
            <div key={ending.endingId} className="flex flex-col gap-4">
              <h3 className="text-lg font-extrabold text-ink">
                {ending.question}
              </h3>
              <div className="w-full overflow-hidden rounded-surface border border-line">
                <table className="w-full table-fixed text-left text-sm sm:text-base">
                  <thead className="bg-sunken text-muted">
                    <tr>
                      <th className="w-1/2 break-words px-2 py-2 font-semibold sm:px-3">
                        Verdict
                      </th>
                      <th className="w-1/4 break-words px-1 py-2 font-semibold">
                        First answer
                      </th>
                      <th className="w-1/4 break-words px-1 py-2 font-semibold">
                        After push-back
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ending.options.map((option) => (
                      <tr
                        key={option.verdictId}
                        className="border-t border-line"
                      >
                        <td className="break-words px-2 py-2 text-ink sm:px-3">
                          {option.label}
                        </td>
                        <td className="px-1 py-2 tabular-nums text-ink">
                          {option.initial}
                        </td>
                        <td className="px-1 py-2 tabular-nums text-ink">
                          {option.final}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted">
                {ending.changedAfterPushBack} changed their answer after
                push-back.
              </p>
              <div className="flex flex-col gap-2">
                <h4 className="font-bold text-ink">Most-used evidence</h4>
                {ending.evidence.length ? (
                  ending.evidence.map((item) => (
                    <CountRow
                      key={item.discoveryId}
                      label={item.label}
                      count={item.count}
                      total={summary.attempts}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted">
                    No evidence was recorded.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <h4 className="font-bold text-ink">Anonymised answers</h4>
                {answers.length ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {answers.map((answer, index) => (
                      <blockquote
                        key={`${answer.endingId}-${index}`}
                        className="min-w-0 rounded-surface border border-line bg-surface p-4"
                      >
                        <p className="break-words text-base text-ink">
                          &ldquo;{answer.text}&rdquo;
                        </p>
                        <footer className="mt-3 text-sm font-semibold text-muted">
                          {answer.verdictLabel}
                        </footer>
                      </blockquote>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    No interview answers were recorded.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function DiscoverySummary({ summary }: { summary: ClassSummary }) {
  return (
    <Section title="Discoveries">
      <div className="flex flex-col gap-7">
        {summary.readingChecks ? <V3ReadingSummary checks={summary.readingChecks} /> : null}
        {summary.discoveries.map((holder) => (
          <div key={holder.holderId} className="flex flex-col gap-3">
            <h3 className="text-lg font-extrabold text-ink">
              {holder.holderName}
            </h3>
            {holder.items.map((item) => (
              <div
                key={item.discoveryId}
                className={`flex flex-col gap-2 ${item.found === 0 ? "opacity-60" : ""}`}
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 break-words font-semibold text-ink">
                    {item.label}
                  </span>
                  {item.core ? (
                    <span className="shrink-0 rounded-full border border-ink px-2 py-0.5 text-xs font-bold text-ink">
                      Core
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-muted">
                  found by {item.found} of {summary.attempts}
                  {item.found === 0 ? " · Missed by everyone" : ""}
                </p>
                <Bar count={item.found} total={summary.attempts} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

const SEVERITY_LABELS: Record<FlagSeverity, string> = {
  urgent: "Urgent",
  serious: "Serious",
  review: "Review",
};

const SEVERITY_STYLES: Record<FlagSeverity, string> = {
  urgent: "bg-danger text-on-accent",
  serious: "bg-signal-wash text-ink",
  review: "bg-sunken text-muted",
};

const CATEGORY_LABELS: Record<string, string> = {
  abusive: "Abusive",
  threat: "Threat",
  hateful: "Hateful",
  provocative: "Provocative",
  sexual: "Sexual",
  self_harm: "Self-harm",
};

function SeverityBadge({
  severity,
  className = "",
}: {
  severity: FlagSeverity;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${SEVERITY_STYLES[severity]} ${className}`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

function FlagSummary({ flagged }: { flagged: FlaggedStudent[] }) {
  return (
    <Section title="Flags">
      <p className="text-sm text-muted">
        Only flagged students are named here, so you can follow up. Flags come
        from an automatic check and can be wrong.
      </p>
      {flagged.length === 0 ? (
        <EmptyState title="No messages were flagged." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface">
          {flagged.map((item) => (
            <li key={item.attemptId}>
              <details className="group" open={item.severity === "urgent"}>
                <summary className="flex cursor-pointer list-none flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="min-w-0 break-all font-semibold text-ink">
                      {item.student}
                    </span>
                    <SeverityBadge
                      severity={item.severity}
                      className="group-open:hidden"
                    />
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
                    {item.count} {item.count === 1 ? "message" : "messages"}{" "}
                    flagged
                    <svg
                      aria-hidden
                      viewBox="0 0 20 20"
                      className="size-4 transition-transform group-open:rotate-180"
                    >
                      <path
                        d="M5 7.5l5 5 5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {item.messages.map((message) => (
                    <FlaggedMessageRow
                      key={`${message.messageId}-${message.category}`}
                      message={message}
                    />
                  ))}
                  {item.count > item.messages.length ? (
                    <p className="text-sm text-muted">
                      {item.messages.length === 0
                        ? "The flagged message text wasn't saved."
                        : `The text of ${item.count - item.messages.length} more flagged ${
                            item.count - item.messages.length === 1
                              ? "message wasn't"
                              : "messages weren't"
                          } saved.`}
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FlaggedMessageRow({ message }: { message: FlaggedMessage }) {
  const context = [
    message.characterName ? `To ${message.characterName}` : null,
    message.stageIndex === null ? null : `Stage ${message.stageIndex + 1}`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2 rounded-control bg-paper p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <SeverityBadge severity={message.severity} />
        <span className="font-semibold text-ink">
          {CATEGORY_LABELS[message.category] ?? message.category}
        </span>
        {context.length ? (
          <span className="text-muted">· {context.join(" · ")}</span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-base text-ink">
        {message.excerpt}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-2 rounded-control border border-line bg-surface p-3.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex items-baseline gap-2 text-2xl font-extrabold tracking-tight text-ink tabular-nums">
        {value}
        {note ? (
          <span className="text-sm font-bold tracking-normal text-danger">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function CountRow({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-ink">{label}</span>
        <span className="shrink-0 tabular-nums text-muted">{count}</span>
      </div>
      <Bar count={count} total={total} />
    </div>
  );
}

function Bar({ count, total }: { count: number; total: number }) {
  const width = Math.min(100, Math.round((count / Math.max(total, 1)) * 100));
  return (
    <div className="h-2 w-full rounded-full bg-sunken">
      <div
        className="h-full rounded-full bg-ink"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
