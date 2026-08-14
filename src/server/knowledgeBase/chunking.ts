/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChunkOptions {
  /** Target chunk size in characters. gemini-embedding-001 handles long
   * inputs fine, but smaller chunks give more precise retrieval — a chunk
   * should be about one policy clause / table row / FAQ answer, not a
   * whole page. */
  targetSize?: number;
  /** Characters of overlap carried from the end of one chunk into the
   * start of the next, so a fact split across a chunk boundary is still
   * findable from either side. */
  overlap?: number;
  /** Chunks shorter than this (after trimming) are dropped — avoids
   * embedding stray whitespace/page-number fragments. */
  minChunkSize?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetSize: 1200,
  overlap: 150,
  minChunkSize: 40,
};

/**
 * Splits raw extracted text (PDF or web page) into overlapping chunks for
 * embedding, preferring to break on paragraph/sentence boundaries rather
 * than mid-sentence.
 */
export function chunkText(rawText: string, options: ChunkOptions = {}): string[] {
  const { targetSize, overlap, minChunkSize } = { ...DEFAULTS, ...options };

  const normalized = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  // Split into paragraphs first, then greedily pack paragraphs into chunks
  // close to targetSize. A paragraph longer than targetSize on its own is
  // further split on sentence boundaries.
  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= targetSize) {
      pieces.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) ?? [para];
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length > targetSize && current.length > 0) {
        pieces.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) pieces.push(current.trim());
  }

  // Pack pieces into overlapping chunks of ~targetSize.
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length + 1 > targetSize) {
      chunks.push(current.trim());
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = tail + "\n\n" + piece;
    } else {
      current = current ? current + "\n\n" + piece : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length >= minChunkSize);
}
