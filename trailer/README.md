# Trailer

Concept trailer for Historical Adventures v3 (Singapore, 1819), built with [Remotion](https://www.remotion.dev).
It is a standalone project, outside the npm workspaces, so it doesn't affect the app's builds or CI.

Numbered pitch claims alternate with gameplay proof: each claim card previews its game beat in a tilted window that
zooms to full screen. Game beats use a pixel town, in-game interface, realistic period documents and callouts. Cuts sit
on a 120 BPM beat grid (one beat = 15 frames), so they land on the music.

```bash
cd trailer
npm install
npm run studio   # preview in the browser
npm run render   # writes out/trailer-v3.mp4
```

- Wording and episode content: `src/episode.ts`
- The cut (order, length in beats, transition): `CUT` in `src/Trailer.tsx`
- Game beats and pitch beats: `src/scenes.tsx`; pixel world: `src/pixel.tsx`; in-game interface: `src/hud.tsx`;
  period documents: `src/artefacts.tsx`; kinetic and typewriter pieces: `src/pitch.tsx`

The dialogue, notes, newspaper, memoir and letter are illustrative, written for the trailer, and marked as such on
screen. The publication and book titles are invented. The reveal's "what really happened" card summarises the
historical record.

## Audio
The music and sound effects are a placeholder, synthesised in code by `scripts/make_audio.py` (needs Python with numpy;
set `FFMPEG` to master to -14 LUFS). The track is 58 s at 120 BPM: an intro pad under the typewriter opening, the full
groove from 4 s, and an outro from 52 s with a final hit on the title card at 56 s. To use a real track, replace
`public/audio/upbeat.mp3` with one at 120 BPM (or change `BEAT` in `src/Trailer.tsx` to match its tempo).

## Credits
- Characters, tiles and buildings: [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)
  by Pixel-boy and AAA (CC0), drawn at an exact 4× scale.
- Fonts (SIL Open Font License, from Google Fonts): Literata, Atkinson Hyperlegible Next, Albert Sans, Pixelify Sans,
  Special Elite, UnifrakturMaguntia, IM Fell English, IM Fell DW Pica SC, Old Standard TT, Pinyon Script.
