import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V3PublishPanel } from "@/components/play/v3/publish-panel";
import { button, EmptyState, Page, Section } from "@/components/ui";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { briefStateV3Schema } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_LABELS } from "@/lib/v3/generation/labels";
import { viewerSeesCost } from "@/lib/v3/generation/service";
import type { SkeletonShape } from "@adventure/spec-v3";

import { getV3GenerationProgress } from "../actions";
import { V3BriefChat } from "./brief-chat";
import { GenerationProgress } from "./generation-progress";
import { ContinueGeneration, StartAgain } from "./review-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Adventure",
  robots: { index: false },
};

export default async function V3AdventurePage({ params }: { params: Promise<{ id: string }> }) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer)) notFound();

  const row = await supabaseV3BriefStore(createAdminClient()).load(id);
  if (!row || row.ownerId !== viewer.user.id || !v3SchoolAllowed(row.schoolId)) notFound();

  switch (row.status) {
    case "briefing": {
      const state = briefStateV3Schema.safeParse(row.state);
      if (!state.success) notFound();
      return (
        <Page title="New adventure" lede="A few short questions, then the generator builds the world." width="wide">
          <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col">
            <V3BriefChat initial={state.data} />
          </div>
        </Page>
      );
    }
    case "generating":
      return (
        <Page title="Generating your adventure" lede="The passes run in order — you can leave this page and come back.">
          <GenerationProgress adventureId={id} seesCost={viewerSeesCost(viewer)} />
        </Page>
      );
    case "needs_review": {
      const progress = await getV3GenerationProgress(id);
      const skeleton = progress && !("error" in progress) ? (progress.skeleton as SkeletonShape | undefined) : undefined;
      return (
        <Page title="Check the skeleton" lede="This is what the generator plans to build. Continue when it looks right.">
          {skeleton ? <SkeletonOutline skeleton={skeleton} /> : <EmptyState title="No skeleton">The skeleton could not be loaded.</EmptyState>}
          <div className="mt-6">
            <ContinueGeneration adventureId={id} />
          </div>
        </Page>
      );
    }
    case "draft": {
      const progress = await getV3GenerationProgress(id);
      const warnings = progress && !("error" in progress) ? progress.warnings : [];
      const byPass = new Map<string, typeof warnings>();
      for (const warning of warnings) {
        const list = byPass.get(warning.pass) ?? [];
        list.push(warning);
        byPass.set(warning.pass, list);
      }
      return (
        <Page title="Adventure ready" lede="Generation finished. Review it, then publish when you're happy.">
          {byPass.size > 0 ? (
            <Section title="Warnings">
              <div className="flex flex-col gap-4">
                {[...byPass.entries()].map(([pass, list]) => (
                  <div key={pass}>
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.12em] text-muted">{PASS_LABELS[pass as keyof typeof PASS_LABELS] ?? pass}</h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                      {list.map((warning, i) => (
                        <li key={i}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={`/v3/teacher/${id}/preview`} className={button.primary}>
              Preview
            </Link>
            <button type="button" disabled className={button.subtle} title="Review and edit is coming soon">
              Review and edit
            </button>
            <span className="text-xs text-muted">coming soon</span>
          </div>
          <div className="mt-6">
            <V3PublishPanel adventureId={id} published={false} />
          </div>
        </Page>
      );
    }
    case "failed": {
      const progress = await getV3GenerationProgress(id);
      const failed = progress && !("error" in progress) ? progress.steps.find((s) => s.status === "failed") : undefined;
      const label = failed ? (PASS_LABELS[failed.name as keyof typeof PASS_LABELS] ?? failed.name) : "generation";
      return (
        <Page title="Generation stopped" lede={`Generation stopped at ${label}. You can start again with the same sources.`}>
          <StartAgain adventureId={id} />
          {failed?.error ? (
            <details className="mt-6 max-w-2xl text-sm text-muted">
              <summary className="cursor-pointer font-semibold">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-surface border border-line bg-sunken p-3">{failed.error}</pre>
            </details>
          ) : null}
        </Page>
      );
    }
    default:
      return (
        <Page
          title={row.title ?? "Adventure"}
          lede={row.status === "published" ? "Students can play this adventure from its link." : "This adventure is already finished."}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/v3/teacher/${id}/preview`} className={button.primary}>
              Preview
            </Link>
            <Link href={`/v3/teacher/${id}/summary`} className={button.quiet}>
              Class summary
            </Link>
          </div>
          <div className="mt-6">
            <V3PublishPanel adventureId={id} published={row.status === "published"} />
          </div>
        </Page>
      );
  }
}

function SkeletonOutline({ skeleton }: { skeleton: SkeletonShape }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-ink">{skeleton.title}</h2>
        <p className="mt-1 text-muted">{skeleton.arc}</p>
        <p className="mt-2 text-sm text-ink">
          <span className="font-semibold">You play:</span> {skeleton.role.name} — {skeleton.role.situation}
        </p>
      </div>
      <Section title="Characters">
        <ul className="grid gap-2 sm:grid-cols-2">
          {skeleton.characters.map((character) => (
            <li key={character.id} className="rounded-surface border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{character.name}</span>
              <span className="text-muted"> · {character.title}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Stages">
        <ol className="flex flex-col gap-2">
          {skeleton.stages.map((stage) => (
            <li key={stage.id} className="rounded-surface border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{stage.title}</span>
              <span className="text-muted"> · {stage.timePlace}</span>
              <p className="mt-0.5 text-muted">{stage.centralQuestion}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Endings">
        <ul className="flex flex-col gap-2">
          {skeleton.endings.map((ending) => (
            <li key={ending.id} className="rounded-surface border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{ending.title}</span>
              <span className="text-muted"> · {ending.type === "historical" ? "What really happened" : ending.type === "secret" ? "Secret" : "Alternative"}</span>
              <p className="mt-0.5 text-muted">{ending.summary}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
