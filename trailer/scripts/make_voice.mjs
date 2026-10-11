/**
 * Voiceover lines for the trailer, generated with OpenAI text-to-speech: an energetic, warm, teacher-like read.
 *
 *   FFMPEG=/path/to/ffmpeg node --env-file=../.env scripts/make_voice.mjs           # voice "cedar"
 *   VOICE=coral FFMPEG=... node --env-file=../.env scripts/make_voice.mjs --force   # another voice, regenerate all
 *   TEMPO=1 FFMPEG=... node scripts/make_voice.mjs --measure-only --trim-all         # after dropping in recordings
 *
 * Writes public/voice/<id>.mp3 and src/voice.json (each clip's length in seconds, which times the shots).
 * To use a human recording instead, replace the mp3s (same ids) and rerun with --measure-only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "voice");
const VOICE = process.env.VOICE ?? "cedar";
/** Speed-up applied when trimming (pitch preserved): the model reads a little slower than natural speech. */
const TEMPO = Number(process.env.TEMPO ?? 1.1);
const force = process.argv.includes("--force");
const measureOnly = process.argv.includes("--measure-only");

const INSTRUCTIONS =
  "Bright, energetic and confident, like an enthusiastic teacher introducing something they love to colleagues. Brisk, lively pace with forward momentum and a smile in the voice. Warm and genuine, not salesy, no long pauses.";

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
const made = [];
if (!measureOnly) {
  const client = new OpenAI({ timeout: 120_000, maxRetries: 1 });
  await Promise.all(
    Object.entries(LINES).map(async ([id, input]) => {
      const file = join(OUT, `${id}.mp3`);
      if (!force && existsSync(file)) return;
      const res = await client.audio.speech.create({ model: "gpt-4o-mini-tts", voice: VOICE, input, instructions: INSTRUCTIONS, response_format: "mp3" });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      made.push(file);
      console.log(`made ${id}`);
    }),
  );
}
for (const file of process.argv.includes("--trim-all") ? Object.keys(LINES).map((id) => join(OUT, `${id}.mp3`)) : made) trim(file);
if (process.argv.includes("--normalize-all")) for (const id of Object.keys(LINES)) normalize(join(OUT, `${id}.mp3`));
const lengths = Object.fromEntries(Object.keys(LINES).map((id) => [id, Math.round(duration(join(OUT, `${id}.mp3`)) * 100) / 100]));
writeFileSync(join(ROOT, "src", "voice.json"), JSON.stringify({ voice: VOICE, lengths }, null, 2) + "\n");
console.log(JSON.stringify(lengths));
