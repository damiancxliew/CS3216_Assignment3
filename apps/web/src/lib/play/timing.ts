export interface PlayTimings {
  time<T>(name: string, operation: () => T | Promise<T>): Promise<T>;
  header(): string;
  json(): Record<string, number>;
}

export function createTimings(): PlayTimings {
  const spans = new Map<string, number>();
  return {
    async time<T>(name: string, operation: () => T | Promise<T>) {
      const started = performance.now();
      try {
        return await operation();
      } finally {
        spans.set(name, (spans.get(name) ?? 0) + performance.now() - started);
      }
    },
    header() {
      return [...spans].map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(", ");
    },
    json() {
      return Object.fromEntries(spans);
    },
  };
}
