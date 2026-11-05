import type { NextRequest } from "next/server";
import { z } from "zod";
import { graderInstructions, markAnswer, SOURCE_TASK_MAX_CHARS as MAX_ANSWER_CHARS, type Judgement } from "@/lib/demo/inference-task";
import { publicJson } from "@/lib/play/http";

/** Standalone demo only: AI-assisted marking of the Source D inference task. */
export const runtime = "nodejs";
export const maxDuration = 60;

const input = z.object({ answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS) }).strict();
const judgement = z.object({
  inference: z.string().max(400).nullable(),
  inferenceValid: z.boolean(),
  inferencePrecise: z.boolean(),
  relevantLift: z.boolean(),
  explanation: z.enum(["none", "partial", "developed", "full"]),
  strength: z.string().min(1).max(600),
  nextStep: z.string().min(1).max(800),
});

// Presentation-scale guard, process-local, separate from the chat budget.
const requests = new Map<string, { start: number; count: number }>();
let daily = { start: Date.now(), count: 0 };
const json = (body: unknown, status = 200) =>
  publicJson(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = (message: string) =>
  json({ mode: "unavailable", message }, 200);

export async function POST(request: NextRequest) {
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin =
      origin.host === (request.headers.get("host") ?? request.nextUrl.host) &&
      origin.protocol === request.nextUrl.protocol;
  } catch {
    // Missing and opaque origins cannot invoke a paid marking call.
  }
  if (!sameOrigin) return json({ error: "Submit your answer from the demo page." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 12000)
    return json({ error: "Answer is too long." }, 413);
  const raw = await request.text();
  if (raw.length > 12000) return json({ error: "Answer is too long." }, 413);
  let body: z.infer<typeof input>;
  try {
    body = input.parse(JSON.parse(raw));
  } catch {
    return json({ error: `Write an answer of up to ${MAX_ANSWER_CHARS.toLocaleString("en-SG")} characters.` }, 400);
  }

  if (!process.env.OPENAI_API_KEY)
    return unavailable("AI marking is not configured here. Use the marking scheme below to check your own answer, or ask your teacher to mark it.");
  const now = Date.now();
  for (const [key, value] of requests) if (now - value.start > 60000) requests.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const budget = requests.get(ip) ?? { start: now, count: 0 };
  if (now - daily.start > 86400000) daily = { start: now, count: 0 };
  if (budget.count >= 6 || daily.count >= 300 || requests.size > 5000)
    return unavailable("AI marking is busy. Your answer is saved; try again in a minute.");
  budget.count++;
  daily.count++;
  requests.set(ip, budget);

  try {
    const result = await fetch(
      `${(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        signal: AbortSignal.timeout(50000),
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.DEMO_GRADER_MODEL ?? process.env.DEMO_HISTORY_MODEL ?? "gpt-5",
          store: false,
          instructions: graderInstructions(),
          input: `<<<STUDENT ANSWER\n${body.answer.replaceAll("<<<", "<<").replaceAll(">>>", ">>")}\n>>>`,
          max_output_tokens: 4000,
          // Minimal matched low on the exemplar + hold-out check at a third of the latency.
          reasoning: { effort: "minimal" },
          text: {
            format: {
              type: "json_schema",
              name: "inference_judgement",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  inference: { type: ["string", "null"] },
                  inferenceValid: { type: "boolean" },
                  inferencePrecise: { type: "boolean" },
                  relevantLift: { type: "boolean" },
                  explanation: { type: "string", enum: ["none", "partial", "developed", "full"] },
                  strength: { type: "string" },
                  nextStep: { type: "string" },
                },
                required: ["inference", "inferenceValid", "inferencePrecise", "relevantLift", "explanation", "strength", "nextStep"],
                additionalProperties: false,
              },
            },
          },
        }),
      },
    );
    if (!result.ok) {
      // Status only: never log credentials, provider bodies or student text.
      console.warn("[history-demo] Marking provider returned HTTP", result.status);
      return unavailable("AI marking is unavailable right now. Your answer is saved; try again shortly.");
    }
    const envelope = await result.json();
    const text =
      envelope.output
        ?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("") ?? envelope.output_text;
    const parsed: Judgement = judgement.parse(JSON.parse(text));
    return json({ mode: "live", grade: markAnswer(body.answer, parsed) });
  } catch {
    console.warn("[history-demo] Marking timed out or failed validation.");
    return unavailable("AI marking is unavailable right now. Your answer is saved; try again shortly.");
  }
}
