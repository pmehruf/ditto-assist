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
  effectiveDate?: string; // YYYY-MM-DD, optional — when the policy/rule described actually takes effect (can be future-dated); announcements without a date are treated as always-current
  category: string;
  addedBy: string;
  rating?: number;
  type?: "QA Announcement" | "General Announcement" | "Insight";
  validTillDate?: string;
  title?: string;
  /** Optional team/department the announcement is coming from. Only shown for "General Announcement" type. */
  from?: string;
  /** YYYY-MM-DD, optional — when this notice was posted/published. Distinct
   * from effectiveDate; defaults to today in the form but is editable. */
  announcementDate?: string;
  /** Which advisor audience this is targeted at — Health Advisors only see
   * "Health" announcements, Term Advisors only see "Term"; everyone else
   * (unassigned/"Both advisor"/"Manager") sees both. Always set server-side
   * (column defaults to "Health"); optional here only so existing
   * fixtures/constructors elsewhere in the app don't need updating. */
  team?: "Health" | "Term";
}

/** External link (SOP, QA Dashboard, etc.) surfaced in the Workspace Controls
 * drawer's Resources section. Readable by everyone; add/edit/delete is
 * gated to Admin/Developer server-side. */
export interface ExternalResource {
  id: string;
  title: string;
  url: string;
  addedBy: string;
  createdAt?: string;
  /** Explicit icon choice (a lucide-react icon name, e.g. "DollarSign") made
   * by the admin who added/edited this resource. Undefined means "no
   * explicit choice" — the client falls back to its keyword-based guess
   * (getResourceIcon in App.tsx). */
  icon?: string;
}
