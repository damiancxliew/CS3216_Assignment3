import React from 'react';
import {Img, interpolate, useCurrentFrame} from 'remotion';
import {FPS} from '../script';
import {asset, C, HARD_SHADOW, SANS, SERIF} from '../tokens';
import {TypedText, typeSeconds} from './TypedText';

/**
 * Pokémon-style dialogue box. Sequences `lines` evenly across `durationInFrames`.
 */
export const DialogueBox: React.FC<{
  lines: string[];
  speaker: string;
  face: string;
  durationInFrames: number;
  style?: React.CSSProperties;
}> = ({lines, speaker, face, durationInFrames, style}) => {
  const frame = useCurrentFrame();
  const perLine = durationInFrames / lines.length;
  const idx = Math.min(lines.length - 1, Math.floor(frame / perLine));
  const lineStart = idx * perLine;
  const line = lines[idx];
  const typing = frame - lineStart < typeSeconds(line, 28) * FPS;

  // face bob while typing
  const bob = typing ? Math.sin(frame / 6) * 3 : 0;

  // caret blink once finished
  const caret = Math.floor(frame / 15) % 2 === 0;

  const pop = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 64,
        transform: `translateX(-50%) scale(${0.96 + pop * 0.04})`,
        width: 1400,
        opacity: pop,
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          background: C.paper,
          border: `3px solid ${C.ink}`,
          borderRadius: 12,
          boxShadow: HARD_SHADOW,
          padding: '28px 40px 36px 190px',
          minHeight: 190,
          boxSizing: 'border-box',
        }}
      >
        {/* speaker name tag overlapping top-left border */}
        <div
          style={{
            position: 'absolute',
            top: -22,
            left: 32,
            background: C.ink,
            color: C.paper,
            fontFamily: SERIF,
            fontVariant: 'small-caps',
            letterSpacing: 2,
            fontSize: 26,
            padding: '6px 22px',
            borderRadius: 8,
            boxShadow: HARD_SHADOW,
          }}
        >
          {speaker}
        </div>
        {/* pixel face */}
        <div
          style={{
            position: 'absolute',
            left: 32,
            top: 36,
            width: 128,
            height: 128,
            border: `2px solid ${C.ink}`,
            borderRadius: 8,
            overflow: 'hidden',
            background: C.surface,
            transform: `translateY(${bob}px)`,
          }}
        >
          <Img
            src={asset(face)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              imageRendering: 'pixelated',
            }}
          />
        </div>
        <div style={{fontSize: 34, lineHeight: 1.45, minHeight: 100}}>
          <TypedText text={line} startFrame={lineStart} charsPerSec={28} />
        </div>
        {!typing && (
          <div
            style={{
              position: 'absolute',
              right: 28,
              bottom: 16,
              fontSize: 26,
              color: C.ink,
              fontFamily: SANS,
              opacity: caret ? 1 : 0.15,
            }}
          >
            ▼
          </div>
        )}
      </div>
    </div>
  );
};
