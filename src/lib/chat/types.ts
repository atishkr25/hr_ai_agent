export type UserRole = "employee" | "manager" | "hr_admin";

export type PolicyChunk = {
  id: string;
  title: string;
  section: string;
  page: string;
  content: string;
  source: string;
  visibility: UserRole[];
};

export type Citation = {
  title: string;
  section: string;
  page: string;
  source?: string;
  chunkId?: string;
};

export type RetrievalMatch = {
  chunk: PolicyChunk;
  score: number;
};

export type ChatResult = {
  answer: string;
  confidence: number;
  citations: Citation[];
  escalate: boolean;
  escalationReason?: string;
  tone: "neutral-inclusive" | "review-needed";
  policyCoverage: "high" | "medium" | "low";
};
