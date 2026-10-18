import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import { EmptyState, Page, Section, button } from "@/components/ui";
import { loadClassSummary } from "@/lib/play/v3/summary";
import { v3PublishDeps, v3SummaryDeps } from "@/lib/play/v3/http";
import { loadPublishState } from "@/lib/play/v3/publish";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";
import type { ClassSummary } from "@adventure/play-contract";

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
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const query = await searchParams;
  const requestedTab = SUMMARY_TABS.find((item) => item.id === query.tab)?.id ?? "overview";
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
  const publish = await loadPublishState(v3PublishDeps(), user.id, id);

  const headerLinks = (
    <div className="flex flex-wrap items-center gap-2">
      {publish.kind === "hidden" ? null : (
        <V3PublishPanel {...({ version: publish.version, publishedVersion: publish.publishedVersion, unpublishedChanges: publish.kind === "published" && publish.unpublishedChanges })} adventureId={id} published={publish.kind === "published"} />
      )}
      <Link href={`/v3/teacher/${id}/preview`} className={button.subtle}>
        Preview
      </Link>
      <Link href="/teacher" className={button.subtle}>
        Back to adventures
      </Link>
    </div>
  );

  if (result.status === 409) {
    return (
      <Page
        kicker={headerLinks}
        title={<span className="break-words">{result.title ?? "Class summary"}</span>}
        lede="Class summary"
        width="wide"
      >
        <div className="mx-auto w-full max-w-xl">
          <EmptyState title="Publish this adventure to see your class&apos;s results." />
        </div>
      </Page>
    );
  }

  const { summary, version, versions, flagged } = result;
  const summaryHref = (nextVersion: number, tab: SummaryTab) =>
    `/v3/teacher/${encodeURIComponent(id)}/summary?version=${nextVersion}&tab=${tab}`;

  return (
    <Page
      kicker={headerLinks}
      title={<span className="break-words">{result.title}</span>}
      lede="Class summary"
      width="wide"
    >
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
              Version {item.version} <span className="ml-1">({item.attempts})</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <nav aria-label="Class summary sections" className="flex gap-2 overflow-x-auto border-b border-line pb-2">
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
        <SummaryContent tab={requestedTab} summary={summary} flagged={flagged} />
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
  flagged: { attemptId: string; count: number; student: string }[];
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
      return <OverviewSummary summary={summary} flaggedCount={flagged.length} />;
  }
}

function OverviewSummary({
  summary,
  flaggedCount,
}: {
  summary: ClassSummary;
  flaggedCount: number;
}) {
  const endingTotal = Math.max(summary.attempts, 1);
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Attempts" value={summary.attempts} />
        <Stat label="Completed / reached reveal" value={summary.completed} />
        <Stat label="Flagged attempts" value={flaggedCount} />
      </dl>
      <Section title="Endings reached">
        {summary.endings.length ? (
          <div className="flex flex-col gap-4">
            {summary.endings.map((ending) => (
              <div key={ending.endingId} className="flex flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-words font-semibold text-ink">{ending.label}</span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-bold capitalize text-muted">
                    {ending.type}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{ending.count}</span>
                </div>
                <Bar count={ending.count} total={endingTotal} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-base text-muted">No endings have been reached yet.</p>
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
          {[...byStage.entries()].sort(([a], [b]) => a - b).map(([stageIndex, rows]) => (
            <div key={stageIndex} className="flex flex-col gap-3">
              <h3 className="text-lg font-extrabold text-ink">Stage {stageIndex + 1}</h3>
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
            <h3 className="text-lg font-extrabold text-ink">{prediction.question}</h3>
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
      <p className="mt-5 text-sm text-muted">This shows how the class split, not who was right.</p>
    </Section>
  );
}

function InterviewSummary({ summary }: { summary: ClassSummary }) {
  return (
    <Section title="Interview">
      <div className="flex flex-col gap-8">
        {summary.verdicts.map((ending) => {
          const answers = summary.answers.filter((answer) => answer.endingId === ending.endingId);
          return (
            <div key={ending.endingId} className="flex flex-col gap-4">
              <h3 className="text-lg font-extrabold text-ink">{ending.question}</h3>
              <div className="w-full overflow-hidden rounded-surface border border-line">
                <table className="w-full table-fixed text-left text-sm sm:text-base">
                  <thead className="bg-sunken text-muted">
                    <tr>
                      <th className="w-1/2 break-words px-2 py-2 font-semibold sm:px-3">Verdict</th>
                      <th className="w-1/4 break-words px-1 py-2 font-semibold">First answer</th>
                      <th className="w-1/4 break-words px-1 py-2 font-semibold">After push-back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ending.options.map((option) => (
                      <tr key={option.verdictId} className="border-t border-line">
                        <td className="break-words px-2 py-2 text-ink sm:px-3">{option.label}</td>
                        <td className="px-1 py-2 tabular-nums text-ink">{option.initial}</td>
                        <td className="px-1 py-2 tabular-nums text-ink">{option.final}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted">
                {ending.changedAfterPushBack} changed their answer after push-back.
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
                  <p className="text-sm text-muted">No evidence was recorded.</p>
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
                        <p className="break-words text-base text-ink">&ldquo;{answer.text}&rdquo;</p>
                        <footer className="mt-3 text-sm font-semibold text-muted">{answer.verdictLabel}</footer>
                      </blockquote>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">No interview answers were recorded.</p>
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
        {summary.discoveries.map((holder) => (
          <div key={holder.holderId} className="flex flex-col gap-3">
            <h3 className="text-lg font-extrabold text-ink">{holder.holderName}</h3>
            {holder.items.map((item) => (
              <div
                key={item.discoveryId}
                className={`flex flex-col gap-2 ${item.found === 0 ? "opacity-60" : ""}`}
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 break-words font-semibold text-ink">{item.label}</span>
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

function FlagSummary({
  flagged,
}: {
  flagged: { attemptId: string; count: number; student: string }[];
}) {
  return (
    <Section title="Flags">
      <p className="text-sm text-muted">Only flagged students are named here, so you can follow up.</p>
      {flagged.length === 0 ? (
        <EmptyState title="No messages were flagged." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface px-4">
          {flagged.map((item) => (
            <li key={item.attemptId} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-all font-semibold text-ink">{item.student}</span>
              <span className="shrink-0 text-sm text-muted">
                {item.count} {item.count === 1 ? "message" : "messages"} flagged
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-2 rounded-control border border-line bg-surface p-3.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-extrabold tracking-tight text-ink tabular-nums">{value}</dd>
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
      <div className="h-full rounded-full bg-ink" style={{ width: `${width}%` }} />
    </div>
  );
}
