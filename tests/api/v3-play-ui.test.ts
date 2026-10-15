import { describe, expect, it, vi } from "vitest";

import { createV3PlayClient } from "@/lib/play/v3/client";
import { buildInterviewAnswerAction } from "@/lib/play/v3/interview-form";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";
import { portraitUrl } from "@/lib/play/v3/portraits";
import { createV3PreviewClient } from "@/lib/play/v3/preview-client";
import { MAX_EVIDENCE_NOTES, MAX_INTERVIEW_TEXT_LENGTH, type PlayerView } from "@adventure/play-contract";

const view = { phase: "briefing", pendingCheck: false } as unknown as PlayerView;
const continueAction = { type: "continue" } as const;

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("v3 play browser client", () => {
  it("maps a successful action response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, { revision: 3, view }));
    const result = await createV3PlayClient("attempt/1", fetchImpl).act(2, continueAction);
    expect(result).toEqual({ ok: true, revision: 3, view });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v3/attempts/attempt%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 2, action: continueAction }),
    }));
  });

  it("adopts a stale revision without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(409, {
      error: { code: "stale_state", message: "Changed." },
      revision: 5,
      view,
    }));
    const result = await createV3PlayClient("attempt-1", fetchImpl).act(2, continueAction);
    expect(result).toEqual({ ok: false, kind: "stale", revision: 5, view });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rate_limited", "rate_limited"],
    ["attempt_limit", "attempt_limit"],
  ] as const)("maps 429 %s responses", async (code, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(429, {
      error: { code, message: "Please wait." },
    }));
    expect(await createV3PlayClient("attempt-1", fetchImpl).act(1, continueAction))
      .toEqual({ ok: false, kind, message: "Please wait." });
  });

  it("maps server failures and refreshes with GET", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(503, { error: { code: "unavailable", message: "Try later." } }))
      .mockResolvedValueOnce(response(200, { revision: 9, view }));
    const client = createV3PlayClient("attempt-1", fetchImpl);
    expect(await client.act(1, continueAction)).toEqual({ ok: false, kind: "error", message: "Try later." });
    expect(await client.refresh()).toEqual({ ok: true, revision: 9, view });
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "GET", cache: "no-store" }));
  });
});

describe("v3 preview browser client", () => {
  const initialToken = "preview-token-0";
  const nextToken = "preview-token-1";
  const checkedToken = "preview-token-2";

  it("sends and adopts client state across actions", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: [] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure/1", initialToken, view, fetchImpl);

    expect(await client.act(0, continueAction)).toEqual({ ok: true, revision: 1, view });
    expect(await client.act(1, continueAction)).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/v3/preview/adventure%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: initialToken, action: continueAction }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure%2F1/actions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, action: continueAction }),
    }));
  });

  it("refreshes pending checks and makes no request when none are pending", async () => {
    const emptyFetch = vi.fn<typeof fetch>();
    const emptyClient = createV3PreviewClient("adventure-1", initialToken, view, emptyFetch);
    expect(await emptyClient.refresh()).toEqual({ ok: true, revision: 0, view });
    expect(emptyFetch).not.toHaveBeenCalled();

    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: ["message-1"] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure-1", initialToken, view, fetchImpl);
    await client.act(0, continueAction);
    expect(await client.refresh()).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure-1/check", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, messageId: "message-1" }),
    }));
    expect(await client.refresh()).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serializes an action and refresh so the check uses the action's state", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { token: nextToken, view, pendingCheckIds: ["message-1"] }))
      .mockResolvedValueOnce(response(200, { token: checkedToken, view, pendingCheckIds: [] }));
    const client = createV3PreviewClient("adventure-1", initialToken, view, fetchImpl);
    const action = client.act(0, continueAction);
    const refresh = client.refresh();

    const [actionResult, refreshResult] = await Promise.all([action, refresh]);
    expect(actionResult).toEqual({ ok: true, revision: 1, view });
    expect(refreshResult).toEqual({ ok: true, revision: 2, view });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/v3/preview/adventure-1/check", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: nextToken, messageId: "message-1" }),
    }));
  });
});

describe("passage offsets", () => {
  it("maps a selection spanning paragraphs to exact body offsets", () => {
    const paragraphs = ["A letter from the harbour.", "", "The tide changed before dawn."];
    const body = paragraphs.join("\n");
    const offsets = offsetsFromParagraphs(paragraphs, { paragraph: 0, offset: 2 }, { paragraph: 2, offset: 8 });
    expect(offsets).toEqual({ start: 2, end: paragraphs[0].length + 2 + 8 });
    expect(body.slice(offsets!.start, offsets!.end)).toBe("letter from the harbour.\n\nThe tide");
  });

  it("rejects invalid, collapsed, and backwards selections", () => {
    expect(offsetsFromParagraphs(["text"], { paragraph: 0, offset: 1 }, { paragraph: 0, offset: 1 })).toBeNull();
    expect(offsetsFromParagraphs(["text"], { paragraph: 1, offset: 0 }, { paragraph: 1, offset: 2 })).toBeNull();
    expect(offsetsFromParagraphs(["text"], { paragraph: 0, offset: 3 }, { paragraph: 0, offset: 1 })).toBeNull();
  });
});

describe("stance portrait URLs", () => {
  it("returns null until a base URL is configured", () => {
    expect(portraitUrl("ahmad:steady", {})).toBeNull();
  });

  it("uses an encoded stance key under the configured base", () => {
    expect(portraitUrl("ahmad:steady", { NEXT_PUBLIC_V3_PORTRAIT_BASE: "https://cdn.example.test/portraits/" }))
      .toBe("https://cdn.example.test/portraits/ahmad%3Asteady.png");
  });
});

describe("interview answer form", () => {
  const choices = { verdictIds: ["verdict-a", "verdict-b"], noteIds: ["note-1", "note-2"] };

  it("builds an answer and omits blank optional text", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["note-2"], text: "   " },
      choices,
    )).toEqual({
      ok: true,
      action: { type: "interviewAnswer", verdictId: "verdict-a", evidenceNoteIds: ["note-2"] },
    });
  });

  it("trims and includes nonblank text", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-b", evidenceNoteIds: [], text: "  My reasoning.  " },
      choices,
    )).toEqual({
      ok: true,
      action: { type: "interviewAnswer", verdictId: "verdict-b", evidenceNoteIds: [], text: "My reasoning." },
    });
  });

  it("rejects verdicts and evidence that are not in the provided choices", () => {
    expect(buildInterviewAnswerAction(
      { verdictId: "unknown", evidenceNoteIds: [], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose a verdict." });
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["unknown"], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose evidence from your notes." });
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: ["note-1", "note-1"], text: "" },
      choices,
    )).toMatchObject({ ok: false, error: "Choose evidence from your notes." });
  });

  it("enforces the contract limits for evidence and text", () => {
    const tooManyNotes = Array.from({ length: MAX_EVIDENCE_NOTES + 1 }, (_, index) => `note-${index}`);
    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: tooManyNotes, text: "" },
      choices,
    )).toMatchObject({ ok: false, error: `Choose no more than ${MAX_EVIDENCE_NOTES} notes.` });

    expect(buildInterviewAnswerAction(
      { verdictId: "verdict-a", evidenceNoteIds: [], text: "x".repeat(MAX_INTERVIEW_TEXT_LENGTH + 1) },
      choices,
    )).toMatchObject({ ok: false, error: `Keep your response to ${MAX_INTERVIEW_TEXT_LENGTH} characters or fewer.` });
  });
});
