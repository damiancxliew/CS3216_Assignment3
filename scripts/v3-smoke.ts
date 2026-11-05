/**
 * End-to-end smoke test of v3 play against a running local app (Checkpoint 1 rehearsal): signs in as the local
 * v3 student, starts golden-1819 and plays the historical path through the real API, engine and models.
 *
 *   npx vitest run --config scripts/vitest.v3-seed.config.ts          # once: seed golden-1819 and the student
 *   npm run dev        # the app, in another terminal
 *   npx vite-node scripts/v3-smoke.ts                                 # this
 *
 * Localhost only; each run creates a throwaway student in the testing school. It reports what happened (notes, stances, phases, timings); it does not assert, because
 * character replies come from a model.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import type { Action, PlayerView } from "@adventure/play-contract";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(import.meta.dirname, "..");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) loadEnvFile(resolve(ROOT, "apps/web/.env.local"));
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TESTING_SCHOOL_ID = "00000000-0000-4000-8000-000000005c01";
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ADVENTURE_ID = "00000000-0000-4000-8000-000000005c02";

for (const url of [SUPABASE_URL, APP]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error(`smoke test only runs against localhost, not ${url}`);
}

const spec = JSON.parse(readFileSync(resolve(ROOT, "fixtures/golden-1819.json"), "utf8")) as {
  documents: { id: string; keyPassages: { id: string; start: number; end: number }[] }[];
  discoveries: { id: string; note: string }[];
};

/** @supabase/ssr stores the session as base64 JSON in `sb-<ref>-auth-token`, chunked above ~3 KB. */
function sessionCookie(session: unknown): string {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const name = `sb-${ref}-auth-token`;
  if (value.length <= 3180) return `${name}=${value}`;
  const chunks = value.match(/.{1,3180}/g) ?? [];
  return chunks.map((chunk, index) => `${name}.${index}=${chunk}`).join("; ");
}

interface Log {
  action: string;
  ms: number;
  status: number;
  phase: string;
  notes: number;
  pending: boolean;
  error?: string;
}

/** A fresh local student per run, so every run starts a new attempt (a student always resumes their latest). */
async function freshStudent(): Promise<{ email: string; password: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const email = `v3-smoke-${Date.now()}@local.test`;
  const password = "password123!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("could not create the smoke student");
  const member = await admin.from("organization_member").insert({ organization_id: TESTING_SCHOOL_ID, user_id: created.data.user.id, role: "student", status: "active" });
  if (member.error) throw member.error;
  return { email, password };
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword(await freshStudent());
  if (error || !data.session) throw error ?? new Error("sign-in failed");
  const cookie = sessionCookie(data.session);
  const headers = { cookie, "content-type": "application/json" };
  const log: Log[] = [];

  const started = await fetch(`${APP}/api/v3/attempts`, { method: "POST", headers, body: JSON.stringify({ adventureId: ADVENTURE_ID }) });
  const start = (await started.json()) as { attemptId: string; revision: number; view: PlayerView; resumed?: boolean; error?: unknown };
  if (!started.ok) throw new Error(`start attempt ${started.status}: ${JSON.stringify(start)}`);
  console.log(`attempt ${start.attemptId} (${start.resumed ? "resumed" : "new"}), phase ${start.view.phase}`);
  let revision = start.revision;
  let view = start.view;

  const refresh = async () => {
    const response = await fetch(`${APP}/api/v3/attempts/${start.attemptId}`, { headers });
    const body = (await response.json()) as { revision: number; view: PlayerView };
    revision = body.revision;
    view = body.view;
  };

  const act = async (action: Action, label = action.type) => {
    const t0 = performance.now();
    const response = await fetch(`${APP}/api/v3/attempts/${start.attemptId}/actions`, { method: "POST", headers, body: JSON.stringify({ revision, action }) });
    const body = (await response.json()) as { revision?: number; view?: PlayerView; error?: { code: string; message: string } };
    if (body.revision !== undefined) revision = body.revision;
    if (body.view !== undefined) view = body.view;
    // The post-turn check lands from after(); poll until it has.
    for (let i = 0; i < 20 && view.pendingCheck; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
    }
    const entry: Log = { action: label, ms: Math.round(performance.now() - t0), status: response.status, phase: view.phase, notes: view.notes.length, pending: view.pendingCheck };
    if (body.error) entry.error = `${body.error.code}: ${body.error.message}`;
    log.push(entry);
    const last = view.messages.at(-1);
    console.log(`${response.status} ${label.padEnd(34)} ${String(entry.ms).padStart(6)} ms  phase=${view.phase} notes=${view.notes.length}${entry.error ? `  ERROR ${entry.error}` : ""}${last ? `\n      ↳ [${last.kind}${last.characterId ? ` ${last.characterId}` : ""}] ${last.text.slice(0, 140)}` : ""}`);
    return response.status;
  };

  const passage = (documentId: string, keyPassageId: string) => {
    const kp = spec.documents.find((d) => d.id === documentId)?.keyPassages.find((k) => k.id === keyPassageId);
    if (!kp) throw new Error(`no key passage ${keyPassageId}`);
    return { type: "selectPassage" as const, documentId, start: kp.start, end: kp.end };
  };
  const noteFor = (discoveryId: string) => {
    const text = spec.discoveries.find((d) => d.id === discoveryId)?.note;
    return view.notes.find((note) => note.text === text)?.id ?? null;
  };
  const passNote = async (discoveryId: string, characterId: string) => {
    const noteId = noteFor(discoveryId);
    if (noteId === null) return console.log(`   (skipped: no note for ${discoveryId})`);
    await act({ type: "insertNote", characterId, noteId }, `insertNote ${discoveryId} → ${characterId}`);
  };

  if (view.phase === "briefing") await act({ type: "continue" }, "continue (briefing)");
  if (view.stage?.intro) await act({ type: "continue" }, "continue (stage 1 opening)");

  // Stage 1: the Temenggong's balai.
  await act({ type: "enterRoom", roomId: "balai" });
  await act({ type: "message", characterId: "temenggong", text: "Who has the right to give land on this island?" }, "message temenggong (authority)");
  await act({ type: "openDocument", documentId: "doc-riau-letter" });
  await act(passage("doc-riau-letter", "kp-riau-authority"), "selectPassage riau letter");
  await act({ type: "closeDocument", documentId: "doc-riau-letter" });
  await passNote("d1-riau-claim", "temenggong");
  await act({ type: "message", characterId: "temenggong", text: "Why is the throne of Johor in dispute?" }, "message temenggong (throne)");
  await act({ type: "openDocument", documentId: "doc-prelim" });
  await act(passage("doc-prelim", "kp-prelim-settled"), "selectPassage draft articles");
  await act({ type: "closeDocument", documentId: "doc-prelim" });
  await act({ type: "endStage" });
  await act({ type: "act", actId: "a1-faithful" });
  await act({ type: "predict", outcomeId: view.definingMoment?.predictionOptions[0]?.outcomeId ?? "o1-sends" }, "predict");
  console.log(`   stage 2 opens: ${view.stage?.intro?.predictionReveal?.actual ?? "(no reveal)"}`);
  await act({ type: "continue" }, "continue (stage 2 opening)");

  // Stage 2: Hussein, then Raffles.
  await act({ type: "enterRoom", roomId: "lodging" });
  await act({ type: "message", characterId: "hussein", text: "What do you want from the British?" }, "message hussein (claim)");
  await act({ type: "enterRoom", roomId: "landing" });
  await passNote("d2-hussein-claim", "raffles");
  await act({ type: "message", characterId: "raffles", text: "Whom will you recognise as Sultan, and why?" }, "message raffles (plan)");
  await act({ type: "openDocument", documentId: "doc-treaty" });
  await act(passage("doc-treaty", "kp-treaty-force"), "selectPassage treaty art. 2");
  await act({ type: "closeDocument", documentId: "doc-treaty" });
  await act({ type: "endStage" });
  const recognise = view.definingMoment?.acts.find((a) => a.id === "a2-recognise")?.id ?? view.definingMoment?.acts[0]?.id ?? "a2-recognise";
  await act({ type: "act", actId: recognise }, `act ${recognise}`);
  await act({ type: "predict", outcomeId: view.definingMoment?.predictionOptions[0]?.outcomeId ?? "o2-treaty" }, "predict");

  // End of game.
  console.log(`   epilogue: ${view.epilogue?.title ?? "(none)"}`);
  await act({ type: "continue" }, "continue (epilogue → interview)");
  const verdicts = view.interview?.verdicts ?? [];
  const evidence = view.notes.slice(0, 2).map((note) => note.id);
  await act({ type: "interviewAnswer", verdictId: verdicts[2]?.id ?? verdicts[0]?.id ?? "", evidenceNoteIds: evidence, text: "The rulers gained, but the people living here were not asked." }, "interviewAnswer (first)");
  console.log(`   push-back: ${view.interview?.pushBack ?? "(none)"}`);
  await act({ type: "interviewAnswer", verdictId: verdicts[2]?.id ?? verdicts[0]?.id ?? "", evidenceNoteIds: [], text: "Even so, I would keep my answer." }, "interviewAnswer (response)");
  await act({ type: "continue" }, "continue (interview → reveal)");

  const failures = log.filter((entry) => entry.status >= 400 || entry.error);
  const replies = log.filter((entry) => entry.action.startsWith("message") || entry.action.startsWith("insertNote")).map((entry) => entry.ms).sort((a, b) => a - b);
  console.log("\n=== summary ===");
  console.log(`final phase: ${view.phase}, ended: ${view.ended}, notes: ${view.notes.length} (${view.notes.map((n) => n.source[0]).join("")})`);
  console.log(`reveal: ${view.reveal ? `${view.reveal.pathVsHistory.map((row) => (row.matched ? "matched" : "diverged")).join(", ")}; corrections ${view.reveal.corrections.length}; missed core ${view.reveal.missedCore.length}` : "(none)"}`);
  console.log(`conversation turns incl. check: p50 ${replies[Math.floor(replies.length / 2)] ?? 0} ms, max ${replies.at(-1) ?? 0} ms`);
  console.log(`failed actions: ${failures.length}`);
  for (const failure of failures) console.log(`  - ${failure.action}: ${failure.status} ${failure.error ?? ""}`);
  if (view.phase !== "reveal" || failures.length > 0) process.exitCode = 1;
}

await main();
