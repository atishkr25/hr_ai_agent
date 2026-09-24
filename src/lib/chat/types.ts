export type UserRole = "employee" | "manager" | "hr_admin";

/** The signed-in person, as carried in the session JWT. */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

/** Contact details attached to conversations and HR tickets. */
export type EmployeeContact = {
  id: string;
  name: string;
  email: string;
};

export type EmployeeAccount = {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager";
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type PublicEmployee = Omit<EmployeeAccount, "passwordHash">;

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
  employee?: EmployeeContact;
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
  employee?: EmployeeContact;
  question: string;
  answer: string;
  reason: string;
  status: HrTicketStatus;
  hrResponse?: string;
  notificationStatus?: "pending" | "sent" | "failed" | "not_configured";
  createdAt: string;
  updatedAt: string;
};
