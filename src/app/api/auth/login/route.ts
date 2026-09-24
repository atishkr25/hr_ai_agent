import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/chat/role";

type LoginBody = {
  password?: string;
};

export async function POST(request: Request) {
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

  const submittedPassword = body.password?.trim();

  if (!submittedPassword || submittedPassword !== configuredPassword) {
    return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
  }

  const token = createSessionToken("hr_admin");
  const response = NextResponse.json({ role: "hr_admin" as const });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
