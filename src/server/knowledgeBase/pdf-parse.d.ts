/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// pdf-parse ships no type declarations of its own; this is a minimal
// surface covering the fields we actually use.
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;

  export default pdfParse;
}
