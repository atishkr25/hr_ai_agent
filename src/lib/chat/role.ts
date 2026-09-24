import { signJwt, verifyJwt } from "@/lib/auth/jwt";
import type { SessionUser, UserRole } from "./types";

// HR admins and employees use separate cookies so an HR admin can test the
// employee chat in the same browser without losing the admin session.
export const SESSION_COOKIE_NAME = "hr_agent_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const EMPLOYEE_COOKIE_NAME = "hr_employee_session";
export const EMPLOYEE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionClaims = {
  role?: string;
  name?: string;
  email?: string;
};

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

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function createSessionToken(role: UserRole): string {
  return signJwt({ sub: "hr_admin", role, name: "HR Admin" }, SESSION_MAX_AGE_SECONDS);
}

export function verifySessionToken(token: string | undefined): UserRole | null {
  const claims = verifyJwt<SessionClaims>(token);
  return claims?.role === "hr_admin" ? "hr_admin" : null;
}

export function createEmployeeToken(user: SessionUser): string {
  return signJwt(
    { sub: user.id, name: user.name, email: user.email, role: user.role },
    EMPLOYEE_SESSION_MAX_AGE_SECONDS,
  );
}

export function verifyEmployeeToken(token: string | undefined): SessionUser | null {
  const claims = verifyJwt<SessionClaims>(token);
  if (!claims || typeof claims.name !== "string" || typeof claims.email !== "string") {
    return null;
  }

  // Employee sessions can never carry HR admin rights.
  const role = claims.role === "manager" ? "manager" : "employee";
  return { id: claims.sub, name: claims.name, email: claims.email, role };
}

export function getSessionRoleFromHeaders(headers: Headers): UserRole | null {
  const cookies = parseCookieHeader(headers.get("cookie"));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

export function getEmployeeFromHeaders(headers: Headers): SessionUser | null {
  const cookies = parseCookieHeader(headers.get("cookie"));
  return verifyEmployeeToken(cookies[EMPLOYEE_COOKIE_NAME]);
}

/**
 * The signed-in person making a request: the employee session if present
 * (the person chatting), otherwise the HR admin session.
 */
export function getRequester(request: Request | { headers: Headers }): SessionUser | null {
  const employee = getEmployeeFromHeaders(request.headers);
  if (employee) {
    return employee;
  }

  if (getSessionRoleFromHeaders(request.headers) === "hr_admin") {
    return { id: "hr_admin", name: "HR Admin", email: "", role: "hr_admin" };
  }

  return null;
}

/**
 * Resolves the caller's role from signed session cookies only. HR admins may
 * preview another role's view via the `x-user-role` header (used by the admin
 * evaluation suite); nobody else can choose their role.
 */
export function resolveRoleFromRequest(
  request: Request | { headers: Headers },
  options?: { allowAdminRoleOverride?: boolean },
): UserRole {
  const employee = getEmployeeFromHeaders(request.headers);
  if (getSessionRoleFromHeaders(request.headers) === "hr_admin") {
    const previewRole = request.headers.get("x-user-role");
    if (!options?.allowAdminRoleOverride) {
      return "hr_admin";
    }
    return previewRole ? resolveRole(previewRole) : employee?.role ?? "hr_admin";
  }

  return employee?.role ?? "employee";
}
