import { retrievePolicyMatches } from "./retrieval";
import { normalizeInclusiveTone } from "./tone";
import type { ChatResult, UserRole } from "./types";

const ESCALATION_THRESHOLD = 0.22;

function buildAnswerFromMatch(question: string, topMatch: string): string {
  const query = question.trim();
  if (!query) {
    return "Please share a policy-related question, and I will answer with citations.";
  }

  return topMatch;
}

export function runPolicyQa(question: string, role: UserRole): ChatResult {
  const matches = retrievePolicyMatches(question, role);
  const top = matches[0];

  if (!top) {
    return {
      answer:
        "I could not find a reliable policy match for this question. I am escalating this to HR Operations for manual review.",
      confidence: 0,
      citations: [],
      escalate: true,
      escalationReason: "No policy chunk found for the query.",
      tone: "neutral-inclusive",
      policyCoverage: "low",
    };
  }

  const confidence = Number(Math.min(0.99, top.score + 0.15).toFixed(2));
  const citations = matches.map((match) => ({
    title: match.chunk.title,
    section: match.chunk.section,
    page: match.chunk.page,
    source: match.chunk.source,
    chunkId: match.chunk.id,
  }));

  if (confidence < ESCALATION_THRESHOLD) {
    return {
      answer:
        "I found low-confidence policy signals only. I am escalating this to HR Operations so a human reviewer can validate the answer.",
      confidence,
      citations,
      escalate: true,
      escalationReason:
        "Confidence below threshold. Human verification required.",
      tone: "neutral-inclusive",
      policyCoverage: confidence > 0.15 ? "medium" : "low",
    };
  }

  const answer = normalizeInclusiveTone(
    buildAnswerFromMatch(question, top.chunk.content),
  );

  return {
    answer,
    confidence,
    citations,
    escalate: false,
    tone: "neutral-inclusive",
    policyCoverage: confidence > 0.65 ? "high" : "medium",
  };
}
