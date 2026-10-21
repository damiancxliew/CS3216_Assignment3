// Illustrative Singapore waterfront architecture, extending the demo's native SVG art.
import { writeFileSync } from "node:fs";
const dir = "apps/web/public/demo/lim-bo-seng/map";
const r = (x, y, w, h, c) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const p = (d, c) => `<path d="${d}" fill="${c}"/>`;
const text = (x, y, t, size = 7) =>
  `<text x="${x}" y="${y}" text-anchor="middle" fill="#f3dfac" font-family="serif" font-size="${size}">${t}</text>`;
function save(name, body, w = 32, h = 32, view = `0 0 ${w} ${h}`) {
  writeFileSync(
    `${dir}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view}" shape-rendering="crispEdges">${body}</svg>\n`,
  );
}
function split(name, body, w, h) {
  for (let y = 0; y < h; y += 32)
    for (let x = 0; x < w; x += 32)
      save(`${name}-${x / 32}-${y / 32}`, body, 32, 32, `${x} ${y} 32 32`);
}
for (const [name, tint, shutter, label, sign] of [
  ["provision", "#dcc99d", "#42665c", "雜貨", "PROVISIONS"],
  ["home", "#e0b5a0", "#48646c", "住家", "RIVER STREET"],
  ["merchant", "#adc6bc", "#46685a", "商行", "MERCHANT"],
  ["godown", "#c9b38a", "#735642", "貨倉", "GODOWN"],
  ["coffee", "#d9cb9e", "#6a7562", "咖啡", "COFFEE"],
]) {
  let b =
    r(0, 0, 96, 96, "#383c35") +
    r(2, 6, 92, 77, tint) +
    p("M0 9 L8 0 H88 L96 9 V16 H0Z", "#9e503b");
  for (let x = 0; x < 96; x += 6)
    b += r(x, 3, 1, 12, "#d38b60") + r(x, 14, 6, 2, "#713f32");
  b +=
    r(3, 17, 90, 3, "#f0ddb0") +
    r(4, 20, 3, 42, "#eee0bd") +
    r(89, 20, 3, 42, "#eee0bd");
  for (const x of [14, 40, 66]) {
    b +=
      p(`M${x} 29 Q${x + 8} 19 ${x + 16} 29 V53 H${x}Z`, "#efe1bc") +
      r(x + 1, 30, 14, 23, shutter);
    for (let y = 32; y < 53; y += 4) b += r(x + 2, y, 12, 1, "#97a38c");
    b += r(x + 7, 30, 1, 23, "#243e38");
  }
  b +=
    r(4, 56, 88, 3, "#eee0bd") +
    r(10, 60, 76, 13, "#623f32") +
    text(48, 69, label, 10) +
    r(4, 75, 88, 21, "#333f3c");
  for (const x of [5, 44, 83])
    b += r(x, 74, 7, 22, "#d5c6a0") + r(x, 91, 9, 5, "#8f917b");
  b +=
    r(13, 77, 29, 18, "#805c3f") +
    r(53, 77, 28, 18, "#70563e") +
    r(15, 80, 24, 2, "#b7925c") +
    r(55, 85, 23, 2, "#b7925c");
  b += text(48, 21, sign, 5);
  save(`river-${name}-full`, b, 96, 96);
  split(`river-${name}`, b, 96, 96);
}
let boat =
  p("M0 25 L12 4 H81 L96 22 L84 48 L14 55Z", "#483c2d") +
  p("M5 26 L16 9 H78 L90 23 L79 43 L17 49Z", "#a87948");
for (let y = 14; y < 45; y += 5) boat += r(18, y, 58, 2, "#654d37");
boat +=
  p("M28 27 V10 Q50 -3 72 10 V27Z", "#c6ac72") +
  r(28, 26, 44, 4, "#6a5036") +
  r(37, 8, 2, 18, "#715a3c") +
  r(62, 8, 2, 18, "#715a3c") +
  r(11, 25, 18, 2, "#e1c795");
split("river-boat", boat, 96, 64);
save("river-boat-full", boat, 96, 64);
save(
  "quay-step",
  r(0, 0, 32, 32, "#807b65") +
    r(0, 1, 32, 6, "#d4c6a3") +
    r(0, 10, 32, 6, "#b6ac8e") +
    r(0, 19, 32, 6, "#a59e85") +
    r(0, 28, 32, 3, "#645f51"),
);
save(
  "mooring",
  r(8, 13, 16, 17, "#574c3a") +
    r(7, 11, 18, 5, "#9d8a64") +
    p("M2 24 Q16 12 29 24 L28 27 Q16 17 3 27Z", "#c9ab75"),
);
save(
  "newsstand",
  r(2, 6, 28, 25, "#77513a") +
    r(0, 3, 32, 5, "#375a4b") +
    r(5, 11, 22, 15, "#e9d8ae") +
    r(7, 13, 18, 2, "#5a5144") +
    r(7, 18, 8, 1, "#817760") +
    r(17, 18, 7, 1, "#817760") +
    r(7, 21, 17, 1, "#817760"),
);
save(
  "household-parcels",
  r(1, 22, 30, 7, "#604b35") +
    r(3, 8, 12, 15, "#d0ae71") +
    r(8, 8, 2, 15, "#f1d9a8") +
    r(17, 13, 12, 10, "#ac8750") +
    r(21, 13, 2, 10, "#ead39f") +
    p("M5 7 L8 2 H12 L15 7Z", "#e5c78f"),
);
save(
  "boarding-sign",
  r(14, 8, 4, 24, "#78563b") +
    p("M0 1 H23 L32 9 L23 17 H0Z", "#285f55") +
    text(13, 11, "BOARD", 6),
);
