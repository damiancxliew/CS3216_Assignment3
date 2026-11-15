#!/usr/bin/env node
// Renders docs/diagrams/*.mmd to png/*.png sized for an A4 portrait report.
// Each diagram is rendered once as SVG to measure its natural size, then as PNG at a
// scale that makes it about TARGET_WIDTH px wide. The report line printed per diagram is
// the font size the body text will have when the PNG is placed on an A4 page
// (190 mm printable width, 277 mm printable height).
// Usage: node docs/diagrams/render.mjs [name ...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = "@mermaid-js/mermaid-cli@12.2.0";
const TARGET_WIDTH = 1600;
const MAX_SCALE = 2.5;
const FONT_PX = 16;
const A4 = { width: 190, height: 277 };

const here = dirname(fileURLToPath(import.meta.url));
const config = join(here, "mermaid.config.json");
const wanted = process.argv.slice(2);
const sources = readdirSync(here)
  .filter((f) => f.endsWith(".mmd"))
  .filter((f) => wanted.length === 0 || wanted.includes(basename(f, ".mmd")))
  .sort();
const tmp = mkdtempSync(join(tmpdir(), "mmd-"));

const mmdc = (args) =>
  execFileSync("npx", ["-y", CLI, "-q", "-c", config, "-b", "white", ...args], { stdio: ["ignore", "ignore", "inherit"] });

function svgSize(file) {
  const svg = readFileSync(file, "utf8");
  const box = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
  if (!box) throw new Error(`no viewBox in ${file}`);
  return { width: Number(box[1]), height: Number(box[2]) };
}

function pngSize(file) {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

try {
  for (const source of sources) {
    const name = basename(source, ".mmd");
    const svg = join(tmp, `${name}.svg`);
    mmdc(["-i", join(here, source), "-o", svg]);
    const natural = svgSize(svg);
    const scale = Math.min(MAX_SCALE, TARGET_WIDTH / natural.width);
    const png = join(here, "png", `${name}.png`);
    mmdc(["-i", join(here, source), "-o", png, "-s", scale.toFixed(3)]);
    const out = pngSize(png);
    const printedWidth = Math.min(A4.width, (A4.height * out.width) / out.height);
    const fontPt = ((FONT_PX * scale * printedWidth) / out.width) / 0.3528;
    console.log(
      `${name}: natural ${Math.round(natural.width)}x${Math.round(natural.height)}, png ${out.width}x${out.height}, ` +
        `A4 width ${printedWidth.toFixed(0)} mm, body text ${fontPt.toFixed(1)} pt${fontPt < 7 ? "  <-- too small" : ""}`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
