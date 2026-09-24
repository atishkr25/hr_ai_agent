import { NextResponse } from "next/server";
import { resolveRoleFromRequest } from "@/lib/chat/role";
import { readHrTicket, readHrTickets, upsertHrTicket } from "@/lib/chat/store";
import type { HrTicketStatus } from "@/lib/chat/types";

export async function GET(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can access HR tickets." }, { status: 403 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  const tickets = await readHrTickets(limit);
  return NextResponse.json({ count: tickets.length, tickets });
}

export async function PATCH(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can update HR tickets." }, { status: 403 });
  }

  let body: { id?: string; status?: HrTicketStatus; hrResponse?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "Ticket id is required." }, { status: 400 });
  }

  const ticket = await readHrTicket(body.id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const status = body.status === "open" || body.status === "in_progress" || body.status === "resolved"
    ? body.status
    : ticket.status;
  const updated = {
    ...ticket,
    status,
    hrResponse: body.hrResponse ?? ticket.hrResponse,
    updatedAt: new Date().toISOString(),
  };
  await upsertHrTicket(updated);
  return NextResponse.json({ ticket: updated });
}
