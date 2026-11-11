"use client";

import { canStep, findPath, spaceAt, type Point } from "@adventure/game-core";
import type { PlaygroundSnapshot } from "@adventure/game-client";
import type { MapView } from "@adventure/game-client/view";
import type { PlayerView } from "@adventure/play-contract";
import { useEffect, useId, useRef, useState } from "react";

import { ASSET_BASE, characterFor, PLAYER_CHARACTER, walkSheetUrl, type Character } from "@/lib/play/appearance";
import {
  arrivalPoint,
  compileV3StageMap,
  createHeldKeyMover,
  createRoomEntrySync,
  nearbyCharacterId,
  placeAt,
  seatIn,
  unreadDocumentAt,
  v3DocumentProps,
} from "@/lib/play/v3/map";

import { v3Atmosphere, v3Environment, v3RoomFixtures, type V3StageScenery } from "@/lib/play/v3/scenery";
import { AdventureDialog } from "../adventure-dialog";
import styles from "../adventure-chrome.module.css";
import { pixelFont } from "./pixel-font";

const STEP_MS = 160;
/** How long a movement key must stay down before it auto-repeats, so a slightly long tap is still one tile. */
const KEY_REPEAT_DELAY_MS = 240;
/** The loading curtain's fade, matching its CSS transition. */
const CURTAIN_FADE_MS = 450;

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
type V3Documents = PlayerView["documentsHere"];

export type V3MapGuideTarget = { kind: "character" | "document" | "room"; id: string };

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
  /** Characters to mark with a "!" bubble: essential conversations the student hasn't finished. */
  attentionIds?: readonly string[];
  /** The next thing to go to: a bouncing gold marker over an on-screen character or document here, or the room's
   * label / edge pointer for a room. A character or document that is not on this map shows nothing. */
  guideTarget?: V3MapGuideTarget | null;
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

let tiledViewChunk: Promise<typeof import("@adventure/game-client/tiled-view")> | null = null;

/** Loads the Phaser renderer chunk once; later calls (and the map itself) reuse the same request. */
function loadTiledView() {
  tiledViewChunk ??= import("@adventure/game-client/tiled-view").catch((error: unknown) => {
    tiledViewChunk = null;
    throw error;
  });
  return tiledViewChunk;
}

/** Warm the map renderer during intro screens so the stage map appears without a blank wait. */
export function preloadV3Map(): void {
  if (typeof window === "undefined") return;
  void loadTiledView().catch(() => {});
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
  const inspectionTitleId = useId();
  const [inspection, setInspection] = useState<{ name: string; description: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const destinationHandler = useRef<(point: Point) => void>(() => {});
  const walkToHandler = useRef<(roomId: string | null) => void>(() => {});
  const nearbyChangeHandler = useRef<() => void>(() => {});
  const movementLockHandler = useRef<() => void>(() => {});
  const roomSyncHandler = useRef<() => void>(() => {});
  const latest = useRef(props);
  latest.current = { ...props, movementLocked: props.movementLocked || inspection !== null };
  const [failed, setFailed] = useState(false);
  // The curtain covers the flat canvas while the renderer chunk and textures load, then fades away.
  const [curtain, setCurtain] = useState<"loading" | "fading" | "gone">("loading");
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
    roomSyncHandler.current();
    if (latest.current.movementLocked) movementLockHandler.current();
    renderRef.current?.();
    nearbyChangeHandler.current();
  }, [props.currentRoomId, props.characters, props.documents, props.movementLocked, props.ambient, props.audio, props.scenery, props.attentionIds, props.guideTarget, inspection]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const controller = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let destroyed = false;
    let view: MapView | null = null;
    let playerPosition = latest.current.scenery?.authored?.spawnAtEntrance ? compiled.playerSpawn : arrivalPoint(map, latest.current.currentRoomId) ?? compiled.playerSpawn;
    let path: Point[] = [];
    let revision = 0;
    let facing: "down" | "up" | "left" | "right" = "down";
    let autoOpenedAt: string | null = null;
    let lastWalkTo: string | null = null;
    let lastNearbyCharacterId: string | null | undefined;
    let curtainTimer: number | undefined;
    // Who was last seen in each room. Rooms keep their occupants after the player leaves, and a revisited
    // room shows them straight away while its entry is still in flight, so nobody blinks out and back in.
    const remembered = new Map<string, { characters: V3Character[]; documents: V3Documents }>();

    const rooms = createRoomEntrySync({
      enter: (roomId) => latest.current.onEnterRoom(roomId),
      serverRoom: () => latest.current.currentRoomId,
      place: () => placeAt(map, playerPosition),
      onSettled: () => {
        revision += 1;
        updateNearbyCharacter();
        render();
      },
    });
    roomSyncHandler.current = rooms.sync;

    const seatsIn = (roomId: string | null, characters: readonly V3Character[]) => characters.flatMap((character, index) => {
      const position = seatIn(map, roomId, index + 1);
      const space = position && spaceAt(map, position);
      if (!position || (space?.kind !== "room" && !(space?.kind === "outdoor" && space.locationId))) return [];
      return [{ id: character.id, position, character }];
    });

    // The view's characters and documents belong to the server's current room, so they are seated there,
    // never in a room the player has only just walked into.
    const characterSeats = () => seatsIn(latest.current.currentRoomId, latest.current.characters);
    const documentProps = () => v3DocumentProps(
      map,
      latest.current.currentRoomId,
      latest.current.documents,
      latest.current.characters.length + 1,
    );
    const rememberedRooms = () => {
      const here = latest.current.currentRoomId;
      if (here) remembered.set(here, { characters: latest.current.characters, documents: latest.current.documents });
      return [...remembered].filter(([roomId]) => roomId !== here);
    };
    const rememberedRoomOf = (id: string) => rememberedRooms().find(([, room]) =>
      room.characters.some((character) => character.id === id) || room.documents.some((document) => document.id === id))?.[0];
    // While an entry is in flight the visible occupants may be the previous room's: nobody is talkable.
    const talkableSeats = () => rooms.pending() ? [] : characterSeats();

    const updateNearbyCharacter = () => {
      const characterId = nearbyCharacterId(playerPosition, facing, talkableSeats());
      if (characterId === lastNearbyCharacterId) return;
      lastNearbyCharacterId = characterId;
      latest.current.onNearbyCharacterChange(characterId);
    };

    const occupant = (character: V3Character, position: Point) => {
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
        emote: !latest.current.movementLocked && latest.current.attentionIds?.includes(character.id) ? "talk" as const : null,
      };
    };

    const snapshot = (): PlaygroundSnapshot => {
      const others = rememberedRooms();
      const people = [
        ...characterSeats().map(({ character, position }) => occupant(character, position)),
        ...others.flatMap(([roomId, room]) => seatsIn(roomId, room.characters).map(({ character, position }) => occupant(character, position))),
      ].filter((person, index, all) => all.findIndex((other) => other.id === person.id) === index);
      const cast = (latest.current.scenery?.authored?.cast ?? []).filter((character) =>
        character.roomId !== latest.current.currentRoomId
        && !remembered.has(character.roomId)
        && !people.some((person) => person.id === character.id),
      ).flatMap(character => {
        const position = seatIn(map, character.roomId, 1);
        return position ? [{ id: character.id, name: character.name, position,
          space: spaceAt(map, position), targetRoomId: null, status: "idle" as const,
          ...walkingActor(latest.current.scenery, `character:${character.id}`, characterFor({ id: character.id, name: character.name }), latest.current.scenery?.authored?.characterSheets?.[character.id]),
          interactive: !latest.current.movementLocked,
        }] : [];
      });
      const props = [
        ...documentProps(),
        ...others.flatMap(([roomId, room]) => v3DocumentProps(map, roomId, room.documents, room.characters.length + 1)),
      ].filter((prop, index, all) => all.findIndex((other) => other.id === prop.id) === index);
      // Panels the host draws over the map (quest card, stage pill, HUD buttons), so edge pointers avoid them.
      const frame = parent.getBoundingClientRect();
      const chrome = [...(parent.parentElement?.querySelectorAll<HTMLElement>('section[aria-label="Mission"], [data-map-chrome]') ?? [])].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? [{ x: rect.left - frame.left, y: rect.top - frame.top, width: rect.width, height: rect.height }] : [];
      });
      const target = latest.current.guideTarget;
      const guide: PlaygroundSnapshot["guide"] = !target || latest.current.movementLocked
        ? null
        : target.kind === "room"
          ? map.rooms.some((room) => room.id === target.id) ? { kind: "room", id: target.id } : null
          : target.kind === "character"
            ? [...people, ...cast].some((person) => person.id === target.id) ? { kind: "actor", id: target.id } : null
            : props.some((prop) => prop.id === target.id) ? { kind: "prop", id: target.id } : null;
      return {
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
          ...cast,
          ...people,
        ],
        props,
        guide,
        chrome,
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
      };
    };
    const render = () => view?.render(snapshot());
    renderRef.current = render;
    const finishWalk = () => {
      if (path.length === 0) latest.current.onWalkDone();
    };

    const keys = createHeldKeyMover({
      step: (direction) => stepTo({ x: playerPosition.x + direction.x, y: playerPosition.y + direction.y }),
      canRepeat: () => !destroyed && !latest.current.movementLocked && document.visibilityState === "visible",
      initialDelayMs: KEY_REPEAT_DELAY_MS,
      intervalMs: STEP_MS,
    });

    const goTo = (target: Point) => {
      if (latest.current.movementLocked) return;
      // A click or a walk request takes over from any held key, so the two never both step the player.
      keys.clear();
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
      // Stop just inside the door, clear of the people seated in the middle of the room.
      goTo(arrivalPoint(map, roomId) ?? { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) });
    };

    const stepTo = (next: Point) => {
      if (destroyed) return;
      if (latest.current.movementLocked) return;
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
      const wasPending = rooms.pending();
      const claimed = rooms.claimed();
      // Movement never waits for the engine: entries queue behind each other in order while the player walks on.
      rooms.arrive(placeAt(map, next));
      if (rooms.claimed() !== claimed) autoOpenedAt = null;
      updateNearbyCharacter();
      render();

      if (!wasPending && !rooms.pending() && !latest.current.movementLocked && !latest.current.destination) {
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
      if (document.visibilityState !== "visible" || latest.current.movementLocked || path.length === 0 || keys.active()) return;
      stepTo(path[0]!);
    }, STEP_MS);

    // The quest card folds and unfolds without touching map props; re-measure the panels now and then.
    const chromeWatch = window.setInterval(() => { if (document.visibilityState === "visible") render(); }, 1000);

    const clearHeld = () => keys.clear();

    movementLockHandler.current = () => {
      if (path.length === 0 && !keys.active()) return;
      path = [];
      keys.clear();
      revision += 1;
      render();
      latest.current.onWalkDone();
    };

    const keyName = (event: KeyboardEvent) => event.key.length === 1 ? event.key.toLowerCase() : event.key;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (latest.current.movementLocked) return;
      const key = keyName(event);
      if (key === "e") {
        if (rooms.pending()) return;
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
      // The OS's own key repeat is ignored: the mover's delayed repeat is the only auto-walk.
      if (event.repeat) return;
      if (path.length > 0) {
        path = [];
        latest.current.onWalkDone();
      }
      keys.press(event.code || key, delta);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keys.release(event.code || keyName(event));
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
        const { createTiledMapView } = await loadTiledView();
        if (destroyed) return;
        view = await createTiledMapView(parent, snapshot(), onDestination, reducedMotion.matches, {
          assetBase: ASSET_BASE,
          themeBase: "/game/themes",
          defaultSprite: "Villager",
          clickToWalk: true,
          onActor: (actorId) => {
            if (latest.current.characters.some((character) => character.id === actorId)) {
              if (!rooms.pending()) latest.current.onSelectCharacter(actorId);
              return;
            }
            // Someone remembered in another room, or authored cast elsewhere: head to their room.
            const roomId = rememberedRoomOf(actorId) ?? latest.current.scenery?.authored?.cast?.find(character => character.id === actorId)?.roomId;
            if (roomId && roomId !== placeAt(map, playerPosition)) goToRoom(roomId);
          },
          onProp: (documentId) => {
            if (latest.current.documents.some((document) => document.id === documentId)) {
              if (!rooms.pending()) latest.current.onOpenDocument(documentId);
              return;
            }
            const roomId = rememberedRoomOf(documentId);
            if (roomId && roomId !== placeAt(map, playerPosition)) goToRoom(roomId);
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
          // The desktop zoom-out must not leave an empty strip beside a narrower map.
          fillViewport: true,
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
        // Lift the curtain once the first frame with the map has painted.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          if (destroyed) return;
          setCurtain("fading");
          curtainTimer = window.setTimeout(() => { if (!destroyed) setCurtain("gone"); }, reducedMotion.matches ? 0 : CURTAIN_FADE_MS);
        }));
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
      roomSyncHandler.current = () => {};
      rooms.destroy();
      latest.current.onReadyChange(false);
      controller.abort();
      keys.clear();
      window.clearInterval(walk);
      window.clearInterval(chromeWatch);
      window.clearTimeout(curtainTimer);
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
      {curtain !== "gone" ? (
        <div
          role="status"
          aria-live="polite"
          className={`${pixelFont.className} absolute inset-0 z-10 flex items-center justify-center bg-[#1f2433] transition-opacity duration-[450ms] ease-out motion-reduce:transition-none ${curtain === "fading" ? "pointer-events-none opacity-0" : "opacity-100"}`}
        >
          <div className="flex flex-col items-center gap-3 text-[#f2d49b]">
            <div className="flex items-end gap-1.5" aria-hidden>
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="block size-2.5 animate-bounce bg-[#f2c14e] shadow-[2px_2px_0_#0e111a] motion-reduce:animate-none"
                  style={{ animationDelay: `${index * 140}ms` }}
                />
              ))}
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] [text-shadow:2px_2px_0_#0e111a] motion-safe:animate-pulse">
              Loading the map…
            </p>
          </div>
        </div>
      ) : null}
      {inspection && (
        <AdventureDialog
          kind="landmark"
          titleId={inspectionTitleId}
          closeLabel="Return to the map"
          onClose={() => setInspection(null)}
        >
          <h2 id={inspectionTitleId} className={styles.modalTitle}>{inspection.name}</h2>
          <p className="whitespace-pre-line">{inspection.description}</p>
          <p className="mt-4 text-sm opacity-70">
            Illustrated reconstruction. This prop is not an archival object or evidence that Lim used this exact item.
            Consult the Source archive for historical records.
          </p>
        </AdventureDialog>
      )}
    </>
  );
}
