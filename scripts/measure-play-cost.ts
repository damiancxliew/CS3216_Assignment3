/**
 * Measure what one attempt costs (M6 pricing) by playing the demo adventure
 * through the real play service and the real OpenAI client, with every call
 * logged by the cost meter. The store is in memory, so no database or sign-in
 * is needed; the model calls are exactly the ones a browser attempt makes.
 *
 *   npm run measure:play-cost                        # 2 quick, 3 typical, 2 chatty
 *   PLAY_COST_PROFILES=typical,typical npm run measure:play-cost
 *   node scripts/play-cost-summary.mjs output/play-cost-sim.jsonl [prices.json]
 *
 * Needs OPENAI_API_KEY (read from apps/web/.env.local). Spends real money.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";

import { loadI1Spec } from "@adventure/generation/fixtures";
import type { AdventureSpec } from "@adventure/generation/spec";
import { createOpenAiClient } from "@adventure/orchestration";
import { it } from "vitest";

import { meteredClient } from "@/lib/play/cost-meter";
import { getState, postAction, postDecision, postMessage, postMintOptions, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";
import { enterRoom, inspectEvidence, stateOf, talkToAgent, type PlayDriver } from "../tests/api/play-driver";

// The app's key wins over one already exported in the shell, which may be stale.
const appEnv = existsSync("apps/web/.env.local") ? parseEnv(readFileSync("apps/web/.env.local", "utf8")) : {};
if (appEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = appEnv.OPENAI_API_KEY;

const LOG = "output/play-cost-sim.jsonl";
const STUDENT = "measure-student";

/** How a student plays one stage: messages per character, whether they talk to the room and share evidence. */
const PROFILES = {
  quick: { perAgent: 0, toOneAgent: 1, roomWide: 0, share: false },
  typical: { perAgent: 2, toOneAgent: 0, roomWide: 1, share: true },
  chatty: { perAgent: 5, toOneAgent: 0, roomWide: 2, share: true },
} as const;
type Profile = keyof typeof PROFILES;

const QUESTIONS = [
  "What do you make of what is happening here?",
  "Who really holds the power in this place, in your view?",
  "What would you gain or lose if this goes ahead?",
  "Why should I trust what you are telling me?",
  "What are the others not saying out loud?",
  "If you were in my place, what would you decide?",
  "What happened the last time something like this was tried?",
];

async function playAttempt(spec: AdventureSpec, attemptId: string, profile: Profile): Promise<string> {
  const plan = PROFILES[profile];
  const base: AttemptRecord = { attemptId, studentId: STUDENT, adventureId: "measure", publishedVersion: 1, status: "active", stageDeadlineAt: null, spec, snapshot: null, runtimeRevision: 0 };
  const store = new MemoryPlayStore([base]);
  const deps: PlayServiceDeps = { store, llm: meteredClient(createOpenAiClient(), attemptId, LOG) };
  // Walking a step takes ~0.3 s; a message waits long enough for the reply limiter to refill.
  let now = Date.now();
  const tick = (ms: number) => { now += ms; store.clock = () => new Date(now); };
  const driver: PlayDriver = { deps, attemptId, userId: STUDENT, advanceTime: () => tick(300) };
  let asked = 0;
  const ask = () => QUESTIONS[asked++ % QUESTIONS.length]!;
  const attempt = async (label: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { console.warn(`[${attemptId}] ${label}: ${(error as Error).message.slice(0, 120)}`); }
  };

  for (let guard = 0; guard < 8; guard += 1) {
    const state = await stateOf(driver);
    if (state.status !== "active") break;
    const stage = spec.stages[state.stage.index]!;

    for (const item of stage.evidence) await attempt(`evidence ${item.id}`, async () => { await enterRoom(driver, item.roomId); await inspectEvidence(driver, item.id); });

    const agents = stage.agents.map((agent) => agent.id);
    const talkTo = [...agents.flatMap((id) => Array(plan.perAgent).fill(id)), ...agents.slice(0, plan.toOneAgent)];
    for (const agentId of talkTo) await attempt(`talk ${agentId}`, async () => { tick(20_000); await talkToAgent(driver, agentId, ask()); });
    for (let i = 0; i < plan.roomWide; i += 1) {
      await attempt("room-wide", async () => {
        tick(20_000);
        const here = await stateOf(driver);
        if (here.currentRoomId) await postMessage(deps, attemptId, STUDENT, { roomId: here.currentRoomId, body: ask(), addresseeId: null });
      });
    }
    if (plan.share) {
      const here = await stateOf(driver);
      for (const entry of here.journal.slice(0, 1)) await attempt("share", () => postAction(deps, attemptId, STUDENT, { type: "share_evidence", evidenceId: entry.id }));
    }
    const mintReady = (await stateOf(driver)).mintReady;
    console.info(`[${attemptId}] stage ${state.stage.index}: mintReady=${mintReady}`);
    if (mintReady) await attempt("mint", () => postMintOptions(deps, attemptId, STUDENT));

    const ready = await getState(deps, attemptId, STUDENT);
    if (!ready.ok) throw new Error(JSON.stringify(ready.error));
    const option = ready.state.options.find((candidate) => candidate.available);
    if (option) {
      tick(20_000);
      const decided = await postDecision(deps, attemptId, STUDENT, { optionId: option.id, optionsVersion: ready.state.optionsVersion });
      if (!decided.ok) console.warn(`[${attemptId}] decision: ${decided.error.message}`);
    } else {
      // Nothing unlocked an option: the stage timer ends it, as in a real lesson (D12).
      store.add({ ...base, snapshot: store.saved.at(-1)!.snapshot, runtimeRevision: store.saved.length, stageDeadlineAt: new Date(now - 1_000).toISOString() });
    }
  }
  const final = await stateOf(driver);
  return `${attemptId} (${profile}): ${final.status}${final.ending ? ` → ${final.ending.id}` : ""}`;
}

it("plays attempts against the real model and logs their cost", async () => {
  await mkdir("output", { recursive: true });
  const spec = await loadI1Spec();
  const profiles = (process.env.PLAY_COST_PROFILES ?? "quick,quick,typical,typical,typical,chatty,chatty").split(",") as Profile[];
  const run = Date.now().toString(36);
  const results = await Promise.all(profiles.map((profile, index) => playAttempt(spec, `sim-${run}-${index + 1}-${profile}`, profile)));
  console.log(`\n${results.join("\n")}\n\nLog: ${LOG}`);
});
