import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Bubble, Caption, Face, NoteCard, Panel, PanelHeader, Paper, Sfx, Typed, ramp } from "./components";
import { cast, copy, scenes } from "./episode";
import { color, sans, serif } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* 1. Problem: reading isn't thinking; chatting isn't thinking. */
export const Problem = () => {
  const frame = useCurrentFrame();
  const chat = ramp(frame, 150, 14);
  const fadeReply = ramp(frame, 255, 30);
  return (
    <Paper>
      <AbsoluteFill style={{ opacity: 1 - chat }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const flip = interpolate(frame, [30 + i * 18, 44 + i * 18], [0, 1], clamp);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 760 + i * 6,
                top: 330 - i * 6,
                width: 400,
                height: 520,
                background: "#ffffff",
                border: "2px solid #e6dcc5",
                borderRadius: 8,
                boxShadow: "0 10px 30px rgba(23,32,51,0.12)",
                transformOrigin: "left center",
                transform: `rotate(${-3 + i * 1.5}deg) perspective(1200px) rotateY(${-flip * 160}deg)`,
                opacity: 1 - flip * 0.9,
                padding: 40,
              }}
            >
              {Array.from({ length: 14 }, (_, l) => (
                <div key={l} style={{ height: 10, margin: "14px 0", background: "#e9e4d8", width: `${70 + ((l * 37 + i * 11) % 30)}%`, borderRadius: 4 }} />
              ))}
            </div>
          );
        })}
        <Caption text={copy.problem[0]} start={8} top={110} size={70} />
        <Caption text={copy.problem[1]} start={70} top={900} size={58} weight={500} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: chat, alignItems: "center", justifyContent: "center" }}>
        <Panel width={980} style={{ marginTop: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 26 }}>
            <div style={{ width: 70, height: 70, borderRadius: 999, background: "#d9d4c7" }} />
            <div style={{ fontSize: 30, fontWeight: 700, color: color.muted }}>AI historical figure</div>
          </div>
          <div style={{ opacity: 1 - fadeReply * 0.75 }}>
            <Bubble side="left" text={copy.blandReply} start={170} tone="faded" speed={2.2} />
          </div>
        </Panel>
        <Caption text={copy.problem[2]} start={158} top={110} size={60} />
        <Caption text={copy.problem[3]} start={225} top={890} size={58} weight={500} />
      </AbsoluteFill>
    </Paper>
  );
};

/* 2. Big idea, over real map footage from the game. */
export const BigIdea = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 240], [1, 1.08]);
  const scale = 1920 / 700;
  const clip = (x: number, rot: number, title: string, from: string, at: number) => {
    const t = ramp(frame, at, 14);
    return (
      <div
        style={{
          position: "absolute",
          left: x,
          top: 250,
          width: 470,
          background: "#f7f0dc",
          border: "2px solid #d9cdae",
          padding: "26px 30px",
          boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
          transform: `rotate(${rot}deg) translateY(${(1 - t) * 40}px)`,
          opacity: t,
          fontFamily: serif,
        }}
      >
        <div style={{ fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: color.muted, fontFamily: sans }}>{from}</div>
        <div style={{ fontSize: 40, fontWeight: 700, marginTop: 10, lineHeight: 1.15 }}>{title}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ background: color.night, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo
          src={staticFile("media/world.mp4")}
          muted
          style={{ position: "absolute", width: 1100 * scale, height: 726 * scale, left: -35 * scale, top: -(52 * scale + (638 * scale - 1080) / 2), imageRendering: "pixelated" }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(17,23,34,0.15) 0%, rgba(17,23,34,0.25) 55%, rgba(17,23,34,0.85) 100%)" }} />
      {clip(330, -4, "\u201cAn empty island\u201d", "One account", 110)}
      {clip(1120, 3, "\u201cOur home for generations\u201d", "Another account", 130)}
      <Caption text={copy.bigIdea[0]} start={10} bottom={190} size={66} light />
      <Caption text={copy.bigIdea[1]} start={80} bottom={100} size={56} light weight={500} />
    </AbsoluteFill>
  );
};

/* 3. What students learn. */
export const Outcomes = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = (n: number, text: string, accent: string, at: number) => {
    const t = spring({ frame: frame - at, fps, config: { damping: 15 } });
    return (
      <div style={{ width: 700, background: "#ffffff", borderRadius: 28, padding: "44px 48px", border: "2px solid #e6dcc5", boxShadow: "0 22px 50px rgba(23,32,51,0.12)", transform: `translateY(${(1 - t) * 60}px)`, opacity: t }}>
        <div style={{ width: 72, height: 72, borderRadius: 999, background: accent, color: "#fff", fontSize: 40, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</div>
        <div style={{ fontFamily: serif, fontSize: 52, fontWeight: 700, marginTop: 26, lineHeight: 1.18 }}>{text}</div>
      </div>
    );
  };
  return (
    <Paper>
      <Caption text={copy.outcomes.lead} start={4} top={170} size={60} weight={500} />
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 80, paddingTop: 120 }}>
        {card(1, copy.outcomes.first, color.record, 24)}
        {card(2, copy.outcomes.second, color.world, 54)}
      </AbsoluteFill>
    </Paper>
  );
};

/* 4. Everyone they meet wants something. */
export const People = () => (
  <Paper deep>
    <Caption text={copy.people} start={2} top={70} size={62} />
    <div style={{ position: "absolute", left: 140, top: 210 }}>
      <Panel width={1060}>
        <PanelHeader sprite={cast.temenggong.sprite} name={cast.temenggong.name} sub="At his house by the river" />
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <Bubble side="right" sprite={cast.player.sprite} text={scenes.chat.question} start={18} speed={2} />
          <Bubble side="left" sprite={cast.temenggong.sprite} text={scenes.chat.answer} start={62} speed={1.8} />
        </div>
      </Panel>
    </div>
    <Sfx src="chatter" at={62} volume={0.35} />
    <div style={{ position: "absolute", right: 120, top: 430 }}>
      <NoteCard text={scenes.chat.note} start={122} width={560} />
    </div>
  </Paper>
);

/* 5. Sources don't always agree. */
export const Sources = () => {
  const frame = useCurrentFrame();
  const sweep = interpolate(frame, [48, 78], [0, 1], clamp);
  const s = scenes.sources;
  return (
    <Paper deep>
      <Caption text={copy.sources} start={2} top={70} size={62} />
      <div style={{ position: "absolute", left: 150, top: 210, width: 900, background: "#fbf3df", border: "2px solid #d9cdae", padding: "44px 56px 96px", boxShadow: "0 24px 60px rgba(23,32,51,0.18)", transform: "rotate(-1.2deg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `3px double ${color.ink}`, paddingBottom: 14 }}>
          <div style={{ fontFamily: serif, fontSize: 34, fontWeight: 700 }}>{s.masthead}</div>
          <div style={{ fontSize: 24, color: color.muted }}>{s.date}</div>
        </div>
        <div style={{ fontFamily: serif, fontSize: 38, lineHeight: 1.7, marginTop: 22 }}>
          {s.lines.map((line, i) => (
            <div key={i} style={{ position: "relative", display: "inline-block", width: "100%" }}>
              {i === s.highlight ? (
                <div style={{ position: "absolute", left: -8, top: 8, bottom: 6, width: `calc(${sweep * 100}% + 16px)`, maxWidth: "calc(100% + 16px)", background: "rgba(255,214,90,0.6)", borderRadius: 6, zIndex: 0 }} />
              ) : null}
              <span style={{ position: "relative" }}>{line}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", right: 30, bottom: 26, fontSize: 20, fontWeight: 700, color: color.signal, border: `2px solid ${color.signal}`, borderRadius: 8, padding: "4px 10px", transform: "rotate(-6deg)" }}>
          {copy.illustrative}
        </div>
      </div>
      <div style={{ position: "absolute", right: 120, top: 260, width: 640 }}>
        <Bubble side="left" sprite={cast.temenggong.sprite} name={cast.temenggong.short} text={s.rival} start={92} speed={2} />
      </div>
      <div style={{ position: "absolute", right: 120, top: 640 }}>
        <NoteCard text={s.note} start={132} width={640} />
      </div>
    </Paper>
  );
};

/* 6. What they share changes how people react. */
export const Share = () => {
  const frame = useCurrentFrame();
  const menu = ramp(frame, 18, 8) * (1 - ramp(frame, 44, 6));
  const chip = ramp(frame, 44, 6) * (1 - ramp(frame, 70, 4));
  const sent = ramp(frame, 70, 8);
  const bang = spring({ frame: frame - 100, fps: 30, config: { damping: 8 } });
  return (
    <Paper deep>
      <Caption text={copy.share} start={2} top={70} size={62} />
      <div style={{ position: "absolute", left: 360, top: 200 }}>
        <Panel width={1200}>
          <div style={{ position: "relative" }}>
            <PanelHeader sprite={cast.raffles.sprite} name={cast.raffles.name} sub="Government Hill" />
            <div style={{ position: "absolute", left: 48, top: -30, width: 48, height: 48, borderRadius: 999, background: color.signal, color: "#fff", fontWeight: 700, fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${bang})`, opacity: bang, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>!</div>
          </div>
          <div style={{ minHeight: 300, display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ opacity: sent, transform: `translateY(${(1 - sent) * 20}px)` }}>
              <Bubble side="right" sprite={cast.player.sprite} start={72}>
                <div style={{ fontSize: 22, opacity: 0.85, marginBottom: 6 }}>From my notes</div>
                <div style={{ fontFamily: serif }}>{scenes.share.noteInserted}</div>
              </Bubble>
            </div>
            <div style={{ opacity: ramp(frame, 112, 12), fontStyle: "italic", fontSize: 32, color: color.muted, textAlign: "center", marginTop: 10 }}>
              {scenes.share.reaction}
            </div>
          </div>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 16, borderTop: "2px solid #e6dcc5", paddingTop: 22 }}>
            <div style={{ fontSize: 26, fontWeight: 700, background: color.worldWash, color: color.world, border: `2px solid ${color.world}`, borderRadius: 14, padding: "12px 18px" }}>Notes</div>
            <div style={{ flex: 1, fontSize: 28, color: color.muted, background: "#fff", border: "2px solid #e6dcc5", borderRadius: 14, padding: "14px 20px", minHeight: 36 }}>
              {chip > 0 ? (
                <span style={{ opacity: chip, background: color.worldWash, color: color.ink, borderRadius: 10, padding: "4px 12px", fontFamily: serif }}>
                  {scenes.share.noteInserted}
                </span>
              ) : (
                "Say something…"
              )}
            </div>
            <div style={{ position: "absolute", left: 0, bottom: 90, opacity: menu, transform: `translateY(${(1 - menu) * 14}px)` }}>
              <div style={{ width: 640, background: "#fffdf3", borderLeft: `8px solid ${color.world}`, borderRadius: 14, padding: "16px 22px", boxShadow: "0 14px 34px rgba(23,32,51,0.18)", fontFamily: serif, fontSize: 28 }}>
                {scenes.share.noteInserted}
              </div>
            </div>
          </div>
        </Panel>
      </div>
      <Sfx src="accept" at={44} volume={0.35} />
      <Sfx src="alert" at={100} volume={0.6} />
    </Paper>
  );
};

/* 7. Their choices change what happens next. */
export const Choice = () => {
  const frame = useCurrentFrame();
  const c = scenes.choice;
  const picked = ramp(frame, 72, 8);
  const closed = ramp(frame, 118, 14);
  return (
    <Paper deep>
      <Caption text={copy.choices} start={2} top={70} size={62} />
      <div style={{ position: "absolute", left: 160, top: 220, display: "flex", alignItems: "center", gap: 22 }}>
        <Face sprite={cast.raffles.sprite} size={84} />
        <div style={{ fontFamily: serif, fontSize: 40, fontWeight: 700 }}>{c.prompt}</div>
      </div>
      <div style={{ position: "absolute", left: 160, top: 360, display: "flex", flexDirection: "column", gap: 24 }}>
        {c.options.map((option, i) => {
          const t = ramp(frame, 12 + i * 10, 10);
          const isPicked = i === c.picked;
          const isClosed = i === 2;
          return (
            <div
              key={option}
              style={{
                width: 900,
                fontSize: 36,
                padding: "26px 32px",
                borderRadius: 18,
                background: isPicked ? `rgba(54,89,207,${0.12 + picked * 0.88})` : "#ffffff",
                color: isPicked && picked > 0.5 ? "#ffffff" : color.ink,
                border: `3px solid ${isPicked ? color.record : "#e6dcc5"}`,
                opacity: t * (isPicked ? 1 : 1 - picked * 0.45) * (isClosed ? 1 - closed * 0.4 : 1),
                transform: `translateX(${(1 - t) * -30}px) scale(${isPicked ? 1 + picked * 0.03 : 1})`,
                textDecoration: isClosed && closed > 0.5 ? "line-through" : "none",
              }}
            >
              {option}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", right: 140, top: 380, width: 640 }}>
        {["Ending A", "Ending B", "Ending C"].map((label, i) => {
          const gone = i === 2 ? closed : 0;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 18, margin: "34px 0", opacity: ramp(frame, 90, 12) * (1 - gone * 0.75) }}>
              <div style={{ width: 300, height: 6, background: i === 2 ? "#c9c4b6" : color.record, borderRadius: 4, borderStyle: "none" }} />
              <div style={{ fontSize: 30, fontWeight: 700, color: i === 2 ? color.muted : color.ink, textDecoration: gone > 0.5 ? "line-through" : "none" }}>{label}</div>
            </div>
          );
        })}
        <div style={{ fontSize: 28, fontStyle: "italic", color: color.signal, opacity: closed, marginTop: 10 }}>{c.closed}</div>
      </div>
      <Sfx src="accept" at={72} volume={0.5} />
      <Sfx src="resolution" at={118} volume={0.5} />
    </Paper>
  );
};

/* 8. At the end, they explain their thinking. */
export const Explain = () => {
  const frame = useCurrentFrame();
  const e = scenes.explain;
  return (
    <Paper deep>
      <Caption text={copy.explain} start={2} top={70} size={62} />
      <div style={{ position: "absolute", left: 300, top: 190 }}>
        <Panel width={1320}>
          <PanelHeader sprite={cast.clerk.sprite} name={cast.clerk.name} sub="Asking what you saw" />
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <Bubble side="left" sprite={cast.clerk.sprite} text={e.question} start={10} speed={2.2} />
            <div style={{ display: "flex", gap: 16, justifyContent: "flex-end", opacity: ramp(frame, 52, 10) }}>
              {e.verdicts.map((v, i) => {
                const on = i === e.picked && frame > 78;
                return (
                  <div key={v} style={{ fontSize: 28, fontWeight: 700, padding: "14px 22px", borderRadius: 999, border: `3px solid ${color.record}`, background: on ? color.record : "#fff", color: on ? "#fff" : color.record }}>
                    {v}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", opacity: ramp(frame, 92, 10) }}>
              <div style={{ maxWidth: 760, background: color.worldWash, border: `2px solid ${color.world}`, borderRadius: 14, padding: "12px 18px", fontFamily: serif, fontSize: 26 }}>{e.attached}</div>
            </div>
            <Bubble side="left" sprite={cast.clerk.sprite} text={e.pushBack} start={118} speed={2.2} />
          </div>
        </Panel>
      </div>
      <Sfx src="accept" at={78} volume={0.4} />
    </Paper>
  );
};

/* 9. They see what really happened; why it works for schools. */
export const Schools = () => {
  const frame = useCurrentFrame();
  const r = scenes.real;
  const second = ramp(frame, 150, 14);
  const column = (title: string, items: readonly string[], accent: string, at: number) => (
    <div style={{ width: 640 }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 2, marginBottom: 24 }}>{title}</div>
      {items.map((item, i) => {
        const differs = items === r.yours && r.differs[i];
        return (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 20, margin: "0 0 26px", opacity: ramp(frame, at + i * 14, 10) }}>
            <div style={{ width: 26, height: 26, borderRadius: 999, background: differs ? color.signal : accent, flexShrink: 0 }} />
            <div style={{ fontFamily: serif, fontSize: 36, color: differs ? color.signal : color.ink }}>{item}</div>
          </div>
        );
      })}
    </div>
  );
  return (
    <Paper>
      <AbsoluteFill style={{ opacity: 1 - second }}>
        <Caption text={copy.real} start={2} top={110} size={64} />
        <AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 120, paddingTop: 140 }}>
          {column("Your story", r.yours, color.record, 26)}
          {column("What really happened", r.history, color.world, 46)}
        </AbsoluteFill>
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: second }}>
        <div style={{ position: "absolute", left: 160, top: 200, width: 760 }}>
          {copy.schools.map((line, i) => (
            <div key={line} style={{ fontFamily: serif, fontSize: 54, fontWeight: 700, lineHeight: 1.2, margin: "0 0 44px", opacity: ramp(frame, 160 + i * 34, 14), transform: `translateY(${(1 - ramp(frame, 160 + i * 34, 14)) * 20}px)` }}>
              {line}
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", right: 140, top: 210 }}>
          <Panel width={760}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color.muted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 26 }}>Your class at a glance</div>
            {scenes.classView.map((row, i) => {
              const grow = interpolate(frame, [170 + i * 16, 210 + i * 16], [0, row.value], clamp);
              return (
                <div key={row.label} style={{ marginBottom: 30 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, marginBottom: 10 }}>
                    <span>{row.label}</span>
                    <span style={{ fontWeight: 700 }}>{Math.round(grow * 100)}%</span>
                  </div>
                  <div style={{ height: 18, background: "#ece5d3", borderRadius: 999 }}>
                    <div style={{ width: `${grow * 100}%`, height: "100%", background: i === 1 ? color.world : color.record, borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>
      </AbsoluteFill>
    </Paper>
  );
};

/* 10. End card. */
export const EndCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame: frame - 6, fps, config: { damping: 14 } });
  return (
    <Paper>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.9 + logo * 0.1})`, opacity: logo }}>
          <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150 }} />
          <div style={{ fontFamily: serif, fontSize: 110, fontWeight: 700, letterSpacing: -1 }}>Historical Adventures</div>
        </div>
        <div style={{ fontFamily: serif, fontSize: 50, marginTop: 40, opacity: ramp(frame, 40, 14) }}>{copy.tagline}</div>
        <div style={{ fontSize: 34, color: color.muted, marginTop: 26, opacity: ramp(frame, 70, 14) }}>{copy.audience}</div>
        <div style={{ position: "absolute", bottom: 90, fontSize: 30, fontWeight: 700, color: color.signal, opacity: ramp(frame, 100, 14) }}>
          <Typed text={copy.wip} start={100} speed={2} />
        </div>
      </AbsoluteFill>
    </Paper>
  );
};
