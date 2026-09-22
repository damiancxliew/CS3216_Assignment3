"use client";

/**
 * The playable view over the Turn API. Everything on the right-hand panel is
 * reachable by keyboard and works with the canvas ignored (Y5); the map is the
 * spatial layer on top of the same state, not a second source of truth.
 *
 * Sized for a secondary-school student on a school laptop: 16px base text,
 * 44px targets, no faint grey on grey, one idea per section.
 */
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

/** A character's face: the generated portrait when the asset service has one, the pack's faceset otherwise (D4/D6). */
function Portrait({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (!src) return <span className="inline-block shrink-0 rounded-lg bg-black/10 dark:bg-white/10" style={{ width: size, height: size }} aria-hidden />;
  const pixel = src.startsWith("/game/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img
      src={src}
      alt={`${name}'s portrait`}
      width={size}
      height={size}
      className="shrink-0 rounded-lg border-2 border-black/15 bg-[#e7d4a8] object-cover dark:border-white/20"
      style={pixel ? { imageRendering: "pixelated" } : undefined}
    />
  );
}

const button =
  "inline-flex min-h-11 items-center rounded-xl border-2 border-black/20 bg-white/60 px-4 py-2 text-base font-medium leading-snug transition hover:bg-black/5 disabled:opacity-40 dark:border-white/25 dark:bg-white/5 dark:hover:bg-white/10";
const primary =
  "inline-flex min-h-11 items-center rounded-xl bg-foreground px-5 py-2 text-base font-semibold leading-snug text-background transition hover:opacity-90 disabled:opacity-40";
const heading = "text-lg font-bold tracking-tight";
const quiet = "text-base leading-relaxed opacity-80";

export function PlayClient({ attemptId, initialState }: { attemptId: string; initialState: PlayState }) {
  const [state, setState] = useState<PlayState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addressee, setAddressee] = useState<string | null>(null);
  const [intent, setIntent] = useState<MapIntent>(null);
  const [waitingAtDoor, setWaitingAtDoor] = useState<string | null>(null);
  const [lastResolution, setLastResolution] = useState<string | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const revision = useRef(initialState.revision);
  const { muted, toggleMuted, cues } = useSoundCues(state, notice);

  const accept = useCallback((next: PlayState) => {
    // Out-of-order replies are discarded (I3: revision is monotonic per attempt).
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    const result = await playApi.state(attemptId);
    if (result.ok) accept(result.body);
  }, [attemptId, accept]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, busy]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [state.transcript.length]);

  const here = state.rooms.find((r) => r.id === state.currentRoomId) ?? null;
  const peopleHere = state.agents.filter((a) => a.roomId === state.currentRoomId);
  const effectiveAddressee = peopleHere.some((a) => a.id === addressee) ? addressee : peopleHere[0]?.id ?? null;

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
        <p className="text-base font-semibold uppercase tracking-widest opacity-80">The end</p>
        <h2 className="text-3xl font-bold tracking-tight">{state.ending?.title ?? "The adventure is over"}</h2>
        {lastResolution ? <p className="text-lg leading-relaxed">{lastResolution}</p> : null}
        {state.ending ? <p className="text-lg leading-relaxed opacity-90">{state.ending.summary}</p> : null}
        <Link href={`/play/${attemptId}/debrief`} className={`${primary} w-fit text-lg`}>
          Read the debrief
        </Link>
      </section>
    );
  }

  const decided = state.commitments.filter((c) => c.committed).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="relative min-h-[60vh] flex-1 lg:min-h-0" aria-label="Map">
        <MapCanvas
          state={state}
          audio={{ muted, cues }}
          intent={intent}
          onIntentDone={() => setIntent(null)}
          onEnterRoom={onEnterRoom}
          onSettled={onSettled}
          onWaitingAtDoor={setWaitingAtDoor}
        />
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/70 px-4 py-2 text-base font-medium text-white">
          Arrow keys or WASD to walk · click a tile to go there
        </p>
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-base font-medium text-white hover:bg-black/85"
        >
          <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
          {muted ? "Sound off" : "Sound on"}
        </button>
        {lastResolution ? (
          <div role="status" className="absolute left-3 right-3 top-3 mx-auto max-w-2xl rounded-2xl border-2 border-white/30 bg-black/80 p-5 text-white shadow-xl backdrop-blur">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest opacity-80">What happened</p>
            <p className="text-lg leading-relaxed">{lastResolution}</p>
            <button type="button" className="mt-3 rounded-lg border-2 border-white/40 px-4 py-2 text-base font-medium hover:bg-white/10" onClick={() => setLastResolution(null)}>
              Got it
            </button>
          </div>
        ) : null}
      </section>

      <aside className="flex w-full min-w-0 flex-col gap-7 overflow-y-auto border-t-2 border-black/10 p-6 text-base lg:w-[30rem] lg:border-l-2 lg:border-t-0 dark:border-white/15">
        <section className="flex flex-col gap-3" aria-labelledby="where">
          <div className="flex items-start justify-between gap-4">
            <h2 id="where" className="text-xl font-bold tracking-tight">
              {here ? here.name : "Outside"}
            </h2>
            <span className="shrink-0 rounded-lg bg-black/5 px-3 py-1.5 text-base font-semibold tabular-nums dark:bg-white/10">
              <span className="font-normal opacity-80">Time left </span>
              <StageCountdown attemptId={attemptId} deadlineIso={state.timer.deadlineAt} serverNowIso={state.timer.serverNow} />
            </span>
          </div>
          {here && state.roomImages[here.id] ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated landmark from storage
            <img src={state.roomImages[here.id]} alt={here.name} className="aspect-[3/2] w-full rounded-xl border-2 border-black/15 object-cover dark:border-white/20" />
          ) : null}
          {here?.purpose ? <p className={quiet}>{here.purpose}</p> : null}
          {!here ? <p className={quiet}>You are between buildings. Walk into one to talk to the people inside.</p> : null}
          <div className="flex flex-wrap gap-2">
            {state.rooms
              .filter((r) => r.id !== state.currentRoomId)
              .map((r) => (
                <button key={r.id} type="button" className={button} disabled={busy !== null} onClick={() => setIntent({ kind: "room", roomId: r.id })}>
                  Walk to {r.name}
                  {!r.doorOpen ? <span className="ml-2 text-sm font-normal opacity-80">(door closed)</span> : null}
                </button>
              ))}
            {here ? (
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => act(here.doorOpen ? "Closing…" : "Opening…", () => playApi.action(attemptId, { type: here.doorOpen ? "close_door" : "open_door", roomId: here.id }))}
              >
                {here.doorOpen ? "Close the door" : "Open the door"}
              </button>
            ) : null}
            {waitingAtDoor ? (
              <button type="button" className={primary} disabled={busy !== null} onClick={() => act("Knocking…", () => playApi.action(attemptId, { type: "knock", roomId: waitingAtDoor }))}>
                Knock on {state.rooms.find((r) => r.id === waitingAtDoor)?.name ?? "the door"}
              </button>
            ) : null}
          </div>
          {state.evidenceHere.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold uppercase tracking-wide">Something to look at</p>
              <ul className="flex flex-wrap gap-2">
                {state.evidenceHere.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={button} disabled={busy !== null} onClick={() => act("Examining…", () => playApi.action(attemptId, { type: "inspect", evidenceId: item.id }))}>
                      Examine {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="talk">
          <h2 id="talk" className={heading}>
            {peopleHere.length ? "Here with you" : "Nobody here to talk to"}
          </h2>
          {peopleHere.length ? (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Who you are speaking to">
              {peopleHere.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === effectiveAddressee}
                  className={`${button} w-full justify-start gap-3 py-2 pl-2 text-left ${a.id === effectiveAddressee ? "border-foreground bg-black/10 dark:bg-white/15" : ""}`}
                  onClick={() => setAddressee(a.id)}
                >
                  <Portrait src={a.portraitUrl} name={a.name} size={44} />
                  <span className="min-w-0 leading-snug">
                    <span className="block font-semibold">{a.name}</span>
                    {a.role ? <span className="block text-sm font-normal opacity-80">{a.role}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-xl border-2 border-black/10 p-4 dark:border-white/15" role="log" aria-live="polite" aria-label="Conversation">
            {state.transcript.length === 0 ? <p className={quiet}>Nothing said yet. Walk up to someone and ask them something.</p> : null}
            {state.transcript.map((m) => {
              const speaker = m.authorType === "agent" ? state.agents.find((a) => a.id === m.authorId) : null;
              const mine = m.authorType === "player";
              return (
                <div key={m.id} className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                  {speaker ? <Portrait src={speaker.portraitUrl} name={speaker.name} size={36} /> : null}
                  <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-2 leading-relaxed ${mine ? "bg-foreground text-background" : "bg-black/5 dark:bg-white/10"}`}>
                    {!mine ? <p className="text-sm font-semibold opacity-80">{m.authorName ?? "Someone"}</p> : null}
                    <p>{m.body}</p>
                  </div>
                </div>
              );
            })}
            <div ref={transcriptEnd} />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              aria-label="What you say"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy !== null || !peopleHere.length}
              placeholder={peopleHere.length ? `Ask ${peopleHere.find((a) => a.id === effectiveAddressee)?.name ?? "them"} something…` : "Find someone to talk to first"}
              className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-black/20 bg-transparent px-4 py-2 text-base outline-none placeholder:opacity-60 focus:border-foreground dark:border-white/25"
              maxLength={2000}
            />
            <button type="submit" className={primary} disabled={busy !== null || !draft.trim() || !peopleHere.length}>
              {busy === "Speaking…" ? "…" : "Say it"}
            </button>
          </form>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="objectives">
          <h2 id="objectives" className={heading}>
            Your goals{" "}
            <span className="text-base font-normal opacity-80">
              · stage {state.stage.index + 1} of {state.stageCount}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {state.stage.objectives.map((o) => (
              <li key={o.id} className={`flex items-start gap-3 leading-snug ${o.met ? "opacity-70" : ""}`}>
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${o.met ? "border-emerald-600 bg-emerald-600 text-white" : "border-black/30 dark:border-white/40"}`}
                >
                  {o.met ? "✓" : ""}
                </span>
                <span className={o.met ? "line-through" : ""}>{o.title}</span>
                <span className="sr-only">{o.met ? "done" : "not yet"}</span>
              </li>
            ))}
          </ul>
          {state.journal.length ? (
            <details className="rounded-xl border-2 border-black/10 p-3 dark:border-white/15">
              <summary className="cursor-pointer font-semibold">Your notes ({state.journal.length})</summary>
              <ul className="mt-3 flex flex-col gap-3">
                {state.journal.map((j) => (
                  <li key={j.id} className="flex gap-3 rounded-lg bg-black/5 p-3 dark:bg-white/5">
                    {state.evidenceImages[j.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
                      <img src={state.evidenceImages[j.id]} alt="" className="h-16 w-16 flex-none rounded-lg object-cover" />
                    ) : null}
                    <div className="min-w-0 leading-relaxed">
                      <p>{j.text}</p>
                      {j.sourceSpan ? <p className="mt-1 text-sm opacity-80">{j.sourceSpan}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border-2 border-black/15 p-4 dark:border-white/20" aria-labelledby="decide">
          <h2 id="decide" className={heading}>
            Your decision
          </h2>
          <p className={quiet}>
            {decided} of {state.commitments.length} people have decided. Choosing ends this stage. There is no going back.
          </p>
          <ul className="flex flex-col gap-3">
            {state.options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={`${o.available ? primary : button} w-full flex-col items-start gap-1 text-left`}
                  disabled={!o.available || busy !== null}
                  onClick={() => decide(o.id)}
                >
                  <span className="leading-snug">{o.label}</span>
                  {!o.available ? <span className="text-sm font-normal opacity-80">Locked: {o.unavailableReason}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {notice ? (
          <p role="status" className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 px-4 py-3 text-base leading-relaxed">
            {notice}
          </p>
        ) : null}
        {busy ? (
          <p role="status" aria-live="polite" className="text-base font-medium opacity-80">
            {busy}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
