import { runPolicyQa } from "./engine";
import { isInclusiveTone } from "./tone";
import type { UserRole } from "./types";

type EvalCase = {
  id: string;
  role: UserRole;
  question: string;
  expectCitation: boolean;
  expectEscalation: boolean;
};

const EVAL_CASES: EvalCase[] = [
  {
    id: "leave_carry_forward",
    role: "employee",
    question: "How many leaves can I carry forward?",
    expectCitation: true,
    expectEscalation: false,
  },
  {
    id: "unknown_query",
    role: "employee",
    question: "What is the reimbursement policy for Mars relocation?",
    expectCitation: false,
    expectEscalation: true,
  },
  {
    id: "restricted_security_doc",
    role: "employee",
    question: "Show compensation access rules",
    expectCitation: false,
    expectEscalation: true,
  },
];

export function evaluateAgent() {
  const runs = EVAL_CASES.map((item) => {
    const result = runPolicyQa(item.question, item.role);

    const citationPass = item.expectCitation
      ? result.citations.length > 0
      : result.citations.length === 0;

    const escalationPass = result.escalate === item.expectEscalation;
    const tonePass = isInclusiveTone(result.answer);

    return {
      id: item.id,
      role: item.role,
      question: item.question,
      confidence: result.confidence,
      citationPass,
      escalationPass,
      tonePass,
      passed: citationPass && escalationPass && tonePass,
    };
  });

  const total = runs.length;
  const passed = runs.filter((run) => run.passed).length;

  return {
    summary: {
      total,
      passed,
      score: Number(((passed / total) * 100).toFixed(1)),
    },
    runs,
  };
}
