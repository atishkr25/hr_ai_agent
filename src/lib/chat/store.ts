// src/lib/chat/store.ts
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), ".next", "cache", "policies.json");

export function readStore<T>(fallback: T[]): T[] {
  try {
    if (!fs.existsSync(DB_PATH)) return fallback;
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return fallback;
  }
}

export function writeStore<T>(data: T[]): void {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    console.error("[store] Failed to write:", DB_PATH);
  }
}