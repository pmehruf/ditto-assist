/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — APPS SCRIPT EXECUTIONS API
 * ---------------------------------------------------------------
 * Read-only access to the QA master workbook's bound Apps Script project's
 * *execution history*, via Google's Apps Script API (Processes resource) —
 * used solely to answer "when did processRawDump (Phase1_DataEngine.gs)
 * last actually run?" for the Workspace's QA Performance card's "Last
 * updated" label, rather than guessing or claiming "just now".
 *
 * Auth: reuses the exact same stored user OAuth grant sheetsClient.ts's
 * "Connect Google Sheets" flow already sets up (see getStoredUserGrantClient
 * there) — that consent now also requests the script.processes scope (see
 * googleOAuth.ts's getQaDashboardSheetsAuthUrl), so no second connect flow
 * is needed. A service account can never substitute here even as a
 * fallback: it isn't a collaborator on the Apps Script project, so it has
 * no execution history to read regardless of any Sheet-level access it's
 * been granted. Whoever connects needs Editor/Owner access to the *script*
 * project itself (Viewer-on-Sheet doesn't carry visibility into the bound
 * script's executions) — if that's not the case, or the stored grant
 * predates this scope, calls here simply return null rather than throwing,
 * since this only ever backs an optional label.
 */

import { getStoredUserGrantClient } from "./sheetsClient.js";

// The Apps Script project bound to the QA master spreadsheet
// (Phase1_DataEngine.gs) — there's no way to discover a script's ID from
// the Sheets API, so this was supplied directly by the script's owner.
export const QA_APPS_SCRIPT_ID = "1y9vvCVmtYABBAfWNpg_Ob5cxl-2eXozwaoZsgq_6qzeeQXaYO4pUZfGi";

interface ScriptProcess {
  functionName?: string;
  processStatus?: string;
  processType?: string;
  startTime?: string; // RFC3339
  duration?: string; // Duration string, e.g. "12.345s"
}

/** Parses an Apps Script API Duration string ("12.345s") into milliseconds.
 * Returns 0 (rather than throwing) for any shape that doesn't match — a
 * missing/malformed duration should degrade to "started at X", not break
 * the whole lookup. */
function durationToMs(duration?: string): number {
  if (!duration) return 0;
  const match = /^(-?[\d.]+)s$/.exec(duration.trim());
  if (!match) return 0;
  const seconds = parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

/**
 * Most recent COMPLETED execution of `functionName` on the QA Apps Script
 * project — real trigger history, not an estimate. Returns null (never
 * throws) whenever this can't be answered: no stored grant yet, a grant
 * that predates the script.processes scope, or a connected account without
 * Editor/Owner access to the script project — all of those are expected,
 * recoverable states for an optional "Last updated" label, not errors
 * worth surfacing to the advisor viewing their Workspace.
 */
export async function getLastExecutionTime(functionName: string): Promise<Date | null> {
  const client = await getStoredUserGrantClient();
  if (!client) return null;

  // GET /v1/processes:listScriptProcesses — NOT /v1/projects/{scriptId}/processes
  // (that path 404s; scriptId is a query param here, not part of the URL),
  // and the filter fields are `scriptProcessFilter.*` — `userProcessFilter.*`
  // is a different endpoint (`processes.list`, across every script the
  // caller owns, not scoped to one project). See processes.listScriptProcesses
  // in the Apps Script API reference.
  const params = new URLSearchParams({
    scriptId: QA_APPS_SCRIPT_ID,
    "scriptProcessFilter.functionName": functionName,
    "scriptProcessFilter.statuses": "COMPLETED",
    pageSize: "10",
  });
  const url = `https://script.googleapis.com/v1/processes:listScriptProcesses?${params.toString()}`;

  try {
    const res = await client.request<{ processes?: ScriptProcess[] }>({ url });
    const processes = res.data.processes || [];
    if (processes.length === 0) return null;

    // The API doesn't guarantee result order, so pick the latest ourselves
    // — "latest" meaning when it *finished* (startTime + duration), not
    // when it started, so a long-running run correctly outranks a short one
    // that started slightly later.
    let latestMs: number | null = null;
    for (const p of processes) {
      if (!p.startTime) continue;
      const start = new Date(p.startTime).getTime();
      if (Number.isNaN(start)) continue;
      const end = start + durationToMs(p.duration);
      if (latestMs === null || end > latestMs) latestMs = end;
    }
    return latestMs === null ? null : new Date(latestMs);
  } catch (err) {
    console.error(`Failed to fetch Apps Script execution history for "${functionName}":`, err);
    return null;
  }
}
