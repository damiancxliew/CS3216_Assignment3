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
import { Pending, Spinner, Thinking } from "@/components/ui";
import type { PlayState } from "@/lib/play/session";

const MapCanvas = dynamic(() => import("./map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-world-wash" role="status">
      <span className="inline-flex items-center gap-2 rounded-control bg-surface px-4 py-2.5 text-base font-semibold text-ink">
        <Spinner /> Loading the map…
      </span>
    </div>
  ),
});

const POLL_MS = 8_000;
/** A failing server is not polled at the same rate: back off, and give up rather than pile on. */
const MAX_POLL_MS = 120_000;
const GIVE_UP_AFTER = 6;

/** A character's face: the generated portrait when the asset service has one, the pack's faceset otherwise (D4/D6). */
function Portrait({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const box = { width: size, height: size, minWidth: size, minHeight: size };
  if (!src) return <span className="inline-block shrink-0 self-start rounded-control bg-sunken" style={box} aria-hidden />;
  const pixel = src.startsWith("/game/");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- storage urls are dynamic and the facesets are tiny
    <img
      src={src}
      alt={`${name}'s portrait`}
      width={size}
      height={size}
      className="shrink-0 self-start rounded-control border border-line bg-[#e7d4a8] object-cover"
      style={{ ...box, imageRendering: pixel ? "pixelated" : undefined }}
    />
  );
}

const chip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-base font-semibold leading-tight text-ink transition-colors hover:border-ink disabled:opacity-60";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-base font-semibold leading-snug text-paper transition-colors hover:bg-record disabled:opacity-60";
const label = "text-sm font-semibold text-muted";

export function PlayClient({ attemptId, initialState }: { attemptId: string; initialState: PlayState }) {
  const [state, setState] = useState<PlayState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingSpeech, setPendingSpeech] = useState<{ id: string; roomId: string; body: string } | null>(null);
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
  }, [state.transcript.length, pendingSpeech?.id]);

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
    const roomId = state.currentRoomId;
    if (!body || !roomId || busy !== null) return;
    setDraft("");
    setPendingSpeech({ id: crypto.randomUUID(), roomId, body });
    setBusy("Speaking…");
    setNotice(null);
    try {
      const result = await playApi.message(attemptId, { roomId, body, addresseeId: effectiveAddressee });
      if (!result.ok) {
        setPendingSpeech(null);
        setDraft((current) => (current === "" ? body : current));
        setNotice(result.error.message);
        await refresh();
        return;
      }
      setPendingSpeech(null);
      accept(result.body.state);
    } catch (error) {
      setPendingSpeech(null);
      setDraft((current) => (current === "" ? body : current));
      setNotice(error instanceof Error ? error.message : "Could not send that message.");
    } finally {
      setBusy(null);
    }
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
      <section className="mx-auto my-10 flex w-full max-w-2xl flex-col gap-5 px-6">
        {/* The map (and its sound manager) is gone at the ending; the closing theme plays from here. */}
        {!muted ? <audio src="/game/ninja/audio/music/end-theme.ogg" autoPlay loop /> : null}
        <p className={label}>The end</p>
        <h2 className="font-serif text-4xl text-ink">{state.ending?.title ?? "The adventure is over"}</h2>
        {lastResolution ? <p className="text-lg leading-relaxed text-ink">{lastResolution}</p> : null}
        {state.ending ? <p className="text-lg leading-relaxed text-muted">{state.ending.summary}</p> : null}
        <Link href={`/play/${attemptId}/debrief`} className={`${primary} mt-2 w-fit min-h-12 px-6 text-lg`}>
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
      <section className="relative min-h-[55vh] flex-1 bg-sunken lg:min-h-0" aria-label="Map">
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
        <p className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-10rem)] rounded-control bg-ink/85 px-3.5 py-2 text-base font-semibold text-paper">
          Arrows or WASD to walk. Click a character to talk, or press Enter to talk to whoever is with you.
        </p>
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-control bg-ink/85 px-3.5 py-2 text-base font-semibold text-paper hover:bg-ink"
        >
          {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          {muted ? "Sound off" : "Sound on"}
        </button>
        {lastResolution ? (
          <div role="status" className="absolute left-3 right-3 top-3 mx-auto max-w-2xl rounded-surface border-l-[3px] border-world bg-surface p-5 text-ink shadow-xl">
            <p className="mb-2 text-base font-semibold text-world">What happened</p>
            <p className="text-lg leading-relaxed">{lastResolution}</p>
            <button type="button" className={`${primary} mt-4`} onClick={() => setLastResolution(null)}>
              Got it
            </button>
          </div>
        ) : null}
      </section>

      <aside className="flex min-h-0 w-full min-w-0 flex-col border-t border-line bg-paper text-base lg:w-[30rem] lg:border-l lg:border-t-0">
        {/* ── Top: where you are, where you can go ─────────────────────────── */}
        <section className="flex flex-col gap-3 border-b border-line px-5 py-4" aria-labelledby="where">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={label}>You are in</p>
              <h2 id="where" className="font-serif text-2xl leading-tight text-ink">
                {here ? here.name : "the open air"}
              </h2>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-lg font-semibold tabular-nums ${
                lowTime ? "animate-pulse border-signal bg-signal-wash text-ink" : "border-line bg-surface text-ink"
              }`}
              aria-label="Time left in this stage"
            >
              <Timer className="h-5 w-5" aria-hidden /> <StageCountdown attemptId={attemptId} deadlineIso={state.timer.deadlineAt} serverNowIso={state.timer.serverNow} />
            </span>
          </div>
          {here && state.roomImages[here.id] ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated landmark from storage
            <img src={state.roomImages[here.id]} alt={here.name} className="aspect-[3/1] w-full rounded-control border border-line object-cover" />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {state.rooms
              .filter((r) => r.id !== state.currentRoomId)
              .map((r) => (
                <button key={r.id} type="button" className={chip} disabled={busy !== null} onClick={() => setIntent({ kind: "room", roomId: r.id })}>
                  <ArrowRight className="h-4 w-4" aria-hidden /> {r.name}
                  {!r.doorOpen ? <Lock className="h-4 w-4 text-muted" aria-label="door closed" /> : null}
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
              <button type="button" className={`${primary} min-h-10 py-1.5 text-sm`} disabled={busy !== null} onClick={() => act("Knocking…", () => playApi.action(attemptId, { type: "knock", roomId: waitingAtDoor }))}>
                Knock on {state.rooms.find((r) => r.id === waitingAtDoor)?.name ?? "the door"}
              </button>
            ) : null}
          </div>
          {state.evidenceHere.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-l-[3px] border-world py-1 pl-3">
              <span className="text-base font-semibold text-world">Look at</span>
              {state.evidenceHere.map((item) => (
                <button key={item.id} type="button" className={chip} disabled={busy !== null} onClick={() => act("Examining…", () => playApi.action(attemptId, { type: "inspect", evidenceId: item.id }))}>
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
                    className={`flex min-w-0 shrink-0 items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors ${
                      active ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink"
                    }`}
                  >
                    <Portrait src={a.portraitUrl} name={a.name} size={40} />
                    <span className="min-w-0 leading-tight">
                      <span className="block text-base font-semibold">{a.name}</span>
                      {a.role ? <span className={`block max-w-[14rem] truncate text-sm ${active ? "text-paper/85" : "text-muted"}`}>{a.role}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p id="talk" className="px-5 pt-4 text-base text-ink">
              {here ? "Nobody is here right now. Try another building, or wait and see who comes in." : "Walk into a building to find someone to talk to."}
            </p>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" role="log" aria-live="polite" aria-label="Conversation">
            {state.transcript.length === 0 && pendingSpeech === null ? (
              <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
                <p className="font-serif text-xl text-ink">Nothing has been said yet</p>
                <p className="text-base leading-relaxed text-muted">
                  {talkingTo
                    ? `Ask ${talkingTo.name} a question. Hearing what they think is how you complete a goal about them.`
                    : "Find someone and ask them a question. Your goals below say who is worth talking to."}
                </p>
              </div>
            ) : null}
            {state.transcript.map((m) => {
              const speaker = m.authorType === "agent" ? state.agents.find((a) => a.id === m.authorId) : null;
              const mine = m.authorType === "player";
              return (
                <div key={m.id} className={`flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  {speaker ? <Portrait src={speaker.portraitUrl} name={speaker.name} size={36} /> : null}
                  <div className={`min-w-0 max-w-[85%] rounded-surface px-4 py-2.5 leading-relaxed ${mine ? "rounded-tr-sm bg-ink text-paper" : "rounded-tl-sm bg-surface text-ink"}`}>
                    {!mine ? <p className="text-sm font-semibold text-muted">{m.authorName ?? "Someone"}</p> : null}
                    <p>{m.body}</p>
                  </div>
                </div>
              );
            })}
            {pendingSpeech ? (
              <div key={pendingSpeech.id} className="flex flex-row-reverse items-start gap-2.5">
                <div className="min-w-0 max-w-[85%] rounded-surface rounded-tr-sm bg-ink px-4 py-2.5 leading-relaxed text-paper">
                  <p>{pendingSpeech.body}</p>
                </div>
              </div>
            ) : null}
            {busy === "Speaking…" ? <div className="px-2"><Thinking label={`${talkingTo?.name ?? "They"} is thinking`} /></div> : null}
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
              className="min-h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 py-2 text-base text-ink placeholder:text-muted focus:border-record focus:outline-none disabled:opacity-60"
              maxLength={2000}
            />
            <button type="submit" className={`${primary} min-h-12`} disabled={busy !== null || !draft.trim() || !peopleHere.length}>
              {busy === "Speaking…" ? <Pending>Saying it</Pending> : "Say it"}
            </button>
          </form>
        </section>

        {/* ── Bottom, always visible: goals + the decision ─────────────────── */}
        <section className="flex flex-col gap-3 border-t border-line bg-sunken/60 px-5 py-4" aria-labelledby="decide">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base text-ink">
              <span className="font-semibold">Goals {goalsMet} of {goalsTotal}</span>
              <span className="ml-3 text-muted">Stage {state.stage.index + 1} of {state.stageCount}</span>
            </p>
            {state.journal.length ? (
              <button type="button" className="text-base font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-ink" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}>
                Notes ({state.journal.length})
              </button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1.5">
            {state.stage.objectives.map((o) => (
              <li key={o.id} className={`flex items-start gap-2.5 text-base leading-snug ${o.met ? "text-muted" : "font-semibold text-ink"}`}>
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${o.met ? "border-world bg-world text-paper" : "border-line-strong"}`}
                >
                  {o.met ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className={o.met ? "line-through" : ""}>{o.title}</span>
                  {!o.met && state.objectiveHints[o.id] ? (
                    <span className="flex items-start gap-1 text-sm font-normal text-muted">
                      <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {state.objectiveHints[o.id]}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">{o.met ? "done" : "not yet"}</span>
              </li>
            ))}
          </ul>
          {notesOpen && state.journal.length ? (
            <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto border-l-[3px] border-world pl-3">
              {state.journal.map((j) => (
                <li key={j.id} className="flex gap-3 rounded-control bg-surface p-3 text-base leading-relaxed text-ink">
                  {state.evidenceImages[j.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- generated prop from storage
                    <img src={state.evidenceImages[j.id]} alt="" className="h-14 w-14 flex-none rounded-control object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p>{j.text}</p>
                    {j.sourceSpan ? <p className="mt-1 font-serif text-base italic text-record">{j.sourceSpan}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {canDecide ? (
            <div className="flex flex-col gap-2 rounded-surface border border-signal bg-signal-wash p-3">
              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
                <span id="decide" className="font-serif text-xl text-ink">
                  You can decide now
                </span>
                <span className="text-base text-muted">
                  {decided} of {state.commitments.length} decided. {decisionOpen ? "Hide" : "Show"}
                </span>
              </button>
              {decisionOpen ? (
                <>
                  <p className="text-base leading-snug text-ink">This ends the stage. There is no going back.</p>
                  <ul className="flex flex-col gap-2">
                    {state.options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className={`${o.available ? primary : chip} w-full flex-col items-start gap-0.5 text-left ${o.available ? "" : "min-h-11"}`}
                          disabled={!o.available || busy !== null}
                          onClick={() => decide(o.id)}
                        >
                          <span className="leading-snug">{o.label}</span>
                          {!o.available ? (
                            <span className="inline-flex items-center gap-1 text-sm font-normal text-muted">
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
            <button type="button" className="flex w-full items-center justify-between rounded-control border border-dashed border-line-strong px-3 py-2.5 text-left hover:border-ink" onClick={() => setDecisionOpen((v) => !v)} aria-expanded={decisionOpen}>
              <span id="decide" className="inline-flex items-center gap-2 text-base font-semibold text-muted">
                <Lock className="h-4 w-4" aria-hidden /> Decision locked. Finish your goals first.
              </span>
              <span className="text-sm text-muted">{decisionOpen ? "Hide" : "See choices"}</span>
            </button>
          )}
          {!canDecide && decisionOpen ? (
            <ul className="flex flex-col gap-1.5 text-base leading-snug text-muted">
              {state.options.map((o) => (
                <li key={o.id} className="rounded-control bg-surface px-3 py-2">
                  {o.label}
                  {o.unavailableReason ? <span className="block text-sm">{o.unavailableReason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {notice ? (
            <p role="status" className="rounded-control border border-signal bg-signal-wash px-3.5 py-2.5 text-base leading-snug text-ink">
              {notice}
            </p>
          ) : null}
          {busy && busy !== "Speaking…" ? (
            <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-base text-muted">
              <Spinner /> {busy}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
