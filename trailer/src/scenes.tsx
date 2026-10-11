import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Sfx } from "./components";
import { cast, copy, scenes } from "./episode";
import { BeatTitle, ChoiceMenu, DialogBox, NoteToast, Parchment, PixelFrame, ramp } from "./hud";
import { Backdrop, KineticLine, NumberedPoint } from "./kinetic";
import { Atmosphere, Emote, SPOTS, T, TOWN_H, TOWN_W, Town, Walker, World } from "./pixel";
import { color, pixel, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Ambient townsfolk so the world feels lived in. */
const Townsfolk = () => (
  <>
    <Walker sprite="Villager" path={[{ f: 0, x: 17 * T, y: 9 * T }, { f: 120, x: 25 * T, y: 9 * T }, { f: 200, x: 25 * T, y: 10 * T }]} />
    <Walker sprite="Woman" path={[{ f: 0, x: 31 * T, y: 10 * T }, { f: 160, x: 21 * T, y: 10 * T }]} />
    <Walker sprite="Villager2" path={[{ f: 0, x: SPOTS.merchant.x, y: SPOTS.merchant.y }, { f: 1, x: SPOTS.merchant.x, y: SPOTS.merchant.y }]} />
    <Walker sprite="Villager6" path={[{ f: 0, x: SPOTS.trader.x, y: SPOTS.trader.y }, { f: 1, x: SPOTS.trader.x, y: SPOTS.trader.y }]} idle="left" />
    <Walker sprite={cast.farquhar.sprite} path={[{ f: 0, x: SPOTS.farquhar.x, y: SPOTS.farquhar.y }, { f: 1, x: SPOTS.farquhar.x, y: SPOTS.farquhar.y }]} />
    <Walker sprite={cast.hussein.sprite} path={[{ f: 0, x: SPOTS.hussein.x, y: SPOTS.hussein.y }, { f: 1, x: SPOTS.hussein.x, y: SPOTS.hussein.y }]} />
  </>
);

const Still = ({ sprite, at, idle = "down" }: { sprite: string; at: { x: number; y: number }; idle?: "down" | "up" | "left" | "right" }) => (
  <Walker sprite={sprite} path={[{ f: 0, ...at }, { f: 1, ...at }]} idle={idle} />
);

/** The town at a camera position; `dim` darkens it behind interface panels. */
const TownShot = ({ camX, camY = 0, dim = 0, children }: { camX: number; camY?: number; dim?: number; children?: React.ReactNode }) => (
  <>
    <World camX={camX} camY={camY} width={TOWN_W} height={TOWN_H}>
      <Town />
      <Townsfolk />
      <Still sprite={cast.temenggong.sprite} at={SPOTS.temenggong} />
      <Still sprite={cast.raffles.sprite} at={SPOTS.raffles} />
      {children}
    </World>
    <Atmosphere />
    {dim > 0 ? <AbsoluteFill style={{ background: `rgba(12,16,28,${dim})` }} /> : null}
  </>
);

/* 1. Problem (kinetic type). */
export const Problem = () => (
  <Backdrop>
    <KineticLine text={copy.problem[0]} start={6} top={330} exitAt={128} />
    <KineticLine text={copy.problem[1]} start={48} top={500} size={72} weight={500} accent={["think", "it", "through"]} exitAt={128} />
    <KineticLine text={copy.problem[2]} start={140} top={300} size={84} exitAt={290} />
    <KineticLine text={copy.problem[3]} start={190} top={600} size={72} weight={500} accent={["think"]} exitAt={290} />
  </Backdrop>
);

/* 2. Big idea, over an establishing shot of the town. */
export const BigIdea = () => {
  const frame = useCurrentFrame();
  const camX = interpolate(frame, [0, 240], [0, 26 * T], clamp);
  const place = ramp(frame, 8, 14) * (1 - ramp(frame, 90, 14));
  return (
    <AbsoluteFill>
      <TownShot camX={camX} camY={8}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 2 * T, y: 9 * T + 8 }, { f: 240, x: 36 * T, y: 9 * T + 8 }]} />
      </TownShot>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(12,16,28,0.85) 100%)" }} />
      <div style={{ position: "absolute", left: 120, top: 100, opacity: place, fontFamily: pixel, fontSize: 56, fontWeight: 700, color: "#fff8e9", textShadow: "4px 4px 0 rgba(0,0,0,0.5)" }}>
        Singapore, 1819
      </div>
      <KineticLine text={copy.bigIdea[0]} start={70} top={760} size={76} />
      <KineticLine text={copy.bigIdea[1]} start={130} top={870} size={60} weight={500} accent={["without", "knowing"]} />
    </AbsoluteFill>
  );
};

/* 3. What students learn (kinetic type). */
export const Outcomes = () => (
  <Backdrop>
    <KineticLine text={copy.outcomes.lead} start={4} top={200} size={64} weight={500} />
    <NumberedPoint n={1} text={copy.outcomes.first} start={26} top={420} accent={color.record === "#3659cf" ? "#a3b6ff" : color.record} />
    <NumberedPoint n={2} text={copy.outcomes.second} start={52} top={620} accent="#7edbb4" />
  </Backdrop>
);

/* 4. Everyone they meet wants something. */
export const People = () => (
  <AbsoluteFill>
    <TownShot camX={1 * T} camY={20}>
      <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 0, y: 9 * T + 8 }, { f: 40, x: 8 * T, y: 9 * T + 8 }, { f: 52, x: 8 * T, y: 8 * T + 4 }]} idle="up" />
      <Emote x={SPOTS.temenggong.x + 2} y={SPOTS.temenggong.y - 14} text="…" at={96} />
    </TownShot>
    <BeatTitle text={copy.people} />
    <DialogBox sprite={cast.player.sprite} name={cast.player.name} text={scenes.chat.question} start={48} speed={2} mine />
    {/* The answer replaces the question in the same box. */}
    <AnswerOverlay />
    <NoteToast text={scenes.chat.note} start={168} style={{ top: 250 }} />
    <Sfx src="chatter" at={100} volume={0.3} />
  </AbsoluteFill>
);
const AnswerOverlay = () => {
  const frame = useCurrentFrame();
  return frame < 96 ? null : <DialogBox sprite={cast.temenggong.sprite} name={cast.temenggong.short} text={scenes.chat.answer} start={100} speed={1.8} />;
};

/* 5. Sources don't always agree. */
export const Sources = () => {
  const s = scenes.sources;
  return (
    <AbsoluteFill>
      <TownShot camX={12 * T} camY={20} dim={0.45} />
      <BeatTitle text={copy.sources} />
      <Parchment masthead={s.masthead} date={s.date} lines={s.lines} highlight={s.highlight} sweepAt={30} stamp={copy.illustrative} style={{ left: 120, top: 220 }} />
      <DialogBox sprite={cast.temenggong.sprite} name={cast.temenggong.short} text={s.rival} start={82} speed={2} />
      <NoteToast text={s.note} start={140} style={{ top: 250 }} />
    </AbsoluteFill>
  );
};

/* 6. What they share changes how people react. */
export const Share = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <TownShot camX={34 * T} camY={20}>
        <Walker sprite={cast.player.sprite} path={[{ f: 0, x: 36 * T, y: 9 * T + 8 }, { f: 30, x: 47 * T, y: 9 * T + 8 }, { f: 40, x: 47 * T, y: 8 * T + 4 }]} idle="up" />
        <Emote x={SPOTS.raffles.x + 4} y={SPOTS.raffles.y - 14} text="!" at={92} />
      </TownShot>
      <BeatTitle text={copy.share} />
      {frame < 92 ? (
        <DialogBox sprite={cast.player.sprite} name={cast.player.name} start={40} mine>
          <span style={{ display: "inline-block", fontSize: 30, color: color.world, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>FROM MY NOTES</span>
          <br />
          <span style={{ background: color.worldWash, padding: "2px 10px" }}>{scenes.share.noteInserted}</span>
        </DialogBox>
      ) : (
        <DialogBox sprite={cast.raffles.sprite} name={cast.raffles.short} text={scenes.share.reaction} start={98} speed={1.8} />
      )}
      <Sfx src="accept" at={40} volume={0.35} />
      <Sfx src="alert" at={92} volume={0.6} />
    </AbsoluteFill>
  );
};

/* 7. Their choices change what happens next. */
export const Choice = () => {
  const frame = useCurrentFrame();
  const c = scenes.choice;
  return (
    <AbsoluteFill>
      <TownShot camX={38 * T} camY={20} dim={0.5} />
      <BeatTitle text={copy.choices} />
      <ChoiceMenu title={c.prompt} options={c.options} start={10} pickAt={70} picked={c.picked} closedIndex={2} closedAt={112} style={{ left: 400, top: 290 }} />
      <div style={{ position: "absolute", left: 412, top: 760, fontFamily: pixel, fontSize: 40, color: "#ffc7ae", opacity: ramp(frame, 116, 12), textShadow: "3px 3px 0 rgba(0,0,0,0.5)" }}>{c.closed}</div>
      <Sfx src="resolution" at={112} volume={0.5} />
    </AbsoluteFill>
  );
};

/* 8. At the end, they explain their thinking. */
export const Explain = () => {
  const frame = useCurrentFrame();
  const e = scenes.explain;
  return (
    <AbsoluteFill>
      <TownShot camX={4 * T} camY={20} dim={0.5} />
      <BeatTitle text={copy.explain} />
      {frame < 118 ? (
        <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.question} start={12} speed={2.2} />
      ) : (
        <DialogBox sprite={cast.clerk.sprite} name={cast.clerk.name} text={e.pushBack} start={122} speed={2.4} />
      )}
      {frame < 118 ? <ChoiceMenu title="Your answer" options={e.verdicts} start={46} pickAt={88} picked={e.picked} style={{ left: 440, top: 230 }} /> : null}
    </AbsoluteFill>
  );
};

/* 9. They see what really happened. */
export const Real = () => {
  const frame = useCurrentFrame();
  const r = scenes.real;
  const scroll = (title: string, items: readonly string[], accent: string, at: number, mine: boolean) => (
    <div style={{ width: 700 }}>
      <PixelFrame style={{ padding: "34px 40px", background: "linear-gradient(180deg, #fbf1d8 0%, #f3e3bd 100%)", boxShadow: `inset 0 0 0 6px #e8d9b3, 0 0 0 10px ${color.ink}` }}>
        <div style={{ fontFamily: pixel, fontWeight: 700, fontSize: 36, color: accent, letterSpacing: 2, marginBottom: 20 }}>{title}</div>
        {items.map((item, i) => {
          const differs = mine && r.differs[i];
          return (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: serif, fontSize: 40, lineHeight: 1.6, color: differs ? color.signal : color.ink, opacity: ramp(frame, at + i * 12, 10) }}>
              <span style={{ width: 20, height: 20, background: differs ? color.signal : accent, flexShrink: 0 }} />
              {item}
            </div>
          );
        })}
      </PixelFrame>
    </div>
  );
  return (
    <Backdrop>
      <KineticLine text={copy.real} start={4} top={150} size={84} />
      <AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 90, paddingTop: 170 }}>
        {scroll("YOUR STORY", r.yours, color.record, 26, true)}
        {scroll("WHAT REALLY HAPPENED", r.history, color.world, 44, false)}
      </AbsoluteFill>
    </Backdrop>
  );
};

/* 10. Why it fits schools (kinetic type, one line at a time). */
export const Schools = () => (
  <Backdrop>
    <KineticLine text={copy.schools[0]} start={6} top={420} size={92} accent={["your", "own"]} exitAt={70} />
    <KineticLine text={copy.schools[1]} start={82} top={420} size={108} accent={["one"]} exitAt={146} />
    <KineticLine text={copy.schools[2]} start={158} top={420} size={108} accent={["thinking."]} />
  </Backdrop>
);

/* 11. End card. */
export const EndCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame: frame - 6, fps, config: { damping: 14 } });
  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36, transform: `scale(${0.9 + logo * 0.1})`, opacity: logo }}>
          <Img src={staticFile("logo-light.svg")} style={{ width: 160, height: 160 }} />
          <div style={{ fontFamily: serif, fontSize: 116, fontWeight: 700, color: "#f5eddf", letterSpacing: -1 }}>Historical Adventures</div>
        </div>
        <div style={{ fontFamily: serif, fontSize: 52, marginTop: 40, color: "#f5eddf", opacity: ramp(frame, 40, 14) }}>{copy.tagline}</div>
        <div style={{ fontFamily: sans, fontSize: 34, color: "#b5bdcb", marginTop: 26, opacity: ramp(frame, 70, 14) }}>{copy.audience}</div>
        <div style={{ position: "absolute", bottom: 90, fontFamily: pixel, fontSize: 36, fontWeight: 700, color: "#ffac86", opacity: ramp(frame, 96, 14) }}>{copy.wip}</div>
      </AbsoluteFill>
    </Backdrop>
  );
};
