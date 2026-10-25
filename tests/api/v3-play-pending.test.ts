import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerView } from "@adventure/play-contract";
import type { V3PlayResult } from "@/lib/play/v3/client";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const slot = hooks.states.length;
    hooks.states.push(initial);
    return [initial, (next: unknown) => {
      hooks.states[slot] = typeof next === "function" ? next(hooks.states[slot]) : next;
    }];
  },
}));

import { useV3Play } from "@/components/play/v3/use-v3-play";

const view = { phase: "stage", timer: { remainingMs: 60_000 }, messages: [], pendingCheck: false } as unknown as PlayerView;

function setup() {
  hooks.states.length = 0;
  hooks.effects.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout });
  vi.stubGlobal("document", { visibilityState: "visible" });
  const pending: ((result: V3PlayResult) => void)[] = [];
  const act = vi.fn(() => new Promise<V3PlayResult>((resolve) => pending.push(resolve)));
  const play = useV3Play("attempt-1", view, 1, () => ({ act, refresh: vi.fn() }));
  const cleanup = hooks.effects[0]!();
  return {
    play, act,
    busy: () => hooks.states[2],
    currentView: () => hooks.states[0] as PlayerView,
    finish: async (revision: number) => {
      pending.shift()!({ ok: true, revision, view });
      await Promise.resolve();
    },
    cleanup,
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("gameplay pending actions", () => {
  it("does not mark chat as sending during an automatic timer update", async () => {
    const game = setup();
    vi.advanceTimersByTime(15_000);
    expect(game.act).toHaveBeenCalledWith(1, { type: "tick" });
    expect(game.busy()).toBe(false);
    expect(game.currentView().messages).toEqual([]);
    await game.finish(2);
    expect(game.busy()).toBe(false);
    game.cleanup?.();
  });

  it("keeps a message queued behind a timer update pending until it is sent", async () => {
    const game = setup();
    vi.advanceTimersByTime(15_000);
    const action = { type: "message", characterId: "character-1", text: "Why here?" } as const;
    const settled = vi.fn();
    game.play.send(action, settled);
    expect(game.busy()).toBe(true);
    expect(game.currentView().messages.at(-1)?.text).toBe("Why here?");
    expect(game.act).toHaveBeenCalledTimes(1);
    await game.finish(2);
    expect(game.act).toHaveBeenLastCalledWith(2, action);
    expect(game.busy()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    await game.finish(3);
    expect(settled).toHaveBeenCalledWith(true);
    expect(game.busy()).toBe(false);
    game.cleanup?.();
  });
});
