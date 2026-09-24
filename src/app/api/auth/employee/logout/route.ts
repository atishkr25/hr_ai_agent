import { NextResponse } from "next/server";
import { EMPLOYEE_COOKIE_NAME, sessionCookieOptions } from "@/lib/chat/role";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: EMPLOYEE_COOKIE_NAME, value: "", ...sessionCookieOptions(0) });
  return response;
}
