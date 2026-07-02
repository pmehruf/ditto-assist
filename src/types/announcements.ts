/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AuditLogEntry {
  timestamp: string;
  userEmail: string;
  planName: string;
  pedInput: string;
  matchedQuestion: string;
  matchType: string;
  source: string;
  explanation: string;
}

export interface ReportedIssue {
  id: string;
  timestamp: string;
  userEmail: string;
  userName: string;
  userTactId: string;
  planName: string;
  pedInput: string;
  matchedQuestion: string;
  matchType: string;
  source: string;
  explanation: string;
  issueNotes: string;
  status: "Pending" | "Urgent" | "Resolved" | "Ignored";
  ownerNotes?: string;
  resolvedAt?: string;
}

export interface QAAnnouncement {
  id: string;
  announcement: string;
  effectiveDate?: string; // YYYY-MM-DD, optional — announcements without a date are treated as always-current
  category: string;
  addedBy: string;
  rating?: number;
  type?: "QA Announcement" | "General Announcement";
  validTillDate?: string;
  title?: string;
  /** Optional team/department the announcement is coming from. Only shown for "General Announcement" type. */
  from?: string;
}
