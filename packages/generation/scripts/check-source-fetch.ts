/** Run on the deployed worker: npx vite-node scripts/check-source-fetch.ts <public-record-url> ...
 * Read-only client comparison; never changes headers or accepts empty source text.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lookup } from "node:dns/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchSourceBytes,
  isAllowedUrl,
  type SourceDiagnostic,
} from "../src/sources";
import { pinnedFetch } from "../src/sources/pinned-fetch";
import { isPrivateAddress } from "../src/sources/private-address";
const exec = promisify(execFile);
const accept = "text/html, application/pdf, text/plain;q=0.9";
const safeHeaders = (headers: Headers) =>
  Object.fromEntries(
    [...headers].filter(
      ([key]) =>
        !["set-cookie", "authorization", "cookie"].includes(key.toLowerCase()),
    ),
  );
for (const target of process.argv.slice(2)) {
  if (!isAllowedUrl(target)) throw Error("Use an approved public source URL.");
  const events: unknown[] = [];
  const diagnostic: Partial<SourceDiagnostic> = {};
  const started = Date.now();
  try {
    await fetchSourceBytes(target, {
      policy: {},
      diagnostic,
      fetch: async (url, init) => {
        const began = Date.now();
        const response = await pinnedFetch(url, init);
        events.push({
          url: String(url),
          requestHeaders: { accept },
          status: response.status,
          responseHeaders: safeHeaders(response.headers),
          headersMs: Date.now() - began,
        });
        return response;
      },
    });
  } catch (cause) {
    events.push({
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
  const pinned = { events, ...diagnostic, totalMs: Date.now() - started };
  const directory = await mkdtemp(join(tmpdir(), "source-client-"));
  const curls: unknown[] = [];
  try {
    let url = target;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!isAllowedUrl(url)) throw Error("Rejected curl redirect");
      const parsed = new URL(url),
        addresses = await lookup(parsed.hostname, { all: true });
      if (
        !addresses.length ||
        addresses.some((value) => isPrivateAddress(value.address))
      )
        throw Error("Nonpublic curl target");
      const address = addresses[0]!,
        port = parsed.protocol === "https:" ? 443 : 80;
      const began = Date.now();
      const { stdout } = await exec(
        "curl",
        [
          "--silent",
          "--show-error",
          "--max-time",
          "15",
          "--max-filesize",
          String(15 * 1024 * 1024),
          "--resolve",
          `${parsed.hostname}:${port}:${address.family === 6 ? `[${address.address}]` : address.address}`,
          "--header",
          `Accept: ${accept}`,
          "--dump-header",
          join(directory, "headers"),
          "--output",
          join(directory, "body"),
          "--write-out",
          "%{json}",
          url,
        ],
        { maxBuffer: 1024 * 1024 },
      );
      const headerText = await readFile(join(directory, "headers"), "utf8");
      const headers = Object.fromEntries(
        headerText
          .split(/\r?\n/)
          .filter((line) => line.includes(":") && !/^set-cookie:/i.test(line))
          .map((line) => [
            line.slice(0, line.indexOf(":")).toLowerCase(),
            line.slice(line.indexOf(":") + 1).trim(),
          ]),
      );
      const details = JSON.parse(stdout) as {
        http_code: number;
        size_download: number;
        time_total: number;
        redirect_url: string;
        url_effective: string;
      };
      curls.push({
        url,
        requestHeaders: { accept },
        status: details.http_code,
        responseHeaders: headers,
        bodyBytes: details.size_download,
        totalMs: Date.now() - began,
        curlSeconds: details.time_total,
      });
      if (
        ![301, 302, 303, 307, 308].includes(details.http_code) ||
        !details.redirect_url
      )
        break;
      url = new URL(details.redirect_url, url).href;
    }
  } catch (cause) {
    curls.push({
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  process.stdout.write(
    JSON.stringify({ target, pinned, curl: curls }, null, 2) + "\n",
  );
}
