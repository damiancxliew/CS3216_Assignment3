# Trailer

Concept trailer for Historical Adventures v3 (Singapore, 1819), built with [Remotion](https://www.remotion.dev).
It is a standalone project, outside the npm workspaces, so it doesn't affect the app's builds or CI.

Pitch claims (bold kinetic type, typewriter open and close) alternate with gameplay proof (a lo-fi pixel town, in-game
interface and realistic period documents). One lo-fi track plays throughout: clear under game beats, muffled under
pitch beats.

```bash
cd trailer
npm install
npm run studio   # preview in the browser
npm run render   # writes out/trailer-v3.mp4
```

- Wording and episode content: `src/episode.ts`
- The cut (order, lengths, pitch or game): `CUT` in `src/Trailer.tsx`
- Game beats and pitch beats: `src/scenes.tsx`; pixel world: `src/pixel.tsx`; in-game interface: `src/hud.tsx`;
  period documents: `src/artefacts.tsx`; kinetic and typewriter pieces: `src/pitch.tsx`

The dialogue, notes, newspaper, memoir and letter are illustrative, written for the trailer, and marked as such on
screen. The publication and book titles are invented. The reveal's "what really happened" card summarises the
historical record.

## Audio
The music and sound effects are a placeholder, synthesised in code by `scripts/make_audio.py` (needs Python with numpy;
set `FFMPEG` to master to -14 LUFS and make the muffled copy). To use a real track, replace `public/audio/lofi.mp3`
and `public/audio/lofi-muffled.mp3` (a low-passed copy of the same track).

## Credits
- Characters, tiles and buildings: [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)
  by Pixel-boy and AAA (CC0), drawn at an exact 4× scale.
- Fonts (SIL Open Font License, from Google Fonts): Literata, Atkinson Hyperlegible Next, Albert Sans, Pixelify Sans,
  Special Elite, UnifrakturMaguntia, IM Fell English, IM Fell DW Pica SC, Old Standard TT, Pinyon Script.
