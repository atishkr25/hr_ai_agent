import type { UserRole } from "./types";
import { persistAuditEvent, readAuditEvents } from "./store";

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

  void persistAuditEvent(entry).catch((error) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[audit] Could not persist audit event:", errorMsg);
  });

  return entry;
}

export function listAuditEvents(limit = 50): AuditEvent[] {
  return AUDIT_LOGS.slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function listAuditEventsAsync(limit = 50): Promise<AuditEvent[]> {
  const safeLimit = Math.max(1, Math.min(limit, 5000));
  const persisted = await readAuditEvents(safeLimit);
  const combined = new Map<string, AuditEvent>();

  for (const event of [...AUDIT_LOGS, ...persisted]) {
    combined.set(event.id, event);
  }

  return Array.from(combined.values())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, safeLimit);
}
