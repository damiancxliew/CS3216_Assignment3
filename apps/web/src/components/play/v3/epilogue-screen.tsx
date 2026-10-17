"use client";

import { useEffect } from "react";
import type { Action, PlayerView } from "@adventure/play-contract";

import { useTypewriter } from "@/components/play/v3/dialogue-box";
import { SpeakerBox } from "@/components/play/v3/speaker-box";

export function EpilogueScreen({
  epilogue,
  busy,
  send,
}: {
  epilogue: NonNullable<PlayerView["epilogue"]>;
  busy: boolean;
  send: (action: Action) => void;
}) {
  const typed = useTypewriter(epilogue.text, true);
  const advance = () => {
    if (!typed.done) typed.skip();
    else if (!busy) send({ type: "continue" });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " " && event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      advance();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <SpeakerBox
      speaker="Narrator"
      tag={epilogue.title}
      note={epilogue.label}
      text={typed.shown}
      done={typed.done}
      busy={busy}
      continueLabel="Continue"
      onAdvance={advance}
    />
  );
}
