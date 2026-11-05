/**
 * Key art for the trailer, generated with the same art direction the product uses
 * (packages/generation/src/assets/service.ts: STYLE.portrait and STYLE.cover).
 *
 *   node --env-file=../.env scripts/make_art.mjs          # needs OPENAI_API_KEY; skips files that exist
 *   node --env-file=../.env scripts/make_art.mjs --force  # regenerate everything
 *
 * Writes public/art/*.webp. Portrait expression variants are edits of the neutral portrait, so the face stays the same.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
const MODEL = "gpt-image-1.5";
const force = process.argv.includes("--force");

const PORTRAIT_STYLE = [
  "Serious, historically grounded head-and-shoulders character portrait for an educational game.",
  "Crisp hand-authored 16-bit pixel art with a limited muted period palette and a strong silhouette.",
  "Preserve the subject-specific age, hair, facial hair, clothing and cultural details supplied in the description.",
  "Centered frontal or slight three-quarter pose, reserved neutral expression, plain charcoal background, no text and no frame.",
  "Not cute, chibi, toy-like, anime, caricatured, smiling or heroic.",
].join(" ");

const COVER_STYLE =
  "Wide establishing key-art illustration of the historical setting, for the cover of an educational adventure. High-resolution painterly historical illustration with smooth natural contours, fine architectural detail, soft atmospheric lighting, and richly blended muted period colors. Use continuous brushwork and antialiased edges. No pixel art, visible pixel grid, blocky square edges, dithering, low-resolution texture, or retro game rendering. Compose one readable wide scene of the place — period architecture, terrain, sky and weather — seen from a slightly elevated three-quarter vantage point, with distinct foreground, midground and background layers. Any people are small, distant and incidental. No close-up faces or portraits, no text, lettering, titles, captions, logos, banners, flags, insignia, frames, borders, vignettes, UI, watermarks or modern objects. The card crops the image to a wide strip, so keep the important detail near the centre and away from the extreme edges.";

const SAFE = "Suitable for students aged 13-18: no gore, no nudity, no weapons, no modern text or logos.";

const portraits = {
  ahmad: "Ahmad, a young Malay interpreter and scribe in Singapore in 1819, about twenty years old, slim, clean-shaven, wearing a simple cotton baju melayu and a black songkok, attentive eyes.",
  temenggong: "Temenggong Abdul Rahman, the Malay chief governing Singapore island for Johor in 1819, a dignified man in his fifties with a short grey beard, wearing traditional Malay court dress in deep colours with a folded tengkolok headcloth.",
  raffles: "Sir Stamford Raffles in 1819, an English East India Company official in his late thirties, pale complexion, short curly brown hair and sideburns, wearing an early nineteenth-century dark tailcoat with a high collar and a white cravat.",
  hussein: "Tengku Hussein, a Malay prince of Johor in 1819, about forty, neat moustache, wearing rich royal Malay attire of songket cloth and a patterned headcloth.",
  farquhar: "Major William Farquhar in 1819, a Scottish officer in his mid-forties, weathered face, greying hair, wearing a plain early nineteenth-century red officer's coat without insignia.",
  clerk: "A clerk of the East India Company in Singapore in 1824, a middle-aged Eurasian man with small round spectacles, receding hair and a plain dark coat, holding a quill near his chin.",
};

const expressions = {
  "temenggong-guarded": ["temenggong", "guarded and unconvinced: eyes slightly narrowed, mouth set firm, chin a little lowered"],
  "raffles-intrigued": ["raffles", "intrigued: eyebrows slightly raised, eyes bright and attentive, leaning a little forward"],
  "clerk-sceptical": ["clerk", "sceptical: one eyebrow raised, lips pressed, looking straight at the viewer as if pressing a point"],
};

const covers = {
  "cover-1819": ["The mouth of the Singapore River in 1819", "Malay attap houses on stilts along a muddy river bank, a few small sailing ships and sampans at anchor, jungle-covered hills behind, warm late-afternoon light.", "warm grass green, dark brown wood, cream stone"],
  "cover-meiji": ["A street in Kyoto during the Meiji Restoration, 1868", "wooden machiya townhouses and a temple roof under fresh snow, paper lanterns, the first gas street lamp, quiet winter morning.", "snow white, pale blue-gray, dark timber"],
  "cover-malacca": ["The harbour of the Malacca Sultanate around 1450", "a busy port with Chinese junks and Arab dhows, a wooden Malay palace on a hill, market stalls along the shore, bright tropical sky.", "sea green, weathered tan, muted blue-gray"],
  "cover-silkroad": ["Samarkand on the Silk Road around 1400", "a caravanserai courtyard with resting camels and bales of cloth, blue-tiled domes and minarets beyond, dusty golden evening light.", "sandy ochre, clay brown, sun-faded cream"],
  "cover-merger": ["Singapore in the early 1960s, during Merger and Separation", "City Hall and the Padang with colonial buildings, a few 1960s cars and trishaws on the road, heavy monsoon clouds gathering over the sea.", "muted blue-gray, cream stone, deep green"],
};

const client = new OpenAI({ timeout: 180_000, maxRetries: 1 });
mkdirSync(OUT, { recursive: true });

const save = (name, b64) => writeFileSync(join(OUT, `${name}.webp`), Buffer.from(b64, "base64"));
const done = (name) => !force && existsSync(join(OUT, `${name}.webp`));

async function generate(name, prompt, size, quality) {
  if (done(name)) return console.log(`skip ${name}`);
  const res = await client.images.generate({ model: MODEL, prompt, size, quality, output_format: "webp", background: "opaque", n: 1 });
  save(name, res.data[0].b64_json);
  console.log(`made ${name}`);
}

async function edit(name, from, change) {
  if (done(name)) return console.log(`skip ${name}`);
  const image = await toFile(readFileSync(join(OUT, `${from}.webp`)), `${from}.webp`, { type: "image/webp" });
  const prompt = `Same person, same 16-bit pixel-art style, same framing, clothing, palette and plain charcoal background. Change only the facial expression to: ${change}. Keep it serious and historically grounded, not cartoonish. No text and no frame.`;
  const res = await client.images.edit({ model: MODEL, image, prompt, size: "1024x1024", quality: "medium", output_format: "webp", n: 1 });
  save(name, res.data[0].b64_json);
  console.log(`made ${name}`);
}

const run = async (jobs, limit = 4) => {
  const queue = [...jobs];
  const failures = [];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) {
      const [name, job] = queue.shift();
      try { await job(); } catch (error) { failures.push(name); console.error(`failed ${name}: ${error?.message ?? error}`); }
    }
  }));
  return failures;
};

const portraitJobs = Object.entries(portraits).map(([name, brief]) => [name, () => generate(name, `Subject: ${brief} ${PORTRAIT_STYLE} ${SAFE}`, "1024x1024", "medium")]);
const coverJobs = Object.entries(covers).map(([name, [subject, brief, palette]]) => [name, () => generate(name, `Subject: ${subject}. Description: ${brief} ${COVER_STYLE} Use colors inspired by the setting: ${palette}, with natural tonal variation and smooth color transitions. ${SAFE}`, "1536x1024", "high")]);
const failed = await run([...portraitJobs, ...coverJobs]);
const failedEdits = await run(Object.entries(expressions).filter(([, [from]]) => !failed.includes(from)).map(([name, [from, change]]) => [name, () => edit(name, from, change)]));
const all = [...failed, ...failedEdits];
if (all.length) {
  console.error(`failed: ${all.join(", ")}`);
  process.exit(1);
}
