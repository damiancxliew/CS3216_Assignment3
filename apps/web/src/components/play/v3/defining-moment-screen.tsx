"use client";

import type { Action, PlayerView } from "@adventure/play-contract";

export function DefiningMomentScreen({
  view,
  busy,
  send,
}: {
  view: PlayerView;
  busy: boolean;
  send: (action: Action) => void;
}) {
  const moment = view.definingMoment;
  if (!moment) return null;

  const decider = moment.deciderName || "they";

  return (
    <section aria-labelledby="defining-moment-title" className="rounded-2xl border-2 border-signal bg-signal-wash p-5 sm:p-7">
      <p className="text-xs font-black uppercase tracking-widest text-signal">A defining moment</p>
      <h2 id="defining-moment-title" className="mt-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
        {moment.scene}
      </h2>
      {moment.nudge ? <p className="mt-3 text-sm leading-relaxed text-muted">{moment.nudge}</p> : null}

      {moment.status === "choosing" ? (
        <div className="mt-6 grid gap-3">
          {moment.acts.map((act) => (
            <button
              key={act.id}
              type="button"
              disabled={busy}
              onClick={() => send({ type: "act", actId: act.id })}
              className="min-h-20 rounded-2xl border-2 border-line-strong bg-surface px-5 py-5 text-left text-lg font-black leading-snug text-ink shadow-[0_3px_0_var(--line-strong)] hover:bg-world-wash disabled:opacity-50 sm:px-6"
            >
              {act.text}
            </button>
          ))}
        </div>
      ) : (
        <>
          {moment.reaction ? (
            <p className="mt-5 rounded-xl border border-line bg-surface p-4 text-base leading-relaxed text-ink">
              {moment.reaction}
            </p>
          ) : null}
          <h3 className="mt-6 text-xl font-black text-ink">What will {decider} decide?</h3>
          <div className="mt-3 grid gap-3">
            {moment.predictionOptions.map((option) => (
              <button
                key={option.outcomeId}
                type="button"
                disabled={busy}
                onClick={() => send({ type: "predict", outcomeId: option.outcomeId })}
                className="min-h-14 rounded-xl border border-line-strong bg-surface px-4 py-3 text-left font-bold leading-relaxed text-ink hover:bg-record-wash disabled:opacity-50"
              >
                {option.text}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
