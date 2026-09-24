import OpenAI from "openai";
import { getGeminiApiKey, isGeminiProvider } from "./gemini";

const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
const OPENAI_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const GEMINI_EMBEDDING_DIMENSIONS = Number.parseInt(
  process.env.GEMINI_EMBEDDING_DIMENSIONS?.trim() || "768",
  10,
);

export const EMBEDDING_MODEL = isGeminiProvider()
  ? GEMINI_EMBEDDING_MODEL
  : OPENAI_EMBEDDING_MODEL;

/**
 * Expected vector length for stored embeddings. Only known up-front for Gemini,
 * where the output dimensionality is requested explicitly.
 */
export const EMBEDDING_DIMENSIONS: number | null = isGeminiProvider()
  ? GEMINI_EMBEDDING_DIMENSIONS
  : null;

// A failing provider is skipped for a short cooldown instead of for the rest of
// the process lifetime, so a transient error (rate limit, network) does not
// permanently disable semantic search.
const PROVIDER_RETRY_COOLDOWN_MS = 60_000;
let providerUnavailableUntil = 0;

function markProviderUnavailable(): void {
  providerUnavailableUntil = Date.now() + PROVIDER_RETRY_COOLDOWN_MS;
}

export function hasCompatibleEmbedding(embedding: number[] | undefined, model?: string): boolean {
  if (!embedding?.length || model !== EMBEDDING_MODEL) {
    return false;
  }

  return EMBEDDING_DIMENSIONS === null || embedding.length === EMBEDDING_DIMENSIONS;
}

function createEmbeddingClient(): OpenAI | null {
  const apiKey = process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseURL = process.env.EMBEDDING_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim();
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

export function isEmbeddingConfigured(): boolean {
  if (isGeminiProvider()) {
    return Boolean(getGeminiApiKey());
  }

  return Boolean(process.env.EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

type GeminiEmbeddingResponse = {
  embeddings?: Array<{
    values?: number[];
  }>;
  error?: {
    message?: string;
  };
};

async function embedTextsWithGemini(
  texts: string[],
  taskType: EmbeddingTaskType,
): Promise<Array<number[] | null>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return texts.map(() => null);
  }

  const batchSize = 100;
  const embeddings: Array<number[] | null> = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            // The batch REST endpoint currently applies these fields from
            // the request root (the SDK exposes them as EmbedContentConfig).
            taskType,
            outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
          })),
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const body = await response.text();
      let message = `Gemini embeddings failed with status ${response.status}.`;
      try {
        const payload = JSON.parse(body) as GeminiEmbeddingResponse;
        message = payload.error?.message || message;
      } catch {
        if (body) {
          message = body.slice(0, 300);
        }
      }
      throw new Error(message);
    }

    const payload = (await response.json()) as GeminiEmbeddingResponse;
    embeddings.push(...(payload.embeddings ?? []).map((item) => item.values ?? null));
  }

  return texts.map((_, index) => embeddings[index] ?? null);
}

export async function embedTexts(
  texts: string[],
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
): Promise<Array<number[] | null>> {
  if (!texts.length) {
    return [];
  }

  if (Date.now() < providerUnavailableUntil) {
    return texts.map(() => null);
  }

  if (isGeminiProvider()) {
    try {
      return await embedTextsWithGemini(texts, taskType);
    } catch (error) {
      markProviderUnavailable();
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn("[embeddings] Gemini provider unavailable:", errorMsg);
      return texts.map(() => null);
    }
  }

  const client = createEmbeddingClient();
  if (!client) {
    return texts.map(() => null);
  }

  try {
    const response = await client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    });

    const byIndex = new Map(response.data.map((item) => [item.index, item.embedding]));
    return texts.map((_, index) => byIndex.get(index) ?? null);
  } catch (error) {
    markProviderUnavailable();
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[embeddings] Embedding provider unavailable:", errorMsg);
    return texts.map(() => null);
  }
}

export async function embedText(
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  const [embedding] = await embedTexts([text], taskType);
  return embedding ?? null;
}
