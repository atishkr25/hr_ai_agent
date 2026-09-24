import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { AuditEvent } from "./audit";
import type { ConversationRecord, EmployeeAccount, HrTicket, PolicyChunk, PublicEmployee } from "./types";

const MONGODB_URI = process.env.MONGODB_URI?.trim();
const DATABASE_NAME = process.env.MONGODB_DB_NAME?.trim() || "hr-ai-agent";

// Cache the connection on globalThis so dev hot reloads and separately bundled
// route handlers share one connection pool instead of opening new ones.
type MongoCache = {
  client: MongoClient | null;
  db: Db | null;
  promise: Promise<{ client: MongoClient; db: Db }> | null;
};
const globalForMongo = globalThis as typeof globalThis & { __hrAgentMongo?: MongoCache };
const mongoCache: MongoCache = (globalForMongo.__hrAgentMongo ??= { client: null, db: null, promise: null });
const LOCAL_CONVERSATIONS = new Map<string, ConversationRecord>();
const LOCAL_TICKETS = new Map<string, HrTicket>();

export function isMongoConfigured(): boolean {
  return Boolean(MONGODB_URI);
}

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (mongoCache.client && mongoCache.db) {
    return { client: mongoCache.client, db: mongoCache.db };
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  if (!mongoCache.promise) {
    mongoCache.promise = (async () => {
      const client = new MongoClient(MONGODB_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 5000,
      });
      await client.connect();
      const db = client.db(DATABASE_NAME);
      mongoCache.client = client;
      mongoCache.db = db;
      console.log(`[store] Connected to MongoDB database ${DATABASE_NAME}`);
      return { client, db };
    })();
  }

  try {
    return await mongoCache.promise;
  } catch (error) {
    mongoCache.promise = null;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] MongoDB connection failed:", errorMsg);
    throw error;
  }
}

async function getCollection(name: string): Promise<Collection<Document>> {
  const { db } = await connectToDatabase();
  return db.collection<Document>(name);
}

function withoutMongoId<T>(document: T & { _id?: unknown }): T {
  const copy = { ...document } as T & { _id?: unknown };
  delete copy._id;
  return copy as T;
}

export async function readStore<T>(fallback: T[]): Promise<T[]> {
  try {
    const collection = await getCollection("policies");
    const documents = (await collection.find({}).toArray()) as T[];
    return documents.length > 0
      ? documents.map((document) => withoutMongoId(document as T & { _id?: unknown }))
      : fallback;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] Failed to read policies from MongoDB:", errorMsg);
    return fallback;
  }
}

export async function upsertPolicyDocument(chunk: PolicyChunk): Promise<void> {
  const collection = await getCollection("policies");
  await collection.replaceOne({ id: chunk.id }, chunk as unknown as Document, { upsert: true });
}

export async function deactivatePolicyVersions(
  policyKey: string,
  activeDocumentId: string,
): Promise<void> {
  const collection = await getCollection("policies");
  await collection.updateMany(
    { policyKey, documentId: { $ne: activeDocumentId } },
    { $set: { isActive: false, updatedAt: new Date().toISOString() } },
  );
}

export async function writeStore<T>(data: T[]): Promise<void> {
  const collection = await getCollection("policies");
  await collection.deleteMany({});
  if (data.length > 0) {
    await collection.insertMany(data as unknown as Document[]);
  }
}

export async function vectorSearchPolicies(
  queryEmbedding: number[],
  role: string,
  limit: number,
): Promise<Array<{ chunk: PolicyChunk; score: number }>> {
  if (!process.env.MONGODB_VECTOR_INDEX) {
    return [];
  }

  try {
    const collection = await getCollection("policies");
    const documents = (await collection
      .aggregate([
        {
          $vectorSearch: {
            index: process.env.MONGODB_VECTOR_INDEX,
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: Math.max(limit * 20, 100),
            limit,
            filter: { visibility: role },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            documentId: 1,
            chunkIndex: 1,
            title: 1,
            section: 1,
            page: 1,
            content: 1,
            source: 1,
            visibility: 1,
            embedding: 1,
            embeddingModel: 1,
            createdAt: 1,
            updatedAt: 1,
            vectorScore: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray()) as Array<PolicyChunk & { vectorScore?: number }>;

    return documents.map((document) => ({
      chunk: withoutMongoId(document as PolicyChunk & { _id?: unknown }),
      score: Math.max(0, Math.min(1, document.vectorScore ?? 0)),
    }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[store] Atlas vector search unavailable; using local hybrid search:", errorMsg);
    return [];
  }
}

export async function persistAuditEvent(event: AuditEvent): Promise<void> {
  const collection = await getCollection("audit_events");
  await collection.replaceOne({ id: event.id }, event as unknown as Document, { upsert: true });
}

export async function readAuditEvents(limit = 200): Promise<AuditEvent[]> {
  try {
    const collection = await getCollection("audit_events");
    const documents = (await collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 5000)))
      .toArray()) as unknown as AuditEvent[];
    return documents.map((document) => withoutMongoId(document as AuditEvent & { _id?: unknown }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] Failed to read audit events from MongoDB:", errorMsg);
    return [];
  }
}

export async function upsertConversation(conversation: ConversationRecord): Promise<void> {
  LOCAL_CONVERSATIONS.set(conversation.id, conversation);
  try {
    const collection = await getCollection("conversations");
    await collection.replaceOne(
      { id: conversation.id },
      conversation as unknown as Document,
      { upsert: true },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[store] Could not persist conversation:", errorMsg);
  }
}

export async function readConversation(id: string): Promise<ConversationRecord | null> {
  try {
    const collection = await getCollection("conversations");
    const document = await collection.findOne({ id });
    return document
      ? withoutMongoId(document as unknown as ConversationRecord & { _id?: unknown })
      : LOCAL_CONVERSATIONS.get(id) ?? null;
  } catch {
    return LOCAL_CONVERSATIONS.get(id) ?? null;
  }
}

export async function listConversations(limit = 200): Promise<ConversationRecord[]> {
  try {
    const collection = await getCollection("conversations");
    const documents = (await collection
      .find({})
      .sort({ updatedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .toArray()) as unknown as ConversationRecord[];
    return documents.map((document) => withoutMongoId(document as ConversationRecord & { _id?: unknown }));
  } catch {
    return Array.from(LOCAL_CONVERSATIONS.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }
}

export async function upsertHrTicket(ticket: HrTicket): Promise<void> {
  LOCAL_TICKETS.set(ticket.id, ticket);
  try {
    const collection = await getCollection("hr_tickets");
    await collection.replaceOne(
      { id: ticket.id },
      ticket as unknown as Document,
      { upsert: true },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[store] Could not persist HR ticket:", errorMsg);
  }
}

export async function readHrTickets(limit = 200): Promise<HrTicket[]> {
  try {
    const collection = await getCollection("hr_tickets");
    const documents = (await collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .toArray()) as unknown as HrTicket[];
    return documents.map((document) => withoutMongoId(document as HrTicket & { _id?: unknown }));
  } catch {
    return Array.from(LOCAL_TICKETS.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }
}

export async function readHrTicket(id: string): Promise<HrTicket | null> {
  try {
    const collection = await getCollection("hr_tickets");
    const document = await collection.findOne({ id });
    return document
      ? withoutMongoId(document as unknown as HrTicket & { _id?: unknown })
      : LOCAL_TICKETS.get(id) ?? null;
  } catch {
    return LOCAL_TICKETS.get(id) ?? null;
  }
}

export async function persistIngestionHistory<T extends { id: string }>(entry: T): Promise<void> {
  const collection = await getCollection("ingestion_history");
  await collection.replaceOne({ id: entry.id }, entry as unknown as Document, { upsert: true });
}

export async function readIngestionHistory<T>(limit = 100): Promise<T[]> {
  try {
    const collection = await getCollection("ingestion_history");
    const documents = (await collection
      .find({})
      .sort({ uploadedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .toArray()) as T[];
    return documents.map((document) => withoutMongoId(document as T & { _id?: unknown }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] Failed to read ingestion history from MongoDB:", errorMsg);
    return [];
  }
}

let employeeIndexReady: Promise<unknown> | null = null;

async function getEmployeesCollection(): Promise<Collection<Document>> {
  const collection = await getCollection("employees");
  employeeIndexReady ??= collection.createIndex({ email: 1 }, { unique: true }).catch((error) => {
    employeeIndexReady = null;
    throw error;
  });
  await employeeIndexReady;
  return collection;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
  }
}

function toPublicEmployee(account: EmployeeAccount): PublicEmployee {
  const copy: Partial<EmployeeAccount> = { ...account };
  delete copy.passwordHash;
  return copy as PublicEmployee;
}

export async function findEmployeeByEmail(email: string): Promise<EmployeeAccount | null> {
  const collection = await getEmployeesCollection();
  const document = await collection.findOne({ email });
  return document ? withoutMongoId(document as unknown as EmployeeAccount & { _id?: unknown }) : null;
}

export async function insertEmployee(account: EmployeeAccount): Promise<void> {
  const collection = await getEmployeesCollection();
  try {
    await collection.insertOne({ ...account } as unknown as Document);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new DuplicateEmailError();
    }
    throw error;
  }
}

export async function recordEmployeeLogin(id: string): Promise<void> {
  const collection = await getEmployeesCollection();
  await collection.updateOne({ id }, { $set: { lastLoginAt: new Date().toISOString() } });
}

export async function listEmployees(limit = 500): Promise<PublicEmployee[]> {
  const collection = await getEmployeesCollection();
  const documents = (await collection
    .find({})
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(limit, 1000)))
    .toArray()) as unknown as EmployeeAccount[];
  return documents.map((document) => toPublicEmployee(withoutMongoId(document as EmployeeAccount & { _id?: unknown })));
}

export async function updateEmployeeRole(
  id: string,
  role: EmployeeAccount["role"],
): Promise<PublicEmployee | null> {
  const collection = await getEmployeesCollection();
  const document = await collection.findOneAndUpdate(
    { id },
    { $set: { role, updatedAt: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  return document
    ? toPublicEmployee(withoutMongoId(document as unknown as EmployeeAccount & { _id?: unknown }))
    : null;
}
