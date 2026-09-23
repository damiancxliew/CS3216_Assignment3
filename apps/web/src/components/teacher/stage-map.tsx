/**
 * A stage's compiled `StageMap` drawn as a floor plan: one rect per room,
 * marks where the doors sit, labels centred in rooms wide enough to hold
 * them. Pure server component — the SVG is resolution-independent (tile
 * coordinates as the viewBox) and needs no client JS.
 */
import type { StageMap } from "@adventure/game-core";

/** The SVG only draws rooms and doors; `tiles` and `seed` are never needed. */
type Plan = Pick<StageMap, "width" | "height" | "rooms" | "doors">;

/**
 * Label sizing is a heuristic, not a measurement: at font-size LABEL_FONT a
 * glyph advances up to ~0.75F in tile units for capital-heavy names, so a
 * room fits `floor((width - padding) / 0.75F)` characters. Below ~4 the name
 * is dropped; longer names are truncated, never squeezed.
 */
const LABEL_FONT = 1.4;
const LABEL_PAD = 0.8;
const GLYPH_ADVANCE = 0.75;
const MIN_LABEL_CHARS = 4;
const MIN_LABEL_HEIGHT = 2;

function roomLabel(room: Plan["rooms"][number], name: string): string | null {
  if (room.height < MIN_LABEL_HEIGHT) return null;
  const budget = Math.floor((room.width - LABEL_PAD) / (GLYPH_ADVANCE * LABEL_FONT));
  if (budget < MIN_LABEL_CHARS) return null;
  if (name.length <= budget) return name;
  return name.slice(0, budget).trimEnd() + "…";
}

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
      {map.rooms.map((room) => {
        const label = roomLabel(room, names[room.id] ?? room.id);
        if (!label) return null;
        return (
          <text
            key={room.id}
            x={room.x + room.width / 2}
            y={room.y + room.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={LABEL_FONT}
            className="fill-muted"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
