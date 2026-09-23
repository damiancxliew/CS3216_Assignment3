/** Same-origin redirect targets only: anything that resolves off-origin falls back to the console root. */
export function safeNextPath(next: string | null, origin: string): string {
  if (!next || !next.startsWith("/")) return "/";
  let resolved: URL;
  try {
    resolved = new URL(next, origin);
  } catch {
    return "/";
  }
  if (resolved.origin !== new URL(origin).origin) return "/";
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
