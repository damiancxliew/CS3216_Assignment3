import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DossierSections } from "./dossier";
import { SharePanel } from "./share-panel";
import {
  generateFromSources,
  publishAdventure,
  startEdit,
  updateDefaultTimer,
} from "../actions";
import { ActionButton, ActionForm } from "@/components/action-form";
import {
  button,
  EmptyState,
  Field,
  Page,
  Section,
  StatusBadge,
  READING_BAND_LABELS,
} from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { ReadingLevel } from "@/lib/brief/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildDossier } from "@/lib/teacher/dossier";

export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

// Generation is one long model call; the actions invoked from this page inherit this budget.
export const maxDuration = 300;

type Adventure = {
  id: string;
  student_role: string | null;
  learning_objectives: string[] | null;
  reading_level: ReadingLevel | null;
  title: string;
  setting: string | null;
  status: "draft" | "published" | "archived";
  published_version: number | null;
  default_timer_seconds: number;
  share_token: string;
  stage_outline: { title: string; focus: string }[];
};

type Version = { id: string; version: number; published_at: string | null };

type SourcePageMap = {
  pages?: number;
  chars?: number;
  text?: string;
  page_texts?: { page: number; text: string }[];
};

// Extracted text can run to hundreds of thousands of characters and is shipped
// in the HTML whether the disclosure is open or not, so only a prefix renders.
const SOURCE_TEXT_RENDER_CAP = 20_000;

function sourceText(pageMap: SourcePageMap): { text: string; total: number; truncated: boolean } | null {
  const full = pageMap.page_texts?.length
    ? pageMap.page_texts.map((p) => p.text).join("\n\n")
    : pageMap.text?.split("\f").join("\n\n");
  if (!full) return null;
  return { text: full.slice(0, SOURCE_TEXT_RENDER_CAP), total: full.length, truncated: full.length > SOURCE_TEXT_RENDER_CAP };
}

export default async function AdventurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher");

  // A student admitted to a published adventure can also select the row, so the
  // authoring view matches the owner rather than relying on visibility alone.
  const { data: adventure } = await supabase
    .from("adventure")
    .select("id, title, setting, status, published_version, default_timer_seconds, share_token, student_role, learning_objectives, reading_level, stage_outline")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle<Adventure>();
  if (!adventure) notFound();

  const { data: versionRows } = await supabase
    .from("spec_version")
    .select("id, version, published_at")
    .eq("adventure_id", id)
    .order("version", { ascending: false })
    .returns<Version[]>();
  const versions = versionRows ?? [];
  const draft = versions.find((v) => v.published_at === null) ?? null;
  const published = versions.find((v) => v.version === adventure.published_version) ?? null;
  // The dossier shows the draft when one exists, else the published version.
  const shown = draft ?? published;

  // `spec_version.json` is revoked from `authenticated`, so the dossier is
  // built with the service role now that ownership is confirmed.
  const admin = createAdminClient();
  const dossier = shown ? await buildDossier(admin, { adventureId: id, specVersionId: shown.id }) : null;

  const { data: sources } = await supabase
    .from("source")
    .select("id, title, kind, page_map")
    .eq("adventure_id", id)
    .order("created_at")
    .returns<
      {
        id: string;
        title: string | null;
        kind: string;
        page_map: SourcePageMap | null;
      }[]
    >();
  const sourceRows = sources ?? [];

  const { data: attempts } = await supabase
    .from("attempt")
    .select("id, status, published_version, updated_at, attempt_telemetry(stage_index, ended_by, duration_seconds, tokens, messages, evidence_found)")
    .eq("adventure_id", id)
    .order("updated_at", { ascending: false })
    .returns<
      {
        id: string;
        status: string;
        published_version: number;
        updated_at: string;
        attempt_telemetry: { stage_index: number; ended_by: string; duration_seconds: number; tokens: number; messages: number; evidence_found: number }[];
      }[]
    >();
  // P11: what an attempt costs and how long it takes, summed from the per-stage rows.
  const totals = (attempts ?? []).map((a) => a.attempt_telemetry ?? []).flat();
  const finished = (attempts ?? []).filter((a) => a.status === "completed");
  const minutes = (rows: { duration_seconds: number }[]) => Math.round(rows.reduce((sum, r) => sum + r.duration_seconds, 0) / 60);
  const tokens = (rows: { tokens: number }[]) => rows.reduce((sum, r) => sum + r.tokens, 0);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <Page
      kicker={
        <Link href="/teacher" className="hover:text-ink">
          All adventures
        </Link>
      }
      title={
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          {adventure.title}
          <StatusBadge status={adventure.status} version={adventure.published_version} />
        </span>
      }
      lede={adventure.setting}
      width="wide"
    >
      <Section title="Brief">
        {adventure.reading_level ? (
          <dl className="flex flex-col divide-y divide-line text-base">
            <BriefRow label="Student plays">{adventure.student_role}</BriefRow>
            <BriefRow label="Objectives">
              <ul className="list-disc pl-4">
                {adventure.learning_objectives?.map((objective) => <li key={objective}>{objective}</li>)}
              </ul>
            </BriefRow>
            <BriefRow label="Reading level">
              {READING_BAND_LABELS[adventure.reading_level.band]}, ages {adventure.reading_level.ageMin} to {adventure.reading_level.ageMax}
            </BriefRow>
            {adventure.stage_outline.map((stage, index) => (
              <BriefRow key={stage.title} label={`Stage ${index + 1}`}>
                <span className="font-semibold">{stage.title}.</span> {stage.focus}
              </BriefRow>
            ))}
            <BriefRow label="Sources">
              <ul className="flex flex-col gap-0.5">
                {sourceRows.map((source) => {
                  const label = (
                    <>
                      {source.title ?? "Untitled"}
                      {source.page_map?.pages ? <span className="text-muted"> ({plural(source.page_map.pages, "page")})</span> : null}
                    </>
                  );
                  const extracted = source.page_map ? sourceText(source.page_map) : null;
                  return (
                    <li key={source.id}>
                      {extracted ? (
                        <details>
                          <summary className="cursor-pointer">{label}</summary>
                          <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-surface border border-line bg-sunken px-4 py-3 text-base text-muted">
                            {extracted.text}
                          </div>
                          {extracted.truncated ? (
                            <p className="mt-1 text-base text-muted">
                              Showing the first {SOURCE_TEXT_RENDER_CAP.toLocaleString()} of {extracted.total.toLocaleString()} characters.
                            </p>
                          ) : null}
                        </details>
                      ) : (
                        label
                      )}
                    </li>
                  );
                })}
              </ul>
            </BriefRow>
          </dl>
        ) : (
          <p className="text-base text-muted">
            This adventure predates the brief conversation and cannot be generated. Create a new one from the console.
          </p>
        )}
      </Section>

      <Section title="Playable version" lede="The planner turns the brief and the sources into stages, stakeholders and evidence. Every stage is editable before you publish.">
        {versions.length === 0 ? (
          <EmptyState title="Not generated yet">
            Generating takes a minute or two. Nothing here is visible to students until you publish.
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line text-base">
            {versions.map((version) => (
              <li key={version.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <span className="font-semibold text-ink">Version {version.version}</span>
                <span className="text-base text-muted">
                  {version.published_at
                    ? `Published ${new Date(version.published_at).toLocaleString()}, frozen`
                    : "Draft, editable"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <ActionButton
            action={publishAdventure.bind(null, adventure.id)}
            label={`Publish version ${draft.version}`}
            pendingLabel="Publishing…"
            event={ANALYTICS_EVENTS.adventurePublished}
          />
        ) : published ? (
          <ActionButton
            action={startEdit.bind(null, adventure.id)}
            label="Edit as a new version"
            pendingLabel="Copying…"
            variant="quiet"
          />
        ) : null}
        {published && !draft ? (
          <p className="max-w-[60ch] text-base text-muted">
            Version {published.version} is published and frozen. Editing copies it into a new
            draft; students already playing stay on the version they started.
          </p>
        ) : null}

        {draft ? (
          <p className="text-base text-muted">Publish or discard draft version {draft.version} before generating again.</p>
        ) : adventure.reading_level && sourceRows.length > 0 ? (
          <ActionButton
            action={generateFromSources.bind(null, adventure.id)}
            label={versions.length === 0 ? "Generate the adventure" : "Generate a new version"}
            pendingLabel="Generating… this takes a minute or two"
            event={ANALYTICS_EVENTS.generationCompleted}
          />
        ) : null}
      </Section>

      {dossier && shown ? (
        <DossierSections
          dossier={dossier}
          adventureId={adventure.id}
          specVersionId={shown.id}
          version={shown.version}
          isDraft={shown === draft}
        />
      ) : null}

      <Section
        title="Stage timer"
        lede="The deadline is set and checked in the database when a stage opens, so refreshing, reopening the tab or changing the device clock buys no extra time."
      >
        <ActionForm
          action={updateDefaultTimer.bind(null, adventure.id)}
          submitLabel="Save default"
          pendingLabel="Saving…"
        >
          <Field
            name="default_timer_seconds"
            label="Default per stage, in seconds"
            hint="0 disables timers entirely. Each stage can override this above."
            defaultValue={String(adventure.default_timer_seconds)}
          />
        </ActionForm>
      </Section>

      <Section title="Share with students">
        <SharePanel
          adventureId={adventure.id}
          token={adventure.share_token}
          published={adventure.status === "published"}
        />
        {adventure.status === "published" ? (
          <Link href={`/join/${adventure.share_token}`} className={`${button.quiet} w-fit`}>
            Preview as a player
          </Link>
        ) : null}
      </Section>

      <Section title="Attempts">
        {attempts && attempts.length > 0 ? (
          <div className="flex flex-col gap-6">
            {totals.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <Stat label="Finished" value={`${finished.length} of ${attempts.length}`} />
                <Stat label="Stages played" value={String(totals.length)} />
                <Stat label="Ended by the clock" value={`${Math.round((totals.filter((t) => t.ended_by === "timer").length / totals.length) * 100)}%`} />
                <Stat label="Tokens" value={tokens(totals).toLocaleString()} />
                {finished.length > 0 ? (
                  <Stat
                    label="Minutes per finished attempt"
                    value={String(Math.round(finished.reduce((sum, a) => sum + minutes(a.attempt_telemetry ?? []), 0) / finished.length))}
                  />
                ) : null}
              </dl>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-base">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="py-2 pr-4 font-semibold">Version</th>
                    <th className="py-2 pr-4 font-semibold">Status</th>
                    <th className="py-2 pr-4 text-right font-semibold">Stages</th>
                    <th className="py-2 pr-4 text-right font-semibold">Minutes</th>
                    <th className="py-2 pr-4 text-right font-semibold">Messages</th>
                    <th className="py-2 pr-4 text-right font-semibold">Evidence</th>
                    <th className="py-2 pr-4 text-right font-semibold">Tokens</th>
                    <th className="py-2 font-semibold">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => {
                    const rows = attempt.attempt_telemetry ?? [];
                    return (
                      <tr key={attempt.id} className="border-b border-line tabular-nums">
                        <td className="py-2 pr-4">{attempt.published_version}</td>
                        <td className="py-2 pr-4 capitalize">{attempt.status}</td>
                        <td className="py-2 pr-4 text-right">{rows.length}</td>
                        <td className="py-2 pr-4 text-right">{minutes(rows)}</td>
                        <td className="py-2 pr-4 text-right">{rows.reduce((n, r) => n + r.messages, 0)}</td>
                        <td className="py-2 pr-4 text-right">{rows.reduce((n, r) => n + r.evidence_found, 0)}</td>
                        <td className="py-2 pr-4 text-right">{tokens(rows).toLocaleString()}</td>
                        <td className="py-2 text-muted">{new Date(attempt.updated_at).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="Nobody has joined yet">
            {adventure.status === "published"
              ? "Share the link above with your class. Each attempt appears here as soon as a student enters."
              : "Attempts appear here once the adventure is published and students open the link."}
          </EmptyState>
        )}
      </Section>
    </Page>
  );
}

function BriefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-32 shrink-0 text-base text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-base text-muted">{label}</dt>
      <dd className="font-serif text-2xl text-ink tabular-nums">{value}</dd>
    </div>
  );
}
