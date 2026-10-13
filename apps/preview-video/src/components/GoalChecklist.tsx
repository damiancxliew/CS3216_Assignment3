import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, SANS} from '../tokens';

export const GoalChecklist: React.FC<{
  goals: {title: string; target: string}[];
  checked: number; // how many leading goals are checked
  startFrame?: number;
  stagger?: number;
  fontSize?: number;
}> = ({goals, checked, startFrame = 0, stagger = 8, fontSize = 28}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
      {goals.map((goal, i) => {
        const enter = spring({
          frame: frame - startFrame - i * stagger,
          fps,
          config: {damping: 200},
        });
        const done = i < checked;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              transform: `translateX(${(1 - enter) * 40}px)`,
              opacity: enter,
            }}
          >
            <div
              style={{
                width: fontSize,
                height: fontSize,
                borderRadius: '50%',
                border: `3px solid ${done ? C.world : C.ink}`,
                background: done ? C.world : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.paper,
                fontSize: fontSize * 0.7,
                fontFamily: SANS,
                flexShrink: 0,
              }}
            >
              {done ? '✓' : ''}
            </div>
            <div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize,
                  fontWeight: 600,
                  color: C.ink,
                  textDecoration: done ? 'line-through' : 'none',
                  textDecorationColor: C.world,
                }}
              >
                {goal.title}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: fontSize * 0.72,
                  color: C.muted,
                }}
              >
                {goal.target}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
