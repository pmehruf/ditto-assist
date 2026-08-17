/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import type { KbResourceRow, kbDocumentTypeEnum } from "../db/schema.js";
import { contentHash, ingestPdfResource } from "./pdfIngest.js";
import { chunkText } from "./chunking.js";
import { embedDocumentChunks } from "./embeddings.js";

type KbDocumentType = (typeof kbDocumentTypeEnum.enumValues)[number];

/**
 * Ingests a document by URL rather than an uploaded file — the "Add by URL"
 * counterpart to pdfIngest.ts's upload flow, used for both the admin's
 * one-off "paste a link" action and scripts/seedKnowledgeBaseUrls.ts's bulk
 * import. Two shapes, auto-detected by the response's Content-Type (falling
 * back to the URL's own ".pdf" extension, since some servers mislabel PDFs
 * as application/octet-stream):
 *   - PDF at a URL (a hosted policy wording, claim-process PDF, etc.) —
 *     downloaded and handed to pdfIngest.ts's existing extract/chunk/embed
 *     pipeline unchanged, just sourced from bytes instead of a browser upload.
 *   - An ordinary web page (an insurer's "how to claim" article, a glossary,
 *     etc.) — HTML is fetched and reduced to plain text (see extractHtmlText
 *     below), then chunked/embedded the same way.
 * Both paths share pdfIngest.ts's idempotency convention: content is hashed,
 * and if a previously-active resource's hash is unchanged, re-ingestion (and
 * its embedding cost) is skipped.
 */

const FETCH_TIMEOUT_MS = 30_000;
// Header values must be Latin1/ByteString-safe — no em dashes or other
// non-Latin1 characters, or fetch() throws "Cannot convert argument to a
// ByteString" before the request is even sent.
const FETCH_USER_AGENT = "Mozilla/5.0 (compatible; DittoAssistKB/1.0; +https://ditto.sh) - Knowledge Base document ingestion";

async function fetchUrl(url: string): Promise<{ contentType: string; buffer: Buffer }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": FETCH_USER_AGENT, Accept: "application/pdf,text/html;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Fetching the URL failed (HTTP ${res.status} ${res.statusText}).`);
    const contentType = res.headers.get("content-type") || "";
    const arrayBuffer = await res.arrayBuffer();
    return { contentType, buffer: Buffer.from(arrayBuffer) };
  } finally {
    clearTimeout(timeout);
  }
}

export function looksLikePdfUrl(url: string, contentType?: string): boolean {
  if (contentType && contentType.toLowerCase().includes("application/pdf")) return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".pdf");
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}

/**
 * Reduces raw HTML to plain readable text. Deliberately lightweight (regex-
 * based, no DOM/readability library dependency) rather than a full
 * readability parser — good enough for the informational insurer articles
 * and glossaries this is built for, at the cost of leaving some residual
 * navigation/footer link text in the extracted content. That residual noise
 * mostly lands in its own low-signal chunks that rarely win a retrieval
 * match against the genuinely relevant paragraphs, so it doesn't meaningfully
 * hurt answer quality — see chunking.ts.
 */
export function extractHtmlText(html: string): string {
  let text = html
    // Remove whole elements whose content is never article text.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    // Block-level tags become paragraph breaks before their content is
    // stripped, so sentences from different elements don't run together.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip every remaining tag.
    .replace(/<[^>]+>/g, " ")
    // Common HTML entities.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Collapse whitespace: multiple blank lines -> one, runs of spaces/tabs -> one.
  text = text
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return text.trim();
}

export interface IngestUrlInput {
  /** Existing resource to re-ingest (reuses its id/title unless overridden),
   * or omit to create a new one. */
  resourceId?: number;
  categoryId: number;
  title: string;
  url: string;
  addedBy: string;
  /** What kind of document this is (brochure/policy_wording/prospectus/
   * addon) — defaults to "other" when omitted. Applies whichever pipeline
   * (PDF or web page) this URL is auto-detected as. */
  documentType?: KbDocumentType;
}

export interface IngestUrlResult {
  resource: KbResourceRow;
  chunkCount: number;
  skipped: boolean;
  detectedType: "pdf" | "web";
}

/** Core web-page ingestion once the HTML has already been fetched — shared
 * by ingestUrlResource (below) so a page is never fetched twice just to
 * decide, then re-process, its type. */
async function ingestWebBuffer(repos: Repositories, input: IngestUrlInput, htmlBuffer: Buffer): Promise<{ resource: KbResourceRow; chunkCount: number; skipped: boolean }> {
  let resource = input.resourceId ? await repos.kbResources.get(input.resourceId) : undefined;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: input.categoryId,
      type: "web",
      title: input.title,
      documentType: input.documentType ?? "other",
      sourceUrl: input.url,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      addedBy: input.addedBy,
    });
  } else {
    resource = await repos.kbResources.update(resource.id, {
      status: "processing",
      errorMessage: null,
      ...(input.documentType ? { documentType: input.documentType } : {}),
    });
  }
  const resourceId = resource!.id;

  try {
    const text = extractHtmlText(htmlBuffer.toString("utf-8"));
    if (!text || text.length < 40) {
      throw new Error("No extractable text found on the page (JavaScript-rendered content this fetcher can't see?).");
    }
    const hash = contentHash(text);

    if (resource!.status !== "error" && resource!.contentHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, { status: "active", lastFetchedAt: new Date() });
      return { resource: unchanged!, chunkCount: resource!.chunkCount, skipped: true };
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("Extracted text was too short to chunk after cleanup.");

    const vectors = await embedDocumentChunks(chunks);
    await repos.kbChunks.deleteByResource(resourceId);
    await repos.kbChunks.bulkInsert(
      chunks.map((content, index) => ({ resourceId, chunkIndex: index, content, embedding: vectors[index] }))
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

/**
 * Auto-detecting entry point — used by both the admin "Add by URL" action
 * and scripts/seedKnowledgeBaseUrls.ts. Fetches the URL once, decides PDF vs.
 * web page from the real Content-Type (falling back to a ".pdf" extension
 * check), and routes to the matching pipeline:
 *   - PDF: handed to pdfIngest.ts's ingestPdfResource unchanged, with the
 *     URL itself stored as sourceUrl instead of an uploaded filename.
 *   - Web page: reduced to text via extractHtmlText and chunked/embedded
 *     the same way a PDF's extracted text is.
 */
export async function ingestUrlResource(repos: Repositories, input: IngestUrlInput): Promise<IngestUrlResult> {
  const { contentType, buffer } = await fetchUrl(input.url);

  if (looksLikePdfUrl(input.url, contentType)) {
    const result = await ingestPdfResource(repos, {
      resourceId: input.resourceId,
      categoryId: input.categoryId,
      title: input.title,
      sourceLabel: input.url,
      documentType: input.documentType,
      buffer,
      addedBy: input.addedBy,
    });
    return { ...result, detectedType: "pdf" };
  }

  const result = await ingestWebBuffer(repos, input, buffer);
  return { ...result, detectedType: "web" };
}
