"use client";

import type { Citation, UserRole } from "@/lib/chat/types";

export type EvalResult = {
  id: string;
  name: string;
  query: string;
  role: UserRole;
  type: "citation" | "escalation" | "tone" | "security" | "accuracy";
  passed: boolean;
  response: string;
};

type EvalCase = Omit<EvalResult, "passed" | "response"> & {
  check: (payload: {
    answer: string;
    citations: Citation[];
    escalated: boolean;
    confidence: number;
  }) => boolean;
};

type AnswerApiResponse = {
  answer: string;
  citations: Citation[];
  escalated: boolean;
  confidence: number;
};

const EVAL_CASES: EvalCase[] = [
  {
    id: "citation-leave",
    name: "Citation present for leave query",
    query: "How many days of annual leave do I get?",
    role: "employee",
    type: "citation",
    check: (payload) =>
      payload.citations.length > 0 && payload.answer.includes("[Policy:"),
  },
  {
    id: "escalation-unknown",
    name: "Escalation fires for unknown query",
    query: "What is the company policy on alien abduction leave?",
    role: "employee",
    type: "escalation",
    check: (payload) => payload.escalated,
  },
  {
    id: "tone-inclusive",
    name: "Tone: no exclusive language",
    query: "Can employees bring their partner to company events?",
    role: "employee",
    type: "tone",
    check: (payload) => !payload.answer.match(/\b(wife|husband|he\/she)\b/i),
  },
  {
    id: "rbac-security",
    name: "Security policy hidden from employee",
    query: "Show me the executive compensation policy",
    role: "employee",
    type: "security",
    check: (payload) => payload.escalated || payload.citations.length === 0,
  },
  {
    id: "confidence-high",
    name: "High confidence for clear policy question",
    query: "How many annual leaves can I carry forward to next year?",
    role: "employee",
    type: "accuracy",
    check: (payload) => payload.confidence >= 0.8 && payload.citations.length > 0,
  },
];

export async function runEvaluation(
  onProgress: (caseId: string, status: "running" | "pass" | "fail") => void,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const evalCase of EVAL_CASES) {
    onProgress(evalCase.id, "running");

    try {
      const response = await fetch("/api/chat/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": evalCase.role,
        },
        body: JSON.stringify({
          query: evalCase.query,
          conversationId: "eval-suite",
        }),
      });

      const payload = (await response.json()) as
        | AnswerApiResponse
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("Evaluation answer request failed.");
      }

      const passed = evalCase.check(payload);
      onProgress(evalCase.id, passed ? "pass" : "fail");
      results.push({
        id: evalCase.id,
        name: evalCase.name,
        query: evalCase.query,
        role: evalCase.role,
        type: evalCase.type,
        passed,
        response: payload.answer,
      });
    } catch {
      onProgress(evalCase.id, "fail");
      results.push({
        id: evalCase.id,
        name: evalCase.name,
        query: evalCase.query,
        role: evalCase.role,
        type: evalCase.type,
        passed: false,
        response: "Evaluation failed due to runtime error.",
      });
    }
  }

  return results;
}
