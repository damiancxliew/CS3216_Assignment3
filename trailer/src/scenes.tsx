import type React from "react";
import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ArchivalRecord, Letter, MemoirSpread, NewspaperClipping } from "./artefacts";
import { cast, game, pitch } from "./episode";
import { ChoiceMenu, DialogBox, NoteToast, PixelFrame } from "./hud";
import { BookArt, ChatArt, ClaimCard, ExamPaper, IllustratedCard, RapidWords, StatementCard, TitleCard, TypeScene } from "./pitch";
import { Atmosphere, Emote, SPOTS, T, TOWN_H, TOWN_W, Town, Walker, World } from "./pixel";
import { color, pixel, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---------- shared game pieces ---------- */

const Townsfolk = () => (
  <>
    <Walker sprite="Villager" path={[{ f: 0, x: 17 * T, y: 9 * T }, { f: 120, x: 25 * T, y: 9 * T }]} />
    <Walker sprite="Woman" path={[{ f: 0, x: 31 * T, y: 10 * T }, { f: 160, x: 21 * T, y: 10 * T }]} />
    <Walker sprite="Villager2" path={[{ f: 0, ...SPOTS.merchant }, { f: 1, ...SPOTS.merchant }]} />
    <Walker sprite="Villager6" path={[{ f: 0, ...SPOTS.trader }, { f: 1, ...SPOTS.trader }]} idle="left" />
    <Walker sprite={cast.farquhar.sprite} path={[{ f: 0, ...SPOTS.farquhar }, { f: 1, ...SPOTS.farquhar }]} />
    <Walker sprite={cast.hussein.sprite} path={[{ f: 0, ...SPOTS.hussein }, { f: 1, ...SPOTS.hussein }]} />
    <Walker sprite={cast.temenggong.sprite} path={[{ f: 0, ...SPOTS.temenggong }, { f: 1, ...SPOTS.temenggong }]} />
    <Walker sprite={cast.raffles.sprite} path={[{ f: 0, ...SPOTS.raffles }, { f: 1, ...SPOTS.raffles }]} />
  </>
);

const TownShot = ({ camX, camY = 20, dim = 0, blur = 0, children }: { camX: number; camY?: number; dim?: number; blur?: number; children?: ReactNode }) => (
  <AbsoluteFill style={{ filter: blur ? `blur(${blur}px)` : undefined }}>
    <World camX={camX} camY={camY} width={TOWN_W} height={TOWN_H}>
      <Town />
      <Townsfolk />
      {children}
    </World>
    <Atmosphere fog={0.1} warmth={0.16} />
    {dim > 0 ? <AbsoluteFill style={{ background: `rgba(12,16,28,${dim})` }} /> : null}
  </AbsoluteFill>
);

type Callout = { text: string; x: number; y: number; toX: number; toY: number; at: number };

/** A sticker label with a drawn arrow pointing at a feature on screen. */
const CalloutLabel = ({ c }: { c: Callout }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [c.at, c.at + 8], [0, 1], clamp);
  const draw = interpolate(frame, [c.at + 4, c.at + 14], [0, 1], clamp);
  const midX = (c.x + c.toX) / 2;
  const path = `M ${c.x} ${c.y} Q ${midX} ${Math.min(c.y, c.toY) - 80} ${c.toX} ${c.toY}`;
  return (
    <>
      <svg style={{ position: "absolute", inset: 0, width: 1920, height: 1080, overflow: "visible" }} aria-hidden>
        <path d={path} fill="none" stroke="#ffd166" strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} style={{ filter: "drop-shadow(3px 3px 0 rgba(0,0,0,0.5))" }} />
        <circle cx={c.toX} cy={c.toY} r={12 * draw} fill="#ffd166" />
      </svg>
      <div style={{ position: "absolute", left: c.x, top: c.y, transform: `translate(-50%, -100%) rotate(-3deg) scale(${0.8 + p * 0.2})`, opacity: p, background: "#ffd166", color: color.ink, fontFamily: pixel, fontWeight: 700, fontSize: 36, padding: "10px 20px", boxShadow: `5px 5px 0 ${color.ink}`, whiteSpace: "nowrap" }}>
        {c.text}
      </div>
    </>
  );
};

/** Every game beat: a quick punch-in and an optional callout. */
const GameBeat = ({ callout, children }: { callout?: Callout; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const punch = interpolate(frame, [0, 8], [1.06, 1], clamp);
  return (
    <AbsoluteFill style={{ transform: `scale(${punch})` }}>
      {children}
      {callout ? <CalloutLabel c={callout} /> : null}
    </AbsoluteFill>
  );
};

/* ---------- pitch beats ---------- */

export const Open = () => <TypeScene lines={pitch.open} start={8} cps={15} gap={14} background="art/cover-1819.webp" />;
export const Context = () => <IllustratedCard lines={pitch.context} tone="paper" size={84} art={<ExamPaper q={pitch.examQuestion} />} />;
export const Reading = () => <IllustratedCard lines={pitch.reading} tone="ink" size={92} art={<BookArt />} />;
export const Chatbots = () => <IllustratedCard lines={pitch.chatbots} tone="record" size={92} art={<ChatArt />} />;
export const Rarely = () => <StatementCard lines={pitch.rarely} tone="ink" size={130} />;
export const Here = () => <StatementCard lines={pitch.here} tone="signal" size={190} />;
export const AnyLesson = () => <StatementCard lines={pitch.anyLesson} tone="record" size={130} />;
export { AskScene as Ask, ClassScene as ClassView, EasyScene as Easy, MontageScene as Montage } from "./creation";
export const Rapid = () => (
  <RapidWords
    every={30}
    items={[
      { text: pitch.rapid[0], tone: "ink", icon: "lesson" },
      { text: pitch.rapid[1], tone: "signal", icon: "marks" },
      { text: pitch.rapid[2], tone: "world", icon: "thinking" },
    ]}
  />
);
export const Close = () => (
  <TypeScene lines={[pitch.close]} start={4} cps={18}>
    <TitleCard at={60} tagline={pitch.tagline} audience={pitch.audience} wip={pitch.wip} />
  </TypeScene>
);

/** Claim cards: each previews the game beat that proves it, zooming in at the end of its (content-timed) length. */
const claim = (chapter: string, label: string, lines: string[], tone: "ink" | "record" | "signal" | "world" | "paper", next: () => React.ReactElement) => ({ duration }: { duration: number }) => (
  <ClaimCard chapter={chapter} label={label} lines={lines} tone={tone} next={next} duration={duration} size={84} />
);

/* ---------- game beats ---------- */

export const Establish = () => {
  const frame = useCurrentFrame();
  const camX = interpolate(frame, [0, 90], [6 * T, 20 * T], clamp);
  const tag = interpolate(frame, [6, 14], [0, 1], clamp);
  return (
    <GameBeat>
      <TownShot camX={camX} camY={8}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 12 * T, y: 9 * T + 8 }, { f: 90, x: 28 * T, y: 9 * T + 8 }]} />
      </TownShot>
      {/* The painting dissolves into the playable town. */}
      <AbsoluteFill style={{ opacity: interpolate(frame, [8, 34], [1, 0], clamp) }}>
        <Img src={staticFile("art/cover-1819.webp")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.05 + frame * 0.004})` }} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 90, bottom: 80, opacity: tag, fontFamily: pixel, fontWeight: 700, fontSize: 64, color: "#fff8e9", textShadow: `5px 5px 0 ${color.ink}` }}>Singapore, 1819</div>
    </GameBeat>
  );
};

export const Question = () => {
  const frame = useCurrentFrame();
  return (
    <GameBeat callout={{ text: "Everyone has an agenda", x: 1250, y: 560, toX: 660, toY: 720, at: 30 }}>
      <TownShot camX={1 * T}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 8 * T, y: 9 * T }, { f: 10, x: 8 * T, y: 8 * T + 4 }]} idle="up" />
        <Emote x={SPOTS.temenggong.x + 2} y={SPOTS.temenggong.y - 14} text="…" at={8} />
      </TownShot>
      <DialogBox sprite={cast.temenggong.sprite} name={cast.temenggong.short} text={game.question.answer} start={8} speed={1.8} mood="guarded" moodAt={34} />
      <NoteToast text={game.question.note} start={48} style={{ top: 70 }} />
    </GameBeat>
  );
};

export const Read = () => (
  <GameBeat callout={{ text: "Real-looking sources", x: 1420, y: 250, toX: 1150, toY: 420, at: 14 }}>
    <TownShot camX={14 * T} dim={0.35} blur={6} />
    <NewspaperClipping markAt={34} style={{ left: 250, top: 240, transform: "rotate(-2deg)" }} />
    <NoteToast text={game.read.note} start={52} style={{ top: 560, right: 70, width: 560 }} />
  </GameBeat>
);

export const Compare = () => (
  <GameBeat callout={{ text: "Two accounts, one island", x: 980, y: 300, toX: 1250, toY: 520, at: 26 }}>
    <TownShot camX={24 * T} dim={0.35} blur={6} />
    <MemoirSpread markAt={18} style={{ left: 70, top: 330, transform: "rotate(-2deg) scale(0.92)", transformOrigin: "top left" }} />
    <Letter markAt={42} style={{ right: 60, top: 340 }} />
    <NoteToast text={game.compare.note} start={56} style={{ top: 70, right: 90, width: 640 }} />
  </GameBeat>
);

export const Share = () => {
  const frame = useCurrentFrame();
  return (
    <GameBeat callout={{ text: "Your notes are your proof", x: 1300, y: 420, toX: 900, toY: 860, at: 16 }}>
      <TownShot camX={34 * T}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 47 * T, y: 9 * T }, { f: 8, x: 47 * T, y: 8 * T + 4 }]} idle="up" />
        <Emote x={SPOTS.raffles.x + 4} y={SPOTS.raffles.y - 14} text="!" at={44} />
      </TownShot>
      {frame < 44 ? (
        <DialogBox sprite={cast.player.sprite} name={cast.player.name} start={4} mine>
          <span style={{ display: "inline-block", fontSize: 30, color: color.world, fontWeight: 700, letterSpacing: 2 }}>FROM MY NOTES</span>
          <br />
          <span style={{ background: color.worldWash, padding: "2px 10px" }}>{game.share.noteInserted}</span>
        </DialogBox>
      ) : (
        <DialogBox sprite={cast.raffles.sprite} name={cast.raffles.short} text={game.share.reaction} start={48} speed={1.8} mood="intrigued" moodAt={60} enter={false} />
      )}
    </GameBeat>
  );
};

export const Choose = () => (
  <GameBeat callout={{ text: "This ending is now gone", x: 1500, y: 300, toX: 1300, toY: 560, at: 80 }}>
    <TownShot camX={38 * T} dim={0.45} />
    <ChoiceMenu title={game.choice.prompt} options={game.choice.options} start={4} pickAt={50} picked={game.choice.picked} closedIndex={2} closedAt={76} style={{ left: 440, top: 330 }} />
  </GameBeat>
);

export const Explain = () => {
  const frame = useCurrentFrame();
  const e = game.explain;
  return (
    <GameBeat callout={{ text: "It pushes back", x: 1400, y: 520, toX: 1100, toY: 800, at: 74 }}>
      <TownShot camX={4 * T} dim={0.45} />
      {frame < 66 ? (
        <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.question} start={4} speed={2} />
      ) : (
        <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.pushBack} start={68} speed={1.8} mood="sceptical" moodAt={66} enter={false} />
      )}
      {frame < 74 ? (
        <div style={{ opacity: interpolate(frame, [64, 72], [1, 0], clamp) }}>
          <ChoiceMenu title="Your answer" options={e.verdicts} start={22} pickAt={50} picked={e.picked} style={{ left: 460, top: 300 }} />
        </div>
      ) : null}
    </GameBeat>
  );
};

export const Reveal = () => {
  const frame = useCurrentFrame();
  const r = game.real;
  return (
    <GameBeat>
      <TownShot camX={44 * T} dim={0.55} blur={6} />
      <div style={{ position: "absolute", left: 120, top: 250, width: 720 }}>
        <PixelFrame style={{ padding: "34px 40px", background: "#fff8e9", boxShadow: `inset 0 0 0 6px #e8d9b3, 0 0 0 10px ${color.ink}` }}>
          <div style={{ fontFamily: pixel, fontWeight: 700, fontSize: 36, color: color.record, letterSpacing: 2, marginBottom: 18 }}>YOUR STORY</div>
          {r.yours.map((item, i) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: pixel, fontSize: 38, lineHeight: 1.55, color: r.differs[i] ? color.signal : color.ink, opacity: interpolate(frame, [6 + i * 8, 14 + i * 8], [0, 1], clamp) }}>
              <span style={{ width: 18, height: 18, background: r.differs[i] ? color.signal : color.record, flexShrink: 0 }} />
              {item}
            </div>
          ))}
        </PixelFrame>
      </div>
      <ArchivalRecord items={r.history} appearAt={30} style={{ right: 100, top: 170, transform: "rotate(1.5deg)" }} />
      <div style={{ position: "absolute", left: 120, bottom: 90, fontFamily: serif, fontWeight: 700, fontSize: 44, color: "#fff8e9", opacity: interpolate(frame, [50, 62], [0, 1], clamp) }}>
        Where your story split from history, highlighted.
      </div>
    </GameBeat>
  );
};

const [s1, s2, s3, s4, s5, s6, s7] = pitch.skills;
export const CPeople = claim(s1.chapter, s1.label, s1.lines, "record", Question);
export const CSources = claim(s2.chapter, s2.label, s2.lines, "ink", Read);
export const CDisagree = claim(s3.chapter, s3.label, s3.lines, "signal", Compare);
export const CShare = claim(s4.chapter, s4.label, s4.lines, "world", Share);
export const CChoose = claim(s5.chapter, s5.label, s5.lines, "ink", Choose);
export const CDefend = claim(s6.chapter, s6.label, s6.lines, "record", Explain);
export const CReal = claim(s7.chapter, s7.label, s7.lines, "paper", Reveal);
