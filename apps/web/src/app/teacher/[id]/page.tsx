import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { READING_BANDS } from "@adventure/generation/spec";

import { SharePanel } from "./share-panel";
import {
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
import { Field, Section, SelectField, StatusBadge } from "@/components/ui";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

// Generation is one long model call; the actions invoked from this page inherit this budget.
export const maxDuration = 300;

const READING_BAND_LABELS: Record<(typeof READING_BANDS)[number], string> = {
  primary: "Primary",
  "lower-secondary": "Lower secondary",
  "upper-secondary": "Upper secondary",
  "pre-university": "Pre-university",
};

type Adventure = {
  id: string;
  title: string;
  setting: string | null;
  status: "draft" | "published" | "archived";
  published_version: number | null;
  default_timer_seconds: number;
  share_token: string;
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

  // RLS does the authorisation: another teacher's adventure simply is not here.
  const { data: adventure } = await supabase
    .from("adventure")
    .select("id, title, setting, status, published_version, default_timer_seconds, share_token")
    .eq("id", id)
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
    .select("id, title, kind")
    .eq("adventure_id", id)
    .returns<{ id: string; title: string | null; kind: string }[]>();

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
    .select("id, status, published_version, updated_at")
    .eq("adventure_id", id)
    .order("updated_at", { ascending: false })
    .returns<
      { id: string; status: string; published_version: number; updated_at: string }[]
    >();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link href="/teacher" className="w-fit text-sm opacity-60 hover:opacity-100">
          ← All adventures
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

      <Section title="Sources">
        {sources && sources.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {sources.map((source) => (
              <li key={source.id}>
                {source.title ?? "Untitled"}{" "}
                <span className="opacity-50">({source.kind})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-60">No source material yet.</p>
        )}
        <ActionForm
          action={addTextSource.bind(null, adventure.id)}
          submitLabel="Add source"
          pendingLabel="Adding…"
          event={ANALYTICS_EVENTS.sourceUploaded}
        >
          <Field name="title" label="Source title" placeholder="Classroom handout" optional />
          <Field
            name="body"
            label="Source text"
            placeholder="Paste the passage students will play from…"
            multiline
          />
        </ActionForm>
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
          <details className="text-sm" open={versions.length === 0}>
            <summary className="cursor-pointer opacity-70">
              Generate {versions.length === 0 ? "a draft" : "a new version"} from the sources
            </summary>
            <div className="pt-3">
              {!sources || sources.length === 0 ? (
                <p className="opacity-60">Add at least one source first.</p>
              ) : (
                <ActionForm
                  action={generateFromSources.bind(null, adventure.id)}
                  submitLabel={`Generate from ${sources.length} source${sources.length === 1 ? "" : "s"}`}
                  pendingLabel="Generating… this takes a minute or two"
                  event={ANALYTICS_EVENTS.generationCompleted}
                >
                  <Field
                    name="setting"
                    label="Setting"
                    placeholder="Singapore and Johor, 1819"
                    defaultValue={adventure.setting ?? undefined}
                  />
                  <Field
                    name="studentRole"
                    label="Who the student plays"
                    placeholder="Junior interpreter to the expedition"
                  />
                  <Field
                    name="learningObjectives"
                    label="Learning objectives (one per line, up to six)"
                    placeholder={"Explain why the EIC wanted a port at the Straits\nDescribe the Johor succession dispute"}
                    multiline
                    rows={3}
                  />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <SelectField
                      name="band"
                      label="Reading level"
                      defaultValue="lower-secondary"
                      options={READING_BANDS.map((band) => ({ value: band, label: READING_BAND_LABELS[band] }))}
                    />
                    <Field name="ageMin" label="Age from" defaultValue="13" />
                    <Field name="ageMax" label="Age to" defaultValue="14" />
                    <SelectField
                      name="stageCount"
                      label="Stages"
                      defaultValue="3"
                      options={[
                        { value: "1", label: "1" },
                        { value: "2", label: "2" },
                        { value: "3", label: "3" },
                      ]}
                    />
                  </div>
                </ActionForm>
              )}
            </div>
          </details>
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
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                v{attempt.published_version} · {attempt.status} ·{" "}
                <span className="opacity-50">
                  {new Date(attempt.updated_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-60">Nobody has joined yet.</p>
        )}
      </Section>
    </main>
  );
}
