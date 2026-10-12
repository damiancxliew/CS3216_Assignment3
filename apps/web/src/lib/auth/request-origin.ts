/** Public origin of a request, honouring the reverse proxy's forwarded host and scheme. */
export function requestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const fallback = requestUrl.origin;
  const host =
    first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host) return fallback;
  const proto = (
    first(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1)
  ).toLowerCase();
  if (proto !== "http" && proto !== "https") return fallback;
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return fallback;
  }
}

function first(value: string | null): string | undefined {
  const result = value?.split(",")[0]?.trim();
  return result || undefined;
}
