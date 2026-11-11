import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FORTRESS_DIR } from "../../engine";

/** Local only: serves the lesson pack's art in place. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (process.env.NODE_ENV === "production" || !/^[\w.-]+\.(jpg|png)$/.test(file)) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(resolve(FORTRESS_DIR, "art", file));
    return new Response(new Uint8Array(bytes), { headers: { "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
