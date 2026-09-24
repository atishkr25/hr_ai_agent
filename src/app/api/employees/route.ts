import { NextResponse } from "next/server";
import { resolveRoleFromRequest } from "@/lib/chat/role";
import { listEmployees, updateEmployeeRole } from "@/lib/chat/store";

export async function GET(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can view employees." }, { status: 403 });
  }

  try {
    const employees = await listEmployees();
    return NextResponse.json({ count: employees.length, employees });
  } catch {
    return NextResponse.json({ error: "Employee directory is unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can update employees." }, { status: 403 });
  }

  let body: { id?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (typeof body.id !== "string" || (body.role !== "employee" && body.role !== "manager")) {
    return NextResponse.json({ error: "Employee id and a role of employee or manager are required." }, { status: 400 });
  }

  const employee = await updateEmployeeRole(body.id, body.role);
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  return NextResponse.json({ employee });
}
