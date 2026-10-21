// Pack imagegen artwork into the engine's four-direction/four-phase format.
// This only crops transparent margins, sizes cells and aligns feet; it does not draw artwork.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const ids = ["lim", "gan", "tan", "elizabeth", "tham"];
const destination = "apps/web/public/demo/lim-bo-seng/sprites";
await mkdir(destination, { recursive: true });
for (const id of ids) {
  const file = `docs/standalone-demo/artwork/${id}-generated.png`;
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bands = [];
  let start = null;
  for (let y = 0; y <= info.height; y++) {
    let occupied = false;
    for (let x = 0; y < info.height && x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 160) {
        occupied = true;
        break;
      }
    }
    if (occupied && start === null) start = y;
    if (!occupied && start !== null) {
      if (y - start > 10) bands.push([start, y]);
      start = null;
    }
  }
  if (bands.length !== 4)
    throw new Error(`${id}: expected four separate animation rows`);
  const cells = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const [top, bottom] = bands[row];
      let left = info.width,
        right = -1;
      for (let y = top; y < bottom; y++) {
        for (
          let x = Math.floor((column * info.width) / 4);
          x < Math.floor(((column + 1) * info.width) / 4);
          x++
        ) {
          if (data[(y * info.width + x) * 4 + 3] > 160) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      }
      if (right < left) throw new Error(`${id}: empty frame ${row},${column}`);
      const { data: frame, info: dimensions } = await sharp(file)
        .extract({ left, top, width: right - left + 1, height: bottom - top })
        .resize({ width: 48, height: 56, fit: "inside", kernel: "nearest" })
        .png()
        .toBuffer({ resolveWithObject: true });
      cells.push({
        input: frame,
        left: column * 64 + Math.floor((64 - dimensions.width) / 2),
        top: row * 64 + 61 - dimensions.height,
      });
    }
  }
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: "#00000000" },
  })
    .composite(cells)
    .png()
    .toFile(`${destination}/${id}.png`);
  console.log(`Packed ${id}: 16 frames, 64px cells, aligned feet`);
}
