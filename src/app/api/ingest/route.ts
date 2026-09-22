import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { v4 as uuidv4 } from "uuid";
import { resolveRoleFromRequest } from "@/lib/chat/role";

export const runtime = "nodejs";

interface IngestChunk {
  id: string;
  title: string;
  section: string;
  page: number;
  content: string;
  visibleRoles: string[];
}

interface IngestionHistoryEntry {
  id: string;
  filename: string;
  fileType: "pdf" | "docx";
  chunkCount: number;
  upserted: number;
  status: "ready" | "partial" | "failed";
  uploadedAt: string;
}

const INGESTION_HISTORY: IngestionHistoryEntry[] = [];

function chunkText(text: string, filename: string): IngestChunk[] {
  const chunks: IngestChunk[] = [];
  const targetChunkChars = 1600;
  const overlapChars = 200;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 30);

  let currentChunk = "";
  let currentSection = "General";
  let estimatedPage = 1;
  let charCount = 0;

  const headingRegex =
    /^([A-Z][A-Z\s]{4,}|[\d]+[\.)]\s+[A-Z].{0,60}|[A-Z].{0,60}:)\s*$/;

  for (let i = 0; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];

    if (headingRegex.test(paragraph) && paragraph.length < 80) {
      if (currentChunk.trim().length > 100) {
        chunks.push({
          id: uuidv4(),
          title: filename.replace(/\.[^/.]+$/, ""),
          section: currentSection,
          page: estimatedPage,
          content: currentChunk.trim(),
          visibleRoles: ["employee", "manager", "hr_admin"],
        });
      }
      currentSection = paragraph.trim();
      currentChunk = "";
      continue;
    }

    currentChunk += `${currentChunk ? "\n\n" : ""}${paragraph}`;
    charCount += paragraph.length;
    estimatedPage = Math.max(1, Math.floor(charCount / 3000) + 1);

    if (currentChunk.length >= targetChunkChars) {
      chunks.push({
        id: uuidv4(),
        title: filename.replace(/\.[^/.]+$/, ""),
        section: currentSection,
        page: estimatedPage,
        content: currentChunk.trim(),
        visibleRoles: ["employee", "manager", "hr_admin"],
      });

      currentChunk = paragraph ? paragraph.slice(-overlapChars) : "";
    }
  }

  if (currentChunk.trim().length > 100) {
    chunks.push({
      id: uuidv4(),
      title: filename.replace(/\.[^/.]+$/, ""),
      section: currentSection,
      page: estimatedPage,
      content: currentChunk.trim(),
      visibleRoles: ["employee", "manager", "hr_admin"],
    });
  }

  return chunks;
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
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const filename = file.name;
    const lowerName = filename.toLowerCase();
    const fileType = lowerName.endsWith(".pdf")
      ? "pdf"
      : lowerName.endsWith(".docx")
        ? "docx"
        : "unsupported";

    if (fileType === "unsupported") {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are supported." },
        { status: 400 },
      );
    }

    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Max 20MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let rawText = "";
    if (fileType === "pdf") {
      const parsed = await pdfParse(buffer);
      rawText = parsed.text;
    }

    if (fileType === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    }

    if (!rawText || rawText.trim().length < 100) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from this file. It may be scanned or image-based.",
        },
        { status: 422 },
      );
    }

    const chunks = chunkText(rawText, filename);
    if (!chunks.length) {
      return NextResponse.json(
        { error: "No usable content found in this document." },
        { status: 422 },
      );
    }

    const baseUrl = req.nextUrl.origin;
    let upserted = 0;
    const errors: string[] = [];

    for (const chunk of chunks) {
      try {
        const response = await fetch(`${baseUrl}/api/policies`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-role": "hr_admin",
          },
          body: JSON.stringify({
            id: chunk.id,
            title: chunk.title,
            section: chunk.section,
            page: String(chunk.page),
            content: chunk.content,
            source: filename,
            visibility: chunk.visibleRoles,
            visibleRoles: chunk.visibleRoles,
          }),
        });

        if (response.ok) {
          upserted += 1;
        } else {
          errors.push(`Chunk ${chunk.id} failed`);
        }
      } catch {
        errors.push(`Chunk ${chunk.id} error`);
      }
    }

    const status: IngestionHistoryEntry["status"] =
      upserted === 0 ? "failed" : upserted === chunks.length ? "ready" : "partial";

    INGESTION_HISTORY.unshift({
      id: uuidv4(),
      filename,
      fileType,
      chunkCount: chunks.length,
      upserted,
      status,
      uploadedAt: new Date().toISOString(),
    });

    if (INGESTION_HISTORY.length > 100) {
      INGESTION_HISTORY.pop();
    }

    return NextResponse.json({
      filename,
      fileType,
      chunkCount: chunks.length,
      upserted,
      errors: errors.length ? errors : undefined,
      status,
    });
  } catch (error) {
    console.error("[ingest] error:", error);
    return NextResponse.json(
      { error: "Ingestion failed. Please try again." },
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

  const baseUrl = req.nextUrl.origin;
  const response = await fetch(`${baseUrl}/api/policies`, {
    headers: { "x-user-role": "hr_admin" },
  });

  const payload = (await response.json()) as
    | { policies?: Array<{ title: string }> }
    | Array<{ title: string }>;

  const list = Array.isArray(payload) ? payload : payload.policies ?? [];

  const docs: Record<string, { title: string; chunkCount: number }> = {};
  for (const policy of list) {
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
