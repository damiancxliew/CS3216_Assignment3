import { describe, expect, it } from "vitest";

import { v3Ambient } from "@/lib/play/v3/atmosphere";

describe("v3Ambient", () => {
  it.each([
    ["Singapore, 1819", "A thunder storm approaches", "thunderstorm"],
    ["Monsoon coast", "The harbor", "rain"],
    ["Alpine winter", "Snowbound", "snow"],
    ["River in mist", "The crossing", "fog"],
    ["Smoke in the city", "Hazy streets", "haze"],
    ["Desert road", "The dust settles", "dust"],
    ["At dusk", "A quiet meeting", "night"],
  ] as const)("maps %s / %s to %s", (timePlace, title, expected) => {
    expect(v3Ambient({ timePlace, title })).toBe(expected);
  });

  it("uses the first matching condition and whole words", () => {
    expect(v3Ambient({ timePlace: "A rainy winter evening", title: "Storm warning" })).toBe("thunderstorm");
    expect(v3Ambient({ timePlace: "Rainier valley", title: "A fair morning" })).toBe("clear");
    expect(v3Ambient({ timePlace: "Singapore", title: "Nightfall" })).toBe("clear");
  });
});
