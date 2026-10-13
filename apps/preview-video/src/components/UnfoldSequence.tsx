import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {FPS, STAGE_ONE, UNFOLD} from '../script';
import {C, GAME, HARD_SHADOW, SANS, SERIF} from '../tokens';
import {gridLeft, gridTop, MockGame, Sprite} from './MockGame';
import {Painting} from './Painting';
import {TypedText} from './TypedText';

const S = FPS;
const GAME_END = 14 * S - 1; // mock game's final state

export const beatRange = (id: string) => {
  let from = 0;
  for (const beat of UNFOLD.beats) {
    const durationInFrames = beat.seconds * S;
    if (beat.id === id) return {from, durationInFrames};
    from += durationInFrames;
  }
  throw new Error(`unknown beat ${id}`);
};

const NOBLE = `${GAME}/characters/Noble/walk.png`;
const OLDMAN = `${GAME}/characters/OldMan/walk.png`;
const KNIGHT = `${GAME}/characters/Knight/walk.png`;

// grid coordinates in the Audience Hall
const PARKES = {x: 8.5, y: 3}; // existing MockGame NPC
const TABLE = {x: 9.75, y: 3.4, w: 1.5, h: 1};
const GONG = {x: 10.5, y: 4.75}; // opposite Parkes, across the table
const GONG_FROM = {x: 10.5, y: 10}; // where the walk beat starts
// shift the 1152px grid so it is centred in the full 1920 frame (HUD stays off)
const RECENTER_X = Math.round((1920 - 24 * 48) / 2 - 48);
const TABLE_CENTER = {x: gridLeft(TABLE.x) + (TABLE.w * 48) / 2, y: gridTop(TABLE.y) + 24};
const IGNATIEV = {x: 3.5, y: 10};
const CENSORS = [
  {x: 16.5, y: 3},
  {x: 18, y: 3.5},
];

/* ---------- shared pieces ---------- */

const Toast: React.FC<{text: string; tone: 'world' | 'danger' | 'signal'; start: number}> = ({
  text,
  tone,
  start,
}) => {
  const frame = useCurrentFrame();
  const color = {world: C.world, danger: C.danger, signal: C.signal}[tone];
  const t = frame - start;
  const slide = interpolate(t, [0, 10, 48, 58], [-60, 0, 0, -60], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (t < 0 || t > 58) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 1920 * 0.325,
        top: 32,
        transform: `translate(-50%, ${slide}px)`,
        background: C.paper,
        border: `2px solid ${color}`,
        borderRadius: 999,
        padding: '10px 26px',
        fontFamily: SANS,
        fontSize: 24,
        fontWeight: 700,
        color: C.ink,
        boxShadow: HARD_SHADOW,
        whiteSpace: 'nowrap',
        zIndex: 30,
      }}
    >
      {text}
    </div>
  );
};

const Bubble: React.FC<{
  text: string;
  gx: number; // grid x of the speaker
  gy: number;
  start: number;
  hold?: number;
}> = ({text, gx, gy, start, hold = 45}) => {
  const frame = useCurrentFrame();
  const t = frame - start;
  if (t < 0 || t > hold) return null;
  const pop = interpolate(t, [0, 6], [0.6, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: gridLeft(gx) + 24,
        top: gridTop(gy) - 16,
        transform: `translate(-50%, -100%) scale(${pop})`,
        transformOrigin: '50% 100%',
        zIndex: 25,
      }}
    >
      <div
        style={{
          background: C.paper,
          border: `2px solid ${C.ink}`,
          borderRadius: 10,
          padding: '8px 16px',
          fontFamily: SANS,
          fontSize: 20,
          color: C.ink,
          whiteSpace: 'nowrap',
        }}
      >
        <TypedText text={text} startFrame={start} charsPerSec={28} style={{fontSize: 20}} />
      </div>
      {/* tail */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -8,
          width: 12,
          height: 12,
          background: C.paper,
          borderRight: `2px solid ${C.ink}`,
          borderBottom: `2px solid ${C.ink}`,
          transform: 'translateX(-50%) rotate(45deg)',
        }}
      />
    </div>
  );
};

const Table: React.FC<{glow?: number}> = ({glow = 0}) => (
  <div
    style={{
      position: 'absolute',
      left: gridLeft(TABLE.x),
      top: gridTop(TABLE.y),
      width: TABLE.w * 48,
      height: TABLE.h * 48,
      background: '#8a5a2b',
      borderTop: '12px solid #b07a3c',
      boxSizing: 'border-box',
      boxShadow: '0 3px 0 rgba(0,0,0,0.35)',
      zIndex: 10,
    }}
  >
    {/* scroll */}
    <div
      style={{
        position: 'absolute',
        left: 18,
        top: 8,
        width: 36,
        height: 24,
        background: C.paper,
        border: `1.5px solid ${C.ink}`,
        borderRadius: 2,
      }}
    >
      {[6, 11, 16].map((top) => (
        <div
          key={top}
          style={{position: 'absolute', left: 5, right: 5, top, height: 1.5, background: C.ink}}
        />
      ))}
      {glow > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: -14,
            background: `radial-gradient(circle, rgba(255,230,109,${glow}) 0%, rgba(255,230,109,0) 70%)`,
          }}
        />
      )}
    </div>
  </div>
);

const MapActor: React.FC<{
  sheet: string;
  gx: number;
  gy: number;
  row: number;
  col: number;
}> = ({sheet, gx, gy, row, col}) => (
  <div style={{position: 'absolute', left: gridLeft(gx), top: gridTop(gy), zIndex: 12}}>
    <Sprite src={sheet} col={col} row={row} />
  </div>
);

/** Static end-state of the case board, used as the walk beat opens. */
const BoardEndState: React.FC<{fade: number}> = ({fade}) => {
  const chosenIdx = STAGE_ONE.options.findIndex((o) => o.id === STAGE_ONE.chosen);
  return (
    <AbsoluteFill style={{opacity: fade, zIndex: 20, pointerEvents: 'none'}}>
      <div style={{position: 'absolute', inset: 0, background: `rgba(10,12,20,${0.6 * fade})`}} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${1 - (1 - fade) * 0.15})`,
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
        <div style={{display: 'flex', flexDirection: 'column', gap: 18, marginTop: 30}}>
          {STAGE_ONE.options.map((opt, i) => (
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
              }}
            >
              {opt.label}
              {i === chosenIdx && (
                <div
                  style={{
                    position: 'absolute',
                    right: 24,
                    top: '50%',
                    transform: 'translateY(-50%) rotate(-8deg)',
                    border: `4px solid ${C.danger}`,
                    color: C.danger,
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
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Camera wrapper: grid recentred, push-in anchored on the table. */
const MapWorld: React.FC<{
  scale: number;
  hudShift: number;
  children: React.ReactNode;
}> = ({scale, hudShift, children}) => (
  <AbsoluteFill
    style={{
      transform: `translateX(${RECENTER_X}px) scale(${scale})`,
      transformOrigin: `${TABLE_CENTER.x}px ${TABLE_CENTER.y}px`,
    }}
  >
    <MockGame frameOverride={GAME_END} hudShift={hudShift} hidePlayer />
    {children}
  </AbsoluteFill>
);

/* ---------- beat 1: walk ---------- */
const WalkBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const boardFade = interpolate(frame, [0, 10], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cam = interpolate(frame, [8, 50], [1, 1.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const hudShift = interpolate(frame, [8, 50], [0, 760], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Gong walks up from the aisle to the table, 0.8s-2.3s
  const walk = interpolate(frame, [24, 69], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const walking = walk < 1;
  const gx = interpolate(walk, [0, 1], [GONG_FROM.x, GONG.x]);
  const gy = interpolate(walk, [0, 1], [GONG_FROM.y, GONG.y]);

  return (
    <AbsoluteFill>
      <MapWorld scale={cam} hudShift={hudShift}>
        <Table />
        <MapActor sheet={NOBLE} gx={gx} gy={gy} row={walking ? 3 : 3} col={walking ? Math.floor(frame / 6) % 4 : 0} />
        <MapActor sheet={OLDMAN} gx={IGNATIEV.x} gy={IGNATIEV.y} row={1} col={0} />
        {CENSORS.map((p, i) => (
          <MapActor key={i} sheet={OLDMAN} gx={p.x} gy={p.y} row={1} col={0} />
        ))}
        <Bubble text={UNFOLD.bubbles[0].text} gx={gx} gy={gy} start={Math.floor(1.5 * S)} />
        <Bubble text={UNFOLD.bubbles[1].text} gx={PARKES.x} gy={PARKES.y} start={Math.floor(2.8 * S)} />
      </MapWorld>
      <BoardEndState fade={boardFade} />
    </AbsoluteFill>
  );
};

/* ---------- beat 2: sign ---------- */
const SignBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // glow pulses 3x, 8 frames each, from 0.4s
  const pt = frame - Math.floor(0.4 * S);
  const glow = pt < 0 || pt >= 24 ? 0 : 0.55 * Math.abs(Math.sin((pt / 8) * Math.PI));
  const stroke = interpolate(frame, [Math.floor(0.4 * S), Math.floor(0.4 * S) + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stamp = spring({
    frame: frame - Math.floor(1.4 * S),
    fps,
    config: {damping: 11, stiffness: 180},
  });

  return (
    <MapWorld scale={1.6} hudShift={760}>
      <Table glow={glow} />
      {/* quill stroke across the scroll */}
      <div
        style={{
          position: 'absolute',
          left: gridLeft(TABLE.x) + 22,
          top: gridTop(TABLE.y) + 20,
          width: 28,
          height: 3,
          background: C.ink,
          transform: `scaleX(${stroke})`,
          transformOrigin: '0 50%',
          zIndex: 14,
        }}
      />
      <MapActor sheet={NOBLE} gx={GONG.x} gy={GONG.y} row={0} col={0} />
      <MapActor sheet={OLDMAN} gx={IGNATIEV.x} gy={IGNATIEV.y} row={1} col={0} />
      {CENSORS.map((p, i) => (
        <MapActor key={i} sheet={OLDMAN} gx={p.x} gy={p.y} row={1} col={0} />
      ))}
      {stamp > 0 && (
        <div
          style={{
            position: 'absolute',
            left: gridLeft(TABLE.x) - 60,
            top: gridTop(TABLE.y) - 46,
            transform: `rotate(-6deg) scale(${stamp})`,
            background: C.ink,
            color: C.paper,
            fontFamily: SANS,
            fontVariant: 'small-caps',
            fontWeight: 700,
            letterSpacing: 2,
            fontSize: 24,
            padding: '8px 20px',
            borderRadius: 6,
            boxShadow: HARD_SHADOW,
            whiteSpace: 'nowrap',
            zIndex: 15,
          }}
        >
          {UNFOLD.stamp}
        </div>
      )}
    </MapWorld>
  );
};

/* ---------- beat 3: ripple ---------- */
const FloatMark: React.FC<{gx: number; gy: number; start: number; up: boolean}> = ({
  gx,
  gy,
  start,
  up,
}) => {
  const frame = useCurrentFrame();
  const t = frame - start;
  if (t < 0) return null;
  const y = interpolate(t, [0, 24], [0, -40], {extrapolateRight: 'clamp'});
  const o = interpolate(t, [0, 6, 24], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: gridLeft(gx) + 24,
        top: gridTop(gy) - 10 + y,
        transform: 'translateX(-50%)',
        fontSize: 28,
        fontWeight: 900,
        fontFamily: SANS,
        color: up ? C.world : C.danger,
        opacity: o,
        zIndex: 20,
      }}
    >
      {up ? '▲' : '▼'}
    </div>
  );
};

const RippleBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = interpolate(frame, [0, 24], [1.6, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const hudShift = 760; // HUD stays off for the whole unfold

  // knights stand on the outside strip, then march left off the map ~3s
  const kt = frame - Math.floor(0.5 * S);
  const marching = kt >= 0 && kt < 3 * S;
  const marchX = -interpolate(kt, [0, 3 * S], [0, 960], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // censors turn away at 2.0s
  const censorRow = frame >= 2 * S ? 3 : 1;

  // ignatiev takes 2 steps toward gong at 3.4s
  const it = frame - Math.floor(3.4 * S);
  const stepT = interpolate(it, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const igx = interpolate(stepT, [0, 1], [IGNATIEV.x, IGNATIEV.x + 1.4]);
  const igy = interpolate(stepT, [0, 1], [IGNATIEV.y, IGNATIEV.y - 1.2]);

  return (
    <MapWorld scale={cam} hudShift={hudShift}>
      <Table />
      <MapActor sheet={NOBLE} gx={GONG.x} gy={GONG.y} row={0} col={0} />
      <MapActor sheet={OLDMAN} gx={igx} gy={igy} row={it >= 0 && it < 20 ? 3 : 1} col={it >= 0 && it < 20 ? Math.floor(frame / 6) % 4 : 0} />
      {CENSORS.map((p, i) => (
        <MapActor key={i} sheet={OLDMAN} gx={p.x} gy={p.y} row={censorRow} col={0} />
      ))}
      {/* road strip outside the bottom wall */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: gridTop(14.3),
          width: 1248,
          height: 96,
          background: '#1e2838',
          zIndex: 8,
        }}
      />
      {/* knight column marching left below the bottom wall */}
      {Array.from({length: 6}).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: gridLeft(15 + i) + marchX,
            top: gridTop(14.6),
            zIndex: 12,
          }}
        >
          <Sprite src={KNIGHT} col={marching ? Math.floor(frame / 6) % 4 : 0} row={1} />
        </div>
      ))}
      {frame >= 2 * S &&
        CENSORS.map((p, i) => (
          <FloatMark key={i} gx={p.x} gy={p.y} start={Math.floor(2 * S) + i * 4} up={false} />
        ))}
      {frame >= Math.floor(3.4 * S) + 10 && (
        <FloatMark gx={igx} gy={igy} start={Math.floor(3.4 * S) + 10} up />
      )}
      <Toast text={UNFOLD.toasts[0].text} tone={UNFOLD.toasts[0].tone} start={Math.floor(0.5 * S)} />
      <Toast text={UNFOLD.toasts[1].text} tone={UNFOLD.toasts[1].tone} start={Math.floor(2.0 * S)} />
      <Toast text={UNFOLD.toasts[2].text} tone={UNFOLD.toasts[2].tone} start={Math.floor(3.4 * S)} />
    </MapWorld>
  );
};

/* ---------- beat 4/5 shared: burning painting ---------- */

/* soft CSS fx for the burning painting — no sprites */

const Rain: React.FC<{t: number}> = ({t}) => (
  <AbsoluteFill style={{overflow: 'hidden', filter: 'blur(0.5px)'}}>
    {Array.from({length: 70}).map((_, i) => {
      const x = (i * 137) % 1980;
      const len = 60 + ((i * 53) % 61);
      const speed = 9 + ((i * 37) % 7);
      const y = ((i * 97 + t * speed) % 1220) - 80;
      const o = 0.18 + ((i * 29) % 13) / 100;
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: 2,
            height: len,
            background: `rgba(255,255,255,${o})`,
            transform: 'rotate(12deg)',
          }}
        />
      );
    })}
  </AbsoluteFill>
);

const SmokePlume: React.FC<{x: number; delay: number; t: number}> = ({x, delay, t}) => (
  <AbsoluteFill>
    {Array.from({length: 5}).map((_, j) => {
      const size = 180 + ((x * 7 + j * 67) % 140);
      const prog = Math.min(1, Math.max(0, (t * 1.1 - delay + j * 55) / 420));
      const rise = prog * 320;
      const drift = Math.sin(t / 22 + j * 1.7 + x) * 26 * prog;
      const scale = 0.8 + prog * 0.5;
      const o = Math.max(0, 0.55 * (1 - prog));
      const lit = j === 0; // lowest circle lit from below by the fire
      return (
        <div
          key={j}
          style={{
            position: 'absolute',
            left: `${x}%`,
            top: '30%',
            width: size,
            height: size,
            borderRadius: '50%',
            background: lit
              ? `radial-gradient(circle, rgba(255,140,60,0.25) 0%, rgba(40,30,25,0.55) 45%, rgba(40,30,25,0) 72%)`
              : `radial-gradient(circle, rgba(40,30,25,0.55) 0%, rgba(40,30,25,0) 70%)`,
            filter: 'blur(18px)',
            transform: `translate(${drift}px, ${-rise}px) scale(${scale})`,
            opacity: o,
          }}
        />
      );
    })}
  </AbsoluteFill>
);

const Embers: React.FC<{t: number}> = ({t}) => (
  <>
    {Array.from({length: 30}).map((_, i) => {
      const size = 3 + ((i * 7) % 4);
      const speed = 0.7 + ((i * 53) % 40) / 45;
      const x = 350 + ((i * 211) % 1250) + t * 1.1 * speed + Math.sin(t / 9 + i) * 16;
      const y = 640 - (((i * 89) % 300) + t * 1.7 * speed);
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t / 7 + i * 0.9));
      if (y < -20) return null;
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: size,
            height: size,
            borderRadius: '50%',
            background: i % 3 === 0 ? '#ffb347' : '#ff6a1a',
            boxShadow: '0 0 8px 3px rgba(255,120,40,0.6)',
            opacity: twinkle,
          }}
        />
      );
    })}
  </>
);

/** The Beijing painting at night, burning. `t` = frames since the cost beat began. */
const BurningPainting: React.FC<{t: number}> = ({t}) => {
  const glowBase = interpolate(t, [0, 2 * S], [0, 0.55], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const flicker = 1 + Math.sin((t / S) * Math.PI) * 0.08; // 0.5Hz ±8%
  const glow = glowBase * flicker;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', inset: 0, filter: 'brightness(0.6)'}}>
        <Painting src={STAGE_ONE.painting} dim={0.1} />
      </div>
      {/* wide dim sky glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 95% 60% at 50% 24%, rgba(255,120,40,${glow * 0.35}) 0%, rgba(255,120,40,0) 70%)`,
        }}
      />
      {/* main glow anchored behind the hall roofline */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 55% 42% at 52% 32%, rgba(255,120,40,${glow}) 0%, rgba(255,120,40,0) 70%)`,
        }}
      />
      <SmokePlume x={45} delay={0} t={t} />
      <SmokePlume x={50} delay={4} t={t} />
      <SmokePlume x={55} delay={8} t={t} />
      <SmokePlume x={60} delay={12} t={t} />
      <Embers t={t} />
      <Rain t={t} />
    </AbsoluteFill>
  );
};

/* ---------- beat 4: cost ---------- */
const CostBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = frame < 2 ? 1 : 0;
  const lineO = interpolate(frame, [2 * S, 2 * S + 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill>
      <BurningPainting t={frame} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '68%',
          textAlign: 'center',
          fontFamily: SERIF,
          fontSize: 56,
          color: C.paper,
          textShadow: `0 2px 18px rgba(23,32,51,0.9), 0 0 4px ${C.ink}`,
          opacity: lineO,
        }}
      >
        {UNFOLD.costLine}
      </div>
      {flash > 0 && <AbsoluteFill style={{background: '#000'}} />}
    </AbsoluteFill>
  );
};

/* ---------- beat 5: ledger ---------- */
const LedgerBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill>
      <BurningPainting t={frame + 5 * S} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 22,
        }}
      >
        {STAGE_ONE.outcome.effects.map((e, i) => {
          const s = spring({
            frame: frame - i * 12,
            fps,
            config: {damping: 11, stiffness: 200},
          });
          if (s <= 0) return null;
          return (
            <div
              key={i}
              style={{
                background: C.paper,
                border: `2px solid ${C.world}`,
                color: C.ink,
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 20,
                padding: '12px 30px',
                borderRadius: 999,
                boxShadow: HARD_SHADOW,
                transform: `scale(${s})`,
              }}
            >
              {e}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- shot ---------- */
export const UnfoldSequence: React.FC = () => {
  const walk = beatRange('walk');
  const sign = beatRange('sign');
  const ripple = beatRange('ripple');
  const cost = beatRange('cost');
  const ledger = beatRange('ledger');
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Sequence {...walk}>
        <WalkBeat />
      </Sequence>
      <Sequence {...sign}>
        <SignBeat />
      </Sequence>
      <Sequence {...ripple}>
        <RippleBeat />
      </Sequence>
      <Sequence {...cost}>
        <CostBeat />
      </Sequence>
      <Sequence {...ledger}>
        <LedgerBeat />
      </Sequence>
    </AbsoluteFill>
  );
};
