import type { AssetStore } from "@adventure/generation/assets";
import type { SupabaseClient } from "@supabase/supabase-js";

import { S3AssetStore } from "./s3";
import { SupabaseAssetStore } from "./supabase";

export function createAssetStore(admin: SupabaseClient): AssetStore {
  return process.env.ASSET_BUCKET ? new S3AssetStore() : new SupabaseAssetStore(admin);
}
