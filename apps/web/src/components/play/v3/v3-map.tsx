"use client";

import { canStep, findPath, spaceAt, type Point } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { MapView } from "@adventure/game-client/view";
import type { PlayerView } from "@adventure/play-contract";
import { useEffect, useRef, useState } from "react";

import { ASSET_BASE, characterFor, PLAYER_CHARACTER, walkSheetUrl, type Character } from "@/lib/play/appearance";
import {
  arrivalPoint,
  compileV3StageMap,
  nearbyCharacterId,
  roomIdToEnter,
  seatIn,
  unreadDocumentAt,
  v3DocumentProps,
} from "@/lib/play/v3/map";

import { v3Atmosphere, v3Environment, v3RoomFixtures, type V3StageScenery } from "@/lib/play/v3/scenery";
import { V3ScrollDialog } from "./scroll-dialog";

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
  destination?: Point | null;
  onArrive?: (point: Point) => void;
  onInspectLandmark?: (id: string, walkTo: (point: Point) => void) => boolean;
  crowdContext?: string;
  attemptId: string;
  stageId: string;
  stageIndex: number;
  rooms: V3Room[];
  scenery?: V3StageScenery;
  spawnRoomId: string;
  currentRoomId: string | null;
  characters: V3Character[];
  documents: PlayerView["documentsHere"];
  walkTo: string | null;
  movementLocked: boolean;
  onWalkDone: () => void;
  onEnterRoom: (roomId: string) => Promise<boolean>;
  onSelectCharacter: (characterId: string) => void;
  onTalk: (characterId: string) => void;
  onNearbyCharacterChange: (characterId: string | null) => void;
  onOpenDocument: (documentId: string) => void;
  ambient: NonNullable<PlaygroundSnapshot["ambient"]>;
  audio: NonNullable<PlaygroundSnapshot["audio"]>;
  onReadyChange: (ready: boolean) => void;
}

export function v3AudioSnapshot(
  ambient: NonNullable<PlaygroundSnapshot["ambient"]>,
  audio: NonNullable<PlaygroundSnapshot["audio"]>,
  scenery?: V3StageScenery,
): Pick<PlaygroundSnapshot, "ambient" | "audio"> {
  // Keep stage atmosphere, enriching a clear fallback with the public room setting.
  const atmosphere = ambient.id === "clear" && scenery
    ? v3Atmosphere(`${scenery.storyContext} ${Object.values(scenery.roomDescriptions).join(" ")}`)
    : ambient;
  return { ambient: atmosphere, audio };
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isMovementTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest("button"));
}

/** Explicit versioned choices take precedence; standalone scenes keep their authored sheets. */
function walkingActor(scenery: V3StageScenery | undefined, key: string, fallback: Character, authoredSheet?: string) {
  const selected = scenery?.walkingSprites?.[key];
  if (selected && selected.selection !== "default")
    return { sprite: selected.sprite, spriteSheetUrl: selected.spriteSheetUrl };
  return { sprite: selected?.sprite ?? fallback, spriteSheetUrl: authoredSheet ?? selected?.spriteSheetUrl ?? walkSheetUrl(fallback) };
}

export function V3Map(props: V3MapProps) {
  const [inspection, setInspection] = useState<{ name: string; description: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const currentRoomRef = useRef(props.currentRoomId);
  const renderRef = useRef<(() => void) | null>(null);
  const destinationHandler = useRef<(point: Point) => void>(() => {});
  const walkToHandler = useRef<(roomId: string | null) => void>(() => {});
  const nearbyChangeHandler = useRef<() => void>(() => {});
  const movementLockHandler = useRef<() => void>(() => {});
  const latest = useRef(props);
  latest.current = { ...props, movementLocked: props.movementLocked || inspection !== null };
  const [failed, setFailed] = useState(false);
  const [compiled] = useState(() => compileV3StageMap(
    props.attemptId,
    props.stageId,
    props.stageIndex,
    props.rooms,
    props.spawnRoomId,
    props.scenery,
  ));
  const map = compiled.map;

  useEffect(() => {
    if (props.destination) destinationHandler.current(props.destination);
  }, [props.destination]);

  useEffect(() => {
    currentRoomRef.current = props.currentRoomId;
    if (latest.current.movementLocked) movementLockHandler.current();
    renderRef.current?.();
    nearbyChangeHandler.current();
  }, [props.currentRoomId, props.characters, props.documents, props.movementLocked, props.ambient, props.audio, props.scenery, inspection]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const controller = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const held = new Map<string, Point>();
    let destroyed = false;
    let view: MapView | null = null;
    let playerPosition = latest.current.scenery?.authored?.spawnAtEntrance ? compiled.playerSpawn : arrivalPoint(map, latest.current.currentRoomId) ?? compiled.playerSpawn;
    let path: Point[] = [];
    let revision = 0;
    let facing: "down" | "up" | "left" | "right" = "down";
    let transitioning: string | null = null;
    let autoOpenedAt: string | null = null;
    let repeat: number | undefined;
    let lastWalkTo: string | null = null;
    let lastNearbyCharacterId: string | null | undefined;

    const characterSeats = () => transitioning ? [] : latest.current.characters.flatMap((character, index) => {
      const position = seatIn(map, currentRoomRef.current, index + 1);
      const space = position && spaceAt(map, position);
      if (!position || (space?.kind !== "room" && !(space?.kind === "outdoor" && space.locationId))) return [];
      return [{ id: character.id, position, character }];
    });

    const documentProps = () => transitioning ? [] : v3DocumentProps(
      map,
      currentRoomRef.current,
      latest.current.documents,
      latest.current.characters.length + 1,
    );

    const updateNearbyCharacter = () => {
      const characterId = nearbyCharacterId(playerPosition, facing, characterSeats());
      if (characterId === lastNearbyCharacterId) return;
      lastNearbyCharacterId = characterId;
      latest.current.onNearbyCharacterChange(characterId);
    };

    const snapshot = (): PlaygroundSnapshot => ({
      seed: `${latest.current.attemptId}:${latest.current.stageId}`,
      crowdContext: latest.current.scenery?.authored ? undefined : latest.current.crowdContext,
      streetTalk: latest.current.scenery?.authored?.streetTalk,
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
          ...walkingActor(latest.current.scenery, "player", PLAYER_CHARACTER, latest.current.scenery?.authored?.playerSheet),
          facing,
        },
        ...(latest.current.scenery?.authored?.cast ?? []).filter(character => character.roomId !== currentRoomRef.current).flatMap(character => {
          const position = seatIn(map, character.roomId, 1);
          return position ? [{ id: character.id, name: character.name, position,
            space: spaceAt(map, position), targetRoomId: null, status: "idle" as const,
            ...walkingActor(latest.current.scenery, `character:${character.id}`, characterFor({ id: character.id, name: character.name }), latest.current.scenery?.authored?.characterSheets?.[character.id]),
            interactive: !latest.current.movementLocked,
          }] : [];
        }),
        ...characterSeats().map(({ character, position }) => {
          const sprite = characterFor({ id: character.id, name: character.name, role: character.title });
          return {
            id: character.id,
            name: character.name,
            position,
            space: spaceAt(map, position),
            targetRoomId: null,
            status: "idle" as const,
            ...walkingActor(latest.current.scenery, `character:${character.id}`, sprite, latest.current.scenery?.authored?.characterSheets?.[character.id]),
            // While locked (a conversation, the defining moment, an end screen's backdrop) nobody offers "Talk".
            ...(latest.current.movementLocked ? { interactive: false } : {}),
          };
        }),
      ],
      props: documentProps(),
      playerGoal: path.length ? { kind: "point", point: path[path.length - 1]! } : null,
      playerStatus: path.length ? "moving" : "idle",
      running: true,
      npcRoutes: false,
      roomWandering: false,
      environment: v3Environment(latest.current.scenery),
      visualStyle: latest.current.scenery?.authored?.style,
      roomKinds: latest.current.scenery?.authored?.roomKinds,
      interactionLabels: latest.current.scenery?.authored?.interactionLabels,
      revision,
      roomDescriptions: latest.current.scenery?.roomDescriptions,
      storyContext: latest.current.scenery?.storyContext,
      landmarks: v3RoomFixtures(map, latest.current.scenery),
      roomNames: Object.fromEntries(latest.current.rooms.map((room) => [room.id, room.name])),
      ...v3AudioSnapshot(latest.current.ambient, latest.current.audio, latest.current.scenery),
    });
    const render = () => view?.render(snapshot());
    renderRef.current = render;
    const finishWalk = () => {
      if (path.length === 0) latest.current.onWalkDone();
    };

    const goTo = (target: Point) => {
      if (latest.current.movementLocked) return;
      const found = findPath(map, compiled.initialDoors, playerPosition, target);
      path = found
        ? found[0]?.x === playerPosition.x && found[0]?.y === playerPosition.y
          ? found.slice(1)
          : found
        : [];
      revision += 1;
      render();
      if (!found || path.length === 0) {
        latest.current.onWalkDone();
        if (found) latest.current.onArrive?.(playerPosition);
      }
    };

    destinationHandler.current = goTo;

    const goToRoom = (roomId: string) => {
      const room = map.rooms.find((candidate) => candidate.id === roomId);
      if (!room) {
        latest.current.onWalkDone();
        return;
      }
      goTo({ x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) });
    };

    const stepTo = async (next: Point) => {
      if (destroyed) return;
      if (latest.current.movementLocked) return;
      // Keep walking inside the destination while its room action is in flight.
      // Crossing another boundary waits for confirmation so room actions stay ordered.
      if (transitioning) {
        const space = spaceAt(map, next);
        if (space?.kind !== "room" || space.roomId !== transitioning) return;
      }
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
      updateNearbyCharacter();
      render();

      const roomId = transitioning ? null : roomIdToEnter(map, next, currentRoomRef.current);
      if (roomId) {
        autoOpenedAt = null;
        transitioning = roomId;
        updateNearbyCharacter();
        render();
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
          playerPosition = arrivalPoint(map, currentRoomRef.current) ?? compiled.playerSpawn;
        }
        transitioning = null;
        revision += 1;
        updateNearbyCharacter();
        render();
      } else if (!transitioning && !latest.current.movementLocked && !latest.current.destination) {
        const documentId = unreadDocumentAt(documentProps(), next);
        if (documentId === null) {
          autoOpenedAt = null;
        } else {
          const key = `${documentId}:${next.x},${next.y}`;
          if (key !== autoOpenedAt && latest.current.documents.some((document) => document.id === documentId)) {
            autoOpenedAt = key;
            latest.current.onOpenDocument(documentId);
          }
        }
      }
      latest.current.onArrive?.(playerPosition);
      finishWalk();
    };

    const walk = window.setInterval(() => {
      if (document.visibilityState !== "visible" || latest.current.movementLocked || path.length === 0) return;
      void stepTo(path[0]!);
    }, STEP_MS);

    const clearHeld = () => {
      held.clear();
      if (repeat !== undefined) {
        window.clearInterval(repeat);
        repeat = undefined;
      }
    };

    movementLockHandler.current = () => {
      if (path.length === 0 && held.size === 0 && repeat === undefined) return;
      path = [];
      clearHeld();
      revision += 1;
      render();
      latest.current.onWalkDone();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (latest.current.movementLocked) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "e") {
        if (transitioning) return;
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const characterId = nearbyCharacterId(playerPosition, facing, characterSeats());
        if (characterId) {
          event.preventDefault();
          latest.current.onTalk(characterId);
        } else if (view?.greetNearby?.()) {
          event.preventDefault();
        }
        return;
      }
      if (isMovementTarget(event.target)) return;
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
      if (latest.current.movementLocked) return;
      latest.current.onWalkDone();
      goTo(point);
    };

    walkToHandler.current = (roomId) => {
      if (latest.current.movementLocked) return;
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
            if (transitioning) return;
            if (latest.current.characters.some((character) => character.id === actorId)) {
              latest.current.onSelectCharacter(actorId);
            } else {
              const person = latest.current.scenery?.authored?.cast?.find(character => character.id === actorId);
              if (person) goToRoom(person.roomId);
            }
          },
          onProp: (documentId) => {
            if (transitioning) return;
            if (latest.current.documents.some((document) => document.id === documentId)) {
              latest.current.onOpenDocument(documentId);
            }
          },
          ...(latest.current.scenery?.authored ? {
            onLandmark: (id: string) => {
              if (latest.current.movementLocked) return;
              if (latest.current.onInspectLandmark?.(id, goTo)) return;
              const fixture = latest.current.scenery?.authored?.fixtures.find(item => item.id === id);
              if (fixture?.description) setInspection({ name: fixture.name, description: fixture.description });
            },
          } : {}),
          onRoomPointer: (roomId) => {
            if (latest.current.movementLocked) return;
            latest.current.onWalkDone();
            goToRoom(roomId);
          },
          camera: window.matchMedia("(min-width: 1024px)").matches ? latest.current.scenery?.authored?.desktopCamera ?? "detail" : "detail",
          zoomScale: window.matchMedia("(min-width: 1024px)").matches ? (latest.current.scenery?.authored ? 0.5 : 0.75) : 1,
        });
        if (destroyed) {
          view.destroy();
          return;
        }
        render();
        nearbyChangeHandler.current = updateNearbyCharacter;
        if (latest.current.movementLocked) movementLockHandler.current();
        else if (latest.current.destination) goTo(latest.current.destination);
        updateNearbyCharacter();
        latest.current.onReadyChange(true);
        const canvas = parent.querySelector("canvas");
        canvas?.setAttribute("tabindex", "0");
        canvas?.setAttribute("aria-label", "Walkable map. Use arrow keys or WASD to move, and E to talk.");
        document.addEventListener("keydown", onKeyDown, { signal: controller.signal });
        document.addEventListener("keyup", onKeyUp, { signal: controller.signal });
        window.addEventListener("blur", clearHeld, { signal: controller.signal });
        document.addEventListener("visibilitychange", clearHeld, { signal: controller.signal });
        reducedMotion.addEventListener("change", (event) => view?.setReducedMotion(event.matches), { signal: controller.signal });
        walkToHandler.current(latest.current.walkTo);
      } catch (error) {
        if (destroyed) return;
        console.error("Stage map could not load", error);
        latest.current.onReadyChange(false);
        setFailed(true);
        parent.replaceChildren();
      }
    })();

    return () => {
      destroyed = true;
      renderRef.current = null;
      walkToHandler.current = () => {};
      nearbyChangeHandler.current = () => {};
      movementLockHandler.current = () => {};
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
  }, [props.walkTo, props.movementLocked]);

  if (failed) return null;
  return (
    <>
      <div
        ref={host}
        role="img"
        aria-label="Walkable stage map"
        className="absolute inset-0 overflow-hidden"
      />
      {inspection && (
        <V3ScrollDialog
          title={inspection.name}
          eyebrow="Explore the setting"
          footerText="Look around, then compare the sources."
          closeLabel="Return to the map"
          onClose={() => setInspection(null)}
        >
          <p className="whitespace-pre-line">{inspection.description}</p>
          <p className="mt-4 text-sm opacity-70">
            Illustrated reconstruction. This prop is not an archival object or evidence that Lim used this exact item.
            Consult the Source archive for historical records.
          </p>
        </V3ScrollDialog>
      )}
    </>
  );
}
