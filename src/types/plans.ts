/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DraftPlan {
  name: string;
  submittedBy: string;
  submittedAt: string;
  status: "Pending Approval" | "Approved";
  testReport?: string;
  questions: string[];
}
