import { validateSpec } from "@adventure/spec-v3";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/v3/brief/service";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { specExport } from "@/lib/v3/spec-transfer";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("adventures_v3").select("owner_id,school_id,spec,spec_version,status").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not export adventure" }, { status: 500 });
  if (!data || data.owner_id !== auth.userId || !v3SchoolAllowed(data.school_id) || !["draft", "published", "archived"].includes(data.status)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = validateSpec(data.spec);
  if (!parsed.ok) return NextResponse.json({ error: "This adventure does not have a valid saved spec." }, { status: 409 });
  try {
    const sources = await supabaseV3SourceStore(() => admin).load(id);
    const bundle = specExport(parsed.spec, sources, id, data.spec_version);
    const filename = (parsed.spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "adventure") + ".json";
    return new Response(JSON.stringify(bundle, null, 2) + "\n", { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("could not export v3 adventure", error);
    return NextResponse.json({ error: "Could not export adventure. Please try again." }, { status: 500 });
  }
}
