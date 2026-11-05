import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CookieJar,
  Metrics,
  isProductionHost,
  isSuccess,
  nextAction,
  parseArgs,
  parseLink,
  percentile,
  runStudent,
  verdict,
} from "../../scripts/load/v3-public-link.mjs";

const VERSION = "11111111-2222-4333-8444-555555555555";

describe("v3 load test helpers", () => {
  it("reads the version ID from a join or start link and rejects anything else", () => {
    expect(parseLink(`https://staging.example.world/v3/join/${VERSION}`)).toEqual({ origin: "https://staging.example.world", versionId: VERSION });
    expect(parseLink(`http://localhost:3000/v3/play/start/${VERSION}`).versionId).toBe(VERSION);
    expect(() => parseLink("https://staging.example.world/v3/join/not-a-uuid")).toThrow();
    expect(() => parseLink(`https://staging.example.world/join/${VERSION}`)).toThrow();
  });

  it("treats production as opt-in", () => {
    expect(isProductionHost("https://staging.pocketadventures.world")).toBe(false);
    expect(isProductionHost("http://localhost:3000")).toBe(false);
    expect(isProductionHost("https://pocketadventures.world")).toBe(true);
    expect(() => parseArgs([])).toThrow("--link is required");
    expect(parseArgs(["--link", "x", "--users=30", "--chat", "0"])).toMatchObject({ users: 30, chat: 0 });
  });

  it("keeps chunked auth cookies and drops cleared ones", () => {
    const jar = new CookieJar();
    const headers = new Headers();
    headers.append("set-cookie", "sb-ref-auth-token.0=aaa; Path=/; HttpOnly");
    headers.append("set-cookie", "sb-ref-auth-token.1=bbb; Path=/");
    jar.store(new Response(null, { headers }));
    expect(jar.header()).toBe("sb-ref-auth-token.0=aaa; sb-ref-auth-token.1=bbb");
    const cleared = new Headers();
    cleared.append("set-cookie", "sb-ref-auth-token.1=; Path=/; Max-Age=0");
    jar.store(new Response(null, { headers: cleared }));
    expect(jar.header()).toBe("sb-ref-auth-token.0=aaa");
  });

  it("counts a stale-revision 409 as normal concurrency but a 5xx or redirect-less start as failure", () => {
    expect(isSuccess("action:tick", 409)).toBe(true);
    expect(isSuccess("action:message", 500)).toBe(false);
    expect(isSuccess("start", 307)).toBe(true);
    expect(isSuccess("start", 503)).toBe(false);
    expect(isSuccess("game page", 0)).toBe(false);
  });

  it("fails the run on error rate or a p95 over budget", () => {
    expect(percentile([5, 1, 9, 3], 50)).toBe(3);
    expect(percentile([5, 1, 9, 3], 95)).toBe(9);
    const metrics = new Metrics();
    for (let i = 0; i < 99; i++) metrics.record("action:tick", 100, 200);
    metrics.record("action:tick", 100, 500);
    const options = parseArgs(["--link", `https://staging.example.world/v3/join/${VERSION}`]);
    expect(verdict(metrics.summary(), options)).toMatchObject({ failed: 1, pass: true });
    metrics.record("start", 40_000, 307);
    const slow = verdict(metrics.summary(), options);
    expect(slow.pass).toBe(false);
    expect(slow.problems.join(" ")).toContain("start p95");
  });

  it("plays like a quick student: clears screens, reads, talks within budget, then explores", () => {
    const memory = { read: new Set<string>(), visited: new Set<string>(["a"]), talkedIn: new Set<string>(), chats: 0 };
    expect(nextAction({ phase: "briefing" }, memory, 1)).toEqual({ type: "continue" });
    expect(nextAction({ phase: "stage", stage: { intro: { narration: "x" } } }, memory, 1)).toEqual({ type: "continue" });
    const view = {
      phase: "stage", stage: { intro: null }, currentRoomId: "a",
      rooms: [{ id: "a" }, { id: "b" }], characters: [{ id: "lim" }], documents: [], documentsHere: [{ id: "doc" }],
    };
    expect(nextAction(view, memory, 1)).toEqual({ type: "openDocument", documentId: "doc" });
    expect(nextAction({ ...view, documents: [{ id: "doc", open: true }] }, memory, 1)).toEqual({ type: "closeDocument", documentId: "doc" });
    expect(nextAction(view, memory, 1)).toMatchObject({ type: "message", characterId: "lim" });
    expect(nextAction(view, memory, 1)).toEqual({ type: "enterRoom", roomId: "b" });
    expect(nextAction(view, memory, 1)).toBeNull();
    expect(nextAction({ phase: "interview" }, memory, 1)).toBeNull();
  });
});

/** A small stand-in for the v3 app: the same routes, cookies and response shapes. */
function fakeApp() {
  const seen = { starts: 0, actions: [] as string[], missingCookie: 0 };
  const briefed = new Set<string>();
  const view = (attemptId: string) => ({
    phase: briefed.has(attemptId) ? "stage" : "briefing",
    stage: { intro: null }, currentRoomId: "street",
    rooms: [{ id: "street" }, { id: "shop" }], characters: [{ id: "lim" }],
    documents: [], documentsHere: [],
  });
  const revisions = new Map<string, number>();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    const authed = (req.headers.cookie ?? "").includes("sb-test-auth-token=");
    const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === `/v3/join/${VERSION}`) return res.end("<html>Enter the adventure</html>");
    if (url.pathname === `/v3/play/start/${VERSION}`) {
      const attemptId = `00000000-0000-4000-8000-${String(++seen.starts).padStart(12, "0")}`;
      revisions.set(attemptId, 0);
      res.writeHead(307, { location: `/v3/play/${attemptId}`, "set-cookie": `sb-test-auth-token=${attemptId}; Path=/; HttpOnly` });
      return res.end();
    }
    if (!authed) { seen.missingCookie++; return json(401, { error: { code: "unauthorized" } }); }
    const attemptId = (req.headers.cookie ?? "").match(/sb-test-auth-token=([^;]+)/)![1]!;
    if (url.pathname.startsWith("/v3/play/")) return res.end("<html>game</html>");
    if (url.pathname === "/api/v3/attempts" && req.method === "POST") return json(200, { attemptId, revision: revisions.get(attemptId), view: view(attemptId), resumed: true });
    if (url.pathname === `/api/v3/attempts/${attemptId}/actions`) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { revision, action } = JSON.parse(raw);
      seen.actions.push(action.type);
      const current = revisions.get(attemptId)!;
      if (revision !== current) return json(409, { error: { code: "stale_state" }, revision: current, view: view(attemptId) });
      // Like the engine, only "continue" leaves the briefing; a tick changes nothing visible.
      if (action.type === "continue") briefed.add(attemptId);
      revisions.set(attemptId, current + 1);
      return json(200, { revision: current + 1, view: view(attemptId) });
    }
    json(404, {});
  });
  return { server, seen };
}

describe("v3 load test runner", () => {
  let app: ReturnType<typeof fakeApp>;
  let origin: string;
  beforeAll(async () => {
    app = fakeApp();
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => (app.server as Server).close(() => resolve())));

  it("runs simultaneous students through join, guest start, game page and play, keeping each one's session", async () => {
    const options = { ...parseArgs(["--link", `${origin}/v3/join/${VERSION}`, "--users", "5", "--duration", "1", "--chat", "1", "--tick", "60"]), thinkMs: [10, 20] as [number, number] };
    const metrics = new Metrics();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => runStudent(i + 1, parseLink(options.link), options, metrics)));
    expect(results.every((r) => r.started)).toBe(true);
    expect(app.seen.starts).toBe(5);
    expect(app.seen.missingCookie).toBe(0);
    const summary = metrics.summary();
    expect(summary.every((row) => row.failed === 0)).toBe(true);
    const steps = summary.map((row) => row.step);
    for (const step of ["join page", "start", "game page", "resume attempt", "action:tick", "action:continue", "action:message", "action:enterRoom"])
      expect(steps).toContain(step);
    expect(app.seen.actions.filter((a) => a === "message")).toHaveLength(5);
  });
});
