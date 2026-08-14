/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";

// Standalone, lazily-initialized client — mirrors server.ts's getAiClient()
// but deliberately does NOT import server.ts, since server.ts has top-level
// side effects (app.listen(), Vite dev middleware) that one-off scripts
// (seed/backfill scripts run via `tsx scripts/...`) must not trigger.
let aiClient: GoogleGenAI | null = null;

export function getKbAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}
