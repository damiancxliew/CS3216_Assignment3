import React from 'react';
import {Composition} from 'remotion';
import {FPS, TOTAL_SECONDS} from './script';
import {Video} from './Video';

export const Root: React.FC = () => {
  return (
    <Composition
      id="HistoricalAdventuresPreview"
      component={Video}
      durationInFrames={TOTAL_SECONDS * FPS}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
