import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FPS, GUIDE, RECAP_LINES, STAGE_TWO} from '../script';
import {C, SANS, SERIF} from '../tokens';
import {DialogueBox} from './DialogueBox';
import {Painting} from './Painting';

const S = FPS;

export const ChapterCard: React.FC<{durationInFrames: number}> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const fade = interpolate(frame, [0, 2 * S], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleIn = spring({frame: frame - Math.floor(1.5 * S), fps, config: {damping: 200}});

  const boxIn = spring({frame: frame - 3 * S, fps, config: {damping: 200}});

  return (
    <div style={{position: 'absolute', inset: 0, background: '#000'}}>
      <div style={{opacity: fade, position: 'absolute', inset: 0}}>
        <Painting src={STAGE_TWO.painting} dim={0.45} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 140,
          top: 160,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 30}px)`,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 26,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: C.sunshine,
            marginBottom: 14,
          }}
        >
          Stage {String(STAGE_TWO.index).padStart(2, '0')} of{' '}
          {String(STAGE_TWO.count).padStart(2, '0')}
        </div>
        <div style={{fontFamily: SERIF, fontSize: 84, color: C.paper}}>
          {STAGE_TWO.title}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 28,
            color: '#d8d2c4',
            marginTop: 16,
            maxWidth: 900,
          }}
        >
          {STAGE_TWO.setting}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${(1 - boxIn) * 120}px)`,
          opacity: boxIn,
        }}
      >
        <DialogueBox
          lines={RECAP_LINES}
          speaker={GUIDE.name}
          face={GUIDE.face}
          durationInFrames={Math.max(1, durationInFrames - 3 * S)}
        />
      </div>
    </div>
  );
};
