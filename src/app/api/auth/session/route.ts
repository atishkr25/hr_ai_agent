import { NextResponse } from "next/server";
import { resolveRoleFromRequest } from "@/lib/chat/role";

export async function GET(request: Request) {
  const role = resolveRoleFromRequest(request);
  return NextResponse.json({ role });
}
