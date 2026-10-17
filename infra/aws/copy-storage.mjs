import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.ASSET_BUCKET;
const region = process.env.AWS_REGION;
if (!supabaseUrl || !serviceRoleKey || !bucket || !region) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASSET_BUCKET, and AWS_REGION are required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const s3 = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
let copied = 0;

async function copyPrefix(prefix = "") {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from("assets").list(prefix, { limit: 100, offset });
    if (error) throw new Error(`could not list Supabase Storage objects: ${error.message}`);
    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await copyPrefix(key);
        continue;
      }

      const { data: object, error: downloadError } = await supabase.storage.from("assets").download(key);
      if (downloadError || !object) throw new Error(`could not download a Supabase Storage object: ${downloadError?.message ?? "empty response"}`);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: new Uint8Array(await object.arrayBuffer()),
        ContentType: entry.metadata?.mimetype ?? "application/octet-stream",
        CacheControl: "public, max-age=604800",
      }));
      copied += 1;
    }
    if (data.length < 100) break;
  }
}

await copyPrefix();
console.log(`Copied ${copied} assets to the configured S3 bucket.`);
