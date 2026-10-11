import { loadFont as loadSerif } from "@remotion/google-fonts/Literata";
import { loadFont as loadSans } from "@remotion/google-fonts/AtkinsonHyperlegibleNext";

export const serif = loadSerif("normal", { weights: ["500", "700"], subsets: ["latin"] }).fontFamily;
export const sans = loadSans("normal", { weights: ["400", "600", "700"], subsets: ["latin"] }).fontFamily;

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
