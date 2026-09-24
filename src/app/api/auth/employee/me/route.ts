import { NextResponse } from "next/server";
import { getEmployeeFromHeaders } from "@/lib/chat/role";

export async function GET(request: Request) {
  const user = getEmployeeFromHeaders(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ user });
}
