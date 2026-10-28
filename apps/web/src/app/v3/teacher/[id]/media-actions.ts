"use server";
import { z } from "zod";
import { after } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { createAssetStore } from "@/lib/assets/store";
import { tickUrl } from "@/lib/jobs/tick";
import { supabaseMediaRepository } from "@/lib/v3/media/repository";
import {
  uploadMedia,
  createMedia,
  requireMediaAdventure,
} from "@/lib/v3/media/service";
import { searchProvider } from "@/lib/v3/media/providers";
import { MAX_MEDIA_BYTES } from "@/lib/v3/media/uploads";

async function context(adventureId: string) {
  z.string().uuid().parse(adventureId);
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) throw Error("Sign in again.");
  const admin = createAdminClient();
  const deps = {
    play: new SupabaseV3PlayStore(admin),
    media: supabaseMediaRepository(admin),
    storage: createAssetStore(admin),
  };
  await requireMediaAdventure(deps, user.id, adventureId);
  return { admin, deps, userId: user.id };
}
const message = (cause: unknown) =>
  cause instanceof Error && !(cause instanceof z.ZodError)
    ? cause.message
    : "Invalid image request.";
export async function loadMediaAction(adventureId: string) {
  try {
    const { deps } = await context(adventureId);
    return { items: await deps.media.list(adventureId) };
  } catch (cause) {
    return { error: message(cause) };
  }
}
export async function uploadMediaAction(adventureId: string, form: FormData) {
  try {
    const { deps, userId } = await context(adventureId);
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_MEDIA_BYTES)
      throw Error("Choose an image up to 10 MB.");
    const raw = JSON.parse(String(form.get("input")));
    return {
      item: await uploadMedia(
        deps,
        userId,
        adventureId,
        raw,
        new Uint8Array(await file.arrayBuffer()),
      ),
    };
  } catch (cause) {
    return { error: message(cause) };
  }
}
export async function createMediaAction(adventureId: string, raw: unknown) {
  try {
    const { deps, userId } = await context(adventureId);
    const item = await createMedia(deps, userId, adventureId, raw);
    if (item.origin === "ai" && item.state === "pending") {
      const h = await headers(),
        host = h.get("host");
      const url =
        process.env.JOBS_TICK_URL ??
        (host
          ? tickUrl(`${h.get("x-forwarded-proto") ?? "https"}://${host}`)
          : null);
      if (url) after(async () => {
        const { kickTick } = await import("@/lib/jobs/runner");
        await kickTick(url);
      });
    }
    return { item };
  } catch (cause) {
    return { error: message(cause) };
  }
}
export async function searchImagesAction(adventureId: string, raw: unknown) {
  try {
    await context(adventureId);
    const { provider, query, page } = z
      .strictObject({
        provider: z.enum(["commons", "loc"]),
        query: z.string().trim().min(1).max(300),
        page: z.number().int().min(1).max(100).default(1),
      })
      .parse(raw);
    return await searchProvider(provider, query, page);
  } catch {
    return {
      error:
        "This provider is unavailable or returned unsupported metadata. Try again, choose another provider, or upload an image.",
    };
  }
}
