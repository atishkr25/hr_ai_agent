import { NextResponse } from "next/server";
import { resolveRoleFromRequest } from "@/lib/chat/role";
import { listConversations } from "@/lib/chat/store";

export async function GET(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can access conversations." }, { status: 403 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  const conversations = await listConversations(limit);
  return NextResponse.json({ count: conversations.length, conversations });
}
