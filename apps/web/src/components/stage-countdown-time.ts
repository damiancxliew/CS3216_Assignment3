/** Milliseconds until the deadline, corrected for clock skew; `null` when either input is unparsable. */
export function remainingMs(deadlineIso: string, nowMs: number, skewMs: number): number | null {
  const deadline = new Date(deadlineIso).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(skewMs)) return null;
  return Math.max(0, deadline - (nowMs + skewMs));
}

/** The difference between the server's clock and this device's, for display correction only. */
export function clockSkewMs(serverNowIso: string): number {
  const skew = new Date(serverNowIso).getTime() - Date.now();
  return Number.isFinite(skew) ? skew : 0;
}

/** `m:ss`, rounding up so a partial second still reads as time left. */
export function countdownLabel(remaining: number): string {
  const total = Math.ceil(remaining / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
