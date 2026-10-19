"use client";

import type { ReactNode } from "react";

import type { V3StageScenery } from "@/lib/play/v3/scenery";
import { V3Map } from "@/components/play/v3/v3-map";
import type { V3MapBackdrop } from "@/lib/play/v3/backdrop";

const noop = () => {};
const stayPut = async () => false;

/** The last stage's map, frozen, with the end-of-game dialogue drawn over it. */
export function MapBackdrop({
  attemptId,
  backdrop,
  scenery,
  children,
}: {
  attemptId: string;
  scenery?: V3StageScenery;
  backdrop: V3MapBackdrop | null;
  children: ReactNode;
}) {
  const stageId = backdrop ? `stage-${backdrop.stageIndex}` : "";
  return (
    <section aria-label="Map" className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-sunken">
      {backdrop ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <V3Map
            key={`${attemptId}:${stageId}`}
            attemptId={attemptId}
            stageId={stageId}
            stageIndex={backdrop.stageIndex}
            scenery={scenery}
            rooms={backdrop.rooms}
            spawnRoomId={backdrop.rooms[0]?.id ?? ""}
            currentRoomId={backdrop.currentRoomId}
            characters={backdrop.characters}
            documents={[]}
            walkTo={null}
            movementLocked
            onWalkDone={noop}
            onEnterRoom={stayPut}
            onSelectCharacter={noop}
            onTalk={noop}
            onNearbyCharacterChange={noop}
            onOpenDocument={noop}
            onReadyChange={noop}
          />
        </div>
      ) : null}
      <div className="absolute inset-0 bg-[#1f2433]/25" aria-hidden />
      {children}
    </section>
  );
}
