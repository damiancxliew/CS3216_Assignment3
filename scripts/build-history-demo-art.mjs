// Original, deterministic SVG pixel art for the standalone lesson (not archival evidence).
// Rebuild: node scripts/build-history-demo-art.mjs
import { mkdirSync, writeFileSync } from "node:fs";
const dir = "apps/web/public/demo/lim-bo-seng/map";
mkdirSync(dir, { recursive: true });
const rect = (x, y, w, h, c) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const path = (d, c) => `<path d="${d}" fill="${c}"/>`;
function svg(
  name,
  body,
  width = 32,
  height = 32,
  view = `0 0 ${width} ${height}`,
) {
  writeFileSync(
    `${dir}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view}" shape-rendering="crispEdges">${body}</svg>\n`,
  );
}
const ink = "#343d39",
  wood = "#856344",
  light = "#c19a68",
  cream = "#e2d1a5",
  teal = "#49665b",
  rust = "#9e5940";
// Continuous 12-tile frontage: clay roof, plaster piers, timber louvres and shaded five-foot way.
function frontage(tint, sparse = false) {
  let b =
    rect(0, 0, 192, 64, ink) +
    rect(1, 2, 190, 49, tint) +
    rect(0, 0, 192, 13, rust);
  for (let x = 0; x < 192; x += 6)
    b += rect(x, 0, 1, 12, "#c08054") + rect(x, 11, 6, 2, "#6c4939");
  for (let x = 0; x < 192; x += 48) {
    b +=
      rect(x + 2, 14, 44, 3, cream) +
      rect(x + 1, 18, 2, 25, "#8f9579") +
      rect(x + 44, 18, 2, 25, cream) +
      rect(x + 8, 18, 32, 1, "#7c826b") +
      rect(x + 7, 20, 14, 22, teal) +
      rect(x + 26, 20, 14, 22, teal);
    for (let y = 22; y < 41; y += 4)
      b += rect(x + 8, y, 12, 1, "#91a087") + rect(x + 27, y, 12, 1, "#91a087");
    b +=
      rect(x + 2, 43, 44, 7, wood) +
      rect(x + 5, 44, 38, 4, cream) +
      rect(x + 20, 44, 8, 4, teal);
    b +=
      rect(x + 3, 51, 42, 13, "#50564b") +
      rect(x + 4, 51, 3, 13, cream) +
      rect(x + 41, 51, 3, 13, cream);
    if (!sparse)
      b +=
        rect(x + 10, 54, 25, 7, light) +
        rect(x + 12, 53, 5, 3, "#d5bb83") +
        rect(x + 23, 53, 7, 3, teal);
  }
  return b;
}
function split(name, body, width = 192, height = 64) {
  for (let y = 0; y < height; y += 32)
    for (let x = 0; x < width; x += 32)
      svg(`${name}-${x / 32}-${y / 32}`, body, 32, 32, `${x} ${y} 32 32`);
}
split("shop", frontage("#b7b894"));
split("office", frontage("#bfb297", true));
split("scarce-shop", frontage("#a7aa88", true));
function shelter(canvas) {
  let b = path(
    "M0 34 L24 4 H168 L192 34 V40 H0 Z",
    canvas ? "#b6a174" : "#82744d",
  );
  for (let x = 6; x < 186; x += 6)
    b += rect(x, 20, 1, 18, canvas ? "#d8c58f" : "#ac9c65");
  b +=
    rect(0, 38, 192, 4, wood) +
    rect(8, 42, 5, 22, wood) +
    rect(178, 42, 5, 22, wood) +
    rect(16, 43, 160, 21, "#485143");
  for (let x = 22; x < 170; x += 20) b += rect(x, 44, 2, 20, light);
  return b;
}
split("camp", shelter(true));
split("hut", shelter(false));
svg(
  "rice-counter",
  rect(2, 24, 28, 5, "#343d3955") +
    rect(3, 16, 26, 11, wood) +
    rect(2, 14, 28, 4, light) +
    path("M4 13 V6 L7 3 H12 L15 6 V13Z", cream) +
    path("M17 13 V8 L20 5 H25 L28 8 V13Z", "#b9a578") +
    rect(7, 7, 5, 2, wood) +
    rect(19, 9, 6, 2, wood) +
    rect(5, 19, 22, 1, cream),
);
svg(
  "empty-counter",
  rect(3, 16, 26, 11, wood) +
    rect(2, 14, 28, 4, light) +
    rect(5, 9, 7, 5, teal) +
    rect(6, 8, 5, 1, cream) +
    rect(18, 11, 7, 3, cream) +
    rect(4, 20, 23, 1, ink),
);
svg(
  "radio",
  rect(1, 25, 30, 3, "#343d3955") +
    rect(3, 17, 26, 9, wood) +
    rect(2, 16, 28, 3, light) +
    rect(5, 6, 21, 10, teal) +
    rect(7, 8, 8, 5, ink) +
    rect(8, 9, 6, 1, cream) +
    rect(18, 9, 3, 3, cream) +
    rect(23, 8, 1, 5, cream) +
    rect(25, 0, 1, 7, ink) +
    path("M24 13 H30 V21 H27 V14Z", ink) +
    rect(6, 20, 18, 2, wood),
);
svg(
  "map-table",
  rect(2, 10, 28, 15, wood) +
    rect(4, 11, 24, 11, cream) +
    path("M6 15 H12 V18 H18 V13 H26 V15 H20 V20 H11 V17 H6Z", teal) +
    rect(8, 12, 2, 2, rust) +
    rect(23, 18, 2, 2, rust) +
    rect(4, 25, 3, 4, ink) +
    rect(25, 25, 3, 4, ink),
);
svg(
  "sampan",
  path("M0 15 L6 8 H25 L32 15 L25 25 H7Z", ink) +
    path("M2 15 L8 10 H24 L29 15 L24 23 H8Z", wood) +
    rect(10, 11, 3, 12, light) +
    rect(20, 11, 3, 12, light) +
    path("M13 12 H20 V22 H13Z", cream) +
    rect(1, 6, 2, 21, light),
);
svg(
  "rickshaw",
  rect(7, 8, 15, 11, wood) +
    rect(5, 5, 19, 3, ink) +
    rect(7, 7, 2, 15, ink) +
    rect(21, 7, 2, 15, ink) +
    rect(9, 13, 12, 6, rust) +
    rect(10, 19, 12, 3, light) +
    rect(6, 20, 3, 9, ink) +
    rect(22, 20, 3, 9, ink) +
    rect(7, 22, 1, 5, cream) +
    rect(23, 22, 1, 5, cream) +
    path("M11 21 H13 V29 H11Z M18 21 H20 V29 H18Z", wood),
);
svg(
  "writing-desk",
  rect(2, 11, 28, 15, wood) +
    rect(1, 10, 30, 3, light) +
    rect(6, 12, 11, 8, cream) +
    rect(8, 14, 7, 1, teal) +
    rect(8, 17, 6, 1, teal) +
    rect(23, 7, 3, 6, ink) +
    rect(22, 5, 5, 5, "#d1b66b") +
    rect(23, 3, 3, 2, ink) +
    rect(4, 25, 3, 4, ink) +
    rect(25, 25, 3, 4, ink),
);
svg(
  "cargo",
  rect(1, 15, 17, 14, wood) +
    rect(2, 16, 15, 2, light) +
    path("M3 18 H5 L16 27 V29 H14 L3 20Z", light) +
    rect(15, 6, 16, 16, wood) +
    rect(16, 7, 14, 2, light) +
    rect(20, 9, 2, 12, light) +
    rect(28, 8, 2, 14, ink),
);
svg(
  "water-jars",
  path("M3 14 L6 9 V6 H14 V9 L17 14 V25 L14 28 H6 L3 25Z", rust) +
    rect(6, 6, 8, 2, ink) +
    rect(6, 14, 2, 10, light) +
    path("M18 18 L21 13 V10 H27 V13 L30 18 V27 H18Z", teal) +
    rect(21, 10, 6, 2, ink) +
    rect(21, 18, 2, 7, "#91a087"),
);
svg(
  "vegetables",
  rect(1, 3, 30, 26, wood) +
    [4, 12, 20].map((y) => rect(3, y, 26, 2, ink)).join("") +
    [6, 15, 24]
      .flatMap((x) =>
        [6, 14, 22].map((y) =>
          path(`M${x} ${y} h3 v2 h3 v2 h-3 v3 h-3 v-3 h-3 v-2 h3Z`, teal),
        ),
      )
      .join(""),
);
svg(
  "bedrolls",
  rect(1, 6, 30, 9, "#687761") +
    rect(3, 6, 3, 9, cream) +
    rect(25, 6, 3, 9, cream) +
    rect(1, 7, 29, 1, "#94a083") +
    rect(1, 19, 30, 9, "#86754e") +
    rect(3, 19, 3, 9, cream) +
    rect(25, 19, 3, 9, cream),
);
// Native 4x4 walking sheets: plain civilian shirt/trousers and khaki field clothing.
function person(name, shirt, hat = false) {
  let b = "";
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      let a = "";
      const stride = col % 2,
        back = row === 1;
      a +=
        rect(4, 14, 8, 1, "#253c3444") +
        rect(5, 3, 6, 5, "#b99169") +
        rect(5, 2, 6, 2, ink);
      if (hat) a += rect(4, 2, 8, 2, "#8c865b");
      if (!back) a += rect(row === 2 ? 5 : 9, 5, 1, 1, ink);
      a +=
        rect(5, 8, 6, 4, shirt) +
        rect(4, 8 + stride, 1, 4, "#b99169") +
        rect(11, 9 - stride, 1, 4, "#b99169") +
        rect(5, 12, 2, 2 + stride, ink) +
        rect(9, 12, 2, 3 - stride, ink);
      b += `<g transform="translate(${row * 16} ${col * 16})">${a}</g>`;
    }
  svg(name, b, 64, 64);
}
person("civilian", cream);
person("field", "#8d9168", true);
person("keeper", "#718c87");

// Broad tropical crowns give the forest a canopy rather than a lawn with tufts.
let crown =
  rect(28, 38, 8, 24, wood) +
  rect(30, 40, 2, 22, light) +
  path("M24 62 H40 L35 57 H29Z", ink);
crown += path(
  "M9 10 H22 V4 H43 V9 H54 V17 H61 V35 H54 V43 H44 V49 H20 V44 H9 V36 H3 V20 H9Z",
  "#304c38",
);
crown += path(
  "M12 12 H25 V7 H41 V12 H52 V21 H56 V33 H47 V41 H21 V38 H10 V28 H7 V20 H12Z",
  "#526c45",
);
crown += path(
  "M16 13 H28 V10 H39 V15 H48 V22 H43 V26 H32 V23 H19 V28 H12 V22Z",
  "#7a8b50",
);
for (let i = 0; i < 18; i++)
  crown += rect(
    12 + ((i * 13) % 39),
    14 + ((i * 7) % 25),
    3,
    2,
    i % 2 ? "#657846" : "#94a36b",
  );
split("canopy", crown, 64, 64);
