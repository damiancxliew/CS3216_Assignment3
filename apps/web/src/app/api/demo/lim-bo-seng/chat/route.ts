import type { NextRequest } from "next/server";
import { z } from "zod";
import { chatInstructions, curatedReply, selectContext } from "@/lib/demo/chat";
import { hasOtherSpeaker, selectedSpeakerText } from "@/lib/demo/speaker";
import { stages } from "@/lib/demo/lim-bo-seng";
import { publicJson } from "@/lib/play/http";

export const runtime = "nodejs";
export const maxDuration = 35;
const input = z
  .object({
    stage: z
      .number()
      .int()
      .min(0)
      .max(stages.length - 1),
    npc: z.string().max(40),
    question: z.string().trim().min(1).max(1000),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(1800),
        }),
      )
      .max(8),
    decisions: z
      .array(
        z.object({
          stage: z.string().max(40),
          choice: z.string().max(40),
          reason: z.string().max(2000),
        }),
      )
      .max(5),
  })
  .strict();
const output = z.object({
  reply: z.string().min(1).max(2500),
  sources: z.array(z.string()).min(1).max(3),
});
// Presentation-scale guard, process-local. Production deployments need a shared limiter.
const requests = new Map<string, { start: number; count: number }>();
let daily = { start: Date.now(), count: 0 };
// Not a v3 route, so replies go through the shared wrapper that refuses private keys.
const json = (body: unknown, status = 200) =>
  publicJson(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  // Next's development server can normalize nextUrl to localhost even when
  // the browser used 127.0.0.1. Compare the browser authority with the actual
  // request Host, retaining the same protocol requirement.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin =
      origin.host === (request.headers.get("host") ?? request.nextUrl.host) &&
      origin.protocol === request.nextUrl.protocol;
  } catch {
    // Missing and opaque origins cannot invoke a paid conversation.
  }
  if (!sameOrigin)
    return json({ error: "Open this conversation from the demo page." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 24000)
    return json({ error: "Message is too large." }, 413);
  const raw = await request.text();
  if (raw.length > 24000) return json({ error: "Message is too large." }, 413);
  let body: z.infer<typeof input>;
  try {
    body = input.parse(JSON.parse(raw));
  } catch {
    return json(
      {
        error: "Send a question of up to 1,000 characters from a valid scene.",
      },
      400,
    );
  }
  const stage = stages[body.stage];
  if (!stage.npcs.some((n) => n.id === body.npc))
    return json({ error: "That person is not in this scene." }, 400);
  const fallback = () =>
    json(curatedReply(body.stage, body.npc, body.question));
  if (!process.env.OPENAI_API_KEY) return fallback();
  const now = Date.now();
  for (const [key, value] of requests)
    if (now - value.start > 60000) requests.delete(key);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const budget = requests.get(ip) ?? { start: now, count: 0 };
  if (now - daily.start > 86400000) daily = { start: now, count: 0 };
  if (budget.count >= 12 || daily.count >= 500 || requests.size > 5000)
    return json({
      ...curatedReply(body.stage, body.npc, body.question),
      notice:
        "Live chat is taking a break. The curated research note remains available.",
    });
  budget.count++;
  daily.count++;
  requests.set(ip, budget);
  const context = selectContext(body.stage, body.question);
  try {
    const result = await fetch(
      `${(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.DEMO_HISTORY_MODEL ?? "gpt-5",
          store: false,
          instructions: chatInstructions(body.stage, body.npc),
          input: JSON.stringify({
            question: body.question,
            history: body.history.filter((m) => m.role !== "assistant" || !hasOtherSpeaker(m.content, body.npc)),
            decisions: body.decisions,
            sources: context.map(
              ({ id, title, summary, limitation, date }) => ({
                id,
                title,
                summary,
                limitation,
                date,
              }),
            ),
          }),
          max_output_tokens: 1600,
          reasoning: { effort: "minimal" },
          text: {
            format: {
              type: "json_schema",
              name: "history_demo_reply",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  reply: { type: "string" },
                  sources: {
                    type: "array",
                    items: { type: "string", enum: context.map((s) => s.id) },
                  },
                },
                required: ["reply", "sources"],
                additionalProperties: false,
              },
            },
          },
        }),
      },
    );
    if (!result.ok) {
      // Status only: never log credentials, provider bodies or student text.
      console.warn("[history-demo] Live provider returned HTTP", result.status);
      return fallback();
    }
    const envelope = await result.json();
    const text =
      envelope.output
        ?.flatMap(
          (item: { content?: { type: string; text?: string }[] }) =>
            item.content ?? [],
        )
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("") ?? envelope.output_text;
    const answer = output.parse(JSON.parse(text));
    if (
      !answer.sources.every((id) => context.some((source) => source.id === id))
    )
      return fallback();
    if (hasOtherSpeaker(answer.reply, body.npc)) return fallback();
    const reply = selectedSpeakerText(answer.reply, body.npc);
    if (!reply.trim()) return fallback();
    return json({ ...answer, reply, mode: "live" });
  } catch {
    console.warn(
      "[history-demo] Live conversation timed out or failed validation.",
    );
    return fallback();
  }
}
