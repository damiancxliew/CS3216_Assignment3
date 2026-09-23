/**
 * A stage's compiled `StageMap` drawn as a floor plan: one rect per room,
 * marks where the doors sit, labels centred in rooms wide enough to hold
 * them. Pure server component — the SVG is resolution-independent (tile
 * coordinates as the viewBox) and needs no client JS.
 */
import type { StageMap } from "@adventure/game-core";

/** The SVG only draws rooms and doors; `tiles` and `seed` are never needed. */
type Plan = Pick<StageMap, "width" | "height" | "rooms" | "doors">;

/** A label needs a few tiles of room; below this the centred text would spill. */
const MIN_LABEL_TILES = 6;

export function StageMapPlan({ map, names = {} }: { map: Plan; names?: Record<string, string> }) {
  return (
    <svg
      viewBox={`0 0 ${map.width} ${map.height}`}
      className="h-auto w-full rounded-surface bg-world-wash text-ink"
      role="img"
      aria-label="Floor plan"
    >
      {map.rooms.map((room) => (
        <rect
          key={room.id}
          x={room.x}
          y={room.y}
          width={room.width}
          height={room.height}
          className={room.enclosure === "enclosed" ? "fill-surface stroke-line-strong" : "fill-none stroke-line-strong"}
          strokeDasharray={room.enclosure === "enclosed" ? undefined : 0.8}
          strokeWidth={0.15}
        />
      ))}
      {map.doors.map((door) => (
        <rect
          key={door.id}
          x={door.position.x - 0.4}
          y={door.position.y - 0.4}
          width={0.8}
          height={0.8}
          className="fill-line-strong"
        />
      ))}
      {map.rooms
        .filter((room) => room.width >= MIN_LABEL_TILES)
        .map((room) => (
          <text
            key={room.id}
            x={room.x + room.width / 2}
            y={room.y + room.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted text-[1.4px]"
          >
            {names[room.id] ?? room.id}
          </text>
        ))}
    </svg>
  );
}
