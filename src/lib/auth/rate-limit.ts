// In-memory sliding-window limiter for login attempts. Per server instance
// only; put a shared store (e.g. Redis) in front for multi-instance deploys.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

/** Returns true when the caller has exceeded the allowed failed attempts. */
export function isRateLimited(request: Request, scope: string): boolean {
  const key = `${scope}:${clientAddress(request)}`;
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  attempts.set(key, recent);
  return recent.length >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(request: Request, scope: string): void {
  const key = `${scope}:${clientAddress(request)}`;
  attempts.set(key, [...(attempts.get(key) ?? []), Date.now()]);
}

export function clearFailedAttempts(request: Request, scope: string): void {
  attempts.delete(`${scope}:${clientAddress(request)}`);
}
