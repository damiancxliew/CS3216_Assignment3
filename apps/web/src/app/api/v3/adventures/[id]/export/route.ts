import { validateSpec } from "@adventure/spec-v3";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/v3/brief/service";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { specExport } from "@/lib/v3/spec-transfer";
import { createSpecArchive } from "@/lib/v3/spec-archive";
import { createAssetStore } from "@/lib/assets/store";
import { fetchSourceBytes } from "@adventure/generation";

export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("adventures_v3").select("owner_id,school_id,spec,spec_version,status").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not export adventure" }, { status: 500 });
  if (!data || !canAccessV3Authoring(auth.viewer, { ownerId: data.owner_id, schoolId: data.school_id }) || !["draft", "published", "archived"].includes(data.status)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = validateSpec(data.spec);
  if (!parsed.ok) return NextResponse.json({ error: "This adventure does not have a valid saved spec." }, { status: 409 });
  try {
    const sources = await supabaseV3SourceStore(() => admin).load(id);
    const bundle = specExport(parsed.spec, sources, id, data.spec_version);
    const zip = new URL(request.url).searchParams.get("format") === "zip";
    const filename = (parsed.spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "adventure") + (zip ? ".zip" : ".json");
    let body: string | ArrayBuffer = JSON.stringify(bundle, null, 2) + "\n";
    if (zip) {
      const storage = createAssetStore(admin);
      const archive = await createSpecArchive(bundle, async (url) => {
        const stored = await storage.download(url);
        if (stored) return stored;
        // External media keeps the existing DNS-pinned, bounded public fetch boundary.
        return (await fetchSourceBytes(url, { policy: { allowAny: true }, maxBytes: 10 * 1024 * 1024, contentTypes: ["image/png", "image/jpeg", "image/webp"], headers: { accept: "image/*" } })).bytes;
      });
      body = new Uint8Array(archive).buffer;
    }
    return new Response(body, { headers: {
      "Content-Type": zip ? "application/zip" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("could not export v3 adventure", error);
    return NextResponse.json({ error: "Could not export adventure. For ZIP, all selected media must be available and the archive must fit within 15 MB. You can still export JSON." }, { status: 500 });
  }
}
