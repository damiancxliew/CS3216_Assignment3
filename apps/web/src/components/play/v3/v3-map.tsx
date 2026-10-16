"use client";

import { canStep, findPath, spaceAt, type Point } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { MapView } from "@adventure/game-client/view";
import type { PlayerView } from "@adventure/play-contract";
import { useEffect, useRef, useState } from "react";

import { ASSET_BASE, characterFor, PLAYER_CHARACTER, walkSheetUrl } from "@/lib/play/appearance";
import { compileV3StageMap, roomIdToEnter, seatIn, v3DocumentProps } from "@/lib/play/v3/map";

const STEP_MS = 160;

const KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
};

type V3Room = PlayerView["rooms"][number];
type V3Character = PlayerView["characters"][number];

interface V3MapProps {
  attemptId: string;
  stageId: string;
  stageIndex: number;
  rooms: V3Room[];
  spawnRoomId: string;
  currentRoomId: string | null;
  characters: V3Character[];
  documents: PlayerView["documentsHere"];
  walkTo: string | null;
  onWalkDone: () => void;
  onEnterRoom: (roomId: string) => Promise<boolean>;
  onSelectCharacter: (characterId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onReadyChange: (ready: boolean) => void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

export function V3Map(props: V3MapProps) {
  const host = useRef<HTMLDivElement>(null);
  const currentRoomRef = useRef(props.currentRoomId);
  const renderRef = useRef<(() => void) | null>(null);
  const walkToHandler = useRef<(roomId: string | null) => void>(() => {});
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);
  const [compiled] = useState(() => compileV3StageMap(
    props.attemptId,
    props.stageId,
    props.stageIndex,
    props.rooms,
    props.spawnRoomId,
  ));
  const map = compiled.map;

  useEffect(() => {
    currentRoomRef.current = props.currentRoomId;
    renderRef.current?.();
  }, [props.currentRoomId, props.characters, props.documents]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const controller = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const held = new Map<string, Point>();
    let destroyed = false;
    let view: MapView | null = null;
    let playerPosition = seatIn(map, latest.current.currentRoomId, 0) ?? compiled.playerSpawn;
    let path: Point[] = [];
    let revision = 0;
    let facing: "down" | "up" | "left" | "right" = "down";
    let transitioning = false;
    let repeat: number | undefined;
    let lastWalkTo: string | null = null;

    const snapshot = (): PlaygroundSnapshot => ({
      seed: `${latest.current.attemptId}:${latest.current.stageId}`,
      map,
      doors: compiled.initialDoors,
      actors: [
        {
          id: "player",
          name: "You",
          position: playerPosition,
          space: spaceAt(map, playerPosition),
          targetRoomId: null,
          status: path.length ? "moving" : "idle",
          sprite: PLAYER_CHARACTER,
          facing,
        },
        ...latest.current.characters.flatMap((character, index) => {
          const position = seatIn(map, currentRoomRef.current, index + 1);
          if (!position || spaceAt(map, position)?.kind !== "room") return [];
          const sprite = characterFor({ id: character.id, name: character.name, role: character.title });
          return [{
            id: character.id,
            name: character.name,
            position,
            space: spaceAt(map, position),
            targetRoomId: null,
            status: "idle" as const,
            spriteSheetUrl: walkSheetUrl(sprite),
          }];
        }),
      ],
      props: v3DocumentProps(map, currentRoomRef.current, latest.current.documents, latest.current.characters.length + 1),
      playerGoal: path.length ? { kind: "point", point: path[path.length - 1]! } : null,
      playerStatus: path.length ? "moving" : "idle",
      running: true,
      npcRoutes: false,
      roomWandering: false,
      revision,
      roomNames: Object.fromEntries(latest.current.rooms.map((room) => [room.id, room.name])),
    });
    const render = () => view?.render(snapshot());
    renderRef.current = render;
    const finishWalk = () => {
      if (path.length === 0) latest.current.onWalkDone();
    };

    const goTo = (target: Point) => {
      const found = findPath(map, compiled.initialDoors, playerPosition, target);
      path = found
        ? found[0]?.x === playerPosition.x && found[0]?.y === playerPosition.y
          ? found.slice(1)
          : found
        : [];
      revision += 1;
      render();
      if (!found || path.length === 0) latest.current.onWalkDone();
    };

    const goToRoom = (roomId: string) => {
      const room = map.rooms.find((candidate) => candidate.id === roomId);
      if (!room) {
        latest.current.onWalkDone();
        return;
      }
      goTo({ x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) });
    };

    const stepTo = async (next: Point) => {
      if (destroyed || transitioning) return;
      const from = playerPosition;
      if (!canStep(map, compiled.initialDoors, from, next)) {
        path = [];
        revision += 1;
        render();
        finishWalk();
        return;
      }
      const dx = next.x - from.x;
      const dy = next.y - from.y;
      facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      playerPosition = next;
      if (path[0]?.x === next.x && path[0]?.y === next.y) path.shift();
      revision += 1;
      render();

      const roomId = roomIdToEnter(map, next, currentRoomRef.current);
      if (roomId) {
        transitioning = true;
        let accepted = false;
        try {
          accepted = await latest.current.onEnterRoom(roomId);
        } catch {
          accepted = false;
        }
        if (destroyed) return;
        if (accepted) {
          currentRoomRef.current = roomId;
        } else {
          path = [];
          playerPosition = seatIn(map, currentRoomRef.current, 0) ?? compiled.playerSpawn;
        }
        transitioning = false;
        revision += 1;
        render();
      }
      finishWalk();
    };

    const walk = window.setInterval(() => {
      if (document.visibilityState !== "visible" || transitioning || path.length === 0) return;
      void stepTo(path[0]!);
    }, STEP_MS);

    const clearHeld = () => {
      held.clear();
      if (repeat !== undefined) {
        window.clearInterval(repeat);
        repeat = undefined;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const delta = KEYS[key];
      if (!delta) return;
      event.preventDefault();
      if (event.repeat || held.has(event.code || key)) return;
      held.set(event.code || key, delta);
      path = [];
      latest.current.onWalkDone();
      void stepTo({ x: playerPosition.x + delta.x, y: playerPosition.y + delta.y });
      if (repeat === undefined) {
        repeat = window.setInterval(() => {
          const direction = [...held.values()].at(-1);
          if (!direction || document.visibilityState !== "visible") return;
          void stepTo({ x: playerPosition.x + direction.x, y: playerPosition.y + direction.y });
        }, STEP_MS);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      held.delete(event.code || key);
      if (held.size === 0) clearHeld();
    };

    const onDestination = (point: Point) => {
      latest.current.onWalkDone();
      goTo(point);
    };

    walkToHandler.current = (roomId) => {
      if (roomId === lastWalkTo) return;
      lastWalkTo = roomId;
      if (roomId) goToRoom(roomId);
    };

    void (async () => {
      try {
        const { createTiledMapView } = await import("@adventure/game-client/tiled-view");
        if (destroyed) return;
        view = await createTiledMapView(parent, snapshot(), onDestination, reducedMotion.matches, {
          assetBase: ASSET_BASE,
          themeBase: "/game/themes",
          defaultSprite: "Villager",
          clickToWalk: true,
          onActor: (actorId) => {
            if (latest.current.characters.some((character) => character.id === actorId)) {
              latest.current.onSelectCharacter(actorId);
            }
          },
          onProp: (documentId) => {
            if (latest.current.documents.some((document) => document.id === documentId)) {
              latest.current.onOpenDocument(documentId);
            }
          },
          camera: "detail",
          zoomScale: window.matchMedia("(min-width: 1024px)").matches ? 0.75 : 1,
        });
        if (destroyed) {
          view.destroy();
          return;
        }
        render();
        latest.current.onReadyChange(true);
        const canvas = parent.querySelector("canvas");
        canvas?.setAttribute("tabindex", "0");
        canvas?.setAttribute("aria-label", "Walkable map. Use arrow keys or WASD to move.");
        document.addEventListener("keydown", onKeyDown, { signal: controller.signal });
        document.addEventListener("keyup", onKeyUp, { signal: controller.signal });
        window.addEventListener("blur", clearHeld, { signal: controller.signal });
        document.addEventListener("visibilitychange", clearHeld, { signal: controller.signal });
        reducedMotion.addEventListener("change", (event) => view?.setReducedMotion(event.matches), { signal: controller.signal });
        walkToHandler.current(latest.current.walkTo);
      } catch {
        if (destroyed) return;
        latest.current.onReadyChange(false);
        setFailed(true);
        parent.replaceChildren();
      }
    })();

    return () => {
      destroyed = true;
      renderRef.current = null;
      walkToHandler.current = () => {};
      latest.current.onReadyChange(false);
      controller.abort();
      clearHeld();
      window.clearInterval(walk);
      view?.destroy();
      parent.replaceChildren();
    };
  }, [compiled, map]);

  useEffect(() => {
    walkToHandler.current(props.walkTo);
  }, [props.walkTo]);

  if (failed) return null;
  return (
    <div
      ref={host}
      role="img"
      aria-label="Walkable stage map"
      className="absolute inset-0 overflow-hidden"
    />
  );
}
