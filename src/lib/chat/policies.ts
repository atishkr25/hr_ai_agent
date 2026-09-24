import type { PolicyChunk } from "./types";
import { deactivatePolicyVersions as deactivatePolicyVersionsInStore, readStore, upsertPolicyDocument } from "./store";
import { EMBEDDING_MODEL, embedTexts, hasCompatibleEmbedding, isEmbeddingConfigured } from "./embeddings";

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

// Load from MongoDB, fall back to seed data
let POLICY_CHUNKS: PolicyChunk[] = [...SEED_CHUNKS];
let loadedAt = 0;
let loadPromise: Promise<void> | null = null;
let embeddingBackfillPromise: Promise<void> | null = null;
let embeddingBackfillRetryAt = 0;

// MongoDB is the source of truth. Route handlers can run in separate module
// instances, so the in-memory cache is refreshed periodically to pick up
// documents ingested or edited through another route.
const REFRESH_INTERVAL_MS = 10_000;
const EMBEDDING_BACKFILL_RETRY_MS = 60_000;

async function ensureInitialized(forceRefresh = false): Promise<void> {
  const stale = Date.now() - loadedAt > REFRESH_INTERVAL_MS;
  if (loadedAt && !stale && !forceRefresh) {
    return;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const chunks = await readStore<PolicyChunk>(SEED_CHUNKS);
        if (!loadedAt) {
          console.log(`[policies] Initialized with ${chunks.length} chunks`);
        }
        POLICY_CHUNKS = chunks;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("[policies] Failed to load from MongoDB:", errorMsg);
      } finally {
        loadedAt = Date.now();
        loadPromise = null;
      }
    })();
  }

  await loadPromise;
}

export function listPolicies(): PolicyChunk[] {
  return POLICY_CHUNKS.filter((chunk) => chunk.isActive !== false);
}

function embeddingInput(chunk: PolicyChunk): string {
  return `${chunk.title}\n${chunk.section}\n${chunk.content}`;
}

/**
 * Generates embeddings for active chunks that have none, or whose stored vector
 * came from a different model or dimensionality (for example, vectors created
 * before GEMINI_EMBEDDING_DIMENSIONS was set). Mismatched vectors can never be
 * compared with query vectors, so leaving them in place disables semantic search.
 */
async function backfillEmbeddings(): Promise<void> {
  const stale = listPolicies().filter(
    (chunk) => !hasCompatibleEmbedding(chunk.embedding, chunk.embeddingModel),
  );
  if (!stale.length) {
    return;
  }

  const embeddings = await embedTexts(stale.map(embeddingInput));
  let updatedCount = 0;

  for (let index = 0; index < stale.length; index += 1) {
    const chunk = stale[index];
    const embedding = embeddings[index];
    if (!embedding) {
      continue;
    }

    const updated = {
      ...chunk,
      embedding,
      embeddingModel: EMBEDDING_MODEL,
      updatedAt: new Date().toISOString(),
    };
    const position = POLICY_CHUNKS.findIndex((item) => item.id === chunk.id);
    if (position >= 0) {
      POLICY_CHUNKS[position] = updated;
    }
    updatedCount += 1;

    try {
      await upsertPolicyDocument(updated);
    } catch (error) {
      console.warn("[policies] Could not persist generated embedding:", error);
    }
  }

  console.log(`[policies] Embedded ${updatedCount}/${stale.length} chunks with ${EMBEDDING_MODEL}`);
  if (updatedCount < stale.length) {
    embeddingBackfillRetryAt = Date.now() + EMBEDDING_BACKFILL_RETRY_MS;
  }
}

async function ensureEmbeddings(): Promise<void> {
  if (!isEmbeddingConfigured() || Date.now() < embeddingBackfillRetryAt) {
    return;
  }

  if (!embeddingBackfillPromise) {
    embeddingBackfillPromise = backfillEmbeddings()
      .catch((error) => {
        embeddingBackfillRetryAt = Date.now() + EMBEDDING_BACKFILL_RETRY_MS;
        console.warn("[policies] Embedding backfill skipped:", error);
      })
      .finally(() => {
        embeddingBackfillPromise = null;
      });
  }

  await embeddingBackfillPromise;
}

export async function listPoliciesAsync(includeInactive = false): Promise<PolicyChunk[]> {
  await ensureInitialized();
  await ensureEmbeddings();
  return includeInactive ? POLICY_CHUNKS : listPolicies();
}

export async function upsertPolicyChunk(chunk: PolicyChunk): Promise<PolicyChunk> {
  await ensureInitialized();

  let preparedChunk = {
    ...chunk,
    updatedAt: new Date().toISOString(),
  };

  if (!hasCompatibleEmbedding(preparedChunk.embedding, preparedChunk.embeddingModel) && isEmbeddingConfigured()) {
    try {
      const [embedding] = await embedTexts([embeddingInput(preparedChunk)]);
      if (embedding) {
        preparedChunk = {
          ...preparedChunk,
          embedding,
          embeddingModel: EMBEDDING_MODEL,
        };
      }
    } catch (error) {
      console.warn("[policies] Could not generate chunk embedding:", error);
    }
  }

  const existingIndex = POLICY_CHUNKS.findIndex((item) => item.id === chunk.id);

  if (existingIndex >= 0) {
    POLICY_CHUNKS[existingIndex] = preparedChunk;
  } else {
    POLICY_CHUNKS.push(preparedChunk);
  }

  try {
    await upsertPolicyDocument(preparedChunk);
  } catch (error) {
    console.error("[policies] Failed to persist policy chunk:", error);
  }

  return preparedChunk;
}

export async function upsertPolicyChunks(chunks: PolicyChunk[]): Promise<PolicyChunk[]> {
  await ensureInitialized();
  if (!chunks.length) {
    return [];
  }

  const preparedChunks = chunks.map((chunk) => ({
    ...chunk,
    updatedAt: new Date().toISOString(),
  }));

  if (isEmbeddingConfigured()) {
    try {
      const embeddings = await embedTexts(preparedChunks.map(embeddingInput));
      for (let index = 0; index < preparedChunks.length; index += 1) {
        const embedding = embeddings[index];
        if (embedding) {
          preparedChunks[index] = {
            ...preparedChunks[index],
            embedding,
            embeddingModel: EMBEDDING_MODEL,
          };
        }
      }
    } catch (error) {
      console.warn("[policies] Could not generate document embeddings:", error);
    }
  }

  for (const chunk of preparedChunks) {
    const existingIndex = POLICY_CHUNKS.findIndex((item) => item.id === chunk.id);
    if (existingIndex >= 0) {
      POLICY_CHUNKS[existingIndex] = chunk;
    } else {
      POLICY_CHUNKS.push(chunk);
    }

    try {
      await upsertPolicyDocument(chunk);
    } catch (error) {
      console.error("[policies] Failed to persist policy chunk:", error);
    }
  }

  return preparedChunks;
}

export async function deactivatePolicyVersion(
  policyKey: string,
  activeDocumentId: string,
): Promise<void> {
  await ensureInitialized();
  POLICY_CHUNKS = POLICY_CHUNKS.map((chunk) =>
    chunk.policyKey === policyKey && chunk.documentId !== activeDocumentId
      ? { ...chunk, isActive: false, updatedAt: new Date().toISOString() }
      : chunk,
  );

  try {
    await deactivatePolicyVersionsInStore(policyKey, activeDocumentId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[policies] Could not persist inactive policy version:", errorMsg);
  }
}
