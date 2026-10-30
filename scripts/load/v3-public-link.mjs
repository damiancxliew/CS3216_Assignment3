#!/usr/bin/env node
/**
 * Load test: N simultaneous students opening one public v3 student link (#344).
 *
 * Each virtual student does what a real one does, through the real HTTP surface:
 *   1. GET  /v3/join/<versionId>                join page
 *   2. GET  /v3/play/start/<versionId>          creates a guest session (Supabase anonymous sign-in) and an attempt
 *   3. GET  /v3/play/<attemptId>                the server-rendered game page
 *   4. POST /api/v3/attempts {versionId}        resume: revision + view
 *   5. Plays for --duration: a tick every 15 s (as the client does), continue through the briefing,
 *      walk into rooms, open and close documents, and send --chat messages to characters (LLM calls).
 *
 * Zero dependencies (Node 22+). Run:
 *   node scripts/load/v3-public-link.mjs --link https://staging.pocketadventures.world/v3/join/<versionId> --users 30
 * See docs/load-testing.md.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULTS = {
  users: 30,
  rampSeconds: 0,
  durationSeconds: 300,
  chat: 2,
  tickSeconds: 15,
  thinkMs: [2000, 6000],
  timeoutMs: 120_000,
  maxErrorRate: 0.02,
  maxP95Ms: { start: 15_000, action: 5_000, chat: 30_000, page: 8_000 },
};

export function parseArgs(argv) {
  const options = { ...DEFAULTS, maxP95Ms: { ...DEFAULTS.maxP95Ms }, report: null, allowProduction: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case "--link": options.link = value(); break;
      case "--users": options.users = Number(value()); break;
      case "--ramp": options.rampSeconds = Number(value()); break;
      case "--duration": options.durationSeconds = Number(value()); break;
      case "--chat": options.chat = Number(value()); break;
      case "--tick": options.tickSeconds = Number(value()); break;
      case "--report": options.report = value(); break;
      case "--max-error-rate": options.maxErrorRate = Number(value()); break;
      case "--allow-production": options.allowProduction = true; break;
      case "--help": case "-h": options.help = true; break;
      default: throw new Error(`Unknown option ${argv[i]}. Use --help.`);
    }
  }
  if (options.help) return options;
  if (!options.link) throw new Error("--link is required: the v3 student link, e.g. https://host/v3/join/<versionId>.");
  for (const key of ["users", "rampSeconds", "durationSeconds", "chat", "tickSeconds"])
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`--${key} must be a non-negative number.`);
  if (options.users < 1) throw new Error("--users must be at least 1.");
  return options;
}

/** Accepts a /v3/join/<versionId> link (or /v3/play/start/<versionId>) and returns its origin and version ID. */
export function parseLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`Not a URL: ${link}`);
  }
  const match = url.pathname.match(/^\/v3\/(?:join|play\/start)\/([^/]+)\/?$/);
  if (!match || !UUID.test(match[1])) throw new Error("The link must look like https://<host>/v3/join/<versionId>.");
  return { origin: url.origin, versionId: match[1] };
}

/** Production is opt-in; staging and local are the intended targets. */
export function isProductionHost(origin) {
  const host = new URL(origin).hostname;
  return !/(^|\.)(staging|preview|dev|test)\b|localhost|127\.0\.0\.1/.test(host);
}

/** A per-student cookie jar. Supabase SSR auth cookies may be chunked (.0, .1) and refreshed on any response. */
export class CookieJar {
  #cookies = new Map();
  store(response) {
    const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const line of lines) {
      const [pair, ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)) ||
        attributes.some((a) => /^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now());
      if (expired || value === "") this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }
  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  get size() {
    return this.#cookies.size;
  }
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Records every request by step name. */
export class Metrics {
  steps = new Map();
  record(step, ms, status, error = null) {
    const row = this.steps.get(step) ?? { latencies: [], statuses: {}, errors: [] };
    row.latencies.push(ms);
    row.statuses[status] = (row.statuses[status] ?? 0) + 1;
    if (error && row.errors.length < 5) row.errors.push(error);
    this.steps.set(step, row);
  }
  summary() {
    const rows = [];
    for (const [step, row] of this.steps) {
      const failed = Object.entries(row.statuses).filter(([s]) => !isSuccess(step, Number(s))).reduce((n, [, c]) => n + c, 0);
      rows.push({
        step,
        requests: row.latencies.length,
        failed,
        statuses: row.statuses,
        p50: percentile(row.latencies, 50),
        p95: percentile(row.latencies, 95),
        max: Math.max(...row.latencies),
        errors: row.errors,
      });
    }
    return rows;
  }
}

/** 409 stale_state is normal concurrency (tick vs action), not a failure; the student just retries. */
export function isSuccess(step, status) {
  if (status === 0) return false;
  if (step === "start") return status === 302 || status === 303 || status === 307;
  if (step.startsWith("action:")) return status === 200 || status === 409;
  return status >= 200 && status < 300;
}

/** Which p95 budget a step falls under. */
export function budgetFor(step) {
  if (step === "start") return "start";
  if (step === "action:message") return "chat";
  if (step.startsWith("action:")) return "action";
  return "page";
}

export function verdict(summary, options) {
  const requests = summary.reduce((n, r) => n + r.requests, 0);
  const failed = summary.reduce((n, r) => n + r.failed, 0);
  const problems = [];
  const errorRate = requests ? failed / requests : 1;
  if (errorRate > options.maxErrorRate)
    problems.push(`error rate ${(errorRate * 100).toFixed(1)}% exceeds ${(options.maxErrorRate * 100).toFixed(1)}%`);
  for (const row of summary) {
    const budget = options.maxP95Ms[budgetFor(row.step)];
    if (row.p95 !== null && row.p95 > budget) problems.push(`${row.step} p95 ${row.p95} ms exceeds ${budget} ms`);
  }
  return { requests, failed, errorRate, pass: problems.length === 0, problems };
}

/**
 * The next scripted action from what the student can see. Mirrors a quick, curious student:
 * clear any screen with no choice, visit rooms, read what is there, and talk (up to the chat budget).
 */
export function nextAction(view, memory, chatBudget) {
  if (!view) return null;
  // Screens with no choice: the role briefing, a stage's opening and the epilogue.
  if (view.phase === "briefing" || view.phase === "epilogue" || (view.phase === "stage" && view.stage?.intro)) return { type: "continue" };
  if (view.phase !== "stage") return null;
  const open = view.documents?.find((d) => d.open);
  if (open) return { type: "closeDocument", documentId: open.id };
  const unread = view.documentsHere?.find((d) => !memory.read.has(d.id));
  if (unread) {
    memory.read.add(unread.id);
    return { type: "openDocument", documentId: unread.id };
  }
  const listener = view.characters?.[0];
  if (listener && memory.chats < chatBudget && !memory.talkedIn.has(view.currentRoomId)) {
    memory.chats++;
    memory.talkedIn.add(view.currentRoomId);
    return { type: "message", characterId: listener.id, text: "What do you want people to understand about this moment?" };
  }
  const room = view.rooms?.find((r) => r.id !== view.currentRoomId && !memory.visited.has(r.id));
  if (room) {
    memory.visited.add(room.id);
    return { type: "enterRoom", roomId: room.id };
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = ([min, max]) => min + Math.random() * (max - min);

async function timed(metrics, step, jar, url, init, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(init?.headers ?? {}), cookie: jar.header(), "user-agent": "pocketadventures-load-test" },
    });
    jar.store(response);
    const ms = Math.round(performance.now() - started);
    const body = (response.headers.get("content-type") ?? "").includes("json") ? await response.json().catch(() => null) : await response.text();
    const ok = isSuccess(step, response.status);
    metrics.record(step, ms, response.status, ok ? null : snippet(body));
    return { response, body };
  } catch (error) {
    metrics.record(step, Math.round(performance.now() - started), 0, String(error?.name === "TimeoutError" ? "timeout" : error?.message ?? error));
    return { response: null, body: null };
  }
}

function snippet(body) {
  if (body && typeof body === "object") return JSON.stringify(body.error ?? body).slice(0, 200);
  return String(body ?? "").replace(/\s+/g, " ").slice(0, 200);
}

/** One student, start to finish. Never throws; everything lands in metrics. */
export async function runStudent(index, target, options, metrics, log = () => {}) {
  const jar = new CookieJar();
  const { origin, versionId } = target;
  const t = options.timeoutMs;
  await timed(metrics, "join page", jar, `${origin}/v3/join/${versionId}`, {}, t);

  const start = await timed(metrics, "start", jar, `${origin}/v3/play/start/${versionId}`, {}, t);
  const location = start.response?.headers.get("location") ?? "";
  const attemptId = location.match(/\/v3\/play\/([0-9a-f-]{36})/i)?.[1];
  if (!attemptId) {
    log(`student ${index}: could not start (${start.response?.status ?? "network"}${location ? ` → ${location}` : ""})`);
    return { started: false };
  }
  await timed(metrics, "game page", jar, `${origin}/v3/play/${attemptId}`, {}, t);

  const resume = await timed(metrics, "resume attempt", jar, `${origin}/api/v3/attempts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }),
  }, t);
  let revision = resume.body?.revision ?? 0;
  let view = resume.body?.view ?? null;

  const act = async (action) => {
    const result = await timed(metrics, `action:${action.type}`, jar, `${origin}/api/v3/attempts/${attemptId}/actions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, action }),
    }, t);
    if (result.body && typeof result.body.revision === "number") {
      revision = result.body.revision;
      if (result.body.view) view = result.body.view;
    }
    return result;
  };

  const deadline = Date.now() + options.durationSeconds * 1000;
  let nextTick = Date.now();
  const memory = { read: new Set(), visited: new Set(view?.currentRoomId ? [view.currentRoomId] : []), talkedIn: new Set(), chats: 0 };
  while (Date.now() < deadline) {
    if (Date.now() >= nextTick) {
      await act({ type: "tick" });
      nextTick = Date.now() + options.tickSeconds * 1000;
    }
    const action = nextAction(view, memory, options.chat);
    if (action) await act(action);
    await sleep(Math.min(jitter(options.thinkMs), Math.max(0, deadline - Date.now()), Math.max(250, nextTick - Date.now())));
  }
  return { started: true, attemptId };
}

export function formatSummary(summary, outcome, options, students) {
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [
    `\n${students.started}/${options.users} students started · ${outcome.requests} requests · ${outcome.failed} failed (${(outcome.errorRate * 100).toFixed(1)}%)\n`,
    `${pad("step", 22)}${pad("requests", 10)}${pad("failed", 8)}${pad("p50 ms", 9)}${pad("p95 ms", 9)}${pad("max ms", 9)}statuses`,
  ];
  for (const row of summary.sort((a, b) => a.step.localeCompare(b.step)))
    lines.push(`${pad(row.step, 22)}${pad(row.requests, 10)}${pad(row.failed, 8)}${pad(row.p50, 9)}${pad(row.p95, 9)}${pad(row.max, 9)}${JSON.stringify(row.statuses)}`);
  const failures = summary.filter((r) => r.errors.length);
  if (failures.length) {
    lines.push("\nSample errors:");
    for (const row of failures) for (const e of row.errors) lines.push(`  ${row.step}: ${e}`);
  }
  lines.push(`\n${outcome.pass ? "PASS" : "FAIL"}${outcome.problems.length ? `: ${outcome.problems.join("; ")}` : ""}`);
  return lines.join("\n");
}

const HELP = `Load test a public v3 student link with simultaneous students.

  node scripts/load/v3-public-link.mjs --link <https://host/v3/join/versionId> [options]

  --users N            simultaneous students (default ${DEFAULTS.users})
  --ramp S             spread student arrival over S seconds (default ${DEFAULTS.rampSeconds}: all at once)
  --duration S         seconds each student plays after joining (default ${DEFAULTS.durationSeconds})
  --chat N             character messages per student; each is a real LLM call (default ${DEFAULTS.chat})
  --tick S             seconds between ticks, as the game client sends (default ${DEFAULTS.tickSeconds})
  --max-error-rate R   fail above this share of failed requests (default ${DEFAULTS.maxErrorRate})
  --report FILE        also write the full results as JSON
  --allow-production   required for hosts that are not staging/preview/dev/local
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  const target = parseLink(options.link);
  if (isProductionHost(target.origin) && !options.allowProduction)
    throw new Error(`${target.origin} looks like production. Re-run with --allow-production if that is intended.`);
  console.log(`Load test: ${options.users} students → ${target.origin}/v3/join/${target.versionId}`);
  console.log(`Arrival over ${options.rampSeconds}s · ${options.durationSeconds}s play each · ${options.chat} chat message(s) each (${options.users * options.chat} LLM calls)\n`);

  const metrics = new Metrics();
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: options.users }, async (_, i) => {
    if (options.rampSeconds) await sleep((i / options.users) * options.rampSeconds * 1000);
    return runStudent(i + 1, target, options, metrics, (line) => console.log(line));
  }));
  const students = { started: results.filter((r) => r.started).length };
  const summary = metrics.summary();
  const outcome = verdict(summary, options);
  console.log(formatSummary(summary, outcome, options, students));
  console.log(`Wall time ${Math.round((Date.now() - started) / 1000)}s`);
  if (options.report) {
    writeFileSync(options.report, JSON.stringify({ target, options: { ...options, link: undefined }, students, outcome, summary, at: new Date().toISOString() }, null, 2));
    console.log(`Report written to ${options.report}`);
  }
  process.exitCode = outcome.pass && students.started === options.users ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
