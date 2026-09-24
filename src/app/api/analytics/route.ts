import { NextResponse } from "next/server";
import { listAuditEventsAsync } from "@/lib/chat/audit";
import { resolveRoleFromRequest } from "@/lib/chat/role";

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export async function GET(request: Request) {
  if (resolveRoleFromRequest(request) !== "hr_admin") {
    return NextResponse.json({ error: "Only hr_admin can access analytics." }, { status: 403 });
  }

  const events = (await listAuditEventsAsync(5000)).filter(
    (event) => event.metadata?.evaluation !== true,
  );
  const queries = events.filter((event) => event.type === "qa_query");
  const escalations = events.filter((event) => event.type === "qa_escalation");
  const questionCounts = new Map<string, number>();
  const policyCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();

  for (const event of queries) {
    if (event.question) {
      const question = normalizeQuestion(event.question);
      questionCounts.set(question, (questionCounts.get(question) ?? 0) + 1);
    }
    // Only answered queries cite a policy; escalations have no source to credit.
    const policy = event.metadata?.topPolicy;
    if (typeof policy === "string" && policy !== "none" && event.metadata?.escalated !== true) {
      policyCounts.set(policy, (policyCounts.get(policy) ?? 0) + 1);
    }
    roleCounts.set(event.role, (roleCounts.get(event.role) ?? 0) + 1);
  }

  const topQuestions = Array.from(questionCounts.entries())
    .map(([question, count]) => ({ question, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
  const topPolicies = Array.from(policyCounts.entries())
    .map(([policy, count]) => ({ policy, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);

  return NextResponse.json({
    totalQueries: queries.length,
    totalEscalations: escalations.length,
    escalationRate: queries.length ? Number((escalations.length / queries.length).toFixed(3)) : 0,
    byRole: Object.fromEntries(roleCounts),
    topQuestions,
    topPolicies,
    generatedAt: new Date().toISOString(),
  });
}
