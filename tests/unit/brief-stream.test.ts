import { describe, expect, it } from "vitest";
import { briefStreamResponse, partialReply, replyStreamOptions } from "@/lib/brief/stream";
import { readBriefStream } from "@/lib/brief/use-brief-stream";

describe("brief streaming", () => {
  it("decodes reply text incrementally without exposing JSON or private draft fields", () => {
    const json = JSON.stringify({ reply: 'Read “this”\nA "quote", a slash \\ and 🦊', summary: "private", complete: true });
    const expected = JSON.parse(json).reply;
    for (let length = 1; length <= json.length; length++) {
      const reply = partialReply(json.slice(0, length));
      expect(expected.startsWith(reply)).toBe(true);
    }
    expect(partialReply(json)).toBe(expected);
    expect(partialReply('{"reply":"\\uD83E\\uDD8A"}')).toBe("🦊");
    expect(partialReply('{"reply":"\\uD83E\\uD')).toBe("");
  });

  it("keeps successive model calls separate", () => {
    const updates: unknown[] = [];
    const options = replyStreamOptions((event) => updates.push(event));
    options.onResponseStarted!();
    options.onTextDelta!('{"reply":"One');
    options.onTextDelta!(' done","summary":"private"}');
    options.onResponseStarted!();
    options.onTextDelta!('{"reply":"Two"}');
    expect(updates).toEqual([{ index: 0, text: "One" }, { index: 0, text: "One done" }, { index: 1, text: "Two" }]);
  });

  it("flushes partial replies before the turn finishes and reconciles the final saved result", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const partial = new Promise<void>((resolve) => { received = resolve; });
    const response = briefStreamResponse(async (onReply) => {
      onReply({ index: 0, text: "Still writing" });
      await held;
      return { ok: true, state: { saved: true } };
    });
    let finished = false;
    const result = readBriefStream(response, (index, text) => {
      expect({ index, text }).toEqual({ index: 0, text: "Still writing" });
      received();
    }).then((result) => { finished = true; return result; });
    await partial;
    expect(finished).toBe(false);
    release();
    expect(await result).toEqual({ ok: true, state: { saved: true } });
  });

  it("handles single-byte UTF-8 chunks and a final line without a newline", async () => {
    const bytes = new TextEncoder().encode('{"type":"reply","index":0,"text":"你好 🦊"}\n{"type":"result","result":{"ok":true}}');
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }));
    const replies: string[] = [];
    expect(await readBriefStream(response, (_, text) => replies.push(text))).toEqual({ ok: true });
    expect(replies).toEqual(["你好 🦊"]);
  });

  it("rejects interrupted streams instead of treating partial output as saved", async () => {
    const response = new Response('{"type":"reply","index":0,"text":"Partial"}\n');
    await expect(readBriefStream(response, () => {})).rejects.toThrow("interrupted");
  });
});
