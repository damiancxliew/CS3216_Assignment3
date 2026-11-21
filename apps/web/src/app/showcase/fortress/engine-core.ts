import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FakeLlmClient, createRng, type LlmRequest } from "@adventure/orchestration";
import { EngineSpec, createState, project, runPostTurnCheck, step, type EngineState } from "@adventure/engine";
import type { Action, PlayerView } from "@adventure/play-contract";

/** The lesson pack lives in docs; the harness reads it in place so it always plays the shipped content. */
export const FORTRESS_DIR = resolve(process.cwd().endsWith("apps/web") ? process.cwd() : resolve(process.cwd(), "apps/web"), "../../docs/lesson-materials/battle-of-singapore/fortress");

let cached: EngineSpec | null = null;
export function fortressSpec(): EngineSpec {
  cached ??= EngineSpec.parse(JSON.parse(readFileSync(resolve(FORTRESS_DIR, "adventure.json"), "utf8")).spec);
  return cached;
}

/** Bullets inside one <<<LABEL ... >>> block of a prompt. */
function blockLines(prompt: string, label: string): string[] {
  const start = prompt.indexOf(`<<<${label}`);
  if (start < 0) return [];
  const end = prompt.indexOf(">>>", start);
  return prompt.slice(start, end).split("\n").slice(1).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
}

function blockBody(prompt: string, labelPrefix: string): string {
  const start = prompt.indexOf(`<<<${labelPrefix}`);
  if (start < 0) return "";
  const end = prompt.indexOf(">>>", start);
  return prompt.slice(start, end).split("\n").slice(1).join("\n").trim();
}

/** The shareable fact that best answers what the student said or showed, by shared words; the first one if none match. */
function bestFact(facts: string[], turn: string): string | undefined {
  const words = new Set(turn.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const score = (fact: string) => (fact.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => words.has(word)).length;
  return [...facts].sort((a, b) => score(b) - score(a))[0];
}

/**
 * A scripted stand-in for the model, so the real engine runs without a key or network:
 * a character says the shareable fact that best fits the turn, and the check credits exactly that fact.
 */
function scriptedLlm() {
  return new FakeLlmClient({
    replies: [(request: LlmRequest) => {
      if (request.schemaName === "v3_character_reply") {
        const role = fortressSpec().role.name.toUpperCase();
        const turn = blockBody(request.user, `${role} SHOWS YOU`) || blockBody(request.user, `${role} SAYS TO YOU NOW`);
        const share = bestFact(blockLines(request.user, "WHAT YOU ARE WILLING TO SHARE NOW"), turn);
        return JSON.stringify({ reply: share ?? "I have told you what I can for now. Bring me evidence and we can talk again." });
      }
      if (request.schemaName === "v3_interview_line") {
        const counterpoint = request.user.match(/<counterpoint>([\s\S]*?)<\/counterpoint>/)?.[1];
        return JSON.stringify({ line: counterpoint ?? "Thank you. I will remember what you said." });
      }
      const reply = blockBody(request.user, "CHARACTER'S REPLY");
      const conveyed = blockLines(request.user, "FACTS THE CHARACTER MAY HAVE CONVEYED")
        .map((line) => ({ id: line.slice(0, line.indexOf(":")), text: line.slice(line.indexOf(":") + 1).trim() }))
        .filter((fact) => fact.id && reply.includes(fact.text))
        .map((fact) => fact.id);
      return JSON.stringify({ conveyed, substantive: conveyed.length > 0, assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: "none", reason: null } });
    }],
  });
}

export type FortressSnapshot = { state: EngineState; view: PlayerView; revision: number };

export function startFortress(): FortressSnapshot {
  const spec = fortressSpec();
  const state = createState(spec, "showcase");
  return { state, view: project(spec, state), revision: 0 };
}

/** One action through the real engine, then every post-turn check, as the API does after replying. */
export async function stepFortress(snapshot: FortressSnapshot, action: Action): Promise<FortressSnapshot> {
  const spec = fortressSpec();
  const llm = scriptedLlm();
  const deps = { llm, now: Date.now(), rng: createRng(`showcase:${snapshot.revision}`) };
  let { state, view } = await step({ spec, state: snapshot.state, action }, deps);
  for (const pending of [...state.pendingChecks]) {
    const result = await runPostTurnCheck(spec, state, pending.messageId, { llm });
    ({ state, view } = await step({ spec, state, action: { type: "postTurn", messageId: pending.messageId, result } }, deps));
  }
  return { state, view, revision: snapshot.revision + 1 };
}
