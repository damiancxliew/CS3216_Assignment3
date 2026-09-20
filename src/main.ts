import '../styles.css';
import {
  chooseDecision,
  createGameState,
  findPath,
  generateMap,
  interact,
  isWalkable,
  movePlayer,
  restoreGameState,
  validateBlueprint,
  validateMap,
} from './core';
import type { Blueprint, GameState, GeneratedMap } from './core';
import { renderMap, canvasPointToTile } from './render';
import { demoBlueprint } from './scenario';

const STORAGE_KEY = 'historical-map-poc-v1';
const MAX_BLUEPRINT_BYTES = 100 * 1024;
const DEFAULT_SEED = 'harbor-1';

type StoredWorld = {
  blueprint: unknown;
  seed: unknown;
  state: unknown;
};

type StatusTone = 'neutral' | 'success' | 'error';
type MapEntity = GeneratedMap['entities'][number];
type Point = GameState['player'];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element #${id}`);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('game-map');
const titleElement = element<HTMLElement>('adventure-title');
const settingElement = element<HTMLElement>('adventure-setting');
const playerNameElement = element<HTMLElement>('player-name');
const playerRoleElement = element<HTMLElement>('player-role');
const roleBriefElement = element<HTMLElement>('role-brief');
const descriptionElement = element<HTMLElement>('adventure-description');
const mapNameElement = element<HTMLElement>('map-name');
const mapIdElement = element<HTMLElement>('map-id');
const statusElement = element<HTMLElement>('status');
const objectivesElement = element<HTMLOListElement>('objectives');
const objectiveCountElement = element<HTMLElement>('objective-count');
const currentTaskElement = element<HTMLElement>('current-task');
const journalElement = element<HTMLOListElement>('journal');
const journalCountElement = element<HTMLElement>('journal-count');
const interactionListElement = element<HTMLUListElement>('interaction-list');
const decisionOptionsElement = element<HTMLElement>('decision-options');
const decisionStatusElement = element<HTMLElement>('decision-status');
const decisionPanel = document.querySelector<HTMLElement>('.decision-panel');
if (!decisionPanel) throw new Error('Missing decision panel');
const decisionPanelElement: HTMLElement = decisionPanel;
const seedInput = element<HTMLInputElement>('seed-input');
const generateButton = element<HTMLButtonElement>('generate-map');
const blueprintJson = element<HTMLTextAreaElement>('blueprint-json');
const importButton = element<HTMLButtonElement>('import-blueprint');
const exportButton = element<HTMLButtonElement>('export-blueprint');

let blueprint: Blueprint = demoBlueprint;
let seed = DEFAULT_SEED;
let map = generateMap(blueprint, seed);
let gameState = createGameState(map);
let selectedEntityId: string | null = null;
let initialMessage = 'Map ready. Focus the map to move, or use the accessible interaction list.';
let initialTone: StatusTone = 'neutral';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function setStatus(message: string, tone: StatusTone = 'neutral'): void {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

function validateCandidateBlueprint(candidate: unknown): Blueprint {
  const result = validateBlueprint(candidate);
  if (!result.valid) throw new Error(result.errors.join(' '));
  return candidate as Blueprint;
}

function makeCandidate(candidateBlueprint: Blueprint, candidateSeed: string): GeneratedMap {
  const candidateMap = generateMap(candidateBlueprint, candidateSeed);
  const result = validateMap(candidateMap);
  if (!result.valid) throw new Error(result.errors.join(' '));
  return candidateMap;
}

function loadStoredWorld(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    if (byteLength(raw) > MAX_BLUEPRINT_BYTES) throw new Error('Saved data exceeds the 100KB safety limit.');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('Saved data is not a world record.');
    const stored = parsed as StoredWorld;
    if (typeof stored.seed !== 'string') throw new Error('Saved seed is invalid.');
    const candidateBlueprint = validateCandidateBlueprint(stored.blueprint);
    const candidateMap = makeCandidate(candidateBlueprint, stored.seed);
    const candidateState = restoreGameState(candidateMap, stored.state);
    blueprint = candidateBlueprint;
    seed = stored.seed;
    map = candidateMap;
    gameState = candidateState;
    initialMessage = 'Saved investigation restored from this browser.';
    initialTone = 'success';
  } catch (error) {
    initialMessage = `Saved progress could not be restored. The authored map is ready instead. ${readableError(error)}`;
    initialTone = 'error';
  }
}

function persistWorld(): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ blueprint, seed, state: gameState }));
    return null;
  } catch {
    return ' Progress could not be saved in this browser.';
  }
}

function announceAndPersist(message: string, tone: StatusTone = 'neutral'): void {
  const storageWarning = persistWorld();
  setStatus(`${message}${storageWarning ?? ''}`, storageWarning ? 'error' : tone);
}

function clearElement(target: HTMLElement): void {
  target.textContent = '';
}

function renderObjectives(): void {
  clearElement(objectivesElement);
  const completed = new Set(gameState.completedObjectives);
  objectiveCountElement.textContent = `${completed.size}/${blueprint.objectives.length}`;
  let currentTask: string | null = null;

  for (const objective of blueprint.objectives) {
    const item = document.createElement('li');
    const isComplete = completed.has(objective.id);
    const isUnlocked = objective.requires.every((requiredId) => completed.has(requiredId));
    item.dataset.complete = String(isComplete);

    const title = document.createElement('span');
    title.className = 'objective-title';
    title.textContent = objective.title;
    const state = document.createElement('span');
    state.className = 'objective-state';
    state.textContent = isComplete ? 'Complete' : isUnlocked ? 'Ready to investigate' : 'Locked by an earlier objective';
    item.append(title, state);
    objectivesElement.append(item);
    if (currentTask === null && !isComplete && isUnlocked) currentTask = objective.title;
  }

  if (gameState.decision !== null) {
    currentTaskElement.textContent = 'Investigation complete. Your final recommendation has been recorded.';
  } else if (currentTask !== null) {
    currentTaskElement.textContent = `Current task: ${currentTask}`;
  } else if (gameState.completedObjectives.length === blueprint.objectives.length) {
    currentTaskElement.textContent = `Current task: ${blueprint.decision.title}`;
  } else {
    currentTaskElement.textContent = 'Continue gathering the evidence needed to unlock your next task.';
  }
}

function renderJournal(): void {
  clearElement(journalElement);
  journalCountElement.textContent = String(gameState.journal.length);
  const sources = new Map(blueprint.sources.map((source) => [source.id, source]));

  for (const entry of gameState.journal) {
    const item = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = entry.title;
    const text = document.createElement('p');
    text.textContent = entry.text;
    const metadata = document.createElement('div');
    metadata.className = 'entry-meta';
    const kind = document.createElement('span');
    kind.className = 'entry-label';
    kind.dataset.kind = entry.kind;
    kind.textContent = entry.kind === 'source' ? 'Supplied source' : 'Authored simulation';
    metadata.append(kind);

    for (const sourceId of entry.sourceIds) {
      const reference = document.createElement('span');
      reference.className = 'source-reference';
      const source = sources.get(sourceId);
      reference.textContent = source ? `${source.kind === 'source' ? 'Source' : 'Simulation'}: ${source.title}` : `Reference: ${sourceId}`;
      metadata.append(reference);
    }

    item.append(title, text, metadata);
    journalElement.append(item);
  }
}

function entityTypeLabel(entity: MapEntity): string {
  if (entity.type === 'npc') return 'Person';
  if (entity.type === 'evidence') return 'Evidence';
  return gameState.decision === null ? 'Decision' : 'Decided';
}

function renderInteractions(): void {
  clearElement(interactionListElement);
  for (const entity of map.entities) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const investigated = entity.type === 'decision'
      ? gameState.decision !== null
      : gameState.journal.some((entry) => entry.id === entity.id);
    button.dataset.visited = String(investigated);
    button.dataset.entityId = entity.id;
    button.dataset.entityType = entity.type;
    button.setAttribute('aria-label', `Interact remotely with ${entity.name}, ${entityTypeLabel(entity)}`);
    const name = document.createElement('span');
    name.className = 'interaction-name';
    name.textContent = entity.name;
    const type = document.createElement('span');
    type.className = 'interaction-type';
    type.textContent = entityTypeLabel(entity);
    button.append(name, type);
    button.addEventListener('click', () => performInteraction(entity.id, true));
    item.append(button);
    interactionListElement.append(item);
  }
}

function renderDecision(): void {
  clearElement(decisionOptionsElement);
  const completed = new Set(gameState.completedObjectives);
  const unlocked = blueprint.decision.requires.every((objectiveId) => completed.has(objectiveId));
  decisionPanelElement.dataset.chosen = String(gameState.decision !== null);

  if (gameState.decision !== null) {
    decisionStatusElement.textContent = `Recommendation recorded: ${gameState.decision.outcome}`;
  } else if (unlocked) {
    decisionStatusElement.textContent = `${blueprint.decision.title} Choose one supported recommendation.`;
  } else {
    const remaining = blueprint.decision.requires.filter((objectiveId) => !completed.has(objectiveId)).length;
    decisionStatusElement.textContent = `${blueprint.decision.title} Locked until ${remaining} required objective${remaining === 1 ? '' : 's'} remain complete.`;
  }

  for (const option of blueprint.decision.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.optionId = option.id;
    const chosen = gameState.decision?.optionId === option.id;
    button.textContent = option.label;
    button.disabled = !unlocked || (gameState.decision !== null && !chosen);
    button.setAttribute('aria-pressed', String(chosen));
    button.addEventListener('click', () => makeDecision(option.id));
    decisionOptionsElement.append(button);
  }
}

function renderAll(): void {
  titleElement.textContent = blueprint.title;
  document.title = `${blueprint.title} · Harbor Inquiry Atlas`;
  settingElement.textContent = blueprint.setting;
  playerNameElement.textContent = blueprint.player.name;
  playerRoleElement.textContent = blueprint.player.role;
  roleBriefElement.textContent = blueprint.player.brief;
  descriptionElement.textContent = blueprint.description;
  mapNameElement.textContent = map.scene.name;
  mapIdElement.textContent = map.id;
  mapIdElement.title = map.id;
  seedInput.value = seed;
  renderMap(canvas, map, gameState, { selectedEntityId });
  renderObjectives();
  renderJournal();
  renderInteractions();
  renderDecision();
}

function commitState(nextState: GameState, message: string, ok: boolean, persistUnchanged = false): void {
  const changed = nextState !== gameState;
  gameState = nextState;
  renderAll();
  if (changed || persistUnchanged) announceAndPersist(message, ok ? 'success' : 'error');
  else setStatus(message, ok ? 'neutral' : 'error');
}

function performInteraction(entityId: string, remote: boolean): void {
  selectedEntityId = entityId;
  const result = interact(map, gameState, entityId, { remote });
  commitState(result.state, result.message, result.ok);
}

function makeDecision(optionId: string): void {
  const result = chooseDecision(map, gameState, optionId, { remote: true });
  selectedEntityId = blueprint.decision.id;
  commitState(result.state, result.message, result.ok);
}

function followPath(path: Point[]): boolean {
  let nextState = gameState;
  for (const point of path) {
    const dx = point.x - nextState.player.x;
    const dy = point.y - nextState.player.y;
    const moved = movePlayer(map, nextState, dx, dy);
    if (moved === nextState) return false;
    nextState = moved;
  }
  gameState = nextState;
  return true;
}

function approachPoints(entity: MapEntity): Point[] {
  return [
    { x: entity.x, y: entity.y - 1 },
    { x: entity.x + 1, y: entity.y },
    { x: entity.x, y: entity.y + 1 },
    { x: entity.x - 1, y: entity.y },
  ].filter((point) => isWalkable(map, point.x, point.y));
}

function pathToEntity(entity: MapEntity): Point[] | null {
  let shortest: Point[] | null = null;
  for (const point of approachPoints(entity)) {
    const path = findPath(map, gameState.player, point);
    if (path !== null && (shortest === null || path.length < shortest.length)) shortest = path;
  }
  return shortest;
}

function handleMapClick(event: MouseEvent): void {
  canvas.focus();
  const tile = canvasPointToTile(canvas, map, event.clientX, event.clientY);
  if (tile === null) return;
  const entity = map.entities.find((candidate) => candidate.x === tile.x && candidate.y === tile.y);

  if (entity) {
    selectedEntityId = entity.id;
    const path = pathToEntity(entity);
    if (path === null) {
      renderAll();
      setStatus(`No reachable approach to ${entity.name}.`, 'error');
      return;
    }
    const followed = followPath(path);
    const travelled = followed && path.length > 0;
    const result = interact(map, gameState, entity.id);
    const message = travelled && result.ok ? `Travelled to ${entity.name}. ${result.message}` : result.message;
    commitState(result.state, message, result.ok, travelled);
    return;
  }

  selectedEntityId = null;
  if (!isWalkable(map, tile.x, tile.y)) {
    renderAll();
    setStatus('That terrain is not walkable.', 'error');
    return;
  }
  const path = findPath(map, gameState.player, tile);
  if (path === null) {
    renderAll();
    setStatus('No route reaches that tile.', 'error');
    return;
  }
  const moved = followPath(path);
  renderAll();
  if (moved) announceAndPersist(path.length === 0 ? 'You are already on that tile.' : `Travelled ${path.length} tile${path.length === 1 ? '' : 's'}.`);
  else setStatus('Travel stopped before the selected tile.', 'error');
}

function adjacentEntity(): MapEntity | undefined {
  return map.entities.find((entity) => Math.abs(entity.x - gameState.player.x) + Math.abs(entity.y - gameState.player.y) <= 1);
}

function moveFromKeyboard(dx: number, dy: number): void {
  selectedEntityId = null;
  const nextState = movePlayer(map, gameState, dx, dy);
  if (nextState === gameState) {
    renderAll();
    setStatus('Movement blocked by terrain or an occupied tile.', 'error');
    return;
  }
  gameState = nextState;
  renderAll();
  announceAndPersist('Moved one tile. Press E or Enter beside a marker to investigate.');
}

function handleCanvasKey(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  const directions: Record<string, readonly [number, number]> = {
    arrowup: [0, -1],
    w: [0, -1],
    arrowright: [1, 0],
    d: [1, 0],
    arrowdown: [0, 1],
    s: [0, 1],
    arrowleft: [-1, 0],
    a: [-1, 0],
  };
  const direction = directions[key];
  if (direction) {
    event.preventDefault();
    moveFromKeyboard(direction[0], direction[1]);
    return;
  }
  if (key === 'e' || key === 'enter') {
    event.preventDefault();
    const entity = adjacentEntity();
    if (entity) performInteraction(entity.id, false);
    else setStatus('No interaction is adjacent. Move beside a person, evidence marker, or decision point.', 'error');
  }
}

function replaceWorld(candidateBlueprint: Blueprint, candidateSeed: string, candidateMap: GeneratedMap, message: string): void {
  blueprint = candidateBlueprint;
  seed = candidateSeed;
  map = candidateMap;
  gameState = createGameState(candidateMap);
  selectedEntityId = null;
  blueprintJson.value = JSON.stringify(blueprint, null, 2);
  renderAll();
  announceAndPersist(message, 'success');
  canvas.focus();
}

function generateFromSeed(): void {
  try {
    const candidateSeed = seedInput.value;
    const candidateMap = makeCandidate(blueprint, candidateSeed);
    replaceWorld(blueprint, candidateSeed, candidateMap, `Generated a validated map with seed “${candidateSeed}”.`);
  } catch (error) {
    seedInput.value = seed;
    setStatus(`Map generation failed. The current world was retained. ${readableError(error)}`, 'error');
  }
}

function importBlueprint(): void {
  try {
    const raw = blueprintJson.value;
    if (byteLength(raw) > MAX_BLUEPRINT_BYTES) throw new Error('Blueprint exceeds the 100KB safety limit.');
    const parsed: unknown = JSON.parse(raw);
    const candidateBlueprint = validateCandidateBlueprint(parsed);
    const candidateMap = makeCandidate(candidateBlueprint, seedInput.value);
    replaceWorld(candidateBlueprint, seedInput.value, candidateMap, 'Blueprint validated and imported. A fresh investigation is ready.');
  } catch (error) {
    setStatus(`Import failed. The current world was retained. ${readableError(error)}`, 'error');
  }
}

function exportBlueprint(): void {
  blueprintJson.value = JSON.stringify(blueprint, null, 2);
  blueprintJson.focus();
  blueprintJson.select();
  setStatus('Current blueprint exported to the JSON field. Player progress is not included.', 'success');
}

loadStoredWorld();
blueprintJson.value = JSON.stringify(blueprint, null, 2);
renderAll();
setStatus(initialMessage, initialTone);

canvas.addEventListener('click', handleMapClick);
canvas.addEventListener('keydown', handleCanvasKey);
generateButton.addEventListener('click', generateFromSeed);
importButton.addEventListener('click', importBlueprint);
exportButton.addEventListener('click', exportBlueprint);
seedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') generateFromSeed();
});

const resize = (): void => renderMap(canvas, map, gameState, { selectedEntityId });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
else globalThis.addEventListener('resize', resize);
