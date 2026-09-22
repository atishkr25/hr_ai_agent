"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent } from "@/lib/chat/audit";
import DocumentUpload from "@/components/admin/DocumentUpload";
import { runEvaluation, type EvalResult } from "@/lib/evaluator";
import type { PolicyChunk, UserRole } from "@/lib/chat/types";

type TabKey = "knowledge" | "conversations" | "escalations" | "eval";

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

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "knowledge", label: "Knowledge Base" },
  { key: "conversations", label: "Conversations" },
  { key: "escalations", label: "Escalations" },
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
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<AuditEvent | null>(null);
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(null);
  const [escalationStatus, setEscalationStatus] = useState<Record<string, "Pending" | "Resolved">>({});
  const [hrResponse, setHrResponse] = useState<Record<string, string>>({});
  const [evalResults, setEvalResults] = useState<EvalResult[]>([]);
  const [evalState, setEvalState] = useState<Record<string, EvalStatus>>({});
  const [runningEval, setRunningEval] = useState(false);
  const [currentRole, setCurrentRole] = useState<UserRole>("hr_admin");
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [form, setForm] = useState<PolicyChunk>({
    id: "",
    title: "",
    section: "",
    page: "",
    source: "",
    content: "",
    visibility: ["employee"],
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [policyRes, auditRes] = await Promise.all([
        fetch("/api/policies", { headers: { "x-user-role": currentRole } }),
        fetch("/api/audit?limit=200", { headers: { "x-user-role": currentRole } }),
      ]);

      const policyJson = (await policyRes.json()) as PolicyPayload;
      const auditJson = (await auditRes.json()) as AuditPayload;

      setPolicies(policyJson.policies ?? []);
      setAuditEvents(auditJson.events ?? []);
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

  const queryEvents = auditEvents.filter((event) => event.type === "qa_query");
  const escalationEvents = auditEvents.filter((event) => event.type === "qa_escalation");

  async function upsertPolicy() {
    const id = form.id || `${form.title.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    await fetch("/api/policies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-role": currentRole,
      },
      body: JSON.stringify({ ...form, id }),
    });

    setShowModal(false);
    setForm({
      id: "",
      title: "",
      section: "",
      page: "",
      source: "",
      content: "",
      visibility: ["employee"],
    });
    await fetchData();
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
            <DocumentUpload role={currentRole} />

            {currentRole !== "hr_admin" ? (
              <div className="mb-4 rounded-[6px] border-l-[3px] border-l-[#F59E0B] bg-[#1C1500] px-3 py-2 text-xs text-[#FCD34D]">
                Read-only mode for non-hr_admin role. Switch to hr_admin to add or edit policy chunks.
              </div>
            ) : null}

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Policy Knowledge Base</h2>
              {currentRole === "hr_admin" ? (
                <button
                  onClick={() => setShowModal(true)}
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
                        onClick={() => {
                          setForm(policy);
                          setShowModal(true);
                        }}
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
                    <th className="px-3 py-2">First Question</th>
                    <th className="px-3 py-2">Messages</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">View</th>
                  </tr>
                </thead>
                <tbody>
                  {queryEvents.map((event) => (
                    <tr key={event.id} className="border-t border-[#1F1F21]">
                      <td className="px-3 py-2">{event.role}</td>
                      <td className="px-3 py-2">{event.question}</td>
                      <td className="px-3 py-2">2</td>
                      <td className="px-3 py-2">{new Date(event.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSelectedAudit(event)}
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "escalations" ? (
          <section>
            <h2 className="mb-4 text-lg font-medium">Escalations</h2>
            <div className="space-y-3">
              {escalationEvents.map((event) => {
                const status = escalationStatus[event.id] ?? "Pending";
                const expanded = expandedEscalation === event.id;
                return (
                  <div key={event.id} className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm">{event.question}</p>
                        <p className="text-xs text-[#8C8C95]">
                          {event.role} · {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-[999px] px-2 py-1 text-[10px] ${
                            status === "Pending"
                              ? "bg-[#2A2110] text-[#F59E0B]"
                              : "bg-[#102315] text-[#22C55E]"
                          }`}
                        >
                          {status}
                        </span>
                        <button
                          onClick={() =>
                            setEscalationStatus((prev) => ({
                              ...prev,
                              [event.id]: "Resolved",
                            }))
                          }
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          Mark Resolved
                        </button>
                        <button
                          onClick={() =>
                            setExpandedEscalation((prev) => (prev === event.id ? null : event.id))
                          }
                          className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
                        >
                          {expanded ? "Hide" : "Expand"}
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="mt-3 border-t border-[#1F1F21] pt-3">
                        <p className="text-xs text-[#8C8C95]">Reason: {event.reason}</p>
                        <textarea
                          value={hrResponse[event.id] ?? ""}
                          onChange={(e) =>
                            setHrResponse((prev) => ({
                              ...prev,
                              [event.id]: e.target.value,
                            }))
                          }
                          placeholder="Send HR response"
                          className="mt-2 w-full rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm"
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
            <h3 className="mb-3 text-lg font-medium">Add Policy Chunk</h3>
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

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void upsertPolicy()}
                className="mechanical rounded-[6px] bg-[#6366F1] px-3 py-2 text-sm"
              >
                Save Chunk
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedAudit ? (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[480px] border-l border-[#1F1F21] bg-[#141415] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-medium">Conversation Detail</h3>
            <button
              onClick={() => setSelectedAudit(null)}
              className="mechanical rounded-[6px] border border-[#1F1F21] px-2 py-1 text-xs"
            >
              Close
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <p>
              <span className="text-[#8C8C95]">Role:</span> {selectedAudit.role}
            </p>
            <p>
              <span className="text-[#8C8C95]">Question:</span> {selectedAudit.question}
            </p>
            <p>
              <span className="text-[#8C8C95]">Date:</span> {new Date(selectedAudit.createdAt).toLocaleString()}
            </p>
            <p className="mono rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] p-3 text-xs text-[#B7B7C0]">
              Metadata: {JSON.stringify(selectedAudit.metadata ?? {}, null, 2)}
            </p>
          </div>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-xs text-[#8C8C95]">Refreshing data...</p> : null}
    </main>
  );
}
