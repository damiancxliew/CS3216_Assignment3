import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";

import { DossierSections } from "./dossier";
import { BriefEditor } from "./brief-editor";
import { SharePanel } from "./share-panel";
import type { GenerationJob } from "./story-generation";
import {
  publishAdventure,
  startEdit,
  updateDefaultTimer,
  updateRetries,
} from "../actions";
import { ActionButton, ActionForm } from "@/components/action-form";
import {
  button,
  EmptyState,
  Field,
  Page,
  Section,
  SelectField,
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

// Each planner attempt is a separate server action and may need several minutes.
export const maxDuration = 300;

type EditorTab = "overview" | "stages" | "story" | "publish" | "attempts";
const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "stages", label: "Stages" },
  { id: "story", label: "Story" },
  { id: "publish", label: "Publish & share" },
  { id: "attempts", label: "Attempts" },
];

type Adventure = {
  id: string;
  student_role: string | null;
  learning_objectives: string[] | null;
  reading_level: ReadingLevel | null;
  title: string;
  setting: string | null;
  status: "draft" | "published" | "archived";
  published_version: number | null;
  assets_ready: boolean;
  default_timer_seconds: number;
  allow_retries: boolean;
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; stage?: string; view?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab = EDITOR_TABS.find((item) => item.id === query.tab)?.id ?? "overview";
  const stageView = query.view === "style" ? "style" : "content";
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher");

  // A student admitted to a published adventure can also select the row, so the
  // authoring view matches the owner rather than relying on visibility alone.
  const { data: adventure } = await supabase
    .from("adventure")
    .select("id, title, setting, status, published_version, assets_ready, default_timer_seconds, allow_retries, share_token, student_role, learning_objectives, reading_level, stage_outline")
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
  // The dossier shows the draft when one exists, else the published version —
  // except on Publish & share, where the artwork that is live belongs to the
  // published version, so that version leads there.
  const shown = draft ?? published;
  const dossierFor = tab === "publish" ? (published ?? draft) : shown;

  // `spec_version.json` is revoked from `authenticated`, so the dossier is
  // built with the service role now that ownership is confirmed.
  const dossier = dossierFor && (tab === "stages" || tab === "story" || tab === "publish")
    ? await buildDossier(createAdminClient(), { adventureId: id, specVersionId: dossierFor.id })
    : null;
  const selectedStage = dossier?.stages.find((stage) => stage.id === query.stage) ?? dossier?.stages[0] ?? null;
  const stageUrl = (stageId: string, view: "content" | "style") =>
    `/teacher/${id}?tab=stages&stage=${encodeURIComponent(stageId)}&view=${view}`;

  const { data: sources } = tab === "overview" ? await supabase
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
    >() : { data: null };
  const sourceRows = sources ?? [];
  const { data: generationJob } = tab === "overview" ? await supabase
    .from("generation_job")
    .select("state, phase, started_at, updated_at, message")
    .eq("adventure_id", id)
    .maybeSingle<GenerationJob>() : { data: null };

  const { data: attempts } = tab === "attempts" ? await supabase
    .from("attempt")
    .select("id, student_id, status, published_version, updated_at, attempt_telemetry(stage_index, ended_by, duration_seconds, tokens, messages, evidence_found)")
    .eq("adventure_id", id)
    .order("updated_at", { ascending: false })
    .returns<
      {
        id: string;
        student_id: string;
        status: string;
        published_version: number;
        updated_at: string;
        attempt_telemetry: { stage_index: number; ended_by: string; duration_seconds: number; tokens: number; messages: number; evidence_found: number }[];
      }[]
    >() : { data: null };
  const studentEmails = new Map<string, string>();
  if (attempts?.length) {
    // Ownership was checked above. Auth emails are only available through the
    // server-side admin client; look up each student once for repeat attempts.
    const admin = createAdminClient();
    await Promise.all([...new Set(attempts.map((attempt) => attempt.student_id))].map(async (studentId) => {
      const { data } = await admin.auth.admin.getUserById(studentId);
      if (data.user?.email) studentEmails.set(studentId, data.user.email);
    }));
  }
  // P11: what an attempt costs and how long it takes, summed from the per-stage rows.
  const totals = (attempts ?? []).map((a) => a.attempt_telemetry ?? []).flat();
  const finished = (attempts ?? []).filter((a) => a.status === "completed");
  const minutes = (rows: { duration_seconds: number }[]) => Math.round(rows.reduce((sum, r) => sum + r.duration_seconds, 0) / 60);
  const tokens = (rows: { tokens: number }[]) => rows.reduce((sum, r) => sum + r.tokens, 0);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const releaseChecklist: { done: boolean; label: string }[] = [
    { done: shown !== null, label: shown ? "Story ready" : "No story yet" },
  ];

  return (
    <Page
      kicker={
        <Link href="/teacher" className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 hover:bg-surface hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All adventures
        </Link>
      }
      title={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {adventure.title}
          <StatusBadge status={adventure.status} version={adventure.published_version} />
        </span>
      }
      lede={adventure.setting}
      width="wide"
    >
      <nav aria-label="Adventure sections" className="flex gap-2 overflow-x-auto border-b border-line pb-2">
        {EDITOR_TABS.map((item) => (
          <Link
            key={item.id}
            href={`/teacher/${id}?tab=${item.id}`}
            aria-current={tab === item.id ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-control px-4 text-base font-semibold transition-colors ${tab === item.id ? "bg-ink text-paper" : "text-muted hover:bg-surface hover:text-ink"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <>
      <Section title="Brief">
        {adventure.reading_level ? (
          <><dl className="flex flex-col divide-y divide-line rounded-surface border border-line bg-surface px-4 text-base sm:px-5">
            <BriefRow label="Student plays">{adventure.student_role}</BriefRow>
            <BriefRow label="Objectives">
              <ul className="list-disc space-y-1 pl-5">
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
          <BriefEditor
            adventureId={id}
            hasVersions={versions.length > 0}
            initialJob={generationJob}
            blockedReason={draft ? "Publish or discard the current draft before generating another." : sourceRows.length === 0 ? "Add a readable source before generating." : null}
            brief={{
              title: adventure.title,
              setting: adventure.setting ?? "",
              studentRole: adventure.student_role ?? "",
              learningObjectives: adventure.learning_objectives ?? [],
              readingLevel: adventure.reading_level,
              stageOutline: adventure.stage_outline,
            }}
          />
          </>
        ) : (
          <p className="text-base text-muted">
            This adventure can’t be regenerated. Create a new adventure to use the guided setup.
          </p>
        )}
      </Section>
      </> : null}

      {tab === "stages" ? (
        dossier && shown && selectedStage ? (
          <>
            <nav aria-label="Choose stage" className="flex flex-wrap gap-2">
              {dossier.stages.map((stage) => (
                <Link
                  key={stage.id}
                  href={stageUrl(stage.id, stageView)}
                  aria-current={selectedStage.id === stage.id ? "step" : undefined}
                  className={`${selectedStage.id === stage.id ? button.primary : button.quiet} max-w-full`}
                >
                  {stage.index + 1}. {stage.title}
                </Link>
              ))}
            </nav>
            <nav aria-label="Stage editor views" className="flex gap-2 border-b border-line pb-2">
              {(["content", "style"] as const).map((view) => (
                <Link
                  key={view}
                  href={stageUrl(selectedStage.id, view)}
                  aria-current={stageView === view ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-control px-4 text-base font-semibold ${stageView === view ? "bg-ink text-paper" : "text-muted hover:bg-surface hover:text-ink"}`}
                >
                  {view === "content" ? "Content" : "Style"}
                </Link>
              ))}
            </nav>
            <DossierSections dossier={dossier} adventureId={id} specVersionId={shown.id} isDraft={shown === draft} view={stageView === "content" ? "stage-content" : "stage-style"} stageId={selectedStage.id} />
          </>
        ) : <EmptyState title="No stages yet">Generate the adventure from Overview to create its stages.</EmptyState>
      ) : null}

      {tab === "story" ? (
        dossier && shown ? <DossierSections dossier={dossier} adventureId={id} specVersionId={shown.id} isDraft={shown === draft} view="story" />
        : <EmptyState title="No story yet">Generate the adventure from Overview to review its cast and endings.</EmptyState>
      ) : null}

      {tab === "publish" ? <>
      <Section title="Release">
        <ul className="flex flex-col gap-1.5 text-base">
          {releaseChecklist.map((row) => (
            <li key={row.label} className={`flex items-center gap-2.5 ${row.done ? "text-ink" : "text-muted"}`}>
              {row.done ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50 mx-[5px]" aria-hidden />
              )}
              {row.label}
            </li>
          ))}
        </ul>
        {draft ? (
          <ActionButton action={publishAdventure.bind(null, id)} label={`Publish version ${draft.version}`} pendingLabel="Publishing…" event={ANALYTICS_EVENTS.adventurePublished} />
        ) : published ? (
          <ActionButton action={startEdit.bind(null, id)} label="Create a new version" pendingLabel="Copying…" />
        ) : (
          <p className="text-base text-muted">Write the story from Overview first.</p>
        )}
        {versions.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface px-4 text-base sm:px-5">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="font-semibold text-ink">Version {version.version}</span>
                <span className="text-sm text-muted sm:text-right sm:text-base">
                  {version.published_at
                    ? `Published ${new Date(version.published_at).toLocaleString()}, frozen`
                    : "Draft, editable"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {dossier && dossierFor ? <DossierSections dossier={dossier} adventureId={id} specVersionId={dossierFor.id} isDraft={dossierFor === draft} view="artwork" watchForArtwork={dossierFor === published && !adventure.assets_ready && Boolean(process.env.OPENAI_API_KEY) && published.published_at !== null && Date.now() - Date.parse(published.published_at) < 600_000} /> : null}

      <Section title="Share with students">
        <SharePanel
          adventureId={adventure.id}
          token={adventure.share_token}
          published={adventure.status === "published"}
          ready={adventure.assets_ready}
        />
        {adventure.status === "published" ? (
          <Link href={`/join/${adventure.share_token}`} className={`${button.quiet} w-fit`}>
            Preview as a player
          </Link>
        ) : null}
      </Section>

      <details className="rounded-surface border border-line bg-surface px-4 py-3 sm:px-5">
        <summary className="cursor-pointer font-serif text-xl text-ink">Playing settings</summary>
        <div className="mt-4 flex flex-col gap-6">
          <Section
            title="Stage timer"
            lede="The timer starts when a student enters a stage. Refreshing or reopening the page won’t reset it."
          >
            <ActionForm
              action={updateDefaultTimer.bind(null, adventure.id)}
              submitLabel="Save default"
              pendingLabel="Saving…"
              className="flex max-w-xl flex-col gap-4"
            >
              <Field
                name="default_timer_seconds"
                label="Default per stage, in seconds"
                hint="0 disables timers entirely. Each stage can override this above."
                defaultValue={String(adventure.default_timer_seconds)}
                type="number"
                inputMode="numeric"
                min={0}
              />
            </ActionForm>
          </Section>

          <Section
            title="Retries"
            lede="An attempt that is still open always resumes, whatever this is set to. This decides what happens once a student has reached an ending."
          >
            <ActionForm
              action={updateRetries.bind(null, adventure.id)}
              submitLabel="Save"
              pendingLabel="Saving…"
            >
              <SelectField
                name="allow_retries"
                label="When a student has finished"
                options={[
                  { value: "on", label: "Let them play again from the start" },
                  { value: "off", label: "Keep them on the attempt they finished" },
                ]}
                defaultValue={adventure.allow_retries ? "on" : "off"}
              />
            </ActionForm>
          </Section>
        </div>
      </details>
      </> : null}

      {tab === "attempts" ? (
      <Section title="Attempts">
        {attempts && attempts.length > 0 ? (
          <div className="flex flex-col gap-6">
            {totals.length > 0 ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
            <div className="overflow-x-auto rounded-surface border border-line bg-surface">
              <table className="w-full min-w-[50rem] border-collapse text-base">
                <thead>
                  <tr className="border-b border-line bg-sunken/50 text-left text-muted">
                    <th className="py-2 pl-4 pr-4 font-semibold">Student email</th>
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
                        <td className="py-2 pl-4 pr-4">{studentEmails.get(attempt.student_id) ?? `Student ${attempt.student_id.slice(0, 8)}`}</td>
                        <td className="py-2 pr-4">{attempt.published_version}</td>
                        <td className="py-2 pr-4 capitalize">{attempt.status}</td>
                        <td className="py-2 pr-4 text-right">{rows.length}</td>
                        <td className="py-2 pr-4 text-right">{minutes(rows)}</td>
                        <td className="py-2 pr-4 text-right">{rows.reduce((n, r) => n + r.messages, 0)}</td>
                        <td className="py-2 pr-4 text-right">{rows.reduce((n, r) => n + r.evidence_found, 0)}</td>
                        <td className="py-2 pr-4 text-right">{tokens(rows).toLocaleString()}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-muted">{new Date(attempt.updated_at).toLocaleString()}</td>
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
      ) : null}
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
    <div className="flex min-h-24 flex-col justify-between gap-2 rounded-control border border-line bg-surface p-3.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-serif text-2xl text-ink tabular-nums">{value}</dd>
    </div>
  );
}
