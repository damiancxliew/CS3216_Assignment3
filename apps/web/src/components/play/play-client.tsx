"use client";

/**
 * The playable view over the Turn API. Everything on the right-hand panel is
 * reachable by keyboard and works with the canvas ignored (Y5); the map is the
 * spatial layer on top of the same state, not a second source of truth.
 *
 * The panel is a HUD with one focal point. Top: where you are and where you can
 * go (compact). Middle: the conversation, which is the game, so it takes the
 * height. Bottom, always visible: your goals as a progress strip and the
 * decision, which stays quiet until you can actually make it, then lights up.
 * Sized for a 13-year-old on a school laptop: 16px base, 44px targets.
 */
import { ArrowRight, Check, CornerDownRight, Lock, Search, Timer, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { playApi } from "./api";
import type { MapIntent } from "./map-canvas";
import { useSoundCues } from "./sound";
import { StageCountdown } from "@/components/stage-countdown";
import type { PlayState } from "@/lib/play/session";

const MapCanvas = dynamic(() => import("./map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-[#7d8c5c]/40" />,
});

const POLL_MS = 8_000;
/** A failing server is not polled at the same rate: back off, and give up rather than pile on. */
const MAX_POLL_MS = 120_000;
const GIVE_UP_AFTER = 6;

/** A character's face: the generated portrait when the asset service has one, the pack's faceset otherwise (D4/D6). */
function Portrait({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const box = { width: size, height: size, minWidth: size, minHeight: size };
  if (!src) return <span className="inline-block shrink-0 self-start rounded-xl bg-black/10 dark:bg-white/10" style={box} aria-hidden />;
  const pixel = src.startsWith("/game/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img
      src={src}
      alt={`${name}'s portrait`}
      width={size}
      height={size}
      className="shrink-0 self-start rounded-xl border-2 border-black/15 bg-[#e7d4a8] object-cover dark:border-white/20"
      style={{ ...box, imageRendering: pixel ? "pixelated" : undefined }}
    />
  );
}

const chip =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 border-black/15 bg-white/70 px-3.5 py-1.5 text-[15px] font-semibold leading-tight transition hover:border-black/40 hover:bg-white disabled:opacity-40 dark:border-white/20 dark:bg-white/5 dark:hover:bg-white/15";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground px-5 py-2 text-base font-bold leading-snug text-background transition hover:opacity-90 disabled:opacity-40";
const label = "text-[13px] font-extrabold uppercase tracking-[0.12em] opacity-70";

export function PlayClient({ attemptId, initialState }: { attemptId: string; initialState: PlayState }) {
  const [state, setState] = useState<PlayState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addressee, setAddressee] = useState<string | null>(null);
  const [intent, setIntent] = useState<MapIntent>(null);
  const [waitingAtDoor, setWaitingAtDoor] = useState<string | null>(null);
  const [lastResolution, setLastResolution] = useState<string | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const revision = useRef(initialState.revision);
  const { muted, toggleMuted, cues } = useSoundCues(state, notice);

  const accept = useCallback((next: PlayState) => {
    // Out-of-order replies are discarded (I3: revision is monotonic per attempt).
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);

  const failures = useRef(0);
  const refresh = useCallback(async () => {
    const result = await playApi.state(attemptId);
    if (result.ok) {
      failures.current = 0;
      accept(result.body);
    } else {
      failures.current += 1;
    }
    return result.ok;
  }, [attemptId, accept]);

  useEffect(() => {
    let timer = 0;
    const tick = async () => {
      if (document.visibilityState === "visible" && !busy) await refresh();
      if (failures.current >= GIVE_UP_AFTER) return;
      timer = window.setTimeout(tick, Math.min(POLL_MS * 2 ** failures.current, MAX_POLL_MS));
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [refresh, busy]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [state.transcript.length]);

  // The moment a choice becomes possible, show it; a new stage closes it again.
  const canDecide = state.options.some((o) => o.available);
  useEffect(() => {
    if (canDecide) setDecisionOpen(true);
  }, [canDecide]);
  useEffect(() => {
    setDecisionOpen(false);
  }, [state.stage.id]);

  const here = state.rooms.find((r) => r.id === state.currentRoomId) ?? null;
  const peopleHere = state.agents.filter((a) => a.roomId === state.currentRoomId);
  const effectiveAddressee = peopleHere.some((a) => a.id === addressee) ? addressee : peopleHere[0]?.id ?? null;
  const talkingTo = peopleHere.find((a) => a.id === effectiveAddressee) ?? null;

  async function act(label: string, run: () => Promise<{ ok: true; body: { state: PlayState; refused?: string | null } } | { ok: false; error: { message: string } }>) {
    setBusy(label);
    setNotice(null);
    try {
      const result = await run();
      if (!result.ok) {
        setNotice(result.error.message);
        await refresh();
        return false;
      }
      accept(result.body.state);
      if (result.body.refused) setNotice(result.body.refused);
      return !result.body.refused;
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || !state.currentRoomId) return;
    setDraft("");
    await act("Speaking…", () => playApi.message(attemptId, { roomId: state.currentRoomId!, body, addresseeId: effectiveAddressee }));
  }

  async function decide(optionId: string) {
    setBusy("Deciding…");
    setNotice(null);
    try {
      const result = await playApi.decide(attemptId, { optionId, optionsVersion: state.optionsVersion });
      if (!result.ok) {
        setNotice(result.error.message);
        await refresh();
        return;
      }
      setLastResolution(result.body.resolution.announcement);
      accept(result.body.state);
    } finally {
      setBusy(null);
    }
  }

  const onEnterRoom = useCallback(
    async (roomId: string, position: { x: number; y: number }) => {
      const result = await playApi.action(attemptId, { type: "move_room", toRoomId: roomId, position });
      if (!result.ok) {
        setNotice(result.error.message);
        return false;
      }
      accept(result.body.state);
      if (result.body.refused) {
        setNotice(result.body.refused);
        return false;
      }
      return true;
    },
    [attemptId, accept],
  );

  // From the map: pick who to talk to and put the cursor in the box, so "walk up and talk" works.
  const onTalk = useCallback((actorId: string) => {
    setAddressee(actorId);
    composer.current?.focus();
    composer.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const onSettled = useCallback(
    (position: { x: number; y: number }) => {
      void playApi.action(attemptId, { type: "position", position }).then((r) => r.ok && accept(r.body.state));
    },
    [attemptId, accept],
  );

  if (state.status === "completed") {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-2xl border-2 border-black/10 p-8 dark:border-white/15">
        {/* The map (and its sound manager) is gone at the ending; the closing theme plays from here. */}
        {!muted ? <audio src="/game/ninja/audio/music/end-theme.ogg" autoPlay loop /> : null}
        <p className={label}>The end</p>
        <h2 className="text-3xl font-extrabold tracking-tight">{state.ending?.title ?? "The adventure is over"}</h2>
        {lastResolution ? <p className="text-lg leading-relaxed">{lastResolution}</p> : null}
        {state.ending ? <p className="text-lg leading-relaxed opacity-90">{state.ending.summary}</p> : null}
        <Link href={`/play/${attemptId}/debrief`} className={`${primary} w-fit text-lg`}>
          Read the debrief
        </Link>
      </section>
    );
  }

  const goalsMet = state.stage.objectives.filter((o) => o.met).length;
  const goalsTotal = state.stage.objectives.length;
  const decided = state.commitments.filter((c) => c.committed).length;
  const lowTime = state.timer.enabled && state.timer.secondsRemaining !== null && state.timer.secondsRemaining <= 120;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="relative min-h-[55vh] flex-1 lg:min-h-0" aria-label="Map">
        <MapCanvas
          state={state}
          audio={{ muted, cues }}
          intent={intent}
          onIntentDone={() => setIntent(null)}
          onEnterRoom={onEnterRoom}
          onSettled={onSettled}
          onWaitingAtDoor={setWaitingAtDoor}
          onTalk={onTalk}
        />
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/70 px-4 py-2 text-[15px] font-semibold text-white">
          Arrows / WASD to walk · click a character to talk · Enter to talk to whoever is with you
        </p>
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[15px] font-semibold text-white hover:bg-black/85"
        >
          {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          {muted ? "Sound off" : "Sound on"}
        </button>
        {lastResolution ? (
          <div role="status" className="absolute left-3 right-3 top-3 mx-auto max-w-2xl rounded-2xl border-2 border-white/30 bg-black/85 p-5 text-white shadow-xl backdrop-blur">
            <p className={`${label} mb-2 text-white/80`}>What happened</p>
            <p className="text-lg leading-relaxed">{lastResolution}</p>
            <button type="button" className="mt-3 rounded-xl border-2 border-white/40 px-4 py-2 text-base font-bold hover:bg-white/10" onClick={() => setLastResolution(null)}>
              Got it
            </button>
          </div>
        ) : null}
      </section>

      <aside className="flex min-h-0 w-full min-w-0 flex-col border-t-2 border-black/10 text-base lg:w-[30rem] lg:border-l-2 lg:border-t-0 dark:border-white/15">
        {/* ── Top: where you are, where you can go ─────────────────────────── */}
        <section className="flex flex-col gap-3 border-b-2 border-black/10 px-5 py-4 dark:border-white/15" aria-labelledby="where">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={label}>You are in</p>
              <h2 id="where" className="text-xl font-extrabold leading-tight tracking-tight">
                {here ? here.name : "the open air"}
              </h2>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-lg font-extrabold tabular-nums ${lowTime ? "animate-pulse bg-amber-500 text-black" : "bg-black/5 dark:bg-white/10"}`}
              aria-label="Time left in this stage"
            >
              <Timer className="h-5 w-5" aria-hidden /> <StageCountdown attemptId={attemptId} deadlineIso={state.timer.deadlineAt} serverNowIso={state.timer.serverNow} />
            </span>
          </div>
          {here && state.roomImages[here.id] ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated landmark from storage
            <img src={state.roomImages[here.id]} alt={here.name} className="aspect-[3/1] w-full rounded-xl border-2 border-black/15 object-cover dark:border-white/20" />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {state.rooms
              .filter((r) => r.id !== state.currentRoomId)
              .map((r) => (
                <button key={r.id} type="button" className={chip} disabled={busy !== null} onClick={() => setIntent({ kind: "room", roomId: r.id })}>
                  <ArrowRight className="h-4 w-4" aria-hidden /> {r.name}
                  {!r.doorOpen ? <Lock className="h-4 w-4 opacity-70" aria-label="door closed" /> : null}
                </button>
              ))}
            {here ? (
              <button
                type="button"
                className={chip}
                disabled={busy !== null}
                onClick={() => act(here.doorOpen ? "Closing…" : "Opening…", () => playApi.action(attemptId, { type: here.doorOpen ? "close_door" : "open_door", roomId: here.id }))}
              >
                {here.doorOpen ? "Close door" : "Open door"}
              </button>
            ) : null}
            {waitingAtDoor ? (
              <button type="button" className={`${primary} min-h-10 py-1.5`} disabled={busy !== null} onClick={() => act("Knocking…", () => playApi.action(attemptId, { type: "knock", roomId: waitingAtDoor }))}>
                Knock on {state.rooms.find((r) => r.id === waitingAtDoor)?.name ?? "the door"}
              </button>
            ) : null}
          </div>
          {state.evidenceHere.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-400/15 p-2.5">
              <span className="px-1 text-[15px] font-extrabold">Look at:</span>
              {state.evidenceHere.map((item) => (
                <button key={item.id} type="button" className={`${chip} border-amber-600/50`} disabled={busy !== null} onClick={() => act("Examining…", () => playApi.action(attemptId, { type: "inspect", evidenceId: item.id }))}>
                  <Search className="h-4 w-4" aria-hidden /> {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {/* ── Middle: the conversation. This is the game; it gets the height. ── */}
        <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="talk">
          {peopleHere.length ? (
            <div className="flex gap-2 overflow-x-auto px-5 pt-4" role="radiogroup" aria-label="Who you are talking to" id="talk">
              {peopleHere.map((a) => {
                const active = a.id === effectiveAddressee;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setAddressee(a.id)}
                    className={`flex min-w-0 shrink-0 items-center gap-2.5 rounded-2xl border-2 px-2.5 py-2 text-left transition ${active ? "border-foreground bg-foreground text-background" : "border-black/15 hover:border-black/40 dark:border-white/20"}`}
                  >
                    <Portrait src={a.portraitUrl} name={a.name} size={40} />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-[15px] font-extrabold">{a.name}</span>
                      {a.role ? <span className={`block max-w-[14rem] truncate text-[13px] ${active ? "opacity-80" : "opacity-70"}`}>{a.role}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p id="talk" className="px-5 pt-4 text-[15px] font-semibold opacity-70">
              {here ? "Nobody is here. Try another building." : "Walk into a building to find someone to talk to."}
            </p>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" role="log" aria-live="polite" aria-label="Conversation">
            {state.transcript.length === 0 ? (
              <p className="m-auto max-w-xs text-center text-[15px] leading-relaxed opacity-70">
                {talkingTo
                  ? `Nothing said yet. Ask ${talkingTo.name} a question — hearing what they think is how you complete a goal about them.`
                  : "Nothing said yet. Find someone and ask them a question."}
              </p>
            ) : null}
            {state.transcript.map((m) => {
              const speaker = m.authorType === "agent" ? state.agents.find((a) => a.id === m.authorId) : null;
              const mine = m.authorType === "player";
              return (
                <div key={m.id} className={`flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  {speaker ? <Portrait src={speaker.portraitUrl} name={speaker.name} size={36} /> : null}
                  <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed ${mine ? "rounded-tr-md bg-foreground text-background" : "rounded-tl-md bg-black/[0.06] dark:bg-white/10"}`}>
                    {!mine ? <p className="text-[13px] font-extrabold opacity-75">{m.authorName ?? "Someone"}</p> : null}
                    <p>{m.body}</p>
                  </div>
                </div>
              );
            })}
            {busy === "Speaking…" ? <p className="px-2 text-[15px] font-semibold opacity-60">{talkingTo?.name ?? "They"} is thinking…</p> : null}
            <div ref={transcriptEnd} />
          </div>

          <form
            className="flex gap-2 px-5 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={composer}
              aria-label="What you say"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy !== null || !peopleHere.length}
              placeholder={talkingTo ? `Ask ${talkingTo.name.split(" ").at(-1)} something…` : "Find someone to talk to first"}
              className="min-h-12 min-w-0 flex-1 rounded-2xl border-2 border-black/20 bg-white/70 px-4 py-2 text-base outline-none placeholder:opacity-60 focus:border-foreground dark:border-white/25 dark:bg-white/5"
              maxLength={2000}
            />
            <button type="submit" className={`${primary} min-h-12 rounded-2xl`} disabled={busy !== null || !draft.trim() || !peopleHere.length}>
              Say it
            </button>
          </form>
        </section>

        {/* ── Bottom, always visible: goals + the decision ─────────────────── */}
        <section className="flex flex-col gap-3 border-t-2 border-black/10 bg-black/[0.03] px-5 py-4 dark:border-white/15 dark:bg-white/[0.04]" aria-labelledby="decide">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-extrabold">
              Goals {goalsMet}/{goalsTotal}
              <span className="ml-2 font-semibold opacity-60">· stage {state.stage.index + 1} of {state.stageCount}</span>
            </p>
            {state.journal.length ? (
              <button type="button" className="text-[15px] font-bold underline underline-offset-4 opacity-80 hover:opacity-100" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}>
                Notes ({state.journal.length})
              </button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1.5">
            {state.stage.objectives.map((o) => (
              <li key={o.id} className={`flex items-start gap-2.5 text-[15px] leading-snug ${o.met ? "opacity-60" : "font-semibold"}`}>
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-black ${o.met ? "border-emerald-600 bg-emerald-600 text-white" : "border-black/35 dark:border-white/40"}`}
                >
                  {o.met ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className={o.met ? "line-through" : ""}>{o.title}</span>
                  {!o.met && state.objectiveHints[o.id] ? (
                    <span className="flex items-start gap-1 text-[13px] font-semibold opacity-70">
                      <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {state.objectiveHints[o.id]}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">{o.met ? "done" : "not yet"}</span>
              </li>
            ))}
          </ul>
          {notesOpen && state.journal.length ? (
            <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-xl border-2 border-black/10 p-2 dark:border-white/15">
              {state.journal.map((j) => (
                <li key={j.id} className="flex gap-3 rounded-lg bg-white/60 p-3 text-[15px] leading-relaxed dark:bg-white/5">
                  {state.evidenceImages[j.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
                    <img src={state.evidenceImages[j.id]} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p>{j.text}</p>
                    {j.sourceSpan ? <p className="mt-1 text-[13px] opacity-70">{j.sourceSpan}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {canDecide ? (
            <div className="flex flex-col gap-2 rounded-2xl border-2 border-amber-500 bg-amber-400/20 p-3 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]">
              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
                <span id="decide" className="text-lg font-extrabold">
                  You can decide now
                </span>
                <span className="text-[15px] font-semibold opacity-80">
                  {decided}/{state.commitments.length} decided · {decisionOpen ? "hide" : "show"}
                </span>
              </button>
              {decisionOpen ? (
                <>
                  <p className="text-[15px] leading-snug opacity-80">This ends the stage. There is no going back.</p>
                  <ul className="flex flex-col gap-2">
                    {state.options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className={`${o.available ? primary : chip} w-full flex-col items-start gap-0.5 rounded-xl text-left ${o.available ? "" : "min-h-11"}`}
                          disabled={!o.available || busy !== null}
                          onClick={() => decide(o.id)}
                        >
                          <span className="leading-snug">{o.label}</span>
                          {!o.available ? (
                            <span className="inline-flex items-center gap-1 text-[13px] font-semibold opacity-70">
                              <Lock className="h-3.5 w-3.5" aria-hidden /> {o.unavailableReason}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <button type="button" className="flex w-full items-center justify-between rounded-2xl border-2 border-dashed border-black/20 px-3 py-2.5 text-left dark:border-white/25" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
              <span id="decide" className="inline-flex items-center gap-2 text-[15px] font-bold opacity-80">
                <Lock className="h-4 w-4" aria-hidden /> Decision locked · finish your goals first
              </span>
              <span className="text-[13px] font-semibold opacity-60">{decisionOpen ? "hide" : "see choices"}</span>
            </button>
          )}
          {!canDecide && decisionOpen ? (
            <ul className="flex flex-col gap-1.5 text-[15px] leading-snug opacity-75">
              {state.options.map((o) => (
                <li key={o.id} className="rounded-xl bg-white/50 px-3 py-2 dark:bg-white/5">
                  {o.label}
                  {o.unavailableReason ? <span className="block text-[13px] opacity-80">{o.unavailableReason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {notice ? (
            <p role="status" className="rounded-xl border-2 border-amber-500/60 bg-amber-400/15 px-3 py-2 text-[15px] leading-snug">
              {notice}
            </p>
          ) : null}
          {busy && busy !== "Speaking…" ? (
            <p role="status" aria-live="polite" className="text-[15px] font-semibold opacity-70">
              {busy}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
