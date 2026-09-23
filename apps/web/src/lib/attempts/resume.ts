/**
 * P7 — persistence and resume (FR-18).
 *
 * Everything a returning student needs is already on the server: the attempt
 * row, its `attempt_state` journal and position, the room transcript and the
 * commitments for the open stage. Resuming is therefore a read, not a restore
 * — there is no client-side session to rebuild, so killing the tab mid-stage
 * loses nothing, and re-reading cannot move the deadline (D12/FR-16).
 *
 * The read runs as the signed-in user, so RLS decides what comes back: another
 * student's attempt simply does not exist, private agent-to-agent messages are
 * filtered by the `message_select` policy, and `agent_memory` / `resolution`
 * are denied to client roles outright (FR-21). The projection below adds no
 * privileged lookup of its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { PublicActorCommitment, PublicMessage } from "@/lib/turn-api/contract";

/** Journal entries are written as jsonb, so they are parsed, not trusted. */
export const journalEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceSpan: z.string().nullable().default(null),
  collectedAt: z.string(),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;

export type ResumeState = {
  attemptId: string;
  adventureTitle: string;
  /** Whether the teacher lets a finished attempt be followed by a fresh one. */
  retriesAllowed: boolean;
  status: "active" | "spectating" | "completed" | "abandoned";
  stage: { id: string; index: number; title: string; sharedContext: string } | null;
  stageCount: number;
  timer: { deadlineAt: string | null; serverNow: string };
  journal: JournalEntry[];
  transcript: PublicMessage[];
  commitments: PublicActorCommitment[];
  playerPos: { x: number; y: number } | null;
  /** Player-facing lines answering "where was I?", newest fact last. */
  recap: string[];
};

const positionSchema = z.object({ x: z.number(), y: z.number() });

const MAX_TRANSCRIPT = 50;

export async function loadResumeState(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<ResumeState | null> {
  const { data: attempt } = await supabase
    .from("attempt")
    .select(
      "id, status, current_stage_id, stage_deadline_at, published_version, adventure(id, title, allow_retries)",
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) return null;

  const adventure = attempt.adventure as unknown as { id: string; title: string; allow_retries: boolean };

  const [{ data: state }, { data: stage }, { data: messages }, { data: commitments }] =
    await Promise.all([
      supabase
        .from("attempt_state")
        .select("journal, player_pos")
        .eq("attempt_id", attemptId)
        .maybeSingle(),
      attempt.current_stage_id
        ? supabase
            .from("stage")
            .select("id, index, title, shared_context, spec_version_id")
            .eq("id", attempt.current_stage_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("message")
        .select("id, room_id, author_type, author_id, body, created_at")
        .eq("attempt_id", attemptId)
        .order("created_at", { ascending: false })
        .limit(MAX_TRANSCRIPT),
      supabase
        .from("stage_commitment")
        .select("actor_kind, player_id, agent_id, committed_at")
        .eq("attempt_id", attemptId)
        .eq("stage_id", attempt.current_stage_id ?? "00000000-0000-0000-0000-000000000000"),
    ]);

  const { count: stageCount } = stage
    ? await supabase
        .from("stage")
        .select("id", { count: "exact", head: true })
        .eq("spec_version_id", stage.spec_version_id)
    : { count: 0 };

  const { data: serverNow } = await supabase.rpc("server_now");

  const journal = journalEntriesOf(state?.journal);
  const transcript: PublicMessage[] = (messages ?? [])
    .map((row) => ({
      id: row.id as string,
      roomId: (row.room_id as string | null) ?? null,
      authorType: row.author_type as PublicMessage["authorType"],
      authorId: (row.author_id as string | null) ?? null,
      authorName: null,
      body: row.body as string,
      createdAt: row.created_at as string,
    }))
    .reverse();

  const parsedPos = positionSchema.safeParse(state?.player_pos);

  const resumed: Omit<ResumeState, "recap"> = {
    attemptId: attempt.id as string,
    adventureTitle: adventure?.title ?? "Your adventure",
    retriesAllowed: adventure?.allow_retries ?? false,
    status: attempt.status as ResumeState["status"],
    stage: stage
      ? {
          id: stage.id as string,
          index: stage.index as number,
          title: stage.title as string,
          sharedContext: (stage.shared_context as string | null) ?? "",
        }
      : null,
    stageCount: stageCount ?? 0,
    timer: {
      deadlineAt: (attempt.stage_deadline_at as string | null) ?? null,
      serverNow: (serverNow as string | null) ?? new Date().toISOString(),
    },
    journal,
    transcript,
    commitments: (commitments ?? []).map((row) => ({
      actorKind: row.actor_kind as PublicActorCommitment["actorKind"],
      actorId: (row.player_id ?? row.agent_id) as string,
      actorName: row.actor_kind === "player" ? "You" : "A stakeholder",
      committed: true,
    })),
    playerPos: parsedPos.success ? parsedPos.data : null,
  };

  return { ...resumed, recap: buildRecap(resumed) };
}

function journalEntriesOf(raw: unknown): JournalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = journalEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The recap is derived, never stored: it restates public state the student has
 * already seen, so it cannot become a side channel for anything they haven't.
 */
function buildRecap(state: Omit<ResumeState, "recap">): string[] {
  const lines: string[] = [];

  if (state.status === "completed") {
    lines.push(`You finished ${state.adventureTitle}.`);
  } else if (state.stage) {
    const position = state.stageCount
      ? `stage ${state.stage.index + 1} of ${state.stageCount}`
      : "the opening stage";
    lines.push(`You left off in ${position}: ${state.stage.title}.`);
  } else {
    lines.push(`You joined ${state.adventureTitle}.`);
  }

  if (state.journal.length) {
    const last = state.journal[state.journal.length - 1];
    lines.push(
      `${state.journal.length} piece${state.journal.length === 1 ? "" : "s"} of evidence in your journal, last: “${last.text}”.`,
    );
  }

  const spoken = state.transcript.filter((m) => m.authorType !== "system");
  if (spoken.length) {
    const last = spoken[spoken.length - 1];
    lines.push(
      `Last thing said: “${last.body.length > 140 ? `${last.body.slice(0, 140)}…` : last.body}”.`,
    );
  }

  if (state.commitments.some((c) => c.actorKind === "player")) {
    lines.push("Your decision for this stage is already in — waiting on the others.");
  } else if (state.timer.deadlineAt) {
    lines.push("Your decision for this stage is still open, and the clock kept running.");
  }

  return lines;
}
