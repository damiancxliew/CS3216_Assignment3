import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AssetStore } from "@adventure/generation/assets";

const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/webp", "image/jpeg"]);

export class S3AssetStore implements AssetStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor() {
    const bucket = process.env.ASSET_BUCKET;
    const region = process.env.AWS_REGION;
    const publicBaseUrl = process.env.ASSET_PUBLIC_BASE_URL;
    if (!bucket) throw new Error("ASSET_BUCKET is not configured");
    if (!region) throw new Error("AWS_REGION is not configured");
    if (!publicBaseUrl) throw new Error("ASSET_PUBLIC_BASE_URL is not configured");

    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
  }

  async put(key: string, bytes: Uint8Array, mimeType: string): Promise<string> {
    if (bytes.byteLength > MAX_OBJECT_BYTES) throw new Error("asset exceeds the 10 MB storage limit");
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("asset content type must be PNG, WebP, or JPEG");

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
      CacheControl: "public, max-age=604800",
    }));
    return `${this.publicBaseUrl}/${key}`;
  }

  async download(url: string): Promise<Uint8Array | null> {
    const key = this.keyFromUrl(url);
    if (key === null) return null;

    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return result.Body ? result.Body.transformToByteArray() : null;
  }

  private keyFromUrl(url: string): string | null {
    let baseUrl: URL;
    let objectUrl: URL;
    try {
      baseUrl = new URL(`${this.publicBaseUrl}/`);
      objectUrl = new URL(url);
    } catch {
      return null;
    }

    const basePath = `${baseUrl.pathname.replace(/\/$/, "")}/`;
    if (objectUrl.origin !== baseUrl.origin || !objectUrl.pathname.startsWith(basePath)) return null;
    const encodedKey = objectUrl.pathname.slice(basePath.length);
    if (!encodedKey) return null;
    return decodeURIComponent(encodedKey);
  }
}
