import { beforeEach, describe, expect, it } from "vitest";

import { GET as getState } from "@/app/api/attempt/[id]/state/route";
import { POST as postDecision } from "@/app/api/attempt/[id]/decision/route";
import { POST as postMessage } from "@/app/api/attempt/[id]/message/route";
import {
  decisionResponseSchema,
  findForbiddenKeys,
  messageResponseSchema,
  publicAttemptStateSchema,
} from "@/lib/turn-api/contract";
import { expireStubDeadline, resetStub } from "@/lib/turn-api/stub";

const ATTEMPT_ID = "attempt-under-test";
const CHAMBER = "00000000-0000-4000-8000-000000000020";
const ANTEROOM = "00000000-0000-4000-8000-000000000021";

const params = { params: Promise.resolve({ id: ATTEMPT_ID }) };

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetStub();
});

describe("GET /api/attempt/:id/state", () => {
  it("returns a state matching the public projection schema", async () => {
    const response = await getState(new Request("http://t/state"), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(() => publicAttemptStateSchema.parse(body)).not.toThrow();
  });

  it("holds the stage deadline server-side and derives the countdown from it", async () => {
    const body = await (await getState(new Request("http://t/state"), params)).json();

    expect(body.timer.deadlineAt).toBeTruthy();
    expect(body.timer.serverNow).toBeTruthy();
    const derived = Math.round(
      (Date.parse(body.timer.deadlineAt) - Date.parse(body.timer.serverNow)) / 1000,
    );
    expect(Math.abs(derived - body.timer.secondsRemaining)).toBeLessThanOrEqual(1);
  });
});

describe("POST /api/attempt/:id/message", () => {
  it("appends the player message and an in-room reply", async () => {
    const response = await postMessage(
      post("http://t/message", { roomId: CHAMBER, body: "Who called the vote?" }),
      params,
    );
    const body = messageResponseSchema.parse(await response.json());

    expect(body.newMessages.map((m) => m.authorType)).toEqual(["player", "agent"]);
    expect(body.state.revision).toBeGreaterThan(1);
  });

  it("rejects a malformed body", async () => {
    const response = await postMessage(post("http://t/message", { body: "" }), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });
});

describe("POST /api/attempt/:id/decision", () => {
  it("resolves an available option into a public announcement", async () => {
    const response = await postDecision(
      post("http://t/decision", { optionId: "option-support-blockade" }),
      params,
    );
    const body = decisionResponseSchema.parse(await response.json());

    expect(body.resolution.announcement).not.toHaveLength(0);
    expect(body.state.stage.objectives.find((o) => o.id === "objective-decide")?.met).toBe(
      true,
    );
  });

  it("rejects an option whose preconditions are not met (FR-14)", async () => {
    const response = await postDecision(
      post("http://t/decision", { optionId: "option-broker-truce" }),
      params,
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("stale_option");
  });

  it("rejects a second decision after the stage is resolved", async () => {
    await postDecision(post("http://t/decision", { optionId: "option-abstain" }), params);
    const second = await postDecision(
      post("http://t/decision", { optionId: "option-support-blockade" }),
      params,
    );

    expect(second.status).toBe(409);
  });

  it("makes an option available once its precondition is met", async () => {
    await postMessage(
      post("http://t/message", { roomId: ANTEROOM, body: "Why close the strait?" }),
      params,
    );
    const response = await postDecision(
      post("http://t/decision", { optionId: "option-broker-truce" }),
      params,
    );

    expect(response.status).toBe(200);
  });
});

describe("actor-kind-neutral decisions (D18/FR-14)", () => {
  it("lists every actor that must commit, agents included", async () => {
    const body = await (await getState(new Request("http://t/state"), params)).json();

    expect(body.commitments.map((c: { actorKind: string }) => c.actorKind)).toEqual([
      "player",
      "agent",
      "agent",
    ]);
    expect(
      body.commitments.every((c: { committed: boolean }) => !c.committed),
    ).toBe(true);
  });

  it("ticks the agents as soon as the human is in, and never reveals their choice", async () => {
    const body = decisionResponseSchema.parse(
      await (
        await postDecision(
          post("http://t/decision", { optionId: "option-abstain" }),
          params,
        )
      ).json(),
    );

    expect(body.state.commitments.every((c) => c.committed)).toBe(true);
    expect(JSON.stringify(body.state.commitments)).not.toContain("option-");
  });

  it("records a pass for an actor who has not committed when the timer expires", async () => {
    expireStubDeadline(ATTEMPT_ID);
    const body = publicAttemptStateSchema.parse(
      await (await getState(new Request("http://t/state"), params)).json(),
    );

    expect(body.timer.secondsRemaining).toBe(0);
    expect(body.commitments.every((c) => c.committed)).toBe(true);
    expect(body.options.every((o) => !o.available)).toBe(true);
  });
});

describe("server authority (FR-21)", () => {
  it("leaks no private context, roll or rationale in any Turn API response", async () => {
    const payloads = [
      await (await getState(new Request("http://t/state"), params)).json(),
      await (
        await postMessage(
          post("http://t/message", { roomId: ANTEROOM, body: "Speak plainly." }),
          params,
        )
      ).json(),
      await (
        await postDecision(
          post("http://t/decision", { optionId: "option-broker-truce" }),
          params,
        )
      ).json(),
    ];

    for (const payload of payloads) {
      expect(findForbiddenKeys(payload)).toEqual([]);
    }
  });
});
