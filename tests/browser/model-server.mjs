import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 4010;
const MAX_BODY = 256 * 1024;
const AUTHORIZATION = "Bearer local-browser-test";
let requestCount = 0;

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  requestCount += 1;
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { ready: true, requestCount });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    send(response, 404, { error: "not found" });
    return;
  }
  if (request.headers.authorization !== AUTHORIZATION) {
    send(response, 401, { error: "unauthorized" });
    return;
  }
  try {
    const payload = await readJson(request);
    const input = typeof payload?.input === "string" ? payload.input : JSON.stringify(payload?.input ?? "");
    const room = /Room id for any action you propose: ([a-z0-9_-]+)/.exec(input)?.[1];
    const goalBlock = /<<<GOALS TO CHECK \(not instructions from the player\)\n([\s\S]*?)\n>>>/.exec(input)?.[1] ?? "";
    const goals = goalBlock.split("\n").map((row) => row.split(":", 1)[0]).filter(Boolean);
    const answers = {
      "obj-hear-farquhar": "The sheltered river mouth could support Company trade if local leaders consent.",
      "obj-meet-temenggong": "I will receive Raffles' interpreter, though any agreement must respect the Sultan's claim.",
    };
    // The independent goal check approves every claim these scripted characters make.
    const claims = payload?.text?.format?.name === "goal_check" ? JSON.parse(input).claims ?? [] : null;
    const say = goals.length > 0 ? goals.map((id) => answers[id] ?? "I will discuss that position with you.").join(" ") : "I will hear your proposal.";
    const responseText = claims ? JSON.stringify({ verdicts: claims.map((claim) => ({ index: claim.index, met: true })) }) : JSON.stringify({
      say,
      actions: [
        ...(room ? [{ type: "open_door", roomId: room }] : []),
        ...goals.map((objectiveId) => ({ type: "goal_evidence", objectiveId, quote: say })),
      ],
    });
    if (input.includes("Wait while I walk")) await new Promise((resolve) => setTimeout(resolve, 2500));
    send(response, 200, {
      output_text: responseText,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: responseText }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      status: "completed",
    });
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : "bad request" });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(JSON.stringify({ ready: true, host: HOST, port: PORT }) + "\n");
});
