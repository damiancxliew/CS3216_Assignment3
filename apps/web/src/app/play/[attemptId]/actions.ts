"use server";

import { createClient } from "@/lib/supabase/server";
import { loadDebrief } from "@/lib/attempts/debrief";
import { loadReflections, resolveAnswer, type ReflectionAnswer } from "@/lib/attempts/reflection";

export async function completeWalkthrough(layout: "mobile" | "desktop"): Promise<{ ok: boolean }> {
  if (layout !== "mobile" && layout !== "desktop") return { ok: false };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const column = layout === "mobile" ? "walkthrough_mobile_completed" : "walkthrough_desktop_completed";
  const { data, error } = await supabase.from("profile").update({ [column]: true }).eq("id", user.id).select("id").single();
  return { ok: !error && data?.id === user.id };
}

/**
 * "Play it again" at the ending. Everything that decides whether a second
 * attempt is allowed — whose attempt this is, whether the teacher left retries
 * on, which version the new attempt pins, when its deadline falls — happens
 * inside `restart_attempt`, so a hand-rolled request fails in the database
 * rather than here.
 */
export async function restartAttempt(
  attemptId: string,
): Promise<{ ok: true; attemptId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restart_attempt", {
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    return { ok: false, error: "Could not start a new attempt. Your teacher may have switched retries off." };
  }
  return { ok: true, attemptId: data as string };
}

export async function saveReflection(
  attemptId: string,
  input: unknown,
): Promise<{ ok: true; answers: ReflectionAnswer[] } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to save your reflection." };

    const debrief = await loadDebrief(supabase, attemptId);
    if (!debrief) return { ok: false, error: "This debrief is not available." };

    const resolved = resolveAnswer(input, debrief);
    if (!resolved.ok) return resolved;

    const answer = resolved.answer;
    const { error } = await supabase.from("attempt_reflection").upsert({
      attempt_id: attemptId,
      prompt_key: answer.promptKey,
      choice: answer.choice,
      choice_label: answer.choiceLabel,
      stance: answer.stance,
      response: answer.response,
      counter: answer.counter,
      updated_at: new Date().toISOString(),
    }, { onConflict: "attempt_id,prompt_key" });
    if (error) return { ok: false, error: "Could not save your answer. Try again." };

    return { ok: true, answers: await loadReflections(supabase, attemptId) };
  } catch {
    return { ok: false, error: "Could not save your answer. Try again." };
  }
}
