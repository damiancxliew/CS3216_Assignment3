#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [supabaseUrl, jwtSecretPath, envPath] = process.argv.slice(2);

if (!supabaseUrl || !jwtSecretPath || !envPath) {
  console.error("Usage: node gen-keys.mjs <supabase-url> <jwt-secret-path> <env-file-path>");
  process.exit(2);
}

const jwksUrl = new URL("/auth/v1/.well-known/jwks.json", supabaseUrl);
const response = await fetch(jwksUrl);
if (!response.ok) throw new Error(`Failed to fetch Supabase JWKS (HTTP ${response.status})`);

const jwks = await response.json();
if (!Array.isArray(jwks.keys)) throw new Error("Supabase JWKS response has no keys array");

const publicEcKeys = jwks.keys.flatMap((key) => {
  if (
    key.kty !== "EC"
    || key.crv !== "P-256"
    || typeof key.kid !== "string"
    || typeof key.x !== "string"
    || typeof key.y !== "string"
    || (key.alg && key.alg !== "ES256")
    || (key.use && key.use !== "sig")
  ) return [];

  return [{ kty: "EC", crv: "P-256", x: key.x, y: key.y, kid: key.kid, alg: "ES256", use: "sig" }];
});
if (publicEcKeys.length === 0) throw new Error("Supabase JWKS contains no public ES256 key");

const keyBytes = randomBytes(32);
const keyId = randomBytes(12).toString("base64url");
const octKey = {
  kty: "oct",
  alg: "HS256",
  use: "sig",
  kid: keyId,
  k: keyBytes.toString("base64url"),
};
const jwtSecret = JSON.stringify({ keys: [...publicEcKeys, octKey] });

function mintToken(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: keyId, typ: "JWT" })).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ role, iat: issuedAt, exp: issuedAt + 10 * 365 * 24 * 60 * 60 })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", keyBytes).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

async function writePrivateFile(path, contents) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, absolutePath);
  await chmod(absolutePath, 0o600);
}

await Promise.all([
  writePrivateFile(jwtSecretPath, `${jwtSecret}\n`),
  writePrivateFile(
    envPath,
    `NEXT_PUBLIC_DATA_ANON_KEY=${mintToken("anon")}\nDATA_SERVICE_ROLE_KEY=${mintToken("service_role")}\n`,
  ),
]);

console.log("Wrote PostgREST signing keys and data API tokens.");
