import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {FPS} from '../script';
import {C, SANS, SERIF} from '../tokens';

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 0.8 * FPS], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: C.ink,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        opacity: fade,
      }}
    >
      <div style={{fontFamily: SERIF, fontSize: 88, color: C.paper}}>
        Historical Adventures
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 24,
          color: '#b9b3a4',
          letterSpacing: 2,
        }}
      >
        Preview — proposed stage opening &amp; transition
      </div>
    </div>
  );
};
