import type { UserRole } from "./types";

export type AuditEvent = {
  id: string;
  createdAt: string;
  type: "qa_query" | "qa_escalation" | "policy_update" | "authz_denied";
  role: UserRole;
  question?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
};

const AUDIT_LOGS: AuditEvent[] = [];

export function writeAuditEvent(
  event: Omit<AuditEvent, "id" | "createdAt">,
): AuditEvent {
  const entry: AuditEvent = {
    ...event,
    id: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    createdAt: new Date().toISOString(),
  };

  AUDIT_LOGS.unshift(entry);
  if (AUDIT_LOGS.length > 300) {
    AUDIT_LOGS.pop();
  }

  return entry;
}

export function listAuditEvents(limit = 50): AuditEvent[] {
  return AUDIT_LOGS.slice(0, Math.max(1, Math.min(limit, 200)));
}
