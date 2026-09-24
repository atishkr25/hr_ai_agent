import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { resolveRoleFromRequest } from "@/lib/chat/role";
import { deactivatePolicyVersion, listPoliciesAsync, upsertPolicyChunks } from "@/lib/chat/policies";
import { persistIngestionHistory, readIngestionHistory } from "@/lib/chat/store";
import { chunkExtractedPages } from "@/lib/ingestion/chunk";
import { extractDocxDocument, extractPdfDocument } from "@/lib/ingestion/extract";
import type { UserRole } from "@/lib/chat/types";

export const runtime = "nodejs";

type UploadFileType = "pdf" | "docx";

interface IngestionHistoryEntry {
  id: string;
  filename: string;
  fileType: UploadFileType;
  chunkCount: number;
  upserted: number;
  status: "ready" | "partial" | "failed";
  ocrUsed: boolean;
  uploadedAt: string;
}

const INGESTION_HISTORY: IngestionHistoryEntry[] = [];
let historyLoaded = false;

async function ensureHistoryLoaded(): Promise<void> {
  if (historyLoaded) {
    return;
  }

  historyLoaded = true;
  const persisted = await readIngestionHistory<IngestionHistoryEntry>(100);
  INGESTION_HISTORY.push(...persisted);
}

export async function POST(req: NextRequest) {
  try {
    const role = resolveRoleFromRequest(req);
    if (role !== "hr_admin") {
      return NextResponse.json(
        { error: "Unauthorized. HR admin role required." },
        { status: 403 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const filename = file.name;
    const lowerName = filename.toLowerCase();
    const fileType: UploadFileType | null = lowerName.endsWith(".pdf")
      ? "pdf"
      : lowerName.endsWith(".docx")
        ? "docx"
        : null;

    if (!fileType) {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are supported." },
        { status: 400 },
      );
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = fileType === "pdf"
      ? await extractPdfDocument(buffer)
      : await extractDocxDocument(buffer);
    const extractedTextLength = extracted.pages.reduce((sum, page) => sum + page.text.length, 0);

    if (extractedTextLength < 100) {
      return NextResponse.json(
        {
          error: "Could not extract enough text. The file may be encrypted, empty, or an unsupported scanned document.",
          ocrUsed: extracted.ocrUsed,
        },
        { status: 422 },
      );
    }

    const documentId = uuidv4();
    const policyKey = String(formData.get("policyKey") ?? "").trim() || undefined;
    const version = String(formData.get("version") ?? "").trim() || undefined;
    const requestedVisibility = String(formData.get("visibility") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item): item is UserRole => item === "employee" || item === "manager" || item === "hr_admin");
    // HR admins must always be able to see and manage what they upload.
    const visibility = requestedVisibility.length
      ? Array.from(new Set<UserRole>([...requestedVisibility, "hr_admin"]))
      : undefined;
    const chunks = chunkExtractedPages(extracted.pages, filename, documentId, { policyKey, version, visibility });
    if (!chunks.length) {
      return NextResponse.json(
        { error: "No usable policy sections were found in this document." },
        { status: 422 },
      );
    }

    const savedChunks = await upsertPolicyChunks(chunks);
    const activePolicyKey = chunks[0]?.policyKey;
    if (activePolicyKey) {
      await deactivatePolicyVersion(activePolicyKey, documentId).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn("[ingest] Could not deactivate older policy version:", errorMsg);
      });
    }
    const historyEntry: IngestionHistoryEntry = {
      id: documentId,
      filename,
      fileType,
      chunkCount: chunks.length,
      upserted: savedChunks.length,
      status: savedChunks.length === chunks.length ? "ready" : "partial",
      ocrUsed: extracted.ocrUsed,
      uploadedAt: new Date().toISOString(),
    };

    await ensureHistoryLoaded();
    INGESTION_HISTORY.unshift(historyEntry);
    if (INGESTION_HISTORY.length > 100) {
      INGESTION_HISTORY.pop();
    }
    await persistIngestionHistory(historyEntry).catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn("[ingest] Could not persist ingestion history:", errorMsg);
    });

    return NextResponse.json({
      filename,
      fileType,
      documentId,
      policyKey: activePolicyKey,
      version: chunks[0]?.version,
      visibility: chunks[0]?.visibility,
      chunkCount: savedChunks.length,
      upserted: savedChunks.length,
      status: historyEntry.status,
      ocrUsed: extracted.ocrUsed,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[ingest] error:", errorMsg);
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development"
          ? `Ingestion failed: ${errorMsg}`
          : "Ingestion failed. Please verify the document and try again.",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const role = resolveRoleFromRequest(req);
  if (role !== "hr_admin") {
    return NextResponse.json(
      { error: "Unauthorized. HR admin role required." },
      { status: 403 },
    );
  }

  await ensureHistoryLoaded();
  const policies = await listPoliciesAsync();
  const docs: Record<string, { title: string; chunkCount: number }> = {};

  for (const policy of policies) {
    if (!docs[policy.title]) {
      docs[policy.title] = { title: policy.title, chunkCount: 0 };
    }
    docs[policy.title].chunkCount += 1;
  }

  return NextResponse.json({
    docs: Object.values(docs),
    history: INGESTION_HISTORY,
  });
}
