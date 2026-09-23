/** The OAuth callback's redirect target must stay on-origin; WHATWG URL parsing treats a backslash as a slash. */
import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next";

const ORIGIN = "https://app.test";

describe("safeNextPath", () => {
  it("keeps a plain path with its query and hash", () => {
    expect(safeNextPath("/teacher?x=1#y", ORIGIN)).toBe("/teacher?x=1#y");
    expect(safeNextPath("/play/abc/debrief", ORIGIN)).toBe("/play/abc/debrief");
  });

  it("rejects a protocol-relative target", () => {
    expect(safeNextPath("//evil.com", ORIGIN)).toBe("/");
    expect(safeNextPath("//evil.com/path", ORIGIN)).toBe("/");
  });

  it("rejects a backslash target that resolves off-origin", () => {
    expect(safeNextPath("/\\evil.com", ORIGIN)).toBe("/");
    expect(safeNextPath("\\evil.com", ORIGIN)).toBe("/");
  });

  it("rejects absolute URLs and missing values", () => {
    expect(safeNextPath("https://evil.com", ORIGIN)).toBe("/");
    expect(safeNextPath("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(safeNextPath(null, ORIGIN)).toBe("/");
    expect(safeNextPath("", ORIGIN)).toBe("/");
  });
});
