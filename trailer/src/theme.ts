import { loadFont as loadSerif } from "@remotion/google-fonts/Literata";
import { loadFont as loadSans } from "@remotion/google-fonts/AtkinsonHyperlegibleNext";
import { loadFont as loadPixel } from "@remotion/google-fonts/PixelifySans";
import { loadFont as loadBold } from "@remotion/google-fonts/AlbertSans";
import { loadFont as loadTypewriter } from "@remotion/google-fonts/SpecialElite";
import { loadFont as loadBlackletter } from "@remotion/google-fonts/UnifrakturMaguntia";
import { loadFont as loadFell } from "@remotion/google-fonts/IMFellEnglish";
import { loadFont as loadFellCaps } from "@remotion/google-fonts/IMFellDWPicaSC";
import { loadFont as loadOldStandard } from "@remotion/google-fonts/OldStandardTT";
import { loadFont as loadScript } from "@remotion/google-fonts/PinyonScript";

const latin = { subsets: ["latin" as const] };
export const serif = loadSerif("normal", { weights: ["500", "700"], ...latin }).fontFamily;
export const sans = loadSans("normal", { weights: ["400", "600", "700"], ...latin }).fontFamily;
/** In-game text: names, dialogue, menus. */
export const pixel = loadPixel("normal", { weights: ["400", "600", "700"], ...latin }).fontFamily;
/** Bold kinetic pitch type. */
export const bold = loadBold("normal", { weights: ["500", "800", "900"], ...latin }).fontFamily;
export const typewriter = loadTypewriter("normal", { weights: ["400"], ...latin }).fontFamily;
/** Period print for the realistic documents. */
export const blackletter = loadBlackletter("normal", { weights: ["400"], ...latin }).fontFamily;
export const fell = loadFell("normal", { weights: ["400"], ...latin }).fontFamily;
loadFell("italic", { weights: ["400"], ...latin });
export const fellCaps = loadFellCaps("normal", { weights: ["400"], ...latin }).fontFamily;
export const oldStandard = loadOldStandard("normal", { weights: ["400", "700"], ...latin }).fontFamily;
export const script = loadScript("normal", { weights: ["400"], ...latin }).fontFamily;

/** The product's own palette (apps/web/src/app/globals.css). */
export const color = {
  paper: "#fff8e9",
  paperDeep: "#f4e8cc",
  ink: "#172033",
  muted: "#5c6472",
  record: "#3659cf",
  recordWash: "#e7ecff",
  world: "#258663",
  worldWash: "#dff4e9",
  signal: "#d85f35",
  signalWash: "#ffe4d2",
  night: "#111722",
};

export const FPS = 30;
export const s = (seconds: number) => Math.round(seconds * FPS);
