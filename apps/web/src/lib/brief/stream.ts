/** Only the public reply field is streamed; draft fields stay private until validated. */
export type ReplyListener = (reply: { index: number; text: string }) => void;

export function partialReply(json: string): string {
  const match = /^\s*\{\s*"reply"\s*:\s*"/.exec(json);
  if (!match) return "";
  let value = "";
  for (let i = match[0].length; i < json.length; i++) {
    const char = json[i]!;
    if (char === '"') return value;
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escape = json[++i];
    if (!escape) break;
    if (escape === "u") {
      const hex = json.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (!(escape in escapes)) break;
      value += escapes[escape];
    }
  }
  // Do not render half a surrogate pair while a Unicode escape is still arriving.
  return value.replace(/[\uD800-\uDBFF]$/, "");
}

export function replyStreamOptions(onReply?: ReplyListener) {
  if (!onReply) return {};
  let index = -1;
  let json = "";
  let previous = "";
  return {
    onResponseStarted() { index++; json = ""; previous = ""; },
    onTextDelta(delta: string) {
      json += delta;
      const text = partialReply(json);
      if (text !== previous) { previous = text; onReply({ index, text }); }
    },
  };
}

export function briefStreamResponse(work: (onReply: ReplyListener) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      // Flush headers immediately and keep idle proxies alive during reasoning.
      send({ type: "start" });
      const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
      try {
        const result = await work((reply) => send({ type: "reply", ...reply }));
        send({ type: "result", result });
      } catch (error) {
        console.error("brief stream failed", error);
        send({ type: "result", result: { ok: false, error: "Couldn’t complete that request. Please try again." } });
      } finally {
        clearInterval(heartbeat);
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; },
  });
  return new Response(body, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
