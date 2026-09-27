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
  /** "General Announcement" is legacy-only — Postgres can't drop an enum
   * value in place, and some historical rows may still carry it (see
   * migration 0056's reclassification). It's no longer a selectable Type
   * in the Announcement Manager; "Product Announcement" and "Insurance
   * Operations" replaced it as the two real, dedicated non-QA types. */
  type?: "QA Announcement" | "General Announcement" | "Product Announcement" | "Insurance Operations" | "Insight";
  validTillDate?: string;
  title?: string;
  /** Legacy-only free-text team/department, from the old "General
   * Announcement" type's "From" field — no longer collected for Product
   * Announcement / Insurance Operations (the type itself now says which
   * department), so this is only ever populated on legacy rows. */
  from?: string;
  /** YYYY-MM-DD, optional — when this notice was posted/published. Distinct
   * from effectiveDate; defaults to today in the form but is editable. */
  announcementDate?: string;
  /** Which advisor audience this is targeted at — Health Advisors only see
   * "Health" announcements, Term Advisors only see "Term"; "Both" is visible
   * to Health AND Term advisors alike (lets the Announcement Manager post
   * one common announcement instead of two near-duplicates); everyone else
   * (unassigned/"Manager") sees everything regardless of this value. Always
   * set server-side (column defaults to "Health"); optional here only so
   * existing fixtures/constructors elsewhere in the app don't need updating. */
  team?: "Health" | "Term" | "Both";
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
