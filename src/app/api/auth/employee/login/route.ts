import { NextResponse } from "next/server";
import { employeeSessionResponse, normalizeEmail, toSessionUser } from "@/lib/auth/employee-session";
import { verifyPassword } from "@/lib/auth/password";
import { clearFailedAttempts, isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { findEmployeeByEmail, recordEmployeeLogin } from "@/lib/chat/store";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

const INVALID_CREDENTIALS = "Invalid email or password.";

export async function POST(request: Request) {
  if (isRateLimited(request, "employee-login")) {
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

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  let account;
  try {
    account = await findEmployeeByEmail(email);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[auth] Could not look up employee account:", errorMsg);
    return NextResponse.json(
      { error: "Account service is unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  // Same message for unknown email and wrong password, so accounts cannot be enumerated.
  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    recordFailedAttempt(request, "employee-login");
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  clearFailedAttempts(request, "employee-login");
  void recordEmployeeLogin(account.id).catch(() => undefined);
  return employeeSessionResponse(toSessionUser(account));
}
