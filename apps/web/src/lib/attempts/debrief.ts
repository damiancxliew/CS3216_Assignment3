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
 * Read as the signed-in user against the version the attempt pinned (P4), so a
 * teacher republishing mid-attempt cannot rewrite the history a student is
 * being debriefed on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

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
});

export type Citation = {
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  page: number;
  quote: string;
};

export type Debrief = {
  attemptId: string;
  adventureTitle: string;
  ending: { id: string; title: string };
  /** What happened in the simulation: invented by construction. */
  simulatedOutcome: string;
  /** What the record says, and the spans it says it in. */
  documentedHistory: { text: string; citations: Citation[] };
  /** Named inventions the simulation used where the record is silent. */
  assumptions: { id: string; text: string; rationale: string }[];
  divergence: string;
  reflectionQuestions: string[];
};

export async function loadDebrief(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<Debrief | null> {
  const { data: attempt } = await supabase
    .from("attempt")
    .select("id, status, ending_id, adventure_id, published_version, adventure(title)")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt?.ending_id) return null;

  const { data: specVersion } = await supabase
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

  return {
    attemptId: attempt.id as string,
    adventureTitle: adventure?.title ?? spec.title ?? "Your adventure",
    ending: { id: ending.id, title: ending.title },
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
  };
}
