/** The countdown's pure time math: skew correction, zero clamping, and no NaN for bad input. */
import { describe, expect, it } from "vitest";

import { clockSkewMs, countdownLabel, remainingMs } from "@/components/stage-countdown-time";

describe("remainingMs", () => {
  const deadline = "2030-01-01T00:01:00.000Z";
  const deadlineMs = Date.parse(deadline);

  it("counts down from now plus the clock skew", () => {
    expect(remainingMs(deadline, deadlineMs - 30_000, 0)).toBe(30_000);
    // A device 10s fast sees 10s less remaining.
    expect(remainingMs(deadline, deadlineMs - 30_000, 10_000)).toBe(20_000);
    // A device 10s slow sees 10s more.
    expect(remainingMs(deadline, deadlineMs - 30_000, -10_000)).toBe(40_000);
  });

  it("clamps at zero once the deadline has passed", () => {
    expect(remainingMs(deadline, deadlineMs + 5_000, 0)).toBe(0);
  });

  it("is null for an unparsable deadline or skew", () => {
    expect(remainingMs("not-a-date", 0, 0)).toBeNull();
    expect(remainingMs(deadline, 0, Number.NaN)).toBeNull();
  });
});

describe("countdownLabel", () => {
  it("formats m:ss, rounding partial seconds up", () => {
    expect(countdownLabel(5_000)).toBe("0:05");
    expect(countdownLabel(60_000)).toBe("1:00");
    expect(countdownLabel(609_000)).toBe("10:09");
    expect(countdownLabel(60_100)).toBe("1:01");
    expect(countdownLabel(0)).toBe("0:00");
  });
});

describe("clockSkewMs", () => {
  it("falls back to 0 for an unparsable server time", () => {
    expect(clockSkewMs("not-a-date")).toBe(0);
  });

  it("returns the difference between server and device clocks", () => {
    const skew = clockSkewMs(new Date(Date.now() + 5_000).toISOString());
    expect(skew).toBeGreaterThan(4_000);
    expect(skew).toBeLessThanOrEqual(5_000);
  });
});
