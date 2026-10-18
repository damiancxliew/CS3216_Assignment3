import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {CaseBoard} from './components/CaseBoard';
import {ChapterCard} from './components/ChapterCard';
import {DialogueBox} from './components/DialogueBox';
import {EndCard} from './components/EndCard';
import {GoalChecklist} from './components/GoalChecklist';
import {MockGame} from './components/MockGame';
import {Painting} from './components/Painting';
import {UnfoldSequence} from './components/UnfoldSequence';
import {
  FPS,
  GUIDE,
  INTRO_LINES,
  SHOTS,
  STAGE_ONE,
} from './script';
import {C, GAME, HARD_SHADOW, SANS, SERIF} from './tokens';

const S = FPS;
const FADE = 12;

export const shotRange = (id: string) => {
  let from = 0;
  for (const shot of SHOTS) {
    const durationInFrames = shot.seconds * S;
    if (shot.id === id) return {from, durationInFrames};
    from += durationInFrames;
  }
  throw new Error(`unknown shot ${id}`);
};

/** 12-frame fade-in ramp at a shot's start. */
const FadeIn: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, FADE], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

/* ---------------- title ---------------- */
const TitleShot: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const barIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const textIn = spring({frame: frame - 10, fps, config: {damping: 200}});

  return (
    <AbsoluteFill>
      <Painting src={STAGE_ONE.painting} dim={0.3} />
      {/* letterbox bars */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 90 * barIn,
          background: '#000',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 90 * barIn,
          background: '#000',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 140,
          bottom: 190,
          transform: `translateY(${(1 - textIn) * 40}px)`,
          opacity: textIn,
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
          Stage {String(STAGE_ONE.index).padStart(2, '0')} of{' '}
          {String(STAGE_ONE.count).padStart(2, '0')}
        </div>
        <div style={{fontFamily: SERIF, fontSize: 88, color: C.paper}}>
          {STAGE_ONE.title}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 28,
            color: '#d8d2c4',
            marginTop: 16,
            maxWidth: 980,
          }}
        >
          {STAGE_ONE.setting}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- briefing ---------------- */
const BriefingShot: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cardIn = spring({frame, fps, config: {damping: 200}});
  const listIn = spring({frame: frame - 20, fps, config: {damping: 200}});
  const promptIn = spring({frame: frame - Math.floor(3.5 * S), fps, config: {damping: 200}});

  return (
    <AbsoluteFill>
      <Painting src={STAGE_ONE.painting} dim={0.62} />
      <div
        style={{
          position: 'absolute',
          left: 140,
          top: 120,
          width: 760,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <div
          style={{
            background: C.paper,
            border: `3px solid ${C.ink}`,
            borderRadius: 12,
            boxShadow: HARD_SHADOW,
            padding: '26px 32px',
            transform: `translateX(${(1 - cardIn) * 60}px)`,
            opacity: cardIn,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 20,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: C.muted,
            }}
          >
            You are
          </div>
          <div style={{fontFamily: SERIF, fontSize: 52, color: C.ink}}>
            {STAGE_ONE.player.name}
          </div>
          <div style={{fontFamily: SANS, fontSize: 24, color: C.muted, marginTop: 6}}>
            {STAGE_ONE.player.role}
          </div>
        </div>

        <div
          style={{
            background: C.paper,
            border: `3px solid ${C.ink}`,
            borderRadius: 12,
            boxShadow: HARD_SHADOW,
            padding: '26px 32px',
            transform: `translateX(${(1 - listIn) * 60}px)`,
            opacity: listIn,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 20,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: C.muted,
              marginBottom: 18,
            }}
          >
            Before you decide
          </div>
          <GoalChecklist goals={STAGE_ONE.goals} checked={0} fontSize={26} />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 140,
          bottom: 130,
          width: 620,
          background: C.paper,
          border: `3px solid ${C.signal}`,
          borderRadius: 12,
          boxShadow: `4px 4px 0 ${C.signal}`,
          padding: '26px 32px',
          transform: `translateY(${(1 - promptIn) * 40}px)`,
          opacity: promptIn,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: C.signal,
            marginBottom: 10,
          }}
        >
          The decision
        </div>
        <div style={{fontFamily: SERIF, fontSize: 32, color: C.ink, lineHeight: 1.35}}>
          {STAGE_ONE.decisionPrompt}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- to-play (iris wipe) ---------------- */
const ToPlayShot: React.FC<{durationInFrames: number}> = ({durationInFrames}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const radius = interpolate(t, [0, 1], [0, 150]);
  // dialogue box scales down toward bottom-right (where the HUD will be)
  const shrink = interpolate(t, [0, 1], [1, 0.35]);
  const slideX = interpolate(t, [0, 1], [0, 480]);

  return (
    <AbsoluteFill>
      <Painting src={STAGE_ONE.painting} dim={0.62} />
      {/* MockGame revealed through expanding circle */}
      <AbsoluteFill
        style={{
          clipPath: `circle(${radius}% at 67% 50%)`,
        }}
      >
        <MockGame />
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateX(${slideX}px) scale(${shrink})`,
          transformOrigin: '70% 90%',
          opacity: 1 - t * 0.8,
        }}
      >
        <DialogueBox
          lines={[INTRO_LINES[INTRO_LINES.length - 1]]}
          speaker={GUIDE.name}
          face={GUIDE.face}
          durationInFrames={durationInFrames}
        />
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- video ---------------- */
export const Video: React.FC = () => {
  const title = shotRange('title');
  const intro = shotRange('intro-dialogue');
  const briefing = shotRange('briefing');
  const toPlay = shotRange('to-play');
  const gameplay = shotRange('gameplay');
  const decision = shotRange('decision');
  const unfold = shotRange('unfold');
  const chapterTwo = shotRange('chapter-two');
  const end = shotRange('end');

  const decisionPressFrame = decision.from + 4 * S;
  // beats inside the unfold shot
  const signStart = unfold.from + 4 * S;
  const rippleStart = signStart + 3 * S;
  const costStart = rippleStart + 5 * S;
  const videoEnd = end.from + end.durationInFrames;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Sequence {...title}>
        <FadeIn>
          <TitleShot />
        </FadeIn>
      </Sequence>
      <Sequence {...intro}>
        <FadeIn>
          <AbsoluteFill>
            <Painting src={STAGE_ONE.painting} dim={0.45} />
            <DialogueBox
              lines={INTRO_LINES}
              speaker={GUIDE.name}
              face={GUIDE.face}
              durationInFrames={intro.durationInFrames}
            />
          </AbsoluteFill>
        </FadeIn>
      </Sequence>
      <Sequence {...briefing}>
        <FadeIn>
          <BriefingShot />
        </FadeIn>
      </Sequence>
      <Sequence {...toPlay}>
        <ToPlayShot durationInFrames={toPlay.durationInFrames} />
      </Sequence>
      <Sequence {...gameplay}>
        <FadeIn>
          <MockGame />
        </FadeIn>
      </Sequence>
      <Sequence {...decision}>
        <FadeIn>
          <CaseBoard />
        </FadeIn>
      </Sequence>
      <Sequence {...unfold}>
        <UnfoldSequence />
      </Sequence>
      <Sequence {...chapterTwo}>
        <ChapterCard durationInFrames={chapterTwo.durationInFrames} />
      </Sequence>
      <Sequence {...end}>
        <EndCard />
      </Sequence>

      {/* audio */}
      <Sequence from={0} durationInFrames={rippleStart}>
        <Audio
          src={staticFile(`${GAME}/audio/music/tension.ogg`)}
          volume={(f) =>
            0.35 *
            interpolate(f, [signStart, rippleStart], [1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          }
        />
      </Sequence>
      <Sequence from={decisionPressFrame} durationInFrames={S}>
        <Audio src={staticFile(`${GAME}/audio/sfx/accept.ogg`)} volume={0.6} />
      </Sequence>
      {/* quill stroke on the sign beat */}
      <Sequence from={signStart + Math.floor(0.4 * S)} durationInFrames={S}>
        <Audio src={staticFile(`${GAME}/audio/sfx/accept.ogg`)} volume={0.5} />
      </Sequence>
      {/* marching boots on the ripple beat */}
      <Sequence from={rippleStart + Math.floor(0.5 * S)} durationInFrames={S}>
        <Audio src={staticFile(`${GAME}/audio/sfx/step.ogg`)} volume={0.6} />
      </Sequence>
      <Sequence from={costStart} durationInFrames={2 * S}>
        <Audio src={staticFile(`${GAME}/audio/sfx/resolution.ogg`)} volume={0.6} />
      </Sequence>
      <Sequence from={costStart} durationInFrames={videoEnd - costStart}>
        <Audio
          src={staticFile(`${GAME}/audio/music/quiet.ogg`)}
          volume={(f) =>
            0.35 *
            interpolate(
              f,
              [videoEnd - costStart - 2 * S, videoEnd - costStart],
              [1, 0],
              {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
            )
          }
        />
      </Sequence>
    </AbsoluteFill>
  );
};
