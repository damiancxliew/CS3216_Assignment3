/**
 * P8 — ending and debrief (FR-19).
 *
 * The teaching claim of the debrief is a separation, not a summary: what the
 * record says, with citations a student can check, has to be distinguishable
 * from what the simulation made up to fill the gaps. Spec v2 already carries
 * that split — `ending.historicalOutcome` is `grounded()`, so it arrives with
 * `spans` (source, page, verbatim quote) and `assumptionIds` — so this module
 * resolves those references and hands the page two separately-typed lists it
 * cannot accidentally merge.
 *
 * The attempt is read as the signed-in user, so RLS decides whose debrief this
 * is, and against the version the attempt pinned (P4), so a teacher
 * republishing mid-attempt cannot rewrite the history a student is being
 * debriefed on. The spec itself is server-side only — it carries private agent
 * context and branch targets — so it is read with the service role and only
 * the debrief slice below ever leaves this module (FR-21).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

/** Only the debrief-relevant slice of the spec, parsed defensively. */
const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  pageCount: z.number().optional(),
});

const assumptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  rationale: z.string(),
});

const endingSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  historicalOutcome: z.object({
    text: z.string(),
    spans: z
      .array(
        z.object({
          sourceId: z.string(),
          page: z.number(),
          quote: z.string(),
        }),
      )
      .default([]),
    assumptionIds: z.array(z.string()).default([]),
  }),
  divergence: z.string(),
  reflectionQuestions: z.array(z.string()),
});

const specSchema = z.object({
  title: z.string().optional(),
  sources: z.array(sourceSchema).default([]),
  assumptions: z.array(assumptionSchema).default([]),
  endings: z.array(endingSchema).default([]),
  stages: z.array(z.object({
    index: z.number(),
    title: z.string(),
    evidence: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  })).default([]),
});

const journalEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceSpan: z.string().nullable().default(null),
});

export type Citation = {
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  page: number;
  quote: string;
};

export type StageOutcome = {
  stageIndex: number;
  stageTitle: string;
  /** The option the player committed to, or null when the timer decided for them. */
  chose: string | null;
  /** The resolver's public announcement. Rolls and rationale never leave the server (FR-21). */
  announcement: string;
  /** One line per world change the resolution recorded, in the resolver's words. */
  changes: string[];
  evidenceFound: number;
};

export type Debrief = {
  attemptId: string;
  adventureTitle: string;
  ending: { id: string; title: string };
  /** What the player actually did, stage by stage — the simulation's own record. */
  path: StageOutcome[];
  /** What happened in the simulation: invented by construction. */
  simulatedOutcome: string;
  /** What the record says, and the spans it says it in. */
  documentedHistory: { text: string; citations: Citation[] };
  /** Named inventions the simulation used where the record is silent. */
  assumptions: { id: string; text: string; rationale: string }[];
  divergence: string;
  reflectionQuestions: string[];
  collectedEvidence: { id: string; name: string; text: string; sourceSpan: string | null; stageTitle: string | null }[];
};

export async function loadDebrief(
  supabase: SupabaseClient,
  attemptId: string,
  specReader: SupabaseClient = createAdminClient(),
): Promise<Debrief | null> {
  const { data: attempt } = await supabase
    .from("attempt")
    .select("id, status, ending_id, adventure_id, published_version, adventure(title)")
    .eq("id", attemptId)
    .maybeSingle();

  if (attempt?.status !== "completed" || !attempt.ending_id) return null;

  const { data: specVersion } = await specReader
    .from("spec_version")
    .select("json")
    .eq("adventure_id", attempt.adventure_id)
    .eq("version", attempt.published_version)
    .maybeSingle();

  const parsed = specSchema.safeParse(specVersion?.json);
  if (!parsed.success) return null;

  const spec = parsed.data;
  const ending = spec.endings.find((e) => e.id === attempt.ending_id);
  if (!ending) return null;

  const sourceById = new Map(spec.sources.map((s) => [s.id, s]));
  const assumptionById = new Map(spec.assumptions.map((a) => [a.id, a]));
  const adventure = attempt.adventure as unknown as { title: string } | null;

  // The record of play, read server-side once the student's own client has proved the attempt is
  // theirs (the `attempt` read above goes through RLS). Resolutions hold the rolls, so only their
  // public half is projected; commitments are joined to their option labels.
  const [{ data: resolutions }, { data: commitments }, { data: state }] = await Promise.all([
    specReader
      .from("resolution")
      .select("stage_id, outcome, created_at, stage(index, title)")
      .eq("attempt_id", attemptId)
      .order("created_at")
      .returns<{ stage_id: string; outcome: { announcement?: string; worldDeltas?: { summary?: string }[] }; stage: { index: number; title: string } | null }[]>(),
    specReader
      .from("stage_commitment")
      .select("stage_id, option_id, minted_option_id, decision_option(label), minted_option(label)")
      .eq("attempt_id", attemptId)
      .eq("actor_kind", "player")
      .returns<{ stage_id: string; option_id: string | null; minted_option_id: string | null; decision_option: { label: string } | null; minted_option: { label: string } | null }[]>(),
    specReader.from("attempt_state").select("journal").eq("attempt_id", attemptId).maybeSingle<{ journal: unknown }>(),
  ]);
  const choiceByStage = new Map((commitments ?? []).map((c) => [c.stage_id,
    c.option_id ? c.decision_option?.label ?? "an option"
      : c.minted_option_id ? c.minted_option?.label ?? "a choice developed in conversation" : null,
  ]));
  const journal = (Array.isArray(state?.journal) ? state.journal : []).flatMap((entry) => {
    const parsed = journalEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const collectedIds = new Set(journal.map((entry) => entry.id));
  const path: StageOutcome[] = (resolutions ?? []).map((r) => ({
    stageIndex: r.stage?.index ?? 0,
    stageTitle: r.stage?.title ?? `Stage ${(r.stage?.index ?? 0) + 1}`,
    chose: choiceByStage.get(r.stage_id) ?? null,
    announcement: r.outcome?.announcement ?? "",
    changes: (r.outcome?.worldDeltas ?? []).map((d) => d.summary ?? "").filter(Boolean),
    evidenceFound: spec.stages.find((stage) => stage.index === r.stage?.index)?.evidence.filter((item) => collectedIds.has(item.id)).length ?? 0,
  }));

  return {
    attemptId: attempt.id as string,
    adventureTitle: adventure?.title ?? spec.title ?? "Your adventure",
    ending: { id: ending.id, title: ending.title },
    path,
    simulatedOutcome: ending.summary,
    documentedHistory: {
      text: ending.historicalOutcome.text,
      citations: ending.historicalOutcome.spans.map((span) => {
        const source = sourceById.get(span.sourceId);
        return {
          sourceId: span.sourceId,
          sourceTitle: source?.title ?? span.sourceId,
          sourceKind: source?.kind ?? "source",
          page: span.page,
          quote: span.quote,
        };
      }),
    },
    assumptions: ending.historicalOutcome.assumptionIds.flatMap((id) => {
      const assumption = assumptionById.get(id);
      return assumption ? [assumption] : [];
    }),
    divergence: ending.divergence,
    reflectionQuestions: ending.reflectionQuestions,
    collectedEvidence: journal.map((entry) => {
      const stage = spec.stages.find((candidate) => candidate.evidence.some((item) => item.id === entry.id));
      const name = stage?.evidence.find((item) => item.id === entry.id)?.name ?? entry.text.split(": ")[0]!;
      return {
        id: entry.id,
        name,
        text: entry.text.startsWith(`${name}: `) ? entry.text.slice(name.length + 2) : entry.text,
        sourceSpan: entry.sourceSpan,
        stageTitle: stage?.title ?? null,
      };
    }),
  };
}
