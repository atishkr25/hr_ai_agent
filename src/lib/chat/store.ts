// src/lib/chat/store.ts
import { MongoClient, Db, Collection } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is not set");
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db("hr-ai-agent");
    
    cachedClient = client;
    cachedDb = db;

    console.log("[store] Connected to MongoDB successfully");
    return { client, db };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] MongoDB connection failed:", errorMsg);
    throw error;
  }
}

export async function readStore<T>(fallback: T[]): Promise<T[]> {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection("policies");
    const documents = await collection.find({}).toArray() as unknown as T[];
    return documents.length > 0 ? documents : fallback;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] Failed to read from MongoDB:", errorMsg);
    return fallback;
  }
}

export async function writeStore<T>(data: T[]): Promise<void> {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection("policies");
    
    // Clear existing data and insert new data
    await collection.deleteMany({});
    if (data.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await collection.insertMany(data as any[]);
    }
    
    console.log(`[store] Successfully wrote ${data.length} documents to MongoDB`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[store] Failed to write to MongoDB:", errorMsg);
    throw error;
  }
}