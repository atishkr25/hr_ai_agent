import { listPolicies } from "./policies";
import type { RetrievalMatch, UserRole } from "./types";

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
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
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

export function retrievePolicyMatches(
  question: string,
  role: UserRole,
  maxResults = 3,
): RetrievalMatch[] {
  const roleVisibleChunks = listPolicies().filter((chunk) =>
    chunk.visibility.includes(role),
  );

  const scored = roleVisibleChunks
    .map((chunk) => ({
      chunk,
      score: jaccardLikeScore(
        question,
        `${chunk.title} ${chunk.section} ${chunk.page} ${chunk.content}`,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored;
}
