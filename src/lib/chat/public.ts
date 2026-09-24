import type { PolicyChunk } from "./types";

export function toPublicPolicyChunk(chunk: PolicyChunk): PolicyChunk {
  const safeChunk = { ...chunk };
  delete safeChunk.embedding;
  delete safeChunk.embeddingModel;
  return safeChunk;
}
