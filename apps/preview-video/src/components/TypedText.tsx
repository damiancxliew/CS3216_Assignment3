import React from 'react';
import {useCurrentFrame} from 'remotion';
import {FPS} from '../script';
import {C, SANS} from '../tokens';

export const TypedText: React.FC<{
  text: string;
  startFrame?: number;
  charsPerSec?: number;
  style?: React.CSSProperties;
}> = ({text, startFrame = 0, charsPerSec = 28, style}) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  // +1 so the first character lands on the start frame, not one frame late
  const shown =
    local < 0
      ? 0
      : Math.min(text.length, Math.floor((local / FPS) * charsPerSec) + 1);
  const done = shown >= text.length;

  return (
    <span style={{fontFamily: SANS, color: C.ink, ...style}}>
      {text.slice(0, shown)}
      {!done && local > 0 ? <span style={{opacity: 0.4}}>▌</span> : null}
    </span>
  );
};

export const typeSeconds = (text: string, charsPerSec = 28) =>
  text.length / charsPerSec;
