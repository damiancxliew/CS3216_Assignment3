import { after, NextResponse } from "next/server";

import { getJobs, kickTick } from "@/lib/jobs/runner";
import { handleTick, TICK_SECRET_HEADER, tickUrl } from "@/lib/jobs/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const outcome = await handleTick({
    getJobs,
    secretHeader: request.headers.get(TICK_SECRET_HEADER),
  });

  if (outcome.kicks > 0) {
    after(async () => {
      await Promise.all(
        Array.from({ length: outcome.kicks }, () => kickTick(tickUrl(request.url))),
      );
    });
  }

  return NextResponse.json(outcome.body, { status: outcome.status });
}
