# Project conventions

This repository is a strict TypeScript browser prototype for the map-generation portion of specs.md. It uses Vite for development/build, Vitest for unit tests, and Playwright for browser tests. Node.js 24 is available. Do not modify specs.md. Do not add or remove code comments.

## Commands

- `npm start`: Vite development server at http://127.0.0.1:5173.
- `npm test`: Vitest unit and generation-invariant tests (`tests/*.test.ts`).
- `npm run test:e2e`: Playwright browser tests (`e2e/*.spec.ts`); requires `npx playwright install chromium` once.
- `npm run typecheck`: strict TypeScript checking with no emit.
- `npm run build`: production Vite build.
- `npm run check`: typecheck, unit tests, and production build.

## Module ownership and interfaces

- `src/core.ts`: pure blueprint validation, map generation, navigation, gameplay state, save restoration, and exported domain types.
- `src/scenario.ts`: authored demo blueprint; exports `demoBlueprint` typed with `satisfies Blueprint`.
- `src/main.ts`, `src/render.ts`, `styles.css`, `index.html`: browser UI.
- Vite serves and builds only application assets; repository/config files must not be imported into the browser bundle.
- `tests/`: Vitest tests; `e2e/`: Playwright tests.

All core functions are synchronous and browser/Node compatible. Never use DOM APIs or localStorage in core modules.

### Blueprint v1

`{version:1,id,title,setting,description,player:{name,role,brief},sources:[{id,title,text,kind:'source'|'simulation'}],assumptions:[string],locations:[{id,name,purpose,kind:'market'|'records'|'meeting'}],npcs:[{id,name,role,locationId,dialogue,sourceIds:[string]}],evidence:[{id,name,locationId,text,sourceIds:[string]}],objectives:[{id,title,requires:[objectiveId],interactionId}],decision:{id,title,requires:[objectiveId],options:[{id,label,outcome}]}}`.

POC supports exactly three distinct location kinds in one scene, exactly two NPCs, one to three evidence items, and two or more objectives. All content and dialogue is public; there must be no private NPC fields. An objective is fulfilled by interacting with its referenced NPC/evidence after its dependencies are fulfilled. Interactions can be repeated without duplicate journal entries. IDs must be unique and safe. `sourceIds` refer to supplied source records; simulation content must be labelled honestly. The decision unlocks after its prerequisite objectives.

### Core exports

- `validateBlueprint(unknown) -> {valid:boolean,errors:string[]}`: never throw on malformed JSON-shaped input; enforce bounded strings/counts and coherent/reachable acyclic objective references.
- `generateMap(blueprint, seed='harbor-1') -> map`: throws an Error with readable validation details for invalid blueprint/seed. Returns serializable deterministic map.
- Map: `{version:1,id,seed,blueprint,scene:{id:'main',name,width:30,height:20,tiles:number[][],locations:[{id,name,kind,x,y,width,height}]},playerSpawn:{x,y},entities:[{id,type:'npc'|'evidence'|'decision',name,x,y,locationId}],validation:{valid,errors},generation:{...}}`. Tile 0 grass, 1 path, 2 wall, 3 water, 4 floor. Tiles 0,1,4 walkable. Entities occupy their tile and cannot be walked through. There is exactly one decision entity placed in meeting area.
- `validateMap(map) -> {valid:boolean,errors:string[]}`: independently checks geometry, entity consistency, walkable non-overlapping spawns and reachable interaction neighbors, all area access, and blueprint validity.
- `isWalkable(map,x,y) -> boolean`: includes entity occupancy.
- `findPath(map,from,to) -> Array<{x,y}> | null`: shortest four-way route, excluding start, including target; [] when start=target; null if unreachable.
- `createGameState(map) -> {mapId,player:{x,y},visited:[id],journal:[{id,title,text,kind,sourceIds}],completedObjectives:[id],decision:null|{optionId,outcome}}`.
- `movePlayer(map,state,dx,dy) -> state`: pure; only orthogonal single-tile movement; returns original state if blocked.
- `interact(map,state,entityId,{remote:false}={}) -> {state,ok,message}`: normally requires Manhattan distance <=1; remote true enables equivalent accessible list. NPC/evidence add journal entries and fulfill matching unlocked objectives; decision returns status/instructions; decisions use chooseDecision.
- `chooseDecision(map,state,optionId,{remote:false}={}) -> {state,ok,message}`: requires unlocked prerequisites and proximity to decision entity unless remote. Repeated same choice is safe; cannot change an existing ending.
- `restoreGameState(map,unknown) -> state`: validate saved state, drop/reject tampering and mismatched map ID; return fresh state on invalid saves. Map identity incorporates blueprint content, generator version, and seed, not only blueprint.id.

Rendering uses a responsive Canvas and semantic HTML controls. Never insert blueprint text through innerHTML. Keyboard movement only while map is focused (not while typing in fields). Browser storage errors must not break the demo. Accessible list interactions must have the same gameplay effects as map interactions.
