import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "./types";

export const SESSION_COOKIE_NAME = "hr_agent_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET ?? "dev-only-unsafe-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      return acc;
    }

    acc[rawName] = rawValue.join("=");
    return acc;
  }, {});
}

export function resolveRole(value: string | null): UserRole {
  if (value === "manager" || value === "hr_admin" || value === "employee") {
    return value;
  }

  return "employee";
}

export function createSessionToken(role: UserRole): string {
  const payload = JSON.stringify({ role, iat: Date.now() });
  const encodedPayload = base64UrlEncode(payload);
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): UserRole | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as { role?: string; iat?: number };
    // The cookie max-age is only a browser hint; enforce expiry server-side too.
    if (typeof parsed.iat !== "number" || Date.now() - parsed.iat > SESSION_MAX_AGE_SECONDS * 1000) {
      return null;
    }
    return resolveRole(parsed.role ?? null);
  } catch {
    return null;
  }
}

export function getSessionRoleFromHeaders(headers: Headers): UserRole | null {
  const cookies = parseCookieHeader(headers.get("cookie"));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

export function resolveRoleFromRequest(
  request: Request | { headers: Headers },
  options?: { allowAdminRoleOverride?: boolean },
): UserRole {
  const sessionRole = getSessionRoleFromHeaders(request.headers);
  const headerRole = resolveRole(request.headers.get("x-user-role"));

  if (sessionRole) {
    if (options?.allowAdminRoleOverride && sessionRole === "hr_admin") {
      return headerRole;
    }
    return sessionRole;
  }

  if (process.env.NODE_ENV !== "production") {
    return headerRole;
  }

  return "employee";
}
