import { expect, it } from "vitest";

// CI starts the production server after `next build`; normal unit/API runs need no server.
it.runIf(process.env.RUN_HEADER_ASSET_TESTS === "1")("ships the styles referenced by the production header", async () => {
  const origin = process.env.HEADER_PRODUCTION_ORIGIN ?? "http://127.0.0.1:3239";
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw Error("Local production server only");
  let response: Response | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { response = await fetch(origin); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  expect(response?.status).toBe(200);
  const html = await response!.text();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  expect(header).toBeTruthy();
  const classes = [...new Set([...header!.matchAll(/\bclass="([^"]+)"/g)]
    .flatMap(match => match[1].split(/\s+/)).filter(name => name.startsWith("site-header")))];
  expect(classes.length).toBeGreaterThanOrEqual(3);
  const stylesheets = [...html.matchAll(/<link\b[^>]*>/g)]
    .filter(match => /\brel="stylesheet"/.test(match[0]))
    .map(match => new URL(match[0].match(/\bhref="([^"]+)"/)![1], origin));
  expect(stylesheets.length).toBeGreaterThan(0);
  const css = (await Promise.all(stylesheets.map(async url => {
    expect(url.origin).toBe(new URL(origin).origin);
    const stylesheet = await fetch(url);
    expect(stylesheet.status).toBe(200);
    return stylesheet.text();
  }))).join("\n");
  for (const name of classes) expect(css, `Missing production CSS for ${name}`).toContain(`.${name}`);
});
