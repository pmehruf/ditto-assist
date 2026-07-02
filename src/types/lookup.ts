/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Derived match-certainty summary computed from the current lookupResults. */
export interface LookupMetrics {
  score: number;
  confidenceText: string;
  statusColor: string;
  progressColor: string;
  badgeColor: string;
  isMultiPed: boolean;
  lowConfidencePeds: Array<{ ped: string; score: number; matchType: string }>;
}

/** The mismatch currently staged for reporting via the Flag workflow. */
export interface ReportingItem {
  planName: string;
  pedInput: string;
  mappedQuestion: string;
  matchType: string;
  source: string;
  explanation: string;
}
