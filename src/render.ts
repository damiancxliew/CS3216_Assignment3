import type { GameState, GeneratedMap } from './core';

export type TilePoint = { x: number; y: number };

export type RenderOptions = {
  selectedEntityId?: string | null;
};

const tileColors: Record<number, string> = {
  0: '#9aa274',
  1: '#c8ad78',
  2: '#554d43',
  3: '#72969b',
  4: '#d2bd8f',
};

const ink = '#292820';
const parchment = '#ead9b5';

function fitCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function markerLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, size: number): void {
  ctx.font = `600 ${Math.max(10, size * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(label);
  const width = metrics.width + size * 0.5;
  const height = Math.max(15, size * 0.62);
  const top = y - size * 0.85 - height;
  ctx.fillStyle = 'rgba(239, 223, 187, 0.93)';
  ctx.strokeStyle = 'rgba(41, 40, 32, 0.72)';
  ctx.lineWidth = Math.max(1, size * 0.045);
  ctx.beginPath();
  ctx.rect(x - width / 2, top, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillText(label, x, top + height / 2, width - size * 0.2);
}

function drawNpc(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, visited: boolean): void {
  ctx.fillStyle = visited ? '#8e7148' : '#a14f3c';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.arc(x, y - size * 0.11, size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.28, y + size * 0.34);
  ctx.quadraticCurveTo(x, y - size * 0.03, x + size * 0.28, y + size * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawEvidence(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, visited: boolean): void {
  ctx.fillStyle = visited ? '#b79242' : '#e0bd62';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.36);
  ctx.lineTo(x + size * 0.31, y);
  ctx.lineTo(x, y + size * 0.36);
  ctx.lineTo(x - size * 0.31, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.1, y);
  ctx.lineTo(x + size * 0.1, y);
  ctx.moveTo(x, y - size * 0.1);
  ctx.lineTo(x, y + size * 0.1);
  ctx.stroke();
}

function drawDecision(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, chosen: boolean): void {
  ctx.fillStyle = chosen ? '#cf9f37' : '#365e61';
  ctx.strokeStyle = chosen ? '#fff1bf' : ink;
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 3 * index - Math.PI / 2;
    const pointX = x + Math.cos(angle) * size * 0.36;
    const pointY = y + Math.sin(angle) * size * 0.36;
    if (index === 0) ctx.moveTo(pointX, pointY);
    else ctx.lineTo(pointX, pointY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = chosen ? ink : parchment;
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  ctx.beginPath();
  if (chosen) {
    ctx.moveTo(x - size * 0.16, y);
    ctx.lineTo(x - size * 0.03, y + size * 0.14);
    ctx.lineTo(x + size * 0.19, y - size * 0.15);
  } else {
    ctx.arc(x, y, size * 0.1, 0, Math.PI * 2);
    ctx.moveTo(x, y - size * 0.25);
    ctx.lineTo(x, y - size * 0.1);
    ctx.moveTo(x, y + size * 0.1);
    ctx.lineTo(x, y + size * 0.25);
  }
  ctx.stroke();
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = '#f1e4c4';
  ctx.strokeStyle = '#182e37';
  ctx.lineWidth = Math.max(2, size * 0.1);
  ctx.beginPath();
  ctx.arc(x, y, size * 0.29, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#182e37';
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.18);
  ctx.lineTo(x + size * 0.13, y + size * 0.13);
  ctx.lineTo(x, y + size * 0.07);
  ctx.lineTo(x - size * 0.13, y + size * 0.13);
  ctx.closePath();
  ctx.fill();
}

export function renderMap(
  canvas: HTMLCanvasElement,
  map: GeneratedMap,
  state: GameState,
  options: RenderOptions = {},
): void {
  fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const tileWidth = width / map.scene.width;
  const tileHeight = height / map.scene.height;
  const markerSize = Math.min(tileWidth, tileHeight);
  ctx.clearRect(0, 0, width, height);

  for (let y = 0; y < map.scene.height; y += 1) {
    for (let x = 0; x < map.scene.width; x += 1) {
      const tile = map.scene.tiles[y]?.[x] ?? 2;
      ctx.fillStyle = tileColors[tile] ?? tileColors[2]!;
      ctx.fillRect(x * tileWidth, y * tileHeight, tileWidth + 0.5, tileHeight + 0.5);
      const grain = ((x * 17 + y * 31) % 7) / 7;
      ctx.fillStyle = `rgba(47, 45, 35, ${0.025 + grain * 0.025})`;
      ctx.fillRect(x * tileWidth + grain * tileWidth, y * tileHeight, Math.max(0.6, tileWidth * 0.035), tileHeight);
      if (tile === 3) {
        ctx.strokeStyle = 'rgba(235, 227, 190, 0.26)';
        ctx.lineWidth = Math.max(0.6, markerSize * 0.025);
        ctx.beginPath();
        ctx.moveTo(x * tileWidth + tileWidth * 0.18, y * tileHeight + tileHeight * 0.55);
        ctx.quadraticCurveTo(x * tileWidth + tileWidth * 0.5, y * tileHeight + tileHeight * 0.35, x * tileWidth + tileWidth * 0.82, y * tileHeight + tileHeight * 0.55);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = 'rgba(45, 42, 32, 0.55)';
  ctx.lineWidth = Math.max(1, markerSize * 0.055);
  for (const location of map.scene.locations) {
    const left = location.x * tileWidth;
    const top = location.y * tileHeight;
    const locationWidth = location.width * tileWidth;
    const locationHeight = location.height * tileHeight;
    ctx.setLineDash([markerSize * 0.18, markerSize * 0.12]);
    ctx.strokeRect(left + 1, top + 1, locationWidth - 2, locationHeight - 2);
    ctx.setLineDash([]);
    ctx.font = `700 ${Math.max(11, markerSize * 0.44)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelX = left + locationWidth / 2;
    const labelY = top + markerSize * 0.18;
    const measured = ctx.measureText(location.name);
    ctx.fillStyle = 'rgba(232, 216, 178, 0.88)';
    ctx.fillRect(labelX - measured.width / 2 - markerSize * 0.15, labelY - markerSize * 0.06, measured.width + markerSize * 0.3, markerSize * 0.58);
    ctx.fillStyle = ink;
    ctx.fillText(location.name, labelX, labelY, Math.max(markerSize * 2, locationWidth - markerSize * 0.3));
  }

  for (const entity of map.entities) {
    const centerX = (entity.x + 0.5) * tileWidth;
    const centerY = (entity.y + 0.5) * tileHeight;
    const visited = entity.type === 'decision'
      ? state.decision !== null
      : state.journal.some((entry) => entry.id === entity.id);
    if (options.selectedEntityId === entity.id) {
      ctx.strokeStyle = '#fff3bf';
      ctx.lineWidth = Math.max(2, markerSize * 0.1);
      ctx.beginPath();
      ctx.arc(centerX, centerY, markerSize * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (entity.type === 'npc') drawNpc(ctx, centerX, centerY, markerSize, visited);
    if (entity.type === 'evidence') drawEvidence(ctx, centerX, centerY, markerSize, visited);
    if (entity.type === 'decision') drawDecision(ctx, centerX, centerY, markerSize, state.decision !== null);
    markerLabel(ctx, entity.name, centerX, centerY, markerSize);
  }

  drawPlayer(
    ctx,
    (state.player.x + 0.5) * tileWidth,
    (state.player.y + 0.5) * tileHeight,
    markerSize,
  );

  ctx.strokeStyle = '#26251e';
  ctx.lineWidth = Math.max(2, markerSize * 0.1);
  ctx.strokeRect(1, 1, width - 2, height - 2);
}

export function canvasPointToTile(
  canvas: HTMLCanvasElement,
  map: GeneratedMap,
  clientX: number,
  clientY: number,
): TilePoint | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor((clientX - rect.left) / rect.width * map.scene.width);
  const y = Math.floor((clientY - rect.top) / rect.height * map.scene.height);
  if (x < 0 || y < 0 || x >= map.scene.width || y >= map.scene.height) return null;
  return { x, y };
}
