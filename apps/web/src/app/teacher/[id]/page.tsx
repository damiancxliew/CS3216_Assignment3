import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SharePanel } from "./share-panel";
import {
  addFileSource,
  addTextSource,
  generateFromSources,
  importSpec,
  publishAdventure,
  startEdit,
  updateDefaultTimer,
  updateAgent,
  updateStage,
} from "../actions";
import { ActionButton, ActionForm } from "@/components/action-form";
import {
  Field,
  FileField,
  Section,
  StatusBadge,
  READING_BAND_LABELS,
} from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { ReadingLevel } from "@/lib/brief/schema";
import { createClient } from "@/lib/supabase/server";

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

type Stage = {
  id: string;
  index: number;
  title: string;
  shared_context: string;
  timer_seconds: number | null;
  agent: { id: string; name: string; role: string | null; public_position: string | null }[];
};

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
  const editable = draft ?? null;

  const { data: sources } = await supabase
    .from("source")
    .select("id, title, kind, page_map")
    .eq("adventure_id", id)
    .returns<
      {
        id: string;
        title: string | null;
        kind: string;
        page_map: { pages?: number } | null;
      }[]
    >();

  const { data: stageRows } = editable
    ? await supabase
        .from("stage")
        .select(
          "id, index, title, shared_context, timer_seconds, agent(id, name, role, public_position)",
        )
        .eq("spec_version_id", editable.id)
        .order("index")
        .returns<Stage[]>()
    : { data: [] as Stage[] };
  const stages = stageRows ?? [];

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

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link href="/teacher" className="inline-flex w-fit items-center gap-1 text-sm opacity-60 hover:opacity-100">
          <ArrowLeft className="h-4 w-4" aria-hidden /> All adventures
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{adventure.title}</h1>
          <StatusBadge
            status={adventure.status}
            version={adventure.published_version}
          />
        </div>
        {adventure.setting ? <p className="opacity-70">{adventure.setting}</p> : null}
      </header>

      <Section title="Brief">
        {adventure.reading_level ? (
          <dl className="flex flex-col divide-y divide-black/10 text-sm dark:divide-white/10">
            <BriefRow label="Student plays">{adventure.student_role}</BriefRow>
            <BriefRow label="Objectives">
              <ul className="list-disc pl-4">
                {adventure.learning_objectives?.map((objective) => <li key={objective}>{objective}</li>)}
              </ul>
            </BriefRow>
            <BriefRow label="Reading level">
              {READING_BAND_LABELS[adventure.reading_level.band]} · ages {adventure.reading_level.ageMin}–{adventure.reading_level.ageMax}
            </BriefRow>
            {adventure.stage_outline.map((stage, index) => (
              <BriefRow key={stage.title} label={`Stage ${index + 1}`}>
                <span className="font-medium">{stage.title}</span> — {stage.focus}
              </BriefRow>
            ))}
          </dl>
        ) : (
          <p className="text-sm opacity-60">
            This adventure predates the brief conversation and cannot be generated. Create a new one from the console.
          </p>
        )}
      </Section>

      <Section title="Sources">
        {sources && sources.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {sources.map((source) => (
              <li key={source.id}>
                {source.title ?? "Untitled"}{" "}
                <span className="opacity-50">
                  ({source.kind}
                  {source.page_map?.pages
                    ? ` · ${source.page_map.pages} page${source.page_map.pages === 1 ? "" : "s"}`
                    : ""}
                  )
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-60">No source material yet.</p>
        )}
        <ActionForm
          action={addFileSource.bind(null, adventure.id)}
          submitLabel="Upload source"
          pendingLabel="Reading…"
          event={ANALYTICS_EVENTS.sourceUploaded}
        >
          <Field name="title" label="Source title" placeholder="Uses the filename" optional />
          <FileField
            name="file"
            label="PDF, .txt or .md"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            hint="Text is extracted page by page, because pages are what the debrief cites. A scanned PDF has no text layer — paste it below instead."
          />
        </ActionForm>

        <details className="text-sm">
          <summary className="cursor-pointer opacity-70">Or paste the text</summary>
          <div className="pt-3">
            <ActionForm
              action={addTextSource.bind(null, adventure.id)}
              submitLabel="Add source"
              pendingLabel="Adding…"
              event={ANALYTICS_EVENTS.sourceUploaded}
            >
              <Field
                name="title"
                label="Source title"
                placeholder="Classroom handout"
                optional
              />
              <Field
                name="body"
                label="Source text"
                placeholder="Paste the passage students will play from…"
                multiline
              />
            </ActionForm>
          </div>
        </details>
      </Section>

      <Section title="Content">
        {versions.length === 0 ? (
          <p className="text-sm opacity-60">
            No version yet. Generate one from the sources above to get a playable draft.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {versions.map((version) => (
              <li key={version.id}>
                v{version.version}{" "}
                <span className="opacity-50">
                  {version.published_at
                    ? `published ${new Date(version.published_at).toLocaleString()} · frozen`
                    : "draft · editable"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <ActionButton
            action={publishAdventure.bind(null, adventure.id)}
            label={`Publish v${draft.version}`}
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
          <p className="text-sm opacity-60">
            v{published.version} is published and frozen. Editing copies it into a new
            draft; students already playing stay on the version they started.
          </p>
        ) : null}

        {draft ? (
          <p className="text-sm opacity-60">
            Publish or discard draft v{draft.version} before generating again.
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {!sources || sources.length === 0 ? (
              <p className="opacity-60">Add at least one source, then generate {versions.length === 0 ? "a draft" : "a new version"} from it.</p>
            ) : (
              <ActionButton
                action={generateFromSources.bind(null, adventure.id)}
                label={`Generate ${versions.length === 0 ? "a draft" : "a new version"} from ${sources.length} source${sources.length === 1 ? "" : "s"}`}
                pendingLabel="Generating… this takes a minute or two"
                event={ANALYTICS_EVENTS.generationCompleted}
              />
            )}
            <p className="opacity-60">The planner builds from the brief above and the sources.</p>
          </div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer opacity-70">Import an adventure spec</summary>
          <div className="pt-3">
            <ActionForm
              action={importSpec.bind(null, adventure.id)}
              submitLabel="Import as draft"
              pendingLabel="Importing…"
              event={ANALYTICS_EVENTS.generationCompleted}
            >
              <Field
                name="spec"
                label="Adventure spec v2 (JSON)"
                placeholder='{"version": 2, "id": "…"}'
                multiline
                rows={8}
              />
            </ActionForm>
            <p className="pt-2 opacity-60">
              For a spec produced elsewhere (the generation CLI, a hand-authored fixture).
              It goes through the same validation and write path as generation.
            </p>
          </div>
        </details>
      </Section>

      {editable && stages.length > 0 ? (
        <Section title={`Editing draft v${editable.version}`}>
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="flex flex-col gap-4 rounded-2xl border border-black/10 p-5 dark:border-white/15"
            >
              <ActionForm
                action={updateStage.bind(null, adventure.id, stage.id)}
                submitLabel="Save stage"
                pendingLabel="Saving…"
              >
                <Field
                  name="title"
                  label={`Stage ${stage.index + 1}`}
                  defaultValue={stage.title}
                />
                <Field
                  name="shared_context"
                  label="Shared context"
                  defaultValue={stage.shared_context}
                  multiline
                />
                <Field
                  name="timer_seconds"
                  label={`Timer override in seconds — empty inherits ${adventure.default_timer_seconds}, 0 disables`}
                  defaultValue={
                    stage.timer_seconds === null ? "" : String(stage.timer_seconds)
                  }
                  placeholder={String(adventure.default_timer_seconds)}
                  optional
                />
              </ActionForm>

              {stage.agent.map((agent) => (
                <ActionForm
                  key={agent.id}
                  action={updateAgent.bind(null, adventure.id, agent.id)}
                  submitLabel="Save stakeholder"
                  pendingLabel="Saving…"
                >
                  <Field name="name" label="Stakeholder" defaultValue={agent.name} />
                  <Field name="role" label="Role" defaultValue={agent.role ?? ""} optional />
                  <Field
                    name="public_position"
                    label="Public position"
                    defaultValue={agent.public_position ?? ""}
                    multiline
                    rows={3}
                  />
                </ActionForm>
              ))}
              <p className="text-xs opacity-50">
                Private motivations are edited by the generator, never shown here: they
                live in a table no client role can read.
              </p>
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Stage timer">
        <ActionForm
          action={updateDefaultTimer.bind(null, adventure.id)}
          submitLabel="Save default"
          pendingLabel="Saving…"
        >
          <Field
            name="default_timer_seconds"
            label="Default per stage, in seconds (0 disables timers entirely)"
            defaultValue={String(adventure.default_timer_seconds)}
          />
        </ActionForm>
        <p className="text-sm opacity-60">
          The deadline itself is set and checked in the database when a stage opens,
          so refreshing, reopening the tab or changing the device clock buys no extra
          time. Per-stage overrides live with each stage below.
        </p>
      </Section>

      <Section title="Share with students">
        <SharePanel
          adventureId={adventure.id}
          token={adventure.share_token}
          published={adventure.status === "published"}
        />
        {adventure.status === "published" ? (
          <Link
            href={`/join/${adventure.share_token}`}
            className="w-fit text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
          >
            Preview as a player
          </Link>
        ) : null}
      </Section>

      <Section title="Attempts">
        {attempts && attempts.length > 0 ? (
          <div className="flex flex-col gap-3">
            {totals.length > 0 ? (
              <p className="text-sm opacity-70">
                {finished.length} of {attempts.length} finished · {totals.length} stage{totals.length === 1 ? "" : "s"} played ·{" "}
                {Math.round(totals.filter((t) => t.ended_by === "timer").length / totals.length * 100)}% ended by the clock ·{" "}
                {tokens(totals).toLocaleString()} tokens
                {finished.length > 0 ? ` · ${Math.round(finished.reduce((sum, a) => sum + minutes(a.attempt_telemetry ?? []), 0) / finished.length)} min per finished attempt` : ""}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1 text-sm opacity-80">
              {attempts.map((attempt) => {
                const rows = attempt.attempt_telemetry ?? [];
                return (
                  <li key={attempt.id}>
                    v{attempt.published_version} · {attempt.status}
                    {rows.length > 0
                      ? ` · ${rows.length} stage${rows.length === 1 ? "" : "s"} · ${minutes(rows)} min · ${tokens(rows).toLocaleString()} tokens · ${rows.reduce((n, r) => n + r.messages, 0)} messages · ${rows.reduce((n, r) => n + r.evidence_found, 0)} evidence`
                      : ""}{" "}
                    · <span className="opacity-50">{new Date(attempt.updated_at).toLocaleString()}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm opacity-60">Nobody has joined yet.</p>
        )}
      </Section>
    </main>
  );
}

function BriefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <dt className="w-28 shrink-0 opacity-60">{label}</dt>
      <dd className="flex-1">{children}</dd>
    </div>
  );
}
