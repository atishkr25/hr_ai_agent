import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/chat/audit";
import { answerPolicyQuestion } from "@/lib/chat/answer";
import { getRequester, getSessionRoleFromHeaders, resolveRoleFromRequest } from "@/lib/chat/role";
import { toPublicPolicyChunk } from "@/lib/chat/public";
import { readConversation, upsertConversation, upsertHrTicket } from "@/lib/chat/store";
import { notifyHrTicket } from "@/lib/notifications";
import type { ConversationRecord, ConversationTurn, EmployeeContact, HrTicket, UserRole } from "@/lib/chat/types";

type AnswerRequestBody = {
  query?: string;
  question?: string;
  conversationId?: string;
};

export async function POST(request: Request) {
  const requester = getRequester(request);
  if (!requester) {
    return NextResponse.json({ error: "Please sign in to use the HR assistant." }, { status: 401 });
  }
  const employee: EmployeeContact = { id: requester.id, name: requester.name, email: requester.email };

  const role: UserRole = resolveRoleFromRequest(request, {
    allowAdminRoleOverride: true,
  });
  // Evaluation runs from the admin dashboard exercise the real pipeline but
  // must not open HR tickets or skew analytics. Only honoured for HR admins.
  const isEvaluation =
    request.headers.get("x-eval-run") === "true" &&
    getSessionRoleFromHeaders(request.headers) === "hr_admin";

  let body: AnswerRequestBody;
  try {
    body = (await request.json()) as AnswerRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const query = (body.query ?? body.question)?.trim();
  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  let conversationId = body.conversationId?.trim() || `conv_${Date.now()}`;
  let existingConversation = await readConversation(conversationId);
  // A conversation belongs to the person who started it; never load someone
  // else's history into this user's context. Legacy records without an owner
  // are treated the same way.
  if (existingConversation && existingConversation.employee?.id !== requester.id) {
    conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    existingConversation = null;
  }
  const history = existingConversation?.messages ?? [];
  const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const response = await answerPolicyQuestion(query, role, history);
  const { answer, confidence } = response;
  const chunks = response.matches.map((item) => item.chunk);

  writeAuditEvent({
    type: "qa_query",
    role,
    question: query,
    metadata: {
      chunks: chunks.length,
      requestId,
      conversationId,
      employeeEmail: employee.email,
      escalated: response.escalated,
      provider: response.provider,
      // Attribute the query to the policy actually cited in the answer.
      topPolicy: response.citations[0]?.title ?? "none",
      ...(isEvaluation ? { evaluation: true } : {}),
    },
  });

  const now = new Date().toISOString();
  const userTurn: ConversationTurn = {
    id: `${requestId}_user`,
    role: "user",
    content: query,
    createdAt: now,
  };
  const assistantTurn: ConversationTurn = {
    id: `${requestId}_assistant`,
    role: "assistant",
    content: answer,
    createdAt: now,
    citations: response.citations,
    escalated: response.escalated,
    requestId,
  };
  const conversation: ConversationRecord = {
    id: conversationId,
    role,
    employee,
    title: existingConversation?.title || query.slice(0, 72),
    messages: [...history, userTurn, assistantTurn].slice(-40),
    createdAt: existingConversation?.createdAt || now,
    updatedAt: now,
  };
  if (!isEvaluation) {
    await upsertConversation(conversation);
  }

  if (response.escalated && !isEvaluation) {
    const ticket: HrTicket = {
      id: `ticket_${requestId}`,
      requestId,
      conversationId,
      role,
      employee,
      question: query,
      answer,
      reason: response.escalationReason ?? "Low confidence or insufficient policy context.",
      status: "open",
      notificationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await upsertHrTicket(ticket);
    void notifyHrTicket(ticket).then(async (notificationStatus) => {
      await upsertHrTicket({ ...ticket, notificationStatus, updatedAt: new Date().toISOString() });
    });

    writeAuditEvent({
      type: "qa_escalation",
      role,
      question: query,
      reason: response.escalationReason ?? "Low confidence or insufficient policy context.",
      metadata: {
        requestId,
        provider: response.provider,
        ticketId: ticket.id,
        employeeName: employee.name,
        employeeEmail: employee.email,
        ...(isEvaluation ? { evaluation: true } : {}),
      },
    });
  }

  return NextResponse.json({
    requestId,
    role,
    query,
    conversationId,
    chunks: chunks.map(toPublicPolicyChunk),
    answer,
    citations: response.citations,
    escalated: response.escalated,
    escalationReason: response.escalationReason,
    confidence,
    provider: response.provider,
    ticketId: response.escalated && !isEvaluation ? `ticket_${requestId}` : undefined,
  });
}
