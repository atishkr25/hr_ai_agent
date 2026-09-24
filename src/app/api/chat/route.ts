import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/chat/audit";
import { getRequester, resolveRoleFromRequest } from "@/lib/chat/role";
import { retrievePolicyMatchesHybrid } from "@/lib/chat/retrieval";
import { toPublicPolicyChunk } from "@/lib/chat/public";

type ChatRequestBody = {
  query?: string;
  question?: string;
  conversationId?: string;
};

export async function POST(request: Request) {
  if (!getRequester(request)) {
    return NextResponse.json({ error: "Please sign in to use the HR assistant." }, { status: 401 });
  }
  const role = resolveRoleFromRequest(request);

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const query = (body.query ?? body.question)?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "Query is required." },
      { status: 400 },
    );
  }

  const matches = await retrievePolicyMatchesHybrid(query, role, 5);
  const chunks = matches.map((item) => item.chunk);
  const requestId = `req_${Date.now()}`;

  writeAuditEvent({
    type: "qa_query",
    role,
    question: query,
    metadata: {
      chunks: chunks.length,
      requestId,
      conversationId: body.conversationId ?? "default",
    },
  });

  return NextResponse.json({
    requestId,
    role,
    query,
    chunks: chunks.map(toPublicPolicyChunk),
  });
}
