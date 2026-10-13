/**
 * Voiceover lines for the trailer, generated with OpenAI text-to-speech: a high-energy, warm, teacher-like female read.
 *
 *   FFMPEG=/path/to/ffmpeg node --env-file=../.env scripts/make_voice.mjs           # whole script in one take, voice "nova"
 *   VOICE=coral FFMPEG=... node --env-file=../.env scripts/make_voice.mjs           # another voice
 *   FFMPEG=... node --env-file=../.env scripts/make_voice.mjs --line-by-line --force # fallback: one request per line
 *   TEMPO=1 FFMPEG=... node scripts/make_voice.mjs --measure-only --trim-all         # after dropping in recordings
 *
 * Writes public/voice/<id>.mp3 and src/voice.json (each clip's length in seconds, which times the shots).
 * To use a human recording instead, replace the mp3s (same ids) and rerun with --measure-only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "voice");
const VOICE = process.env.VOICE ?? "nova";
/** Speed-up applied when trimming (pitch preserved): the model reads a little slower than natural speech. */
const TEMPO = Number(process.env.TEMPO ?? 1.15);
const force = process.argv.includes("--force");
const measureOnly = process.argv.includes("--measure-only");

const INSTRUCTIONS =
  "High energy and upbeat: an excited, confident teacher sharing great news with colleagues. Fast, punchy pace with crisp diction and a bright smile in the voice. Keep momentum between sentences. Warm and genuine, never shouty or salesy.";

/** One clip per line; ids match where the line plays (see VOICE_CUES in src/Trailer.tsx). */
export const LINES = {
  context: "History asks students to weigh evidence and judge the past.",
  reading: "But mostly, they read about it.",
  chatbots: "Or ask a chatbot.",
  rarely: "They rarely practise the thinking.",
  here: "Here, they have to.",
  establish: "They step inside the moment.",
  skill1: "They see why people acted as they did.",
  skill2: "Find evidence in real sources.",
  skill3: "Compare accounts that disagree.",
  skill4: "Use evidence to make a case.",
  skill5: "Weigh decisions and their consequences.",
  skill6: "Reach a judgement and defend it.",
  skill7: "And separate the story from the record.",
  anyLesson: "And making one is easy.",
  step1: "Drop in your sources.",
  step2: "We build the game.",
  step3: "And press play.",
  ask: "Want changes? Just ask.",
  montage: "Any topic. Any class.",
  classView: "And afterwards, see how your class thought.",
  title: "Historical Adventures. Turn your sources into a game.",
};

const duration = (file) => {
  const ff = process.env.FFMPEG;
  if (!ff) throw new Error("set FFMPEG to an ffmpeg binary to measure clip lengths");
  let out = "";
  try {
    execFileSync(ff, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    out = String(error.stderr ?? "");
  }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`could not read duration of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/** Trim the silence the speech model leaves at both ends (so lengths measure the speech itself), apply TEMPO, normalise. */
const trim = (file) => {
  const tmp = file.replace(/\.mp3$/, ".trim.mp3");
  const edge = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04";
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", file, "-af", `${edge},areverse,${edge},areverse,atempo=${TEMPO},${LOUD}`, "-ar", "48000", "-b:a", "160k", tmp]);
  renameSync(tmp, file);
};
/** Bring a clip to a voiceover level that sits clearly above the ducked music. */
const LOUD = "loudnorm=I=-16:TP=-1.5:LRA=7";
const normalize = (file) => {
  const tmp = file.replace(/\.mp3$/, ".norm.mp3");
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", file, "-af", LOUD, "-ar", "48000", "-b:a", "160k", tmp]);
  renameSync(tmp, file);
};

mkdirSync(OUT, { recursive: true });
const ids = Object.keys(LINES);

const words = (text) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

/** Align two word lists (edit distance); returns, for each script word, the index of the matching heard word or -1. */
const align = (script, heard) => {
  const n = script.length;
  const m = heard.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (script[i - 1] === heard[j - 1] ? 0 : 1));
  const map = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (d[i][j] === d[i - 1][j - 1] + (script[i - 1] === heard[j - 1] ? 0 : 1)) { map[i - 1] = j - 1; i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return map;
};

/**
 * The whole script is read in one request, so each sentence gets the intonation of its place in the flow (a line
 * like "Here, they have to." lands as a full stop instead of trailing off). The take is transcribed with word
 * timestamps, aligned to the script, and cut in the gap between each line's last word and the next line's first.
 */
const wholeTake = async (client) => {
  const full = join(tmpdir(), "trailer-voice-full.mp3");
  const processed = join(tmpdir(), "trailer-voice-full.processed.mp3");
  const res = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VOICE,
    input: ids.map((id) => LINES[id]).join("\n\n"),
    instructions: `${INSTRUCTIONS} This is a trailer script: give each paragraph a complete, natural ending, with a short pause between paragraphs.`,
    response_format: "mp3",
  });
  writeFileSync(full, Buffer.from(await res.arrayBuffer()));
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", full, "-af", `atempo=${TEMPO},${LOUD}`, "-ar", "48000", "-b:a", "192k", processed]);
  const tr = await client.audio.transcriptions.create({ file: await toFile(readFileSync(processed), "take.mp3"), model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["word"] });
  const heard = (tr.words ?? []).map((w) => ({ word: words(w.word)[0] ?? "", start: w.start, end: w.end }));
  const lineWords = ids.map((id) => words(LINES[id]));
  const script = lineWords.flat();
  const map = align(script, heard.map((w) => w.word));
  const matched = map.filter((j) => j >= 0).length / script.length;
  if (matched < 0.85) return { ok: false, why: `transcript matched only ${Math.round(matched * 100)}% of the script` };
  // First and last heard word of each line.
  let k = 0;
  const spans = lineWords.map((lw) => {
    const idx = lw.map((_, i) => map[k + i]).filter((j) => j >= 0);
    k += lw.length;
    return idx.length ? { first: heard[Math.min(...idx)].start, last: heard[Math.max(...idx)].end } : null;
  });
  if (spans.some((sp) => !sp)) return { ok: false, why: "a line was not found in the transcript" };
  const total = duration(processed);
  const bounds = [0, ...spans.slice(1).map((sp, i) => (spans[i].last + sp.first) / 2), total];
  if (bounds.some((b, i) => i > 0 && b <= bounds[i - 1])) return { ok: false, why: "lines overlap in the transcript" };
  ids.forEach((id, i) => {
    const file = join(OUT, `${id}.mp3`);
    const edge = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03";
    execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-ss", String(bounds[i]), "-to", String(bounds[i + 1]), "-i", processed, "-af", `${edge},areverse,${edge},areverse`, "-ar", "48000", "-b:a", "160k", file]);
  });
  return { ok: true };
};

const made = [];
if (!measureOnly && !process.argv.includes("--line-by-line")) {
  const client = new OpenAI({ timeout: 180_000, maxRetries: 1 });
  let result = { ok: false, why: "not tried" };
  for (let attempt = 1; attempt <= 4 && !result.ok; attempt++) {
    result = await wholeTake(client);
    console.log(`take ${attempt}: ${result.ok ? "split cleanly" : result.why}`);
  }
  if (!result.ok) throw new Error("could not split the whole-script take cleanly; try again or use --line-by-line");
} else if (!measureOnly) {
  // Fallback: one request per line (intonation can trail off on short lines).
  const client = new OpenAI({ timeout: 120_000, maxRetries: 1 });
  await Promise.all(
    ids.map(async (id) => {
      const file = join(OUT, `${id}.mp3`);
      if (!force && existsSync(file)) return;
      const res = await client.audio.speech.create({ model: "gpt-4o-mini-tts", voice: VOICE, input: LINES[id], instructions: INSTRUCTIONS, response_format: "mp3" });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      made.push(file);
      console.log(`made ${id}`);
    }),
  );
}
for (const file of process.argv.includes("--trim-all") ? ids.map((id) => join(OUT, `${id}.mp3`)) : made) trim(file);
if (process.argv.includes("--normalize-all")) for (const id of ids) normalize(join(OUT, `${id}.mp3`));
const lengths = Object.fromEntries(Object.keys(LINES).map((id) => [id, Math.round(duration(join(OUT, `${id}.mp3`)) * 100) / 100]));
writeFileSync(join(ROOT, "src", "voice.json"), JSON.stringify({ voice: VOICE, lengths }, null, 2) + "\n");
console.log(JSON.stringify(lengths));
