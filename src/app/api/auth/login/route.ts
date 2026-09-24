import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { clearFailedAttempts, isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/chat/role";

type LoginBody = {
  password?: string;
};

function passwordsMatch(submitted: string, configured: string): boolean {
  const left = Buffer.from(submitted, "utf8");
  const right = Buffer.from(configured, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (isRateLimited(request, "admin-login")) {
    return NextResponse.json(
      { error: "Too many failed sign-in attempts. Please wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const configuredPassword = process.env.HR_ADMIN_PASSWORD?.trim();
  if (!configuredPassword) {
    return NextResponse.json(
      { error: "Server auth is not configured. Set HR_ADMIN_PASSWORD." },
      { status: 500 },
    );
  }

  const submittedPassword = typeof body.password === "string" ? body.password.trim() : "";

  if (!submittedPassword || !passwordsMatch(submittedPassword, configuredPassword)) {
    recordFailedAttempt(request, "admin-login");
    return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
  }

  clearFailedAttempts(request, "admin-login");
  const response = NextResponse.json({ role: "hr_admin" as const });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken("hr_admin"),
    ...sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  });

  return response;
}
