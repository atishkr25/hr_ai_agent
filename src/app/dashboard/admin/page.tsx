"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent } from "@/lib/chat/audit";
import DocumentUpload from "@/components/admin/DocumentUpload";
import { runEvaluation, type EvalResult } from "@/lib/evaluator";
import type { ConversationRecord, EmployeeContact, HrTicket, PolicyChunk, PublicEmployee, UserRole } from "@/lib/chat/types";

type TabKey = "knowledge" | "conversations" | "escalations" | "employees" | "analytics" | "eval";

type EvalStatus = "idle" | "running" | "pass" | "fail";

type PolicyPayload = {
  role: UserRole;
  count: number;
  policies: PolicyChunk[];
};

type AuditPayload = {
  count: number;
  events: AuditEvent[];
};

type TicketPayload = {
  count: number;
  tickets: HrTicket[];
};

type EmployeePayload = {
  count: number;
  employees: PublicEmployee[];
};

function EmployeeContactLine({ employee }: { employee?: EmployeeContact }) {
  if (!employee) {
    return <span className="text-[#8C8C95]">Unknown employee (asked before sign-in was required)</span>;
  }
  if (!employee.email) {
    return <span>{employee.name}</span>;
  }
  return (
    <span>
      <span className="text-[#F5F5F5]">{employee.name}</span>
      {" · "}
      <a href={`mailto:${employee.email}`} className="text-[#A5B4FC] hover:underline">
        {employee.email}
      </a>
    </span>
  );
}

type ConversationPayload = {
  count: number;
  conversations: ConversationRecord[];
};

const emptyForm: PolicyChunk = {
  id: "",
  title: "",
  section: "",
  page: "",
  source: "",
  content: "",
  visibility: ["employee", "manager", "hr_admin"],
};

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    return null;
  }
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

type AnalyticsPayload = {
  totalQueries: number;
  totalEscalations: number;
  escalationRate: number;
  byRole: Record<string, number>;
  topQuestions: Array<{ question: string; count: number }>;
  topPolicies: Array<{ policy: string; count: number }>;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "knowledge", label: "Knowledge Base" },
  { key: "conversations", label: "Conversations" },
  { key: "escalations", label: "Escalations" },
  { key: "analytics", label: "Analytics" },
  { key: "employees", label: "Employees" },
  { key: "eval", label: "Eval Results" },
];

const roleOptions: UserRole[] = ["employee", "manager", "hr_admin"];

const evalCases = [
  { id: "citation-leave", name: "Citation present for leave query" },
  { id: "escalation-unknown", name: "Escalation fires for unknown query" },
  { id: "tone-inclusive", name: "Tone: no exclusive language" },
  { id: "rbac-security", name: "Security policy hidden from employee" },
  { id: "confidence-high", name: "High confidence for clear policy question" },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("knowledge");
  const [policies, setPolicies] = useState<PolicyChunk[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [tickets, setTickets] = useState<HrTicket[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(null);
  const [hrResponse, setHrResponse] = useState<Record<string, string>>({});
  const [evalResults, setEvalResults] = useState<EvalResult[]>([]);
  const [evalState, setEvalState] = useState<Record<string, EvalStatus>>({});
  const [runningEval, setRunningEval] = useState(false);
  const [currentRole, setCurrentRole] = useState<UserRole>("hr_admin");
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [form, setForm] = useState<PolicyChunk>(emptyForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { "x-user-role": currentRole };
      const [policyRes, auditRes, ticketRes, analyticsRes, conversationRes, employeeRes] = await Promise.all([
        fetch("/api/policies?includeInactive=true", { headers }),
        fetch("/api/audit?limit=200", { headers }),
        fetch("/api/tickets?limit=200", { headers }),
        fetch("/api/analytics", { headers }),
        fetch("/api/conversations?limit=200", { headers }),
        fetch("/api/employees", { headers }),
      ]);

      const [policyJson, auditJson, ticketJson, analyticsJson, conversationJson, employeeJson] = await Promise.all([
        readJson<PolicyPayload>(policyRes),
        readJson<AuditPayload>(auditRes),
        readJson<TicketPayload>(ticketRes),
        readJson<AnalyticsPayload>(analyticsRes),
        readJson<ConversationPayload>(conversationRes),
        readJson<EmployeePayload>(employeeRes),
      ]);

      setPolicies(policyJson?.policies ?? []);
      setAuditEvents(auditJson?.events ?? []);
      setTickets(ticketJson?.tickets ?? []);
      setAnalytics(analyticsJson);
      setConversations(conversationJson?.conversations ?? []);
      setEmployees(employeeJson?.employees ?? []);
    } catch {
      // Keep the previously loaded data if a refresh fails.
    } finally {
      setLoading(false);
    }
  }, [currentRole]);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session");
      const payload = (await response.json()) as { role?: UserRole };
      setCurrentRole(payload.role ?? "employee");
    } catch {
      setCurrentRole("employee");
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkSession();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [checkSession]);

  useEffect(() => {
    if (!authChecked || currentRole !== "hr_admin") {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [authChecked, currentRole, fetchData]);

  async function loginAdmin() {
    if (!loginPassword.trim()) {
      setAuthError("Enter admin password.");
      return;
    }

    setLoggingIn(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setAuthError(payload.error ?? "Login failed.");
        return;
      }

      setLoginPassword("");
      await checkSession();
      await fetchData();
    } catch {
      setAuthError("Login failed. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function logoutAdmin() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentRole("employee");
    setAuthError(null);
    setEvalResults([]);
    setEvalState({});
    setTickets([]);
    setAnalytics(null);
    setConversations([]);
  }

  const filteredPolicies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return policies;
    }
    return policies.filter((policy) => {
      const hay = `${policy.title} ${policy.section} ${policy.content} ${policy.source}`.toLowerCase();
      return hay.includes(q);
    });
  }, [policies, search]);

  const escalationEvents = auditEvents.filter((event) => event.type === "qa_escalation");

  async function updateTicket(ticket: HrTicket, status: HrTicket["status"], hrResponse?: string) {
    const response = await fetch("/api/tickets", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-user-role": currentRole,
      },
      body: JSON.stringify({ id: ticket.id, status, hrResponse }),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { ticket?: HrTicket };
    if (payload.ticket) {
      setTickets((prev) => prev.map((item) => item.id === ticket.id ? payload.ticket as HrTicket : item));
    }
  }

  function openPolicyModal(policy?: PolicyChunk) {
    setForm(policy ?? emptyForm);
    setFormError(null);
    setShowModal(true);
  }

  async function updateEmployeeRole(employee: PublicEmployee, role: PublicEmployee["role"]) {
    const response = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: employee.id, role }),
    });
    const payload = await readJson<{ employee?: PublicEmployee }>(response);
    if (payload?.employee) {
      setEmployees((prev) => prev.map((item) => (item.id === employee.id ? payload.employee as PublicEmployee : item)));
    }
  }

  async function upsertPolicy() {
    const missing = (["title", "section", "page", "source", "content"] as const).filter(
      (field) => !String(form[field] ?? "").trim(),
    );
    if (missing.length) {
      setFormError(`Please fill in: ${missing.join(", ")}.`);
      return;
    }
    if (!form.visibility.length) {
      setFormError("Select at least one role that can see this chunk.");
      return;
    }

    const id = form.id || `${form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    setSavingPolicy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": currentRole,
        },
        body: JSON.stringify({ ...form, id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setFormError(payload.error ?? "Could not save policy chunk.");
        return;
      }

      setShowModal(false);
      setForm(emptyForm);
      await fetchData();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSavingPolicy(false);
    }
  }

  function toggleVisibility(role: UserRole) {
    setForm((prev) => ({
      ...prev,
      visibility: prev.visibility.includes(role)
        ? prev.visibility.filter((item) => item !== role)
        : [...prev.visibility, role],
    }));
  }

  async function runEvalSuite() {
    setRunningEval(true);
    setEvalResults([]);
    setEvalState({});

    const results = await runEvaluation((caseId, status) => {
      setEvalState((prev) => ({ ...prev, [caseId]: status }));
    });

    setEvalResults(results);
    setRunningEval(false);
  }

  const passCount = evalResults.filter((result) => result.passed).length;

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[#0C0C0D] p-6 text-[#F5F5F5]">
        <div className="mx-auto mt-24 max-w-md rounded-[10px] border border-[#1F1F21] bg-[#141415] p-6 text-sm text-[#C8C8D0]">
          Checking admin session...
        </div>
      </main>
    );
  }

  if (currentRole !== "hr_admin") {
    return (
      <main className="min-h-screen bg-[#0C0C0D] p-6 text-[#F5F5F5]">
        <div className="mx-auto mt-24 max-w-md rounded-[10px] border border-[#1F1F21] bg-[#141415] p-6">
          <h1 className="mb-2 text-lg font-semibold">Admin Sign In</h1>
          <p className="mb-4 text-sm text-[#8C8C95]">Enter admin password to access policy upload and controls.</p>
          <input
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="Admin password"
            className="mb-3 w-full rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm outline-none"
          />
          {authError ? (
            <div className="mb-3 rounded-[6px] border border-[#7F1D1D] bg-[#2A1114] px-3 py-2 text-xs text-[#FCA5A5]">
              {authError}
            </div>
          ) : null}
          <button
            onClick={() => void loginAdmin()}
            disabled={loggingIn}
            className="mechanical w-full rounded-[6px] border border-[#1F1F21] bg-[#6366F1] px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {loggingIn ? "Signing in..." : "Sign In as HR Admin"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0C0C0D] text-[#F5F5F5] p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">HR Admin Workspace</h1>
        <div className="flex items-center gap-2">
          <span className="mechanical rounded-[6px] border border-[#1F1F21] bg-[#141415] px-3 py-2 text-xs text-[#C8C8D0]">
            hr_admin
          </span>

          <button
            onClick={() => void logoutAdmin()}
            className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-xs text-[#8C8C95] hover:bg-[#1A1A1C]"
          >
            Logout
          </button>

          <button
            onClick={() => (window.location.href = "/dashboard")}
            className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-xs text-[#8C8C95] hover:bg-[#1A1A1C]"
          >
            Back to Chat
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`mechanical rounded-[6px] border px-3 py-2 text-sm ${
              activeTab === tab.key
                ? "border-[#6366F1] bg-[#6366F1] text-white"
                : "border-[#1F1F21] text-[#8C8C95]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
        {activeTab === "knowledge" ? (
          <section>
            <DocumentUpload role={currentRole} onUploaded={fetchData} />

            {currentRole !== "hr_admin" ? (
              <div className="mb-4 rounded-[6px] border-l-[3px] border-l-[#F59E0B] bg-[#1C1500] px-3 py-2 text-xs text-[#FCD34D]">
                Read-only mode for non-hr_admin role. Switch to hr_admin to add or edit policy chunks.
              </div>
            ) : null}

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Policy Knowledge Base</h2>
              {currentRole === "hr_admin" ? (
                <button
                  onClick={() => openPolicyModal()}
                  className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-sm hover:bg-[#1A1A1C]"
                >
                  Add Policy Chunk
                </button>
              ) : null}
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or keyword"
              className="mb-4 w-full rounded-[6px] border border-[#1F1F21] bg-[#141415] px-3 py-2 text-sm outline-none"
            />

            <div className="space-y-3">
              {filteredPolicies.map((policy) => (
                <div key={policy.id} className="rounded-[12px] border border-[#1F1F21] bg-[#141415] p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{policy.title}</p>
                      <p className="text-xs text-[#8C8C95]">
                        Section {policy.section} · Page {policy.page}
                        {policy.version ? ` · v${policy.version}` : ""}
                        {policy.isActive === false ? " · Archived" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {policy.visibility.map((item) => (
                        <span
                          key={`${policy.id}-${item}`}
                          className={`rounded-[999px] px-2 py-1 text-[10px] ${
                            item === "hr_admin"
                              ? "bg-[#22234B] text-[#A5B4FC]"
                              : "bg-[#1F1F21] text-[#B4B4BC]"
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <p className="mono line-clamp-3 text-xs text-[#C2C2CA]">{policy.content}</p>

                  {currentRole === "hr_admin" ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => openPolicyModal(policy)}
                        className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-1 text-xs hover:bg-[#1A1A1C]"
                      >
                        Edit
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === "conversations" ? (
          <section>
            <h2 className="mb-4 text-lg font-medium">Conversations</h2>
            <div className="overflow-x-auto rounded-[8px] border border-[#1F1F21]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#141415] text-[#8C8C95]">
                  <tr>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">First Question</th>
                    <th className="px-3 py-2">Messages</th>
                    <th className="px-3 py-2">Last Activity</th>
                    <th className="px-3 py-2">View</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => (
                    <tr key={conversation.id} className="border-t border-[#1F1F21]">
                      <td className="px-3 py-2 text-xs"><EmployeeContactLine employee={conversation.employee} /></td>
                      <td className="px-3 py-2">{conversation.role}</td>
                      <td className="px-3 py-2">{conversation.title}</td>
                      <td className="px-3 py-2">{conversation.messages.length}</td>
                      <td className="px-3 py-2">{new Date(conversation.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSelectedConversation(conversation)}
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!conversations.length ? (
                    <tr>
                      <td className="px-3 py-3 text-[#8C8C95]" colSpan={6}>
                        No conversations recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "escalations" ? (
          <section>
            <h2 className="mb-4 text-lg font-medium">Escalations</h2>
            <div className="space-y-3">
              {tickets.map((ticket) => {
                const status = ticket.status;
                const expanded = expandedEscalation === ticket.id;
                return (
                  <div key={ticket.id} className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm">{ticket.question}</p>
                        <p className="mt-1 text-xs">
                          <EmployeeContactLine employee={ticket.employee} />
                        </p>
                        <p className="text-xs text-[#8C8C95]">
                          {ticket.role} · {new Date(ticket.createdAt).toLocaleString()} · {ticket.id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-[999px] px-2 py-1 text-[10px] ${
                            status !== "resolved"
                              ? "bg-[#2A2110] text-[#F59E0B]"
                              : "bg-[#102315] text-[#22C55E]"
                          }`}
                        >
                          {status.replace("_", " ")}
                        </span>
                        <button
                          onClick={() => void updateTicket(ticket, "resolved", hrResponse[ticket.id] ?? ticket.hrResponse)}
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          Mark Resolved
                        </button>
                        <button
                          onClick={() =>
                            setExpandedEscalation((prev) => (prev === ticket.id ? null : ticket.id))
                          }
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          {expanded ? "Hide" : "Expand"}
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="mt-3 border-t border-[#1F1F21] pt-3">
                        <p className="text-xs text-[#8C8C95]">Reason: {ticket.reason}</p>
                        <p className="mt-1 text-xs text-[#8C8C95]">
                          Notification: {(ticket.notificationStatus ?? "pending").replace("_", " ")}
                        </p>
                        <textarea
                          value={hrResponse[ticket.id] ?? ticket.hrResponse ?? ""}
                          onChange={(e) =>
                            setHrResponse((prev) => ({
                              ...prev,
                              [ticket.id]: e.target.value,
                            }))
                          }
                          placeholder="Send HR response"
                          className="mt-2 w-full rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
                        />
                        <button
                          onClick={() => void updateTicket(ticket, "in_progress", hrResponse[ticket.id] ?? ticket.hrResponse)}
                          className="mt-2 rounded-[6px] border border-[#1F1F21] px-3 py-1 text-xs"
                        >
                          Save HR Response
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!tickets.length ? (
                <p className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4 text-sm text-[#8C8C95]">
                  No persistent HR tickets yet. Legacy audit escalations: {escalationEvents.length}.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "analytics" ? (
          <section>
            <h2 className="mb-4 text-lg font-medium">HR Analytics & FAQs</h2>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Total queries", analytics?.totalQueries ?? 0],
                ["Escalations", analytics?.totalEscalations ?? 0],
                ["Escalation rate", `${Math.round((analytics?.escalationRate ?? 0) * 100)}%`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
                  <p className="text-xs text-[#8C8C95]">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
                <h3 className="mb-3 text-sm font-medium">Frequently asked questions</h3>
                <div className="space-y-2 text-sm">
                  {(analytics?.topQuestions ?? []).map((item) => (
                    <div key={item.question} className="flex justify-between gap-3 border-b border-[#1F1F21] pb-2">
                      <span className="text-[#C8C8D0]">{item.question}</span>
                      <span className="text-[#8C8C95]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
                <h3 className="mb-3 text-sm font-medium">Most used policy sources</h3>
                <div className="space-y-2 text-sm">
                  {(analytics?.topPolicies ?? []).map((item) => (
                    <div key={item.policy} className="flex justify-between gap-3 border-b border-[#1F1F21] pb-2">
                      <span className="text-[#C8C8D0]">{item.policy}</span>
                      <span className="text-[#8C8C95]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "employees" ? (
          <section>
            <h2 className="mb-1 text-lg font-medium">Employees</h2>
            <p className="mb-4 text-xs text-[#8C8C95]">
              Registered employee accounts. Role changes apply the next time the employee signs in.
            </p>
            <div className="overflow-x-auto rounded-[8px] border border-[#1F1F21]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#141415] text-[#8C8C95]">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Joined</th>
                    <th className="px-3 py-2">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr key={employee.id} className="border-t border-[#1F1F21]">
                      <td className="px-3 py-2">{employee.name}</td>
                      <td className="px-3 py-2">
                        <a href={`mailto:${employee.email}`} className="text-[#A5B4FC] hover:underline">
                          {employee.email}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={employee.role}
                          onChange={(event) =>
                            void updateEmployeeRole(employee, event.target.value as PublicEmployee["role"])
                          }
                          className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-2 py-1 text-xs"
                        >
                          <option value="employee">employee</option>
                          <option value="manager">manager</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs">{new Date(employee.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs">
                        {employee.lastLoginAt ? new Date(employee.lastLoginAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                  {!employees.length ? (
                    <tr>
                      <td className="px-3 py-3 text-[#8C8C95]" colSpan={5}>
                        No employees have registered yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "eval" ? (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Evaluation Suite</h2>
              <button
                onClick={() => void runEvalSuite()}
                disabled={runningEval}
                className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-sm disabled:opacity-50"
              >
                {runningEval ? "Running..." : "Run Evaluation Suite"}
              </button>
            </div>

            <div className="mb-4 rounded-[8px] border border-[#1F1F21] bg-[#141415] p-3 text-sm">
              {evalResults.length ? `${passCount}/${evalResults.length} tests passed` : "No evaluation run yet"}
              <div className="mt-2 h-2 rounded-full bg-[#1F1F21]">
                <div
                  className="h-2 rounded-full bg-[#6366F1]"
                  style={{
                    width: evalResults.length ? `${(passCount / evalResults.length) * 100}%` : "0%",
                  }}
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-[8px] border border-[#1F1F21]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#141415] text-[#8C8C95]">
                  <tr>
                    <th className="px-3 py-2">Test Case</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Debug</th>
                  </tr>
                </thead>
                <tbody>
                  {evalCases.length ? (
                    evalCases.map((evalCase) => {
                        const status = evalState[evalCase.id] ?? "idle";
                        const result = evalResults.find((item) => item.id === evalCase.id);
                        return (
                          <tr key={evalCase.id} className="border-t border-[#1F1F21]">
                            <td className="px-3 py-2">{evalCase.name}</td>
                            <td className="px-3 py-2">
                              {status === "running" ? (
                                <span className="inline-flex items-center gap-1 text-[#818CF8]">
                                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#6366F1]" />
                                  Running...
                                </span>
                              ) : status === "pass" ? (
                                <span className="text-[#22C55E]">Pass</span>
                              ) : status === "fail" ? (
                                <span className="text-[#EF4444]">Fail</span>
                              ) : (
                                <span className="text-[#8C8C95]">Idle</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-[#8C8C95]">{result?.response.slice(0, 120) ?? "-"}</td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-[#8C8C95]" colSpan={3}>
                        Run the suite to see pass/fail results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </motion.section>

      {showModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[560px] rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
            <h3 className="mb-3 text-lg font-medium">{form.id ? "Edit Policy Chunk" : "Add Policy Chunk"}</h3>
            <div className="grid gap-2">
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Title"
                className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
              />
              <input
                value={form.section}
                onChange={(e) => setForm((prev) => ({ ...prev, section: e.target.value }))}
                placeholder="Section"
                className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
              />
              <input
                value={form.page}
                onChange={(e) => setForm((prev) => ({ ...prev, page: e.target.value }))}
                placeholder="Page Number"
                className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
              />
              <input
                value={form.source}
                onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                placeholder="Source"
                className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
              />
              <textarea
                value={form.content}
                onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="Content"
                rows={5}
                className="rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
              />

              <div className="flex flex-wrap gap-3 pt-1">
                {roleOptions.map((item) => (
                  <label key={item} className="inline-flex items-center gap-2 text-xs text-[#8C8C95]">
                    <input
                      type="checkbox"
                      checked={form.visibility.includes(item)}
                      onChange={() => toggleVisibility(item)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </div>

            {formError ? (
              <div className="mt-3 rounded-[6px] border border-[#7F1D1D] bg-[#2A1114] px-3 py-2 text-xs text-[#FCA5A5]">
                {formError}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void upsertPolicy()}
                disabled={savingPolicy}
                className="mechanical rounded-[6px] bg-[#6366F1] px-3 py-2 text-sm disabled:opacity-60"
              >
                {savingPolicy ? "Saving..." : "Save Chunk"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedConversation ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-[#1F1F21] bg-[#141415] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-medium">Conversation Detail</h3>
            <button
              onClick={() => setSelectedConversation(null)}
              className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
            >
              Close
            </button>
          </div>

          <p className="mb-1 text-xs">
            <EmployeeContactLine employee={selectedConversation.employee} />
          </p>
          <p className="mb-3 text-xs text-[#8C8C95]">
            {selectedConversation.role} · started {new Date(selectedConversation.createdAt).toLocaleString()} · {selectedConversation.id}
          </p>

          <div className="flex-1 space-y-3 overflow-y-auto text-sm">
            {selectedConversation.messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-[6px] border p-3 ${
                  message.role === "user"
                    ? "border-[#2D2D3F] bg-[#1E1E2E]"
                    : "border-[#1F1F21] bg-[#0C0C0D]"
                }`}
              >
                <p className="mb-1 text-[10px] uppercase tracking-wide text-[#8C8C95]">
                  {message.role === "user" ? "Employee" : "Assistant"}
                  {message.escalated ? " · escalated" : ""}
                </p>
                <p className="whitespace-pre-wrap text-[#D4D4DA]">{message.content}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-xs text-[#8C8C95]">Refreshing data...</p> : null}
    </main>
  );
}
