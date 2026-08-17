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
    // Lossless sentence split: only breaks where sentence-ending punctuation
    // is followed by real whitespace. Using .split() (not .match()) is the
    // point — .match() with a two-alternative regex like the one this
    // replaced silently DROPS any span of text it can't match (e.g. numbered
    // clause headings like "3.1.5" or abbreviations like "etc.)", where a
    // period is followed by a digit/paren instead of whitespace), which was
    // caught deleting whole policy clauses from ingested PDFs. split() can
    // never drop characters — every character lands in some piece — so this
    // has no unmatched-span failure mode. "3.1.5" and "etc.)" simply never
    // match the split point (no whitespace directly after the period) and
    // stay attached to their surrounding text instead of vanishing.
    const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length > targetSize && current.length > 0) {
        pieces.push(current.trim());
        current = sentence;
      } else {
        // split() strips the whitespace that used to separate sentences, so
        // it has to be put back here or consecutive sentences would run
        // together with no space between them.
        current = current ? current + " " + sentence : sentence;
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
