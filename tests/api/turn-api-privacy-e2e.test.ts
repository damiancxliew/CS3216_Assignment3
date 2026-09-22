import { beforeEach, describe, expect, it } from "vitest";

import { loadI1Spec } from "@adventure/generation/fixtures";
import { auditClientPayload } from "@adventure/orchestration";

import { POST as postDecision } from "@/app/api/attempt/[id]/decision/route";
import { POST as postMessage } from "@/app/api/attempt/[id]/message/route";
import { GET as getState } from "@/app/api/attempt/[id]/state/route";
import {
  apiErrorSchema,
  decisionResponseSchema,
  messageResponseSchema,
  publicAttemptStateSchema,
} from "@/lib/turn-api/contract";
import { resetRuntime } from "@/lib/turn-api/runtime";

const ATTEMPT_ID = "k11-full-path";
const params = { params: Promise.resolve({ id: ATTEMPT_ID }) };

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

type Capture = { label: string; status: number; payload: unknown };

async function capture(
  captures: Capture[],
  label: string,
  responsePromise: Promise<Response>,
  expectedStatus = 200,
): Promise<unknown> {
  const response = await responsePromise;
  const payload: unknown = await response.json();
  expect(response.status, label).toBe(expectedStatus);
  captures.push({ label, status: response.status, payload });
  return payload;
}

beforeEach(() => {
  resetRuntime();
});

describe("K11 full-path client-payload audit", () => {
  it("leaks no private context, roll, rationale, seed, or hidden state across three stages", async () => {
    const captures: Capture[] = [];
    const spec = await loadI1Spec();
    const privateText = spec.stages.flatMap((stage) =>
      stage.agents.flatMap((agent) => [
        agent.privateContext.persona,
        agent.privateContext.motivations,
        agent.privateContext.hiddenInterests,
        agent.privateContext.knowledgeHorizon,
      ]),
    );

    const initial = publicAttemptStateSchema.parse(
      await capture(
        captures,
        "state:stage-landing",
        getState(new Request("http://test/state"), params),
      ),
    );
    expect(initial.stage.id).toBe("stage-landing");

    messageResponseSchema.parse(
      await capture(
        captures,
        "message:ship-cabin",
        postMessage(
          post("http://test/message", {
            roomId: "ship-cabin",
            body: "Show me Lord Hastings' instructions.",
          }),
          params,
        ),
      ),
    );
    publicAttemptStateSchema.parse(
      await capture(
        captures,
        "state:stage-landing-ready",
        getState(new Request("http://test/state"), params),
      ),
    );
    const firstDecision = decisionResponseSchema.parse(
      await capture(
        captures,
        "decision:sign-preliminary",
        postDecision(
          post("http://test/decision", { optionId: "opt-sign-preliminary" }),
          params,
        ),
      ),
    );
    expect(firstDecision.resolution).toMatchObject({ ending: false, nextStageId: "stage-sultan" });
    expect(firstDecision.state.stage.id).toBe("stage-sultan");

    publicAttemptStateSchema.parse(
      await capture(
        captures,
        "state:stage-sultan",
        getState(new Request("http://test/state"), params),
      ),
    );
    messageResponseSchema.parse(
      await capture(
        captures,
        "message:farquhar-tent",
        postMessage(
          post("http://test/message", {
            roomId: "farquhar-tent",
            body: "Explain the succession dispute.",
          }),
          params,
        ),
      ),
    );
    messageResponseSchema.parse(
      await capture(
        captures,
        "message:hussein-quarters",
        postMessage(
          post("http://test/message", {
            roomId: "hussein-quarters",
            body: "Why should your claim be recognised?",
          }),
          params,
        ),
      ),
    );
    messageResponseSchema.parse(
      await capture(
        captures,
        "message:treaty-ground",
        postMessage(
          post("http://test/message", {
            roomId: "treaty-ground",
            body: "Read the draft terms aloud.",
          }),
          params,
        ),
      ),
    );
    const secondDecision = decisionResponseSchema.parse(
      await capture(
        captures,
        "decision:recognise-hussein",
        postDecision(
          post("http://test/decision", { optionId: "opt-recognise-hussein" }),
          params,
        ),
      ),
    );
    expect(secondDecision.resolution).toMatchObject({ ending: false, nextStageId: "stage-settlement" });
    expect(secondDecision.state.stage.id).toBe("stage-settlement");

    publicAttemptStateSchema.parse(
      await capture(
        captures,
        "state:stage-settlement",
        getState(new Request("http://test/state"), params),
      ),
    );
    messageResponseSchema.parse(
      await capture(
        captures,
        "message:bazaar",
        postMessage(
          post("http://test/message", {
            roomId: "bazaar",
            body: "What must change in the settlement?",
          }),
          params,
        ),
      ),
    );
    messageResponseSchema.parse(
      await capture(
        captures,
        "message:resident-office",
        postMessage(
          post("http://test/message", {
            roomId: "resident-office",
            body: "Defend the licence ledger.",
          }),
          params,
        ),
      ),
    );
    const ending = decisionResponseSchema.parse(
      await capture(
        captures,
        "decision:free-port-reform",
        postDecision(
          post("http://test/decision", { optionId: "opt-free-port-reform" }),
          params,
        ),
      ),
    );
    expect(ending.resolution).toMatchObject({ ending: true, nextStageId: null });
    expect(ending.state.status).toBe("completed");

    const finalState = publicAttemptStateSchema.parse(
      await capture(
        captures,
        "state:completed",
        getState(new Request("http://test/state"), params),
      ),
    );
    expect(finalState.status).toBe("completed");
    expect(finalState.transcript.some((message) => message.id.includes("-s0-"))).toBe(true);
    expect(finalState.transcript.some((message) => message.id.includes("-s1-"))).toBe(true);
    expect(finalState.transcript.some((message) => message.id.includes("-s2-"))).toBe(true);

    apiErrorSchema.parse(
      await capture(
        captures,
        "error:message-after-ending",
        postMessage(
          post("http://test/message", { roomId: "bazaar", body: "One final question." }),
          params,
        ),
        409,
      ),
    );

    expect(new Set(captures.map((entry) => entry.label.split(":")[0]))).toEqual(
      new Set(["state", "message", "decision", "error"]),
    );
    expect(captures).toHaveLength(15);
    for (const entry of captures) {
      const audit = auditClientPayload(entry.payload, privateText);
      expect(audit, entry.label).toEqual({ ok: true, forbiddenKeys: [], leakedText: [] });
      const serialized = JSON.stringify(entry.payload).toLowerCase();
      expect(serialized, entry.label).not.toContain("oddsbase=");
      expect(serialized, entry.label).not.toContain("resolverrationale");
      expect(serialized, entry.label).not.toContain("private brief");
    }
  });
});
