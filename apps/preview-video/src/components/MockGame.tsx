import React from 'react';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FPS, PLAY_TRANSCRIPT, STAGE_ONE} from '../script';
import {C, GAME, HARD_SHADOW, SANS, SERIF} from '../tokens';
import {GoalChecklist} from './GoalChecklist';

const TILE = 48;
const COLS = 24;
const ROWS = 14;

const FLOOR_A = '#d9c6a3';
const FLOOR_B = '#d2bd98';
const GROUT = '#c4ae87';
const WALL = '#172033';
const WALL_CAP = '#3a465c';
const DOOR = '#8a5a2b';

// wall outline for two rooms: Audience Hall (left) + Archive (right)
const isDoor = (x: number, y: number) => x === 12 && y === 7;
const isWall = (x: number, y: number) => {
  if (isDoor(x, y)) return false;
  if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) return true;
  if (x === 12 && (y < 6 || y > 8)) return true; // divider with doorway
  if (y === 7 && x > 15) return true; // archive partition
  return false;
};

const Tile: React.FC<{x: number; y: number}> = ({x, y}) => {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: x * TILE,
    top: y * TILE,
    width: TILE,
    height: TILE,
    boxSizing: 'border-box',
  };
  if (isDoor(x, y)) {
    return <div style={{...base, background: DOOR, boxShadow: `inset 0 0 0 1px ${GROUT}`}} />;
  }
  if (isWall(x, y)) {
    // lighter cap only on the top edge of a wall run; sides are solid ink
    const capped = !isWall(x, y - 1);
    return (
      <div
        style={{
          ...base,
          background: WALL,
          borderTop: capped ? `10px solid ${WALL_CAP}` : 'none',
        }}
      />
    );
  }
  return (
    <div
      style={{
        ...base,
        background: (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B,
        boxShadow: `inset 0 0 0 1px ${GROUT}`,
      }}
    />
  );
};

// grid px offset inside the 1920x1080 frame: left pane 65% wide, grid centred
export const MAP_GRID = {
  left: Math.round((1920 * 0.65 - COLS * TILE) / 2),
  top: Math.round((1080 - ROWS * TILE) / 2),
};
export const gridLeft = (x: number) => MAP_GRID.left + x * TILE;
export const gridTop = (y: number) => MAP_GRID.top + y * TILE;

// sheet rows: 0 = down, 1 = left, 2 = right, 3 = up
export const Sprite: React.FC<{
  src: string;
  col: number; // spritesheet cell (0-3)
  row: number; // direction row (0-3)
  size?: number;
}> = ({src, col, row, size = 48}) => (
  <div
    style={{
      width: size,
      height: size,
      overflow: 'hidden',
      position: 'relative',
    }}
  >
    <Img
      src={staticFile(src)}
      style={{
        position: 'absolute',
        width: size * 4,
        height: size * 4,
        left: -col * size,
        top: -row * size,
        imageRendering: 'pixelated',
      }}
    />
  </div>
);

export const MockGame: React.FC<{
  frameOverride?: number;
  hudShift?: number; // px the HUD panel is translated right
  hidePlayer?: boolean;
}> = ({frameOverride, hudShift = 0, hidePlayer = false}) => {
  const currentFrame = useCurrentFrame();
  const frame = frameOverride ?? currentFrame;
  const {fps} = useVideoConfig();

  // player walks right across the floor over ~6s
  const walkT = interpolate(frame, [0, 6 * FPS], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const walking = walkT < 1;
  const walkFrame = walking ? Math.floor(frame / 6) % 4 : 0;
  const px = interpolate(walkT, [0, 1], [2.5 * TILE, 10.5 * TILE]);
  const py = 10 * TILE;

  // transcript lines appear ~2.5s apart after the walk starts
  const transcriptShown = PLAY_TRANSCRIPT.filter(
    (_, i) => frame >= (2 + i * 2.5) * FPS
  );

  // goals tick at seconds 6, 9 and 12
  const checked =
    (frame >= 6 * FPS ? 1 : 0) +
    (frame >= 9 * FPS ? 1 : 0) +
    (frame >= 12 * FPS ? 1 : 0);

  // "decide now" button pops at second 13
  const btnPop = spring({
    frame: frame - 13 * FPS,
    fps,
    config: {damping: 12, stiffness: 200},
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        background: C.ink,
      }}
    >
      {/* map */}
      <div
        style={{
          width: '65%',
          position: 'relative',
          overflow: 'hidden',
          background: '#111722',
          backgroundImage:
            'linear-gradient(#1a2332 1px, transparent 1px), linear-gradient(90deg, #1a2332 1px, transparent 1px)',
          backgroundSize: `${TILE}px ${TILE}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: COLS * TILE,
            height: ROWS * TILE,
          }}
        >
          {Array.from({length: ROWS}).map((_, y) =>
            Array.from({length: COLS}).map((__, x) => (
              <Tile key={`${x}-${y}`} x={x} y={y} />
            ))
          )}
          {/* landmark labels */}
          <div
            style={{
              position: 'absolute',
              left: 4 * TILE,
              top: 1.2 * TILE,
              fontFamily: SANS,
              fontSize: 18,
              color: C.paper,
              background: 'rgba(23,32,51,0.8)',
              padding: '2px 10px',
              borderRadius: 6,
            }}
          >
            Audience Hall
          </div>
          <div
            style={{
              position: 'absolute',
              left: 17 * TILE,
              top: 1.2 * TILE,
              fontFamily: SANS,
              fontSize: 18,
              color: C.paper,
              background: 'rgba(23,32,51,0.8)',
              padding: '2px 10px',
              borderRadius: 6,
            }}
          >
            Archive
          </div>
          {/* NPC in Audience Hall */}
          <div style={{position: 'absolute', left: 8.5 * TILE, top: 3 * TILE}}>
            <Sprite src={`${GAME}/characters/OldMan/walk.png`} col={0} row={0} />
          </div>
          {/* player */}
          {!hidePlayer && (
          <div style={{position: 'absolute', left: px, top: py}}>
            <Sprite
              src={`${GAME}/characters/Noble/walk.png`}
              col={walkFrame}
              row={walking ? 2 : 0}
            />
          </div>
          )}
        </div>
      </div>

      {/* HUD panel */}
      <div
        style={{
          width: '35%',
          background: C.paper,
          borderLeft: `2px solid ${C.line}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '28px 28px 24px',
          boxSizing: 'border-box',
          transform: `translateX(${hudShift}px)`,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 30,
            color: C.ink,
            borderBottom: `2px solid ${C.line}`,
            paddingBottom: 14,
          }}
        >
          Audience Hall
          <div style={{fontFamily: SANS, fontSize: 18, color: C.muted, marginTop: 4}}>
            Harry Parkes is here
          </div>
        </div>

        {/* transcript */}
        <div style={{flex: 1, padding: '18px 0', display: 'flex', flexDirection: 'column', gap: 12}}>
          {PLAY_TRANSCRIPT.map((line, i) => {
            const appear = (2 + i * 2.5) * FPS;
            const a = interpolate(frame, [appear, appear + 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            if (a === 0) return null;
            const isYou = line.who === 'You';
            return (
              <div
                key={i}
                style={{
                  opacity: a,
                  transform: `translateY(${(1 - a) * 10}px)`,
                  alignSelf: isYou ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: isYou ? C.recordWash : C.surface,
                  border: `1.5px solid ${isYou ? C.record : C.line}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 15,
                    fontWeight: 700,
                    color: isYou ? C.record : C.ink,
                    marginBottom: 2,
                  }}
                >
                  {line.who}
                </div>
                <div style={{fontFamily: SANS, fontSize: 18, color: C.ink, lineHeight: 1.35}}>
                  {line.text}
                </div>
              </div>
            );
          })}
        </div>

        {/* next step */}
        <div
          style={{
            borderTop: `2px solid ${C.line}`,
            paddingTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{fontFamily: SANS, fontSize: 18, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1}}>
            Next step · {checked}/3 goals
          </div>
          <GoalChecklist goals={STAGE_ONE.goals} checked={checked} fontSize={22} stagger={0} />
          {frame >= 13 * FPS - 10 && (
            <div
              style={{
                alignSelf: 'stretch',
                background: C.ink,
                color: C.paper,
                fontFamily: SANS,
                fontSize: 22,
                fontWeight: 700,
                textAlign: 'center',
                padding: '14px 0',
                borderRadius: 10,
                border: `2px solid ${C.ink}`,
                boxShadow: HARD_SHADOW,
                transform: `scale(${btnPop})`,
              }}
            >
              You can decide now →
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
