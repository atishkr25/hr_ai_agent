import OpenAI, { AzureOpenAI } from "openai";
import { normalizeInclusiveTone } from "./tone";
import { generateGeminiJson, getGeminiApiKey, isGeminiProvider } from "./gemini";
import type { Citation, ConversationTurn, PolicyChunk, UserRole } from "./types";

type AnswerSchema = {
  answer: string;
  citations: Array<{
    title: string;
    section: string;
    page: string;
  }>;
  escalated: boolean;
  escalationReason?: string;
};

export type ModelAnswer = {
  answer: string;
  citations: Citation[];
  escalated: boolean;
  escalationReason?: string;
  provider: "gemini" | "openai" | "azure-openai" | "local-fallback";
};

function buildContext(chunks: PolicyChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `--- POLICY ---\nTitle: ${chunk.title}\nSection: ${chunk.section}\nPage: ${chunk.page}\nSource: ${chunk.source}\nContent: ${chunk.content}\n---`,
    )
    .join("\n\n");
}

function buildConversationContext(history: ConversationTurn[]): string {
  return history
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "Employee" : "Assistant"}: ${turn.content}`)
    .join("\n");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function toCitation(chunk: PolicyChunk): Citation {
  return {
    title: chunk.title,
    section: chunk.section,
    page: chunk.page,
    source: chunk.source,
    chunkId: chunk.id,
  };
}

/**
 * Keeps only citations that point at a retrieved chunk, and replaces the
 * model's wording with the chunk's canonical metadata. Matching tolerates
 * small formatting differences ("3.2 Entitlement" vs "Entitlement", page 12 vs
 * "12") but always requires the policy title to match.
 */
function sanitizeCitations(citations: AnswerSchema["citations"], chunks: PolicyChunk[]): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    const title = normalizeKey(citation.title);
    const section = normalizeKey(citation.section);
    const page = normalizeKey(citation.page);

    const match = chunks.find((chunk) => {
      if (normalizeKey(chunk.title) !== title) {
        return false;
      }
      const chunkSection = normalizeKey(chunk.section);
      const sectionMatches = Boolean(section) && (chunkSection === section || chunkSection.includes(section) || section.includes(chunkSection));
      return sectionMatches || (Boolean(page) && normalizeKey(chunk.page) === page);
    });

    if (!match || seen.has(match.id)) {
      continue;
    }

    seen.add(match.id);
    out.push(toCitation(match));
  }

  return out;
}

// Retrieval score above which the top chunk is trusted enough to be shown
// verbatim when no model is available to compose an answer.
const FALLBACK_MIN_SCORE = 0.5;

function buildFallback(chunks: PolicyChunk[], topScore: number): ModelAnswer {
  const top = chunks[0];
  if (!top || topScore < FALLBACK_MIN_SCORE) {
    return {
      answer: "I don't have enough policy information to answer this confidently. Escalating to your HR team.",
      citations: [],
      escalated: true,
      escalationReason: "AI answer generation was unavailable and the closest policy match was not strong enough to share directly.",
      provider: "local-fallback",
    };
  }

  const citation = toCitation(top);
  return {
    answer: normalizeInclusiveTone(
      `Here is the most relevant policy guidance: ${top.content} [Policy: ${citation.title}, Section: ${citation.section}, Page: ${citation.page}]`,
    ),
    citations: [citation],
    escalated: false,
    provider: "local-fallback",
  };
}

function coerceAnswerSchema(value: unknown): AnswerSchema | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.answer !== "string" || !candidate.answer.trim()) {
    return null;
  }

  const rawCitations = Array.isArray(candidate.citations) ? candidate.citations : [];
  const citations = rawCitations
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      title: String(item.title ?? ""),
      section: String(item.section ?? ""),
      page: String(item.page ?? ""),
    }))
    .filter((item) => item.title);

  return {
    answer: candidate.answer.trim(),
    citations,
    escalated: candidate.escalated === true || candidate.escalated === "true",
    escalationReason: typeof candidate.escalationReason === "string" ? candidate.escalationReason : undefined,
  };
}

type GeminiClientConfig = {
  provider: "gemini";
  model: string;
  apiKey: string;
};

function createClient() {
  const geminiKey = getGeminiApiKey();
  if (isGeminiProvider() && geminiKey) {
    return {
      provider: "gemini" as const,
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
      apiKey: geminiKey,
    } satisfies GeminiClientConfig;
  }

  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";

  if (azureKey && azureEndpoint) {
    return {
      provider: "azure-openai" as const,
      model: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini",
      client: new AzureOpenAI({
        apiKey: azureKey,
        endpoint: azureEndpoint,
        apiVersion: azureApiVersion,
      }),
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: "openai" as const,
      model: process.env.OPENAI_MODEL ?? "llama3-70b-8192",
      client: new OpenAI({
        apiKey: openaiKey,
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1",
      }),
    };
  }

  return null;
}

function parseJsonResponse(content: string): unknown {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(normalized);
}

export async function generatePolicyAnswer(
  query: string,
  role: UserRole,
  chunks: PolicyChunk[],
  history: ConversationTurn[] = [],
  topScore = 1,
): Promise<ModelAnswer> {
  if (!chunks.length) {
    return {
      answer: "I don't have enough policy information to answer this confidently. Escalating to your HR team.",
      citations: [],
      escalated: true,
      escalationReason: "No policy chunks were retrieved.",
      provider: "local-fallback",
    };
  }

  const clientConfig = createClient();
  if (!clientConfig) {
    return buildFallback(chunks, topScore);
  }

  const context = buildContext(chunks);
  const systemPrompt = `You are HR AI AGENT. Provide policy-grounded HR answers.

Rules:
- Use ONLY the provided policy context. Never use outside knowledge or assumptions.
- The context comes from a search and may be only loosely related. If it does not directly answer the specific question, set escalated=true instead of answering a different question.
- Conversation history may clarify references such as "that policy", but it is not a source of truth.
- Never expose role-restricted information outside context.
- Always include inline citations in the answer text using this exact format:
  [Policy: TITLE, Section: SECTION, Page: PAGE]
  copying TITLE, SECTION and PAGE exactly as they appear in the context.
- If uncertain or the context is insufficient, set escalated=true, leave citations empty, and briefly and kindly explain that HR will follow up.
- Tone must be warm, professional, and inclusive (gender-neutral, no assumptions about family structure).
- Keep answers concise: two to four sentences unless more detail is needed.

Return JSON with shape:
{
  "answer": string,
  "citations": [{"title": string, "section": string, "page": string}],
  "escalated": boolean,
  "escalationReason": string (optional)
}`;

  const historyContext = buildConversationContext(history);
  const userPrompt = `Role: ${role}\nQuestion: ${query}\n\nRecent conversation:\n${historyContext || "No prior conversation."}\n\nCurrent policy context:\n${context}`;

  const requestModel = async (): Promise<string> =>
    clientConfig.provider === "gemini"
      ? generateGeminiJson(clientConfig.model, systemPrompt, userPrompt, clientConfig.apiKey)
      : (await clientConfig.client.chat.completions.create({
          model: clientConfig.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        })).choices[0]?.message?.content ?? "";

  // One retry absorbs occasional malformed JSON or transient provider errors
  // before degrading to the local fallback.
  let parsed: AnswerSchema | null = null;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
    try {
      const content = await requestModel();
      try {
        parsed = coerceAnswerSchema(parseJsonResponse(content));
      } catch {
        parsed = null;
      }
      if (!parsed) {
        console.warn(`[llm] ${clientConfig.provider} returned an unexpected response (attempt ${attempt}):`, content.slice(0, 300));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[llm] ${clientConfig.provider} answer generation failed (attempt ${attempt}):`, errorMsg);
    }
  }

  if (!parsed) {
    return buildFallback(chunks, topScore);
  }

  const citations = sanitizeCitations(parsed.citations, chunks);

  if (!parsed.escalated && citations.length === 0) {
    return {
      answer: "I could not validate this answer against an approved HR policy. Escalating to HR for review.",
      citations: [],
      escalated: true,
      escalationReason: "Model returned no citation that matched retrieved policy context.",
      provider: clientConfig.provider,
    };
  }

  if (parsed.escalated) {
    return {
      answer: parsed.answer,
      citations: [],
      escalated: true,
      escalationReason: parsed.escalationReason || "The model reported insufficient policy context.",
      provider: clientConfig.provider,
    };
  }

  return {
    answer: parsed.answer,
    citations,
    escalated: false,
    provider: clientConfig.provider,
  };
}
