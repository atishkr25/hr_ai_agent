import OpenAI, { AzureOpenAI } from "openai";
import { runPolicyQa } from "./engine";
import type { Citation, PolicyChunk, UserRole } from "./types";

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
  provider: "openai" | "azure-openai" | "local-fallback";
};

function buildContext(chunks: PolicyChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `--- POLICY ---\nTitle: ${chunk.title}\nSection: ${chunk.section}\nPage: ${chunk.page}\nSource: ${chunk.source}\nContent: ${chunk.content}\n---`,
    )
    .join("\n\n");
}

function sanitizeCitations(citations: AnswerSchema["citations"], chunks: PolicyChunk[]): Citation[] {
  const valid = new Set(chunks.map((chunk) => `${chunk.title}|${chunk.section}|${chunk.page}`));
  const out: Citation[] = [];

  for (const citation of citations) {
    const key = `${citation.title}|${citation.section}|${citation.page}`;
    if (!valid.has(key)) {
      continue;
    }

    out.push({
      title: citation.title,
      section: citation.section,
      page: citation.page,
    });
  }

  return out;
}

function buildFallback(query: string, role: UserRole): ModelAnswer {
  const fallback = runPolicyQa(query, role);

  return {
    answer: fallback.answer,
    citations: fallback.citations,
    escalated: fallback.escalate,
    escalationReason: fallback.escalationReason,
    provider: "local-fallback",
  };
}

function isAnswerSchema(value: unknown): value is AnswerSchema {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnswerSchema>;
  if (typeof candidate.answer !== "string") {
    return false;
  }

  if (typeof candidate.escalated !== "boolean") {
    return false;
  }

  if (!Array.isArray(candidate.citations)) {
    return false;
  }

  return candidate.citations.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.title === "string" &&
      typeof item.section === "string" &&
      typeof item.page === "string",
  );
}

function createClient() {
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
      baseURL: "https://api.groq.com/openai/v1",
    }),
  };
}

  return null;
}

export async function generatePolicyAnswer(
  query: string,
  role: UserRole,
  chunks: PolicyChunk[],
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
    return buildFallback(query, role);
  }

  const context = buildContext(chunks);
  const systemPrompt = `You are HR AI AGENT. Provide policy-grounded HR answers.

Rules:
- Use ONLY provided context.
- Never expose role-restricted information outside context.
- Always include inline citations in answer text using this exact format:
  [Policy: TITLE, Section: SECTION, Page: PAGE]
- If uncertain or insufficient context, set escalated=true and explain briefly.
- Tone must be warm, professional, inclusive.

Return JSON with shape:
{
  "answer": string,
  "citations": [{"title": string, "section": string, "page": string}],
  "escalated": boolean,
  "escalationReason": string (optional)
}`;

  const userPrompt = `Role: ${role}\nQuestion: ${query}\n\nContext:\n${context}`;

  try {
    const completion = await clientConfig.client.chat.completions.create({
      model: clientConfig.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const parsed: unknown = JSON.parse(content);

    if (!isAnswerSchema(parsed)) {
      return buildFallback(query, role);
    }

    const citations = sanitizeCitations(parsed.citations, chunks);

    return {
      answer: parsed.answer,
      citations,
      escalated: parsed.escalated,
      escalationReason: parsed.escalationReason,
      provider: clientConfig.provider,
    };
  } catch {
    return buildFallback(query, role);
  }
}
