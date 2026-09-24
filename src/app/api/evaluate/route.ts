import { NextResponse } from "next/server";
import { evaluateAgent } from "@/lib/chat/evaluation";
import { resolveRoleFromRequest } from "@/lib/chat/role";

export async function GET(request: Request) {
  const role = resolveRoleFromRequest(request);
  if (role !== "hr_admin") {
    return NextResponse.json(
      { error: "Only hr_admin can run evaluations." },
      { status: 403 },
    );
  }

  const result = await evaluateAgent();
  return NextResponse.json(result);
}
