import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/chat/audit";
import { getRequester, resolveRoleFromRequest } from "@/lib/chat/role";
import { listPoliciesAsync, upsertPolicyChunk } from "@/lib/chat/policies";
import { toPublicPolicyChunk } from "@/lib/chat/public";
import type { PolicyChunk, UserRole } from "@/lib/chat/types";

function canAccessChunk(role: UserRole, chunk: PolicyChunk): boolean {
  return chunk.visibility.includes(role);
}

export async function GET(request: Request) {
  if (!getRequester(request)) {
    return NextResponse.json({ error: "Please sign in to view policies." }, { status: 401 });
  }
  const role = resolveRoleFromRequest(request);
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true" && role === "hr_admin";

  const visiblePolicies = (await listPoliciesAsync(includeInactive)).filter((chunk) => canAccessChunk(role, chunk));

  return NextResponse.json({
    role,
    count: visiblePolicies.length,
    policies: visiblePolicies.map(toPublicPolicyChunk),
  });
}

export async function POST(request: Request) {
  const role = resolveRoleFromRequest(request);
  if (role !== "hr_admin") {
    writeAuditEvent({
      type: "authz_denied",
      role,
      reason: "Attempted policy update without hr_admin role.",
    });

    return NextResponse.json(
      { error: "Only hr_admin can create or update policy chunks." },
      { status: 403 },
    );
  }

  let chunk: PolicyChunk;
  try {
    chunk = (await request.json()) as PolicyChunk;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  if (
    !chunk.id ||
    !chunk.title ||
    !chunk.section ||
    !chunk.page ||
    !chunk.source ||
    !chunk.content ||
    !Array.isArray(chunk.visibility) ||
    chunk.visibility.length === 0
  ) {
    return NextResponse.json(
      { error: "Missing required policy chunk fields." },
      { status: 400 },
    );
  }

  const updated = await upsertPolicyChunk(chunk);

  writeAuditEvent({
    type: "policy_update",
    role,
    reason: "Policy chunk upserted",
    metadata: {
      chunkId: updated.id,
      source: updated.source,
      section: updated.section,
    },
  });

  return NextResponse.json({
    status: "updated",
    chunk: toPublicPolicyChunk(updated),
  });
}
