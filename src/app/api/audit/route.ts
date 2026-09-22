import { NextResponse } from "next/server";
import { listAuditEvents } from "@/lib/chat/audit";
import { resolveRoleFromRequest } from "@/lib/chat/role";

export async function GET(request: Request) {
  const role = resolveRoleFromRequest(request);
  if (role !== "hr_admin") {
    return NextResponse.json(
      { error: "Only hr_admin can access audit logs." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const events = listAuditEvents(limitParam);

  return NextResponse.json({
    count: events.length,
    events,
  });
}
