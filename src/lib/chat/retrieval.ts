import { embedText } from "./embeddings";
import { listPoliciesAsync } from "./policies";
import { vectorSearchPolicies } from "./store";
import type { PolicyChunk, RetrievalMatch, UserRole } from "./types";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "to",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "with",
  "can",
  "be",
  "does",
  "do",
  "how",
  "what",
  "when",
  "where",
  "please",
]);

const QUERY_EQUIVALENTS: Record<string, string> = {
  entitled: "entitlement",
  entitlement: "entitlement",
  many: "entitlement",
  get: "entitlement",
  receive: "entitlement",
  wfh: "remote",
  hybrid: "remote",
  benefits: "benefits",
  eligible: "eligibility",
  qualify: "eligibility",
  qualifies: "eligibility",
  duration: "duration",
  long: "duration",
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => QUERY_EQUIVALENTS[token.trim()] ?? token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return Math.max(0, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

// Embedding cosine similarities occupy a compressed band: unrelated HR text
// still scores around 0.45-0.6 against an HR question, while genuine matches
// score roughly 0.65-0.85. Rescale that band to 0-1 so it can be blended with
// the lexical score and compared against a single confidence threshold.
const SEMANTIC_FLOOR = 0.5;
const SEMANTIC_CEILING = 0.85;

function normalizeSemanticScore(similarity: number): number {
  return Math.max(0, Math.min(1, (similarity - SEMANTIC_FLOOR) / (SEMANTIC_CEILING - SEMANTIC_FLOOR)));
}

function searchableText(chunk: PolicyChunk): string {
  return `${chunk.title} ${chunk.section} ${chunk.page} ${chunk.source} ${chunk.content}`;
}

function jaccardLikeScore(query: string, text: string): number {
  const queryTokens = new Set(tokenize(query));
  const textTokens = new Set(tokenize(text));

  if (queryTokens.size === 0 || textTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(queryTokens.size, 1);
}

/**
 * Hybrid retrieval: lexical overlap catches exact policy terminology while
 * embeddings catch natural-language variations such as "time off" vs "leave".
 * If an Atlas Vector Search index is configured, its results are also folded
 * into the score; otherwise embeddings stored on the chunks are scored locally.
 */
export async function retrievePolicyMatchesHybrid(
  question: string,
  role: UserRole,
  maxResults = 5,
): Promise<RetrievalMatch[]> {
  const policies = await listPoliciesAsync();
  const visiblePolicies = policies.filter((chunk) => chunk.visibility.includes(role));
  const queryEmbedding = await embedText(question, "RETRIEVAL_QUERY");

  const atlasMatches = queryEmbedding
    ? await vectorSearchPolicies(queryEmbedding, role, Math.max(maxResults * 2, 10))
    : [];
  const atlasScores = new Map(atlasMatches.map((match) => [match.chunk.id, match.score]));

  const scored = visiblePolicies
    .map((chunk) => {
      const lexicalScore = jaccardLikeScore(question, searchableText(chunk));
      const localSemanticScore = queryEmbedding && chunk.embedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
      const semanticScore = normalizeSemanticScore(
        Math.max(localSemanticScore, atlasScores.get(chunk.id) ?? 0),
      );
      const hasSemanticSignal = Boolean(queryEmbedding && (chunk.embedding || atlasScores.has(chunk.id)));

      // When no embedding is available, remain fully compatible with the
      // deterministic local search used by the original prototype.
      const score = hasSemanticSignal
        ? 0.7 * semanticScore + 0.3 * lexicalScore
        : lexicalScore;

      return { chunk, score, lexicalScore, semanticScore };
    })
    .filter((item) => item.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);

  return scored;
}
