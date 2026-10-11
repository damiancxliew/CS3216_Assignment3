import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { ArchivalRecord, Letter, MemoirSpread, NewspaperClipping } from "./artefacts";
import { cast, game, pitch } from "./episode";
import { ChoiceMenu, DialogBox, NoteToast, PixelFrame } from "./hud";
import { PitchCard, RapidWords, TitleCard, TypeScene } from "./pitch";
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

/** Every game beat: a quick punch-in and a big verb anchored bottom-left. */
const GameBeat = ({ verb, children }: { verb?: string; children: ReactNode }) => {
  const frame = useCurrentFrame();
  const punch = interpolate(frame, [0, 8], [1.06, 1], clamp);
  const v = interpolate(frame, [3, 11], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ transform: `scale(${punch})` }}>
      {children}
      {verb ? (
        <div style={{ position: "absolute", left: 90, top: 70, opacity: v, transform: `translateY(${(1 - v) * -20}px)` }}>
          <div style={{ fontFamily: pixel, fontWeight: 700, fontSize: 26, letterSpacing: 4, color: "#ffd166", textShadow: "3px 3px 0 rgba(0,0,0,0.6)" }}>IN THE GAME</div>
          <div style={{ fontFamily: pixel, fontWeight: 700, fontSize: 120, lineHeight: 1, color: "#fff8e9", textShadow: `6px 6px 0 ${color.ink}` }}>{verb}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ---------- pitch beats ---------- */

export const Open = () => <TypeScene lines={pitch.open} start={8} cps={15} gap={14} />;
export const Problem = () => <PitchCard lines={pitch.problem} tone="ink" size={80} />;
export const Neither = () => <PitchCard lines={pitch.neither} tone="signal" size={118} />;
export const PPeople = () => <PitchCard lines={pitch.people} tone="record" size={170} />;
export const PSources = () => <PitchCard lines={pitch.sources} tone="ink" size={170} />;
export const PDisagree = () => <PitchCard lines={pitch.disagree} tone="signal" size={190} />;
export const PShare = () => <PitchCard lines={pitch.share} tone="world" size={160} />;
export const PChoose = () => <PitchCard lines={pitch.choose} tone="ink" size={160} />;
export const PDefend = () => <PitchCard lines={pitch.defend} tone="record" size={160} />;
export const PReal = () => <PitchCard lines={pitch.real} tone="paper" size={160} />;
export const Rapid = () => (
  <RapidWords every={24} items={[{ text: pitch.rapid[0], tone: "ink" }, { text: pitch.rapid[1], tone: "record" }, { text: pitch.rapid[2], tone: "signal" }, { text: pitch.rapid[3], tone: "world" }]} />
);
export const Close = () => (
  <TypeScene lines={[pitch.close]} start={6} cps={16}>
    <TitleCard at={84} tagline={pitch.tagline} audience={pitch.audience} wip={pitch.wip} />
  </TypeScene>
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
      <div style={{ position: "absolute", left: 90, bottom: 80, opacity: tag, fontFamily: pixel, fontWeight: 700, fontSize: 64, color: "#fff8e9", textShadow: `5px 5px 0 ${color.ink}` }}>Singapore, 1819</div>
    </GameBeat>
  );
};

export const Question = () => {
  const frame = useCurrentFrame();
  return (
    <GameBeat verb="QUESTION">
      <TownShot camX={1 * T}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 8 * T, y: 9 * T }, { f: 10, x: 8 * T, y: 8 * T + 4 }]} idle="up" />
        <Emote x={SPOTS.temenggong.x + 2} y={SPOTS.temenggong.y - 14} text="…" at={8} />
      </TownShot>
      {frame >= 0 ? <DialogBox sprite={cast.temenggong.sprite} name={cast.temenggong.short} text={game.question.answer} start={8} speed={3} /> : null}
      <NoteToast text={game.question.note} start={62} style={{ top: 70 }} />
    </GameBeat>
  );
};

export const Read = () => (
  <GameBeat verb="READ">
    <TownShot camX={14 * T} dim={0.35} blur={6} />
    <NewspaperClipping markAt={34} style={{ left: 250, top: 240, transform: "rotate(-2deg)" }} />
    <NoteToast text={game.read.note} start={66} style={{ top: 560, right: 70, width: 560 }} />
  </GameBeat>
);

export const Compare = () => (
  <GameBeat verb="COMPARE">
    <TownShot camX={24 * T} dim={0.35} blur={6} />
    <MemoirSpread markAt={18} style={{ left: 70, top: 330, transform: "rotate(-2deg) scale(0.92)", transformOrigin: "top left" }} />
    <Letter markAt={42} style={{ right: 60, top: 340 }} />
    <NoteToast text={game.compare.note} start={72} style={{ top: 70, right: 90, width: 640 }} />
  </GameBeat>
);

export const Share = () => {
  const frame = useCurrentFrame();
  return (
    <GameBeat verb="SHARE">
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
        <DialogBox sprite={cast.raffles.sprite} name={cast.raffles.short} text={game.share.reaction} start={48} speed={3} />
      )}
    </GameBeat>
  );
};

export const Choose = () => (
  <GameBeat verb="CHOOSE">
    <TownShot camX={38 * T} dim={0.45} />
    <ChoiceMenu title={game.choice.prompt} options={game.choice.options} start={4} pickAt={50} picked={game.choice.picked} closedIndex={2} closedAt={76} style={{ left: 440, top: 330 }} />
  </GameBeat>
);

export const Explain = () => {
  const frame = useCurrentFrame();
  const e = game.explain;
  return (
    <GameBeat verb="EXPLAIN">
      <TownShot camX={4 * T} dim={0.45} />
      {frame < 66 ? (
        <>
          <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.question} start={4} speed={3} />
          <ChoiceMenu title="Your answer" options={e.verdicts} start={22} pickAt={50} picked={e.picked} style={{ left: 460, top: 300 }} />
        </>
      ) : (
        <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.pushBack} start={68} speed={3.2} />
      )}
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
