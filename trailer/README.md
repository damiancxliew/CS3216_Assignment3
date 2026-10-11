# Trailer

Concept trailer for Historical Adventures v3 (Singapore, 1819), built with [Remotion](https://www.remotion.dev).
It is a standalone project, outside the npm workspaces, so it doesn't affect the app's builds or CI.

```bash
cd trailer
npm install
npm run studio   # preview in the browser
npm run render   # writes out/trailer-v3.mp4
```

- Wording and episode content: `src/episode.ts`
- Scene order and lengths: `CUT` in `src/Trailer.tsx`
- Scenes: `src/scenes.tsx`; shared pieces: `src/components.tsx`

The dialogue, notes and the letter are illustrative, written for the trailer; the letter is marked as such on screen.

## Credits
- Characters, music and sound effects: [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)
  by Pixel-boy and AAA (CC0).
- Map footage: recorded from the game's current 1819 demo adventure.
- Fonts: Literata and Atkinson Hyperlegible Next (SIL Open Font License), loaded from Google Fonts.
