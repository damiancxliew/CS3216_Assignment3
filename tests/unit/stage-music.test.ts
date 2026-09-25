import { beforeEach, describe, expect, it } from "vitest";

import { MUSIC_VOLUME, StageMusic, type MusicElement } from "@/lib/play/stage-music";

class FakeElement implements MusicElement {
  loop = false;
  volume = 1;
  muted = false;
  playing = false;
  plays = 0;

  constructor(readonly src: string) {}

  play() {
    this.playing = true;
    this.plays += 1;
  }

  pause() {
    this.playing = false;
  }
}

let timers: Array<{ handle: number; run: () => void }> = [];
let created: FakeElement[] = [];
let nextHandle = 1;

function player(): StageMusic {
  return new StageMusic({
    createElement: (src) => {
      const element = new FakeElement(src);
      created.push(element);
      return element;
    },
    setInterval: (handler) => {
      const handle = nextHandle++;
      timers.push({ handle, run: handler });
      return handle;
    },
    clearInterval: (handle) => {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
  });
}

/** Run every pending fade to completion. */
function settle(): void {
  for (let tick = 0; tick < 200 && timers.length > 0; tick += 1) {
    for (const timer of [...timers]) timer.run();
  }
}

function audible(): FakeElement[] {
  return created.filter((element) => element.playing && element.volume > 0);
}

beforeEach(() => {
  timers = [];
  created = [];
  nextHandle = 1;
});

describe("stage music", () => {
  it("leaves only the new track playing once a stage change has faded", () => {
    const music = player();
    music.play("/music/calm.ogg");
    settle();
    music.play("/music/tension.ogg");
    settle();

    expect(created.map((element) => element.src)).toEqual(["/music/calm.ogg", "/music/tension.ogg"]);
    expect(created[0]!.playing).toBe(false);
    expect(audible().map((element) => element.src)).toEqual(["/music/tension.ogg"]);
    expect(created[1]!.volume).toBeCloseTo(MUSIC_VOLUME);
  });

  it("stops the previous track even when stages follow each other mid-fade", () => {
    const music = player();
    music.play("/music/calm.ogg");
    music.play("/music/tension.ogg");
    music.play("/music/quiet.ogg");
    settle();

    expect(audible().map((element) => element.src)).toEqual(["/music/quiet.ogg"]);
    expect(created.filter((element) => element.playing)).toHaveLength(1);
  });

  it("does not restart the track when the same stage is re-rendered", () => {
    const music = player();
    music.play("/music/calm.ogg");
    settle();
    music.play("/music/calm.ogg");

    expect(created).toHaveLength(1);
    expect(created[0]!.plays).toBe(1);
    expect(created[0]!.volume).toBeCloseTo(MUSIC_VOLUME);
  });

  it("mutes what is playing and stops everything when the game is left", () => {
    const music = player();
    music.play("/music/calm.ogg");
    settle();
    music.setMuted(true);
    expect(created[0]!.muted).toBe(true);

    music.stop();
    expect(created.some((element) => element.playing)).toBe(false);
    expect(timers).toHaveLength(0);
  });
});

it("softens an ending that reuses the stage track without starting a second player", () => {
  const music = player();
  music.play("/music/peaceful.ogg");
  settle();
  music.play("/music/peaceful.ogg", 0.22);
  settle();
  expect(created).toHaveLength(1);
  expect(created[0].volume).toBeCloseTo(0.22);
  music.setMuted(true);
  expect(created[0].muted).toBe(true);
  music.stop();
  expect(audible()).toHaveLength(0);
});
