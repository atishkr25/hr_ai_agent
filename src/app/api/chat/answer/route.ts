import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/chat/audit";
import { generatePolicyAnswer } from "@/lib/chat/llm";
import { resolveRoleFromRequest } from "@/lib/chat/role";
import { retrievePolicyMatches } from "@/lib/chat/retrieval";
import type { UserRole } from "@/lib/chat/types";

type AnswerRequestBody = {
  query?: string;
  question?: string;
  conversationId?: string;
};

function confidenceFromChunks(chunkCount: number, escalated: boolean) {
  if (escalated) {
    return 0.3;
  }

  return Math.min(0.95, 0.6 + chunkCount * 0.07);
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "to",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "with",
  "can",
  "be",
  "does",
  "do",
  "how",
  "what",
  "when",
  "where",
  "show",
  "policy",
  "company",
]);

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function shouldEscalateBeforeLlm(
  query: string,
  topScore: number,
  chunks: Array<{ title: string; section: string; content: string }>,
) {
  const normalizedQuery = query.toLowerCase();
  const sensitiveTerms = [
    "executive",
    "compensation",
    "salary",
    "disciplinary",
    "confidential",
    "bonus",
  ];

  const mentionsSensitiveTerm = sensitiveTerms.some((term) =>
    normalizedQuery.includes(term),
  );

  const contextContainsSensitive = chunks.some((chunk) => {
    const haystack = `${chunk.title} ${chunk.section} ${chunk.content}`.toLowerCase();
    return sensitiveTerms.some((term) => haystack.includes(term));
  });

  if (topScore < 0.22) {
    return true;
  }

  const queryTokens = new Set(tokenize(query));
  const contextTokens = new Set(tokenize(chunks.map((chunk) => `${chunk.title} ${chunk.section} ${chunk.content}`).join(" ")));
  const covered = Array.from(queryTokens).filter((token) => contextTokens.has(token));
  const coverage = queryTokens.size ? covered.length / queryTokens.size : 1;

  if (coverage < 0.35 && topScore < 0.5) {
    return true;
  }

  if (mentionsSensitiveTerm && !contextContainsSensitive) {
    return true;
  }

  return false;
}

function enforceCitations(answer: string, citations: Array<{ title: string; section: string; page: string }>): string {
  if (!citations.length) {
    return answer;
  }

  const hasInlineCitation = answer.includes("[Policy:");
  if (hasInlineCitation) {
    return answer;
  }

  const first = citations[0];
  return `${answer}\n\n[Policy: ${first.title}, Section: ${first.section}, Page: ${first.page}]`;
}

export async function POST(request: Request) {
  const role: UserRole = resolveRoleFromRequest(request, {
    allowAdminRoleOverride: true,
  });

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

  const matches = retrievePolicyMatches(query, role, 5);
  const chunks = matches.map((item) => item.chunk);
  const topScore = matches[0]?.score ?? 0;
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

  const forceEscalation = shouldEscalateBeforeLlm(query, topScore, chunks);

  const response = forceEscalation
    ? {
        answer:
          "I don't have enough policy information to answer this confidently. Escalating to your HR team.",
        citations: [],
        escalated: true,
        escalationReason:
          "Low-confidence retrieval or sensitive query without matching policy context.",
        provider: "local-fallback" as const,
      }
    : await generatePolicyAnswer(query, role, chunks);
  const answer = enforceCitations(response.answer, response.citations);
  const confidence = confidenceFromChunks(chunks.length, response.escalated);

  if (response.escalated) {
    writeAuditEvent({
      type: "qa_escalation",
      role,
      question: query,
      reason: response.escalationReason ?? "Low confidence or insufficient policy context.",
      metadata: {
        requestId,
        provider: response.provider,
      },
    });
  }

  return NextResponse.json({
    requestId,
    role,
    query,
    chunks,
    answer,
    citations: response.citations,
    escalated: response.escalated,
    escalationReason: response.escalationReason,
    confidence,
    provider: response.provider,
  });
}
