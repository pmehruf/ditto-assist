/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getKbAiClient } from "./geminiClient.js";

// gemini-embedding-001 natively outputs 3072 dims; we truncate to 768 via
// Matryoshka Representation Learning (outputDimensionality) to keep the
// pgvector HNSW index a manageable size while retaining most retrieval
// quality. This constant MUST match the `vector(768)` column width in
// drizzle/0028_knowledge_base.sql / schema.ts's kbChunks.embedding.
export const KB_EMBEDDING_MODEL = "gemini-embedding-001";
export const KB_EMBEDDING_DIMENSIONS = 768;

const EMBED_BATCH_SIZE = 20;

/** Embeds document chunks (PDF/web content going INTO the index). Uses the
 * RETRIEVAL_DOCUMENT task type, which Gemini's embedding model optimizes
 * differently from query embeddings for better retrieval alignment. */
export async function embedDocumentChunks(texts: string[]): Promise<number[][]> {
  return embedBatched(texts, "RETRIEVAL_DOCUMENT");
}

/** Embeds an advisor's question at query time. Uses RETRIEVAL_QUERY, the
 * counterpart task type to RETRIEVAL_DOCUMENT above. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatched([text], "RETRIEVAL_QUERY");
  return vector;
}

async function embedBatched(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getKbAiClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await ai.models.embedContent({
      model: KB_EMBEDDING_MODEL,
      contents: batch,
      config: {
        outputDimensionality: KB_EMBEDDING_DIMENSIONS,
        taskType,
      },
    });
    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: sent ${batch.length} texts, got ${embeddings.length} embeddings back`);
    }
    for (const e of embeddings) {
      if (!e.values) throw new Error("Embedding response missing values");
      results.push(e.values);
    }
  }
  return results;
}
