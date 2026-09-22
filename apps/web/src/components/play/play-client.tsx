"use client";

/**
 * The playable view over the Turn API. Everything on the right-hand panel is
 * reachable by keyboard and works with the canvas ignored (Y5); the map is the
 * spatial layer on top of the same state, not a second source of truth.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { playApi } from "./api";
import type { MapIntent } from "./map-canvas";
import { StageCountdown } from "@/components/stage-countdown";
import type { PlayState } from "@/lib/play/session";

const MapCanvas = dynamic(() => import("./map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-[#7d8c5c]/40" />,
});

const POLL_MS = 8_000;

/** A character's face: the generated portrait when the asset service has one, the pack's faceset otherwise (D4/D6). */
function Portrait({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (!src) return <span className="inline-block rounded-md bg-black/10 dark:bg-white/10" style={{ width: size, height: size }} aria-hidden />;
  const pixel = src.startsWith("/game/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img src={src} alt={`${name}'s portrait`} width={size} height={size} className="rounded-md border border-black/15 bg-[#e7d4a8] object-cover dark:border-white/20" style={pixel ? { imageRendering: "pixelated" } : undefined} />
  );
}

const button = "inline-flex items-center rounded-full border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";
const primary = "inline-flex items-center rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50";

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
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/15">
        <p className="text-sm uppercase tracking-widest opacity-60">The end</p>
        <h2 className="text-2xl font-semibold tracking-tight">{state.ending?.title ?? "The adventure is over"}</h2>
        {lastResolution ? <p className="text-sm opacity-80">{lastResolution}</p> : null}
        {state.ending ? <p className="text-sm opacity-80">{state.ending.summary}</p> : null}
        <Link href={`/play/${attemptId}/debrief`} className={`${primary} w-fit`}>
          Read the debrief
        </Link>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="relative min-h-[60vh] flex-1 lg:min-h-0" aria-label="Map">
        <MapCanvas
          state={state}
          intent={intent}
          onIntentDone={() => setIntent(null)}
          onEnterRoom={onEnterRoom}
          onSettled={onSettled}
          onWaitingAtDoor={setWaitingAtDoor}
        />
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
          Arrow keys or WASD to walk · click a tile to go there
        </p>
        {lastResolution ? (
          <div role="status" className="absolute left-3 right-3 top-3 mx-auto max-w-2xl rounded-lg border border-white/20 bg-black/70 p-4 text-sm text-white shadow-lg backdrop-blur">
            <p className="mb-1 text-xs uppercase tracking-widest opacity-70">What happened</p>
            <p>{lastResolution}</p>
            <button type="button" className="mt-2 text-xs underline opacity-80" onClick={() => setLastResolution(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </section>

      <aside className="flex w-full min-w-0 flex-col gap-6 overflow-y-auto border-t border-black/10 p-5 lg:w-[26rem] lg:border-l lg:border-t-0 dark:border-white/15">
        <section className="flex flex-col gap-2" aria-labelledby="where">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="where" className="text-sm font-medium uppercase tracking-wide opacity-60">
              {here ? here.name : "Between rooms"}
            </h2>
            <span className="text-sm">
              <span className="opacity-60">Time left: </span>
              <StageCountdown attemptId={attemptId} deadlineIso={state.timer.deadlineAt} serverNowIso={state.timer.serverNow} />
            </span>
          </div>
          {here && state.roomImages[here.id] ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated landmark from storage
            <img src={state.roomImages[here.id]} alt={`${here.name}`} className="aspect-[3/2] w-full rounded-lg border border-black/15 object-cover dark:border-white/20" />
          ) : null}
          {here?.purpose ? <p className="text-sm opacity-70">{here.purpose}</p> : null}
          <div className="flex flex-wrap gap-2">
            {state.rooms
              .filter((r) => r.id !== state.currentRoomId)
              .map((r) => (
                <button key={r.id} type="button" className={button} disabled={busy !== null} onClick={() => setIntent({ kind: "room", roomId: r.id })}>
                  Walk to {r.name}
                  {!r.doorOpen ? " (door closed)" : ""}
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
            <ul className="flex flex-wrap gap-2">
              {state.evidenceHere.map((item) => (
                <li key={item.id}>
                  <button type="button" className={button} disabled={busy !== null} onClick={() => act("Examining…", () => playApi.action(attemptId, { type: "inspect", evidenceId: item.id }))}>
                    Examine: {item.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="talk">
          <h2 id="talk" className="text-sm font-medium uppercase tracking-wide opacity-60">
            {peopleHere.length ? "Here with you" : "Nobody here to talk to"}
          </h2>
          {peopleHere.length ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who you are speaking to">
              {peopleHere.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === effectiveAddressee}
                  className={`${button} gap-2 py-1 pl-1 ${a.id === effectiveAddressee ? "bg-black/10 dark:bg-white/15" : ""}`}
                  onClick={() => setAddressee(a.id)}
                  title={a.publicPosition ?? undefined}
                >
                  <Portrait src={a.portraitUrl} name={a.name} size={32} />
                  <span className="text-left leading-tight">
                    {a.name}
                    {a.role ? <span className="block text-xs opacity-60">{a.role}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border border-black/10 p-3 text-sm dark:border-white/15" role="log" aria-live="polite" aria-label="Conversation">
            {state.transcript.length === 0 ? <p className="opacity-60">Nothing said yet. Walk up to someone and ask.</p> : null}
            {state.transcript.map((m) => {
              const speaker = m.authorType === "agent" ? state.agents.find((a) => a.id === m.authorId) : null;
              return (
                <div key={m.id} className={`flex gap-2 ${m.authorType === "player" ? "flex-row-reverse text-right" : ""}`}>
                  {speaker ? <Portrait src={speaker.portraitUrl} name={speaker.name} size={28} /> : null}
                  <p className="min-w-0 flex-1">
                    <span className="opacity-60">{m.authorName ?? "Someone"}: </span>
                    {m.body}
                  </p>
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
              placeholder={peopleHere.length ? `Say something to ${peopleHere.find((a) => a.id === effectiveAddressee)?.name ?? "them"}…` : "Find someone to talk to"}
              className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground dark:border-white/20"
              maxLength={2000}
            />
            <button type="submit" className={primary} disabled={busy !== null || !draft.trim() || !peopleHere.length}>
              {busy === "Speaking…" ? "…" : "Say"}
            </button>
          </form>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="objectives">
          <h2 id="objectives" className="text-sm font-medium uppercase tracking-wide opacity-60">
            Objectives · stage {state.stage.index + 1} of {state.stageCount}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {state.stage.objectives.map((o) => (
              <li key={o.id} className={o.met ? "opacity-60 line-through" : ""}>
                {o.met ? "✓ " : "○ "}
                {o.title}
              </li>
            ))}
          </ul>
          {state.journal.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer opacity-70">Journal ({state.journal.length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {state.journal.map((j) => (
                  <li key={j.id} className="flex gap-2 rounded border border-black/10 p-2 dark:border-white/15">
                    {state.evidenceImages[j.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
                      <img src={state.evidenceImages[j.id]} alt="" className="h-14 w-14 flex-none rounded object-cover" />
                    ) : null}
                    <div className="min-w-0">
                    <p>{j.text}</p>
                    {j.sourceSpan ? <p className="mt-1 text-xs opacity-60">{j.sourceSpan}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="decide">
          <h2 id="decide" className="text-sm font-medium uppercase tracking-wide opacity-60">
            Your decision
          </h2>
          <p className="text-xs opacity-60">
            {state.commitments.filter((c) => c.committed).length} of {state.commitments.length} have decided. Deciding ends the stage; there is no preview of what follows.
          </p>
          <ul className="flex flex-col gap-2">
            {state.options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={`${o.available ? primary : button} w-full justify-start text-left`}
                  disabled={!o.available || busy !== null}
                  title={o.available ? undefined : o.unavailableReason ?? undefined}
                  onClick={() => decide(o.id)}
                >
                  {o.label}
                  {!o.available ? <span className="ml-2 text-xs opacity-60">— {o.unavailableReason}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {notice ? (
          <p role="status" className="text-sm opacity-80">
            {notice}
          </p>
        ) : null}
        {busy ? (
          <p role="status" aria-live="polite" className="text-sm opacity-60">
            {busy}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
