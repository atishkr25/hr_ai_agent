import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  EMAIL_PATTERN,
  employeeSessionResponse,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  toSessionUser,
} from "@/lib/auth/employee-session";
import { hashPassword } from "@/lib/auth/password";
import { DuplicateEmailError, insertEmployee } from "@/lib/chat/store";
import type { EmployeeAccount } from "@/lib/chat/types";

type RegisterBody = {
  name?: unknown;
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "Please enter your full name (2-80 characters)." }, { status: 400 });
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const account: EmployeeAccount = {
    id: `emp_${uuidv4()}`,
    name,
    email,
    // Self-registered accounts are always employees; HR can promote managers.
    role: "employee",
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };

  try {
    await insertEmployee(account);
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[auth] Could not create employee account:", errorMsg);
    return NextResponse.json(
      { error: "Account service is unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  return employeeSessionResponse(toSessionUser(account), 201);
}
