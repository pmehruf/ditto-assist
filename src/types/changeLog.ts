/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Optional point-in-time snapshot of governance state, attached to some
 * change log entries (e.g. plan/draft modification events). Fields are
 * read defensively (`log.snapshot?.draftPlans`, etc.) wherever consumed, so
 * every field here is optional and loosely typed to match.
 */
export interface ChangeLogSnapshot {
  draftPlans?: unknown[];
  productionPlans?: unknown[];
  planQuestionsState?: Record<string, unknown>;
  insurerMetadata?: Record<string, unknown>;
  specificIllnesses?: Record<string, unknown>;
}

export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  userName: string;
  role: string;
  actionType: string;
  planName: string;
  description: string;
  snapshot?: ChangeLogSnapshot;
}
