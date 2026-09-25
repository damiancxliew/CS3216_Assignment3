import { loadI1Spec } from "@adventure/generation/fixtures";

import { publicJson } from "@/lib/play/http";
import { PlaySession } from "@/lib/play/session";

// The landing hero runs the real map on the demo adventure (Singapore 1819). This is the
// same public projection the Turn API sends a student — publicJson refuses anything private —
// built once at build time, with no attempt, model call or sign-in behind it.
export const dynamic = "force-static";

export async function GET() {
  const spec = await loadI1Spec();
  const session = PlaySession.start(spec, "landing-demo", 1, { now: () => new Date("2026-09-25T00:00:00.000Z") }, null, undefined);
  return publicJson(session.state({ enabled: false, deadlineAt: null }));
}
