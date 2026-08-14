/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pdfParse from "pdf-parse";
import type { Repositories } from "../db/repositories/index.js";
import type { KbResourceRow } from "../db/schema.js";
import { chunkText } from "./chunking.js";
import { embedDocumentChunks } from "./embeddings.js";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function extractPdfText(filePathOrBuffer: string | Buffer): Promise<string> {
  const buffer = typeof filePathOrBuffer === "string" ? await readFile(filePathOrBuffer) : filePathOrBuffer;
  const result = await pdfParse(buffer);
  return result.text;
}

export interface IngestPdfInput {
  /** Existing resource to re-ingest (reuses its id/title unless overridden),
   * or omit to create a new one. */
  resourceId?: number;
  categoryId: number;
  title: string;
  /** Free-form origin label stored in sourceUrl for PDFs — e.g. the
   * original filename — since there's no real URL. */
  sourceLabel?: string;
  buffer: Buffer;
  /** Email of the admin who triggered this ingestion, or a fixed label
   * like "seed-script" for one-off imports. */
  addedBy: string;
}

export interface IngestPdfResult {
  resource: KbResourceRow;
  chunkCount: number;
  skipped: boolean;
}

/**
 * Extracts, chunks, embeds, and stores one PDF's content. Idempotent: if
 * the extracted text's hash matches the resource's stored contentHash,
 * re-ingestion is skipped (no wasted embedding calls) unless the resource
 * was previously errored — a resource in "error" status is always retried.
 */
export async function ingestPdfResource(repos: Repositories, input: IngestPdfInput): Promise<IngestPdfResult> {
  let resource = input.resourceId ? await repos.kbResources.get(input.resourceId) : undefined;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: input.categoryId,
      type: "pdf",
      title: input.title,
      sourceUrl: input.sourceLabel ?? null,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      addedBy: input.addedBy,
    });
  } else {
    resource = await repos.kbResources.update(resource.id, { status: "processing", errorMessage: null });
  }
  const resourceId = resource!.id;

  try {
    const text = await extractPdfText(input.buffer);
    const hash = contentHash(text);

    if (resource!.status !== "error" && resource!.contentHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, {
        status: "active",
        lastFetchedAt: new Date(),
      });
      return { resource: unchanged!, chunkCount: resource!.chunkCount, skipped: true };
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("No extractable text found in PDF (scanned image with no OCR layer?)");
    }

    const vectors = await embedDocumentChunks(chunks);

    await repos.kbChunks.deleteByResource(resourceId);
    await repos.kbChunks.bulkInsert(
      chunks.map((content, index) => ({
        resourceId,
        chunkIndex: index,
        content,
        embedding: vectors[index],
      })),
    );

    const updated = await repos.kbResources.update(resourceId, {
      status: "active",
      contentHash: hash,
      lastFetchedAt: new Date(),
      chunkCount: chunks.length,
      errorMessage: null,
    });

    return { resource: updated!, chunkCount: chunks.length, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errored = await repos.kbResources.update(resourceId, { status: "error", errorMessage: message });
    return { resource: errored!, chunkCount: 0, skipped: false };
  }
}
