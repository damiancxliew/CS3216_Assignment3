import type { PostHogConfig } from "posthog-js";

export function analyticsEnvironment(hostname: string, configured?: string) {
  if (["staging", "production", "development", "preview"].includes(configured ?? "")) return configured!;
  if (hostname === "staging.pocketadventures.world") return "staging";
  if (["pocketadventures.world", "www.pocketadventures.world"].includes(hostname)) return "production";
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return "development";
  return "preview";
}

export function stagingReplayConfig(environment: string, pathname: string): Partial<PostHogConfig> {
  if (environment !== "staging") return {};
  const demo = pathname.replace(/\/$/, "") === "/demo/lim-bo-seng";
  return {
    disable_session_recording: !demo,
    session_recording: {
      maskAllInputs: true,
      // Messages may contain student text after it has left the input field.
      maskTextSelector: '.history-demo article, .history-demo [aria-label^="Conversation with"]',
      captureCanvas: { recordCanvas: demo, canvasFps: 2, canvasQuality: "0.4" },
      recordHeaders: false,
      recordBody: false,
    },
  };
}
