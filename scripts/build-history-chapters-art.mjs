// Original pixel illustrations: representative settings, not documented addresses.
import { writeFileSync } from "node:fs";
const dir = "apps/web/public/demo/lim-bo-seng/map";
const r = (x, y, w, h, c) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const p = (d, c) => `<path d="${d}" fill="${c}"/>`;
const t = (x, y, s, c = "#efe1b8", size = 7) =>
  `<text x="${x}" y="${y}" text-anchor="middle" fill="${c}" font-family="monospace" font-size="${size}">${s}</text>`;
function save(name, body, w = 32, h = 32, view = `0 0 ${w} ${h}`) {
  writeFileSync(
    `${dir}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view}" shape-rendering="crispEdges">${body}</svg>\n`,
  );
}
function building(name, b) {
  save(`chapter-${name}-full`, b, 128, 96);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 4; x++)
      save(`chapter-${name}-${x}-${y}`, b, 32, 32, `${x * 32} ${y * 32} 32 32`);
}
function camp(name, label, roof, wall, details) {
  let b =
    r(8, 85, 116, 10, "#3c4439") +
    r(12, 34, 104, 50, wall) +
    p("M0 37 L25 6 H100 L128 37 V43 H0Z", roof);
  for (let x = 10; x < 120; x += 12)
    b += p(
      `M${x} 36 L${30 + (x - 10) * 0.65} 10 H${33 + (x - 10) * 0.65} L${x + 3} 36Z`,
      "#c6b786",
    );
  b +=
    r(4, 40, 120, 4, "#4c4937") +
    r(14, 43, 4, 47, "#dec791") +
    r(109, 43, 4, 47, "#dec791") +
    r(53, 53, 25, 35, "#273c35");
  for (const x of [24, 87])
    b +=
      r(x, 52, 17, 21, "#314740") +
      r(x + 2, 54, 13, 2, "#8c9f8a") +
      r(x + 8, 53, 2, 19, "#baa36c");
  b +=
    r(38, 40, 53, 11, "#3f5e55") +
    t(64, 48, label) +
    r(48, 86, 36, 5, "#b39c71") +
    r(42, 91, 48, 5, "#8e805d") +
    details;
  building(name, b);
}
camp(
  "signals",
  "SIGNALS",
  "#9d9168",
  "#bca376",
  r(102, 0, 2, 30, "#534b39") +
    r(84, 3, 38, 2, "#534b39") +
    r(6, 76, 26, 12, "#6e7651") +
    r(8, 78, 7, 5, "#253c37"),
);
camp(
  "mess",
  "MESS",
  "#7f8a68",
  "#bdad86",
  r(83, 79, 27, 6, "#755a3d") +
    r(88, 74, 5, 5, "#c8d4b9") +
    r(98, 74, 5, 5, "#c8d4b9"),
);
camp(
  "reading",
  "ACCOUNTS",
  "#a99b73",
  "#b9aa82",
  r(19, 78, 24, 7, "#6c4e36") + r(24, 74, 15, 4, "#e6d3a6"),
);
function stilt(name, label, detail) {
  let b = r(9, 85, 113, 9, "#37443b") + r(15, 28, 98, 47, "#9d7448");
  for (let x = 18; x < 113; x += 9) b += r(x, 29, 2, 44, "#c6a06a");
  b += p("M0 34 L24 2 H104 L128 34 L122 41 L5 41Z", "#66724e");
  for (let y = 10; y < 36; y += 7) b += r(24 - y / 2, y, 80 + y, 2, "#a8a078");
  b +=
    r(13, 70, 102, 8, "#5b4c35") +
    r(17, 78, 5, 16, "#735b3c") +
    r(105, 78, 5, 16, "#735b3c") +
    r(50, 48, 29, 24, "#2d4136") +
    r(53, 80, 26, 5, "#b3a075") +
    r(49, 87, 34, 5, "#9c8c65");
  for (const x of [24, 88])
    b += r(x, 46, 16, 16, "#38584c") + r(x + 3, 48, 10, 2, "#9fb28d");
  b += r(38, 34, 54, 11, "#374f42") + t(65, 42, label) + detail;
  building(name, b);
}
stilt(
  "fishing",
  "SHORE",
  p("M12 57 Q35 40 43 70 L12 70Z", "#bec09b") +
    r(16, 58, 1, 12, "#627c64") +
    r(24, 55, 1, 15, "#627c64") +
    r(32, 57, 1, 13, "#627c64"),
);
stilt(
  "liaison",
  "SHELTER",
  r(85, 67, 22, 7, "#bb9963") + r(93, 65, 3, 12, "#e5d4a3"),
);
stilt(
  "stores",
  "STORES",
  r(23, 64, 19, 13, "#ad8852") + r(27, 64, 2, 13, "#d5bc85"),
);
stilt(
  "relay",
  "WIRELESS",
  r(8, 1, 2, 40, "#705e3d") +
    r(6, 0, 31, 2, "#6e785d") +
    r(86, 63, 22, 12, "#64745b") +
    r(90, 66, 7, 4, "#1f382c"),
);
stilt(
  "reports",
  "REPORTS",
  r(22, 63, 21, 9, "#dacb9d") +
    r(25, 65, 15, 1, "#596c50") +
    r(25, 68, 11, 1, "#596c50"),
);
camp(
  "rest",
  "REST",
  "#586d51",
  "#9c9470",
  r(22, 78, 21, 8, "#6c7d5d") + r(25, 77, 5, 9, "#d3bf91"),
);
function shop(name, label, wall, shutter, details) {
  let b =
    r(0, 88, 128, 8, "#454e42") +
    r(4, 12, 120, 71, wall) +
    p("M0 12 L9 2 H119 L128 12 V20 H0Z", "#985c47");
  for (let x = 0; x < 128; x += 7) b += r(x, 5, 2, 13, "#ce9170");
  b += r(3, 20, 122, 3, "#e1d8b1");
  for (const x of [15, 49, 83]) {
    b +=
      p(`M${x} 34 Q${x + 12} 20 ${x + 24} 34 V53 H${x}Z`, "#ede1bc") +
      r(x + 2, 34, 20, 19, shutter);
    for (let y = 36; y < 53; y += 4) b += r(x + 3, y, 18, 1, "#a1b69b");
    b += r(x + 11, 34, 2, 19, "#304b40");
  }
  b +=
    r(5, 56, 118, 4, "#e9d6a8") +
    r(24, 61, 80, 12, shutter) +
    t(64, 70, label) +
    r(4, 75, 120, 18, "#344c41");
  for (const x of [5, 58, 115])
    b += r(x, 74, 7, 22, "#e6d9b0") + r(x - 2, 91, 11, 5, "#8b9479");
  b += details;
  building(name, b);
}
shop(
  "provisions",
  "PROVISIONS",
  "#c9bb91",
  "#576b50",
  r(17, 83, 32, 9, "#8f6a43") + r(20, 80, 11, 4, "#d8c79b"),
);
shop(
  "canteen",
  "CANTEEN",
  "#aac1ae",
  "#3b645b",
  r(75, 83, 30, 9, "#826244") +
    r(79, 79, 5, 4, "#d0d7b9") +
    r(90, 79, 5, 4, "#d0d7b9"),
);
shop(
  "household",
  "住家 · HOME",
  "#d3b098",
  "#576775",
  r(24, 77, 3, 17, "#b9a275") +
    r(22, 77, 26, 2, "#b9a275") +
    r(29, 79, 12, 10, "#acc4b6"),
);
for (const [name, label] of [
  ["camp", "TO SHORE"],
  ["coast", "INLAND"],
  ["town", "ONWARD"],
  ["jungle", "REFLECT"],
])
  save(
    `exit-${name}`,
    r(14, 9, 4, 23, "#806541") +
      p("M0 1 H23 L32 9 L23 17 H0Z", "#315c4c") +
      t(14, 11, label, "#f4e1ad", 5),
  );
save(
  "signal-kit",
  r(1, 22, 30, 5, "#765838") +
    r(5, 9, 23, 14, "#536d55") +
    r(7, 12, 9, 6, "#a7b594") +
    r(20, 11, 5, 5, "#243d31") +
    r(20, 18, 3, 2, "#ead391") +
    r(25, 1, 1, 9, "#8f825a"),
);
save(
  "fishing-net",
  r(1, 22, 30, 7, "#6d5c3f") +
    p("M3 6 L27 2 L29 24 H4Z", "#abb994") +
    Array.from(
      { length: 5 },
      (_, i) =>
        r(5 + i * 5, 6, 1, 17, "#5c7b68") + r(4, 8 + i * 3, 23, 1, "#5c7b68"),
    ).join(""),
);
save(
  "medicine-parcels",
  r(2, 22, 28, 7, "#73583b") +
    r(4, 10, 13, 13, "#cdb780") +
    r(8, 10, 2, 13, "#ede1b8") +
    r(20, 10, 8, 13, "#6c8a6d") +
    r(21, 6, 6, 4, "#ad9875") +
    r(21, 15, 6, 4, "#e4d7b4"),
);
save(
  "wash-line",
  r(1, 3, 2, 29, "#806440") +
    r(29, 3, 2, 29, "#806440") +
    r(2, 5, 28, 1, "#cbbf94") +
    r(5, 6, 9, 16, "#acc8b5") +
    r(18, 6, 9, 12, "#d5bd99"),
);
save(
  "plant-bed",
  r(0, 3, 32, 28, "#897047") +
    r(2, 6, 28, 22, "#5a5b36") +
    Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 3 }, (_, x) =>
        p(`M${4 + x * 10} ${12 + y * 8} l-2 -5 5 2 3 -4 2 5 -5 3Z`, "#7fa367"),
      ).join(""),
    ).join(""),
);
save(
  "lamp",
  r(14, 4, 3, 26, "#80623e") +
    r(10, 4, 11, 11, "#dac077") +
    r(11, 6, 9, 6, "#f2dfaa") +
    r(9, 2, 13, 3, "#53664c") +
    r(11, 28, 10, 4, "#61573a"),
);
