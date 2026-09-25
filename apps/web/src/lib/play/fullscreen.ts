"use client";

/**
 * Full screen for the play view. The whole document goes full screen, so the
 * opening, the map and every dialog stay inside it. Safari on iPad needs the
 * prefixed API; iPhone Safari has none, and then nothing is offered.
 */
import { useCallback, useEffect, useState } from "react";

type PrefixedDocument = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type PrefixedElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function useFullscreen() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const doc = document as PrefixedDocument;
    setSupported(Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled));
    const update = () => setActive(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  /** Must be called from a click or key press; browsers refuse it otherwise. */
  const enter = useCallback(async () => {
    const element = document.documentElement as PrefixedElement;
    try {
      if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
      else await element.webkitRequestFullscreen?.();
    } catch {
      /* refused (e.g. an iframe without permission): the game works the same in a window */
    }
  }, []);

  const exit = useCallback(async () => {
    const doc = document as PrefixedDocument;
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch {
      /* already out */
    }
  }, []);

  const toggle = useCallback(() => void (active ? exit() : enter()), [active, enter, exit]);

  return { supported, active, enter, exit, toggle };
}
