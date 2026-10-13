import React from 'react';
import {Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {asset} from '../tokens';

export const Painting: React.FC<{
  src: string;
  dim?: number;
  startFrame?: number;
}> = ({src, dim = 0.35, startFrame = 0}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const local = Math.max(0, frame - startFrame);
  const total = Math.max(1, durationInFrames - startFrame);
  const p = local / total;

  const scale = interpolate(p, [0, 1], [1.05, 1.12]);
  const tx = interpolate(p, [0, 1], [0, -0.5 * 24]);
  const ty = interpolate(p, [0, 1], [0, -0.6 * 24]);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: '#000'}}>
      <Img
        src={asset(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
        }}
      />
      {/* vignette + dim scrim */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `rgba(10, 10, 16, ${dim})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </div>
  );
};
