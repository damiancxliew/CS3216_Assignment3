import { describe, expect, it } from "vitest";

import { nameInitials } from "../../apps/web/src/lib/play/v3/initials";

describe("nameInitials", () => {
  it("uses the first and last word of a proper name, skipping honorifics", () => {
    expect(nameInitials("Sir Thomas Stamford Raffles")).toBe("TR");
    expect(nameInitials("Major William Farquhar")).toBe("WF");
    expect(nameInitials("Tengku Hussein")).toBe("TH");
  });

  it("uses the first two words of a description, skipping articles", () => {
    expect(nameInitials("A Company clerk at Singapore, 1824")).toBe("CC");
    expect(nameInitials("The batin of the Orang Laut")).toBe("BO");
  });

  it("falls back for empty names", () => {
    expect(nameInitials("  ")).toBe("?");
    expect(nameInitials("Narrator")).toBe("N");
  });
});
