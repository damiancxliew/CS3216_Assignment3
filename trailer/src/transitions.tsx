import type { TransitionPresentation, TransitionPresentationComponentProps, TransitionTiming } from "@remotion/transitions";
import { linearTiming, springTiming } from "@remotion/transitions";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { fade } from "@remotion/transitions/fade";
import { flip } from "@remotion/transitions/flip";
import { iris } from "@remotion/transitions/iris";
import { pushCut } from "@remotion/transitions/push-cut";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { AbsoluteFill } from "remotion";

/** One beat at 120 BPM; every transition takes exactly this long so cuts stay on the grid. */
export const TRANSITION_FRAMES = 15;

/** The next shot is revealed through diagonal stripes. */
const Blinds = ({ children, presentationDirection, presentationProgress }: TransitionPresentationComponentProps<Record<string, never>>) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const L = 140;
  const open = presentationProgress * L;
  const mask = `repeating-linear-gradient(-55deg, #000 0px, #000 ${open}px, transparent ${open}px, transparent ${L}px)`;
  return <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>{children}</AbsoluteFill>;
};
const blinds = (): TransitionPresentation<Record<string, never>> => ({ component: Blinds, props: {} });

const smooth = springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES });
const even = linearTiming({ durationInFrames: TRANSITION_FRAMES });
const size = { width: 1920, height: 1080 };

/** Each transition's own props type differs; the series only needs them to be presentations. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTransition = { presentation: TransitionPresentation<any>; timing: TransitionTiming };

/** The transition library: all DOM-based, so they render reliably. */
const LIBRARY = {
  "slide-right": { presentation: slide({ direction: "from-right" }), timing: smooth },
  "slide-bottom": { presentation: slide({ direction: "from-bottom" }), timing: smooth },
  "wipe-left": { presentation: wipe({ direction: "from-left" }), timing: smooth },
  "wipe-bottom-left": { presentation: wipe({ direction: "from-bottom-left" }), timing: smooth },
  "wipe-top-right": { presentation: wipe({ direction: "from-top-right" }), timing: smooth },
  iris: { presentation: iris(size), timing: smooth },
  clock: { presentation: clockWipe(size), timing: even },
  flip: { presentation: flip({ direction: "from-right", perspective: 2400 }), timing: smooth },
  push: { presentation: pushCut({ flashColor: "#fff8e9", flashOpacity: 0.6 }), timing: even },
  blinds: { presentation: blinds(), timing: even },
  fade: { presentation: fade(), timing: even },
};
export type TransitionName = keyof typeof LIBRARY;
export const TRANSITIONS: Record<TransitionName, AnyTransition> = LIBRARY;
