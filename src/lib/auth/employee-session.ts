import { NextResponse } from "next/server";
import {
  createEmployeeToken,
  EMPLOYEE_COOKIE_NAME,
  EMPLOYEE_SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/chat/role";
import type { EmployeeAccount, SessionUser } from "@/lib/chat/types";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function toSessionUser(account: EmployeeAccount): SessionUser {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}

/** Responds with the signed-in user and sets the employee JWT cookie. */
export function employeeSessionResponse(user: SessionUser, status = 200): NextResponse {
  const response = NextResponse.json({ user }, { status });
  response.cookies.set({
    name: EMPLOYEE_COOKIE_NAME,
    value: createEmployeeToken(user),
    ...sessionCookieOptions(EMPLOYEE_SESSION_MAX_AGE_SECONDS),
  });
  return response;
}
