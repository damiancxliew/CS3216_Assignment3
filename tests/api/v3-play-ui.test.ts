import { describe, expect, it, vi } from "vitest";

import { createV3PlayClient } from "@/lib/play/v3/client";
import { offsetsFromParagraphs } from "@/lib/play/v3/passage-offsets";
import { portraitUrl } from "@/lib/play/v3/portraits";
import type { PlayerView } from "@adventure/play-contract";

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
