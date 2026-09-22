import type { PolicyChunk } from "./types";
import { readStore, writeStore } from "./store";

const SEED_CHUNKS: PolicyChunk[] = [
  {
    id: "leave-4-2",
    title: "Annual Leave Policy",
    section: "4.2 Carry Forward",
    page: "14",
    source: "LeavePolicy_v2.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Employees may carry forward up to 10 unused annual leave days into the next calendar year. Any leave above the cap is forfeited unless legally mandated exceptions apply.",
  },
  {
    id: "leave-4-3",
    title: "Annual Leave Policy",
    section: "4.3 Tenure Rules",
    page: "15",
    source: "LeavePolicy_v2.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Tenure does not change the carry-forward cap for annual leave. The 10-day cap applies uniformly across employee grades unless an approved local annex states otherwise.",
  },
  {
    id: "leave-3-2",
    title: "Annual Leave Policy",
    section: "3.2 Entitlement",
    page: "12",
    source: "LeavePolicy_v2.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "All full-time employees are entitled to 21 annual leave days per calendar year upon completing probation. Part-time employees receive leave on a pro-rata basis.",
  },
  {
    id: "med-2-1",
    title: "Medical Claims",
    section: "2.1 Processing Time",
    page: "22",
    source: "EmployeeBenefits_2026.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Medical reimbursement claims are processed within 10 business days after all required documentation is submitted and validated.",
  },
  {
    id: "med-5-1",
    title: "Medical Claims",
    section: "5.1 Escalation",
    page: "29",
    source: "EmployeeBenefits_2026.pdf",
    visibility: ["manager", "hr_admin"],
    content: "Claims pending beyond 10 business days should be escalated by managers through HR Operations with claim reference numbers and submission timestamps.",
  },
  {
    id: "parental-3-1",
    title: "Parental Leave",
    section: "3.1 Eligibility",
    page: "8",
    source: "ParentalPolicy_2026.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Employees become eligible for parental leave after 12 months of continuous service prior to expected childbirth or adoption date.",
  },
  {
    id: "parental-3-2",
    title: "Parental Leave",
    section: "3.2 Duration",
    page: "9",
    source: "ParentalPolicy_2026.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Primary caregivers are entitled to 16 weeks of paid parental leave. Secondary caregivers are entitled to 4 weeks. Leave must be taken within 12 months of birth or adoption.",
  },
  {
    id: "wfh-1-1",
    title: "Remote Work Policy",
    section: "1.1 Eligibility",
    page: "3",
    source: "RemoteWorkPolicy_2026.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Employees who have completed 6 months of service and maintained a satisfactory performance rating are eligible to apply for hybrid or fully remote work arrangements.",
  },
  {
    id: "wfh-2-1",
    title: "Remote Work Policy",
    section: "2.1 Equipment Allowance",
    page: "7",
    source: "RemoteWorkPolicy_2026.pdf",
    visibility: ["employee", "manager", "hr_admin"],
    content: "Remote employees receive a one-time equipment allowance of ₹30,000 for home office setup. Receipts must be submitted within 90 days of the remote work agreement start date.",
  },
  {
    id: "security-1-2",
    title: "HR Data Security",
    section: "1.2 Role Access",
    page: "4",
    source: "HRSecurityStandard.pdf",
    visibility: ["hr_admin"],
    content: "Personally identifiable employee compensation and disciplinary records are restricted to HR administrators and authorized compliance personnel only.",
  },
];

// Load from disk, fall back to seed data
let POLICY_CHUNKS: PolicyChunk[] = readStore<PolicyChunk>(SEED_CHUNKS);

// If store was empty, seed it
if (POLICY_CHUNKS.length === 0) {
  POLICY_CHUNKS = [...SEED_CHUNKS];
  writeStore(POLICY_CHUNKS);
}

export function listPolicies(): PolicyChunk[] {
  return POLICY_CHUNKS;
}

export function upsertPolicyChunk(chunk: PolicyChunk): PolicyChunk {
  const existingIndex = POLICY_CHUNKS.findIndex((item) => item.id === chunk.id);

  if (existingIndex >= 0) {
    POLICY_CHUNKS[existingIndex] = chunk;
  } else {
    POLICY_CHUNKS.push(chunk);
  }

  writeStore(POLICY_CHUNKS); // persist to disk
  return POLICY_CHUNKS[existingIndex >= 0 ? existingIndex : POLICY_CHUNKS.length - 1];
}