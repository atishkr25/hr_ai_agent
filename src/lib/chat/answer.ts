import { generatePolicyAnswer, type ModelAnswer } from "./llm";
import { retrievePolicyMatchesHybrid } from "./retrieval";
import type { ConversationTurn, RetrievalMatch, UserRole } from "./types";

export type PolicyAnswerResult = ModelAnswer & {
  matches: RetrievalMatch[];
  confidence: number;
};

function confidenceFromRetrieval(topScore: number, escalated: boolean) {
  if (escalated) {
    return 0.1;
  }

  return Number(Math.min(0.98, 0.35 + topScore * 0.65).toFixed(2));
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

const QUERY_EQUIVALENTS: Record<string, string> = {
  wfh: "remote",
  hybrid: "remote",
  entitled: "entitlement",
  many: "entitlement",
  get: "entitlement",
  receive: "entitlement",
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => QUERY_EQUIVALENTS[token.trim()] ?? token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

const SENSITIVE_TERMS = [
  "executive",
  "compensation",
  "salary",
  "salary structure",
  "pay structure",
  "pay band",
  "ctc",
  "remuneration",
  "wage",
  "disciplinary",
  "confidential",
  "bonus",
  "variable pay",
  "increment",
];

// Minimum hybrid retrieval score for a question to be sent to the model.
const RETRIEVAL_THRESHOLD = 0.3;

type PreflightResult = {
  escalate: boolean;
  reason?: string;
  answer?: string;
};

function escalationBeforeLlm(
  query: string,
  matches: RetrievalMatch[],
): PreflightResult {
  const normalizedQuery = query.toLowerCase();
  const chunks = matches.map((match) => match.chunk);
  const topScore = matches[0]?.score ?? 0;

  const sensitiveTerm = SENSITIVE_TERMS.find((term) => normalizedQuery.includes(term));
  if (sensitiveTerm) {
    // Sensitive topics are only answerable from restricted policy context that
    // the caller's role is authorized to see (retrieval is already role-filtered).
    const hasAuthorizedContext = chunks.some(
      (chunk) =>
        !chunk.visibility.includes("employee") &&
        `${chunk.title} ${chunk.section} ${chunk.content}`.toLowerCase().includes(sensitiveTerm),
    );
    if (!hasAuthorizedContext) {
      return {
        escalate: true,
        reason: `Sensitive HR query detected (${sensitiveTerm}). HR review is required.`,
        answer:
          "This question involves sensitive HR information that I can't share here. I've escalated it to your HR team so they can follow up with you directly.",
      };
    }
  }

  if (topScore < RETRIEVAL_THRESHOLD) {
    return {
      escalate: true,
      reason: "Low-confidence retrieval. Human verification is required.",
    };
  }

  // With semantic scores available the model judges whether the retrieved
  // context actually answers the question. Without them, fall back to a
  // keyword coverage check so an unrelated question is not answered from a
  // single generic keyword overlap.
  const hasSemanticSignal = (matches[0]?.semanticScore ?? 0) > 0;
  if (!hasSemanticSignal) {
    const queryTokens = new Set(tokenize(query));
    const contextTokens = new Set(tokenize(chunks.map((chunk) => `${chunk.title} ${chunk.section} ${chunk.source ?? ""} ${chunk.content}`).join(" ")));
    const covered = Array.from(queryTokens).filter((token) => contextTokens.has(token));
    const coverage = queryTokens.size ? covered.length / queryTokens.size : 1;

    if (coverage < 0.5 || (coverage < 0.7 && topScore < 0.5)) {
      return {
        escalate: true,
        reason: "Retrieved policy context does not sufficiently cover the question.",
      };
    }
  }

  return { escalate: false };
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

/**
 * The full question-answering pipeline: role-filtered hybrid retrieval,
 * pre-model guardrails, cited answer generation, and confidence scoring.
 * Shared by the chat API and the server-side evaluation suite so both
 * exercise exactly the same behaviour.
 */
export async function answerPolicyQuestion(
  query: string,
  role: UserRole,
  history: ConversationTurn[] = [],
): Promise<PolicyAnswerResult> {
  let matches = await retrievePolicyMatchesHybrid(query, role, 5);

  // Follow-up questions ("what about part-time staff?") often lack the topic
  // keywords, so retry retrieval with the previous question for context.
  const previousQuestion = [...history].reverse().find((turn) => turn.role === "user")?.content;
  if ((matches[0]?.score ?? 0) < RETRIEVAL_THRESHOLD && previousQuestion) {
    const contextualMatches = await retrievePolicyMatchesHybrid(`${previousQuestion} ${query}`, role, 5);
    if ((contextualMatches[0]?.score ?? 0) > (matches[0]?.score ?? 0)) {
      matches = contextualMatches;
    }
  }

  const chunks = matches.map((item) => item.chunk);
  const topScore = matches[0]?.score ?? 0;

  const preflight = escalationBeforeLlm(query, matches);

  const response = preflight.escalate
    ? {
        answer:
          preflight.answer ??
          "I don't have enough policy information to answer this confidently. Escalating to your HR team.",
        citations: [],
        escalated: true,
        escalationReason: preflight.reason,
        provider: "local-fallback" as const,
      }
    : await generatePolicyAnswer(query, role, chunks, history, topScore);
  const answer = enforceCitations(response.answer, response.citations);
  const confidence = confidenceFromRetrieval(topScore, response.escalated);

  return { ...response, answer, confidence, matches };
}
