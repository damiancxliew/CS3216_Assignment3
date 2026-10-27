import { createAdminClient } from "@/lib/supabase/admin";
import { createAssetStore } from "@/lib/assets/store";
import { spriteObjectKey } from "@/lib/play/v3/sprite-url";

export const runtime = "nodejs";

/** These image objects are already public. Never accept an arbitrary upstream URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = spriteObjectKey(path.join("/"));
  const base = process.env.ASSET_BUCKET ? process.env.ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") : null;
  if (!key || !base) return new Response(null, { status: 404 });
  try {
    const bytes = await createAssetStore(createAdminClient()).download(`${base}/${key}`);
    if (!bytes) return new Response(null, { status: 404 });
    if (bytes.byteLength > 10 * 1024 * 1024) return new Response(null, { status: 502 });
    return new Response(Buffer.from(bytes), { headers: {
      "Content-Type": key.endsWith(".png") ? "image/png" : "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
