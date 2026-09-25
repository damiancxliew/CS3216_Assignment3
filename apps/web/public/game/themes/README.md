# Map terrain sources and floor defaults

The legacy theme terrain sheets below are 16×16 pixel, top-down art released under CC0 by their creators. They remain bundled locally. The current map renderer paints its material atlas locally.

| Theme | Creator | Source |
| --- | --- | --- |
| Desert | GrumpyDiamond | [SandDesertTileSet16x16](https://opengameart.org/content/sanddeserttileset16x16) |
| Winter | Buch, with contributors | [The Field of the Floating Islands: snow expansion](https://opengameart.org/content/the-field-of-the-floating-islands) |
| Forest | Shade | [Puny World 16x16 Overworld Tileset](https://opengameart.org/content/16x16-puny-world-tileset) |
| Coast | ARoachIFoundOnMyPillow | [16x16 Overworld Tiles](https://opengameart.org/content/16x16-overworld-tiles-0) |

Doors, characters and audio still use the bundled Ninja Adventure pack.

## Default floors for open locations

Open locations use a rectangular floor area so their footprint is visible against the surrounding terrain. The renderer selects from its curated 16×16 material atlas using the authored location kind. Each material has eight deterministic tile variants.

| Floor | Location kinds | Material |
| --- | --- | --- |
| Cobble | Courtyard and other open locations, including older maps without a kind | `cobble` |
| Brick | Street, market | `brick` |
| Boardwalk | Dock | `decking` |
| Earth | Field, camp | `earth` |

These four curated defaults can be evaluated in play before adding any new tile art.
