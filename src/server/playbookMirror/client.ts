/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlaybookMirrorConnectionRepository } from "../db/repositories/playbookMirrorConnectionRepository.js";
import { MIRROR_SPREADSHEET_ID } from "./config.js";
import { getVerifiedMirrorClient } from "./mirrorGrant.js";
import { decryptMirrorRefreshToken } from "./mirrorTokenCrypto.js";
import type { MirrorTextClient } from "./sync.js";

/**
 * Builds the only client the mirror sync may use: from the dedicated
 * read-only grant, re-verified with Google right now. It can only issue GET
 * requests, and only to this spreadsheet's spreadsheets.get endpoint.
 */
export async function createVerifiedMirrorTextClient(
  connections: PlaybookMirrorConnectionRepository,
  spreadsheetId: string = MIRROR_SPREADSHEET_ID
): Promise<MirrorTextClient> {
  const row = await connections.get("Health");
  if (!row) throw new Error("The Playbook mirror is not connected. Connect its read-only Google access first.");
  const verified = await getVerifiedMirrorClient(
    { connectedEmail: row.connectedEmail, refreshToken: decryptMirrorRefreshToken(row.encryptedRefreshToken), grantedScopes: row.grantedScopes },
    { clientId: process.env.GOOGLE_CLIENT_ID || "", clientSecret: process.env.GOOGLE_CLIENT_SECRET || "" }
  );
  const allowedPrefix = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?`;
  return {
    email: verified.email,
    async requestText(url: string): Promise<string> {
      if (!url.startsWith(allowedPrefix)) throw new Error("The Playbook mirror may only read its own spreadsheet.");
      const res = await verified.client.request<string>({ url, method: "GET", responseType: "text" });
      return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    },
  };
}
