import { NextResponse } from "next/server";
import { Action } from "@adventure/play-contract";

import { stepFortress, type FortressSnapshot } from "../engine";

/** Local only: steps the real engine statelessly; the browser holds the state. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: { message: "Not available." } }, { status: 404 });
  const body = await request.json() as { snapshot: FortressSnapshot; action: unknown };
  try {
    const next = await stepFortress(body.snapshot, Action.parse(body.action));
    return NextResponse.json(next);
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Step failed" } }, { status: 400 });
  }
}
