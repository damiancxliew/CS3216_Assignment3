type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  now: () => number;
};

// This limiter is process-local; it is exact on a single AWS host and best-effort on Vercel.
export function createRateLimiter({ limit, windowMs, now }: RateLimiterOptions): (key: string) => boolean {
  const timestamps = new Map<string, number[]>();

  return (key) => {
    const current = now();
    const windowStart = current - windowMs;
    const recent = (timestamps.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (recent.length >= limit) {
      timestamps.set(key, recent);
      return false;
    }
    recent.push(current);
    timestamps.set(key, recent);
    return true;
  };
}
