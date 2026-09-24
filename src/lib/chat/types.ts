export type UserRole = "employee" | "manager" | "hr_admin";

export type PolicyChunk = {
  id: string;
  documentId?: string;
  policyKey?: string;
  version?: string;
  isActive?: boolean;
  chunkIndex?: number;
  title: string;
  section: string;
  page: string;
  content: string;
  source: string;
  visibility: UserRole[];
  embedding?: number[];
  embeddingModel?: string;
  createdAt?: string;
  updatedAt?: string;
  uploadedAt?: string;
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
  lexicalScore?: number;
  semanticScore?: number;
};

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: Citation[];
  escalated?: boolean;
  requestId?: string;
};

export type ConversationRecord = {
  id: string;
  role: UserRole;
  title: string;
  messages: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
};

export type HrTicketStatus = "open" | "in_progress" | "resolved";

export type HrTicket = {
  id: string;
  requestId: string;
  conversationId: string;
  role: UserRole;
  question: string;
  answer: string;
  reason: string;
  status: HrTicketStatus;
  hrResponse?: string;
  notificationStatus?: "pending" | "sent" | "failed" | "not_configured";
  createdAt: string;
  updatedAt: string;
};
