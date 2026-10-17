import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FPS, STAGE_ONE} from '../script';
import {C, HARD_SHADOW, SANS, SERIF} from '../tokens';
import {MockGame} from './MockGame';

export const CaseBoard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const chosenIdx = STAGE_ONE.options.findIndex((o) => o.id === STAGE_ONE.chosen);

  const cardIn = spring({frame, fps, config: {damping: 200}});

  // cursor approaches the chosen option ~3s in, presses at ~4s
  const moveStart = 3 * FPS;
  const press = 4 * FPS;
  // option i vertical center inside the card (padding 40 + title ~44 + subtitle ~90 + gaps)
  const optionCenter = 40 + 52 + 90 + chosenIdx * 92 + 38;
  const t = interpolate(frame, [moveStart, press], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cursorTop = interpolate(t, [0, 1], [optionCenter + 260, optionCenter - 18]);
  const cursorRight = interpolate(t, [0, 1], [-60, 60]);
  const pressed = frame >= press;
  const pressScale = interpolate(frame, [press, press + 6], [1, 0.96], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const stamp = spring({
    frame: frame - (press + 14),
    fps,
    config: {damping: 11, stiffness: 180},
  });

  return (
    <div style={{position: 'absolute', inset: 0}}>
      {/* mock game frozen in its end state: 3/3 goals, full transcript */}
      <MockGame frameOverride={14 * FPS - 1} />
      <div style={{position: 'absolute', inset: 0, background: 'rgba(10,12,20,0.6)'}} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${0.9 + cardIn * 0.1})`,
          opacity: cardIn,
          width: 900,
          background: C.paper,
          border: `3px solid ${C.ink}`,
          borderRadius: 12,
          boxShadow: HARD_SHADOW,
          padding: '40px 48px 48px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{fontFamily: SERIF, fontSize: 44, color: C.ink}}>You can decide now</div>
        <div style={{fontFamily: SANS, fontSize: 22, color: C.muted, marginTop: 6, marginBottom: 30}}>
          This ends the stage. Review the evidence before choosing.
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
          {STAGE_ONE.options.map((opt, i) => {
            const isChosen = i === chosenIdx;
            return (
              <div
                key={opt.id}
                style={{
                  position: 'relative',
                  background: C.ink,
                  color: C.paper,
                  fontFamily: SANS,
                  fontSize: 26,
                  fontWeight: 600,
                  padding: '20px 28px',
                  borderRadius: 10,
                  border: `2px solid ${C.ink}`,
                  boxShadow: isChosen && pressed ? '1px 1px 0 ' + C.ink : HARD_SHADOW,
                  transform: isChosen ? `scale(${pressScale})` : 'none',
                }}
              >
                {opt.label}
                {isChosen && stamp > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 24,
                      top: '50%',
                      transform: `translateY(-50%) rotate(-8deg) scale(${stamp})`,
                      border: `4px solid ${C.danger}`,
                      color: C.danger,
                      fontFamily: SANS,
                      fontWeight: 900,
                      fontSize: 30,
                      letterSpacing: 4,
                      padding: '4px 16px',
                      borderRadius: 6,
                      background: 'rgba(255,248,233,0.85)',
                    }}
                  >
                    DECIDED
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* cursor */}
        {frame >= moveStart - 10 && frame < press + 20 && (
          <div
            style={{
              position: 'absolute',
              right: cursorRight,
              top: cursorTop,
              transform: `scale(${pressed ? 0.8 : 1})`,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: `4px solid ${C.paper}`,
              background: 'rgba(23,32,51,0.35)',
              boxShadow: '0 0 0 3px rgba(23,32,51,0.6)',
            }}
          />
        )}
      </div>
    </div>
  );
};
