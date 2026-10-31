/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Database-level guards added by drizzle/0090_playbook_mirror.sql (Product
// Playbook mirror). Synthetic data only — no real Playbook content (D7).
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./testUtils.js";

const SHA = "a".repeat(64);

// drizzle wraps Postgres errors ("Failed query: ..."); the guard message itself is on .cause.
async function expectBlocked(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, "expected the database to refuse this statement").not.toBeNull();
  const err = error as { message?: string; cause?: { message?: string; constraint?: string } };
  expect(`${err.cause?.message ?? ""} ${err.cause?.constraint ?? ""} ${err.message ?? ""}`).toMatch(pattern);
}
const READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";

describe("Playbook mirror database guards (migration 0090)", () => {
  let db: TestDb;
  const run = (q: string) => db.execute(sql.raw(q));
  const snapshot = (id: number, status = "fetched") =>
    run(`insert into playbook_snapshots (id, spreadsheet_id, fetched_via, trigger, request_ranges, request_fields,
           raw_response_gzip, raw_response_bytes, raw_sha256, parser_version, status)
         values (${id}, 'synthetic-sheet', 'tester@example.com', 'manual:test', array['A1:B2'], 'fields',
           '\\x1f8b'::bytea, 2, '${SHA}', 'v-test', '${status}')`);
  const tab = (snapshotId: number) =>
    run(`insert into playbook_snapshot_tabs (snapshot_id, sheet_gid, title, hidden_cols) values (${snapshotId}, 0, 'Synthetic Tab', array[1,19])`);
  const grant = (scopes: string[]) =>
    run(`insert into playbook_mirror_connection (domain, connected_email, encrypted_refresh_token, granted_scopes, connected_by)
         values ('Health', 'tester@example.com', 'enc', array[${scopes.map((s) => `'${s}'`).join(",")}]::text[], 'tester@example.com')`);

  beforeAll(async () => {
    db = await createTestDb();
  });

  describe("cells and snapshots are exact and write-once", () => {
    beforeAll(async () => {
      await snapshot(1);
      await tab(1);
    });

    it("stores text byte for byte, including leading spaces and lone carriage returns", async () => {
      await run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind, raw_text)
                 values (1, 0, 1, 15, 'O1', 'text', E' Plan Name\\r')`);
      const rows = await db.execute(sql`select raw_text from playbook_cells where a1 = 'O1'`);
      expect((rows.rows[0] as { raw_text: string }).raw_text).toBe(" Plan Name\r");
    });

    it("keeps a number's original literal next to its displayed value", async () => {
      await run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind, number_raw, number_value, formatted_value)
                 values (1, 0, 23, 4, 'D23', 'number', '1', 1, '100%')`);
      const rows = await db.execute(sql`select number_raw, formatted_value from playbook_cells where a1 = 'D23'`);
      expect(rows.rows[0]).toEqual({ number_raw: "1", formatted_value: "100%" });
    });

    it("rejects an 'empty' cell that carries text", async () => {
      await expectBlocked(run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind, raw_text)
                        values (1, 0, 45, 4, 'D45', 'empty', 'x')`), /playbook_cells_empty_has_no_text/);
    });

    it("rejects a cell that is both a merge anchor and covered by another merge", async () => {
      await expectBlocked(run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind, merge_range, covered_by)
                        values (1, 0, 35, 7, 'G35', 'empty', 'G34:G38', 'G34')`), /playbook_cells_merge_xor/);
    });

    it("rejects a cell for a tab that was not stored", async () => {
      await expectBlocked(run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind)
                        values (1, 999, 1, 1, 'A1', 'empty')`), /playbook_cells_tab_fk/);
    });

    it("blocks updates to stored cells and tab metadata", async () => {
      await expectBlocked(run(`update playbook_cells set raw_text = 'changed' where a1 = 'O1'`), /write-once/);
      await expectBlocked(run(`update playbook_snapshot_tabs set hidden_cols = '{}' where snapshot_id = 1`), /write-once/);
    });

    it("blocks changes to a snapshot's raw response and fingerprint", async () => {
      await expectBlocked(run(`update playbook_snapshots set raw_response_gzip = '\\x00'::bytea where id = 1`), /immutable/);
      await expectBlocked(run(`update playbook_snapshots set raw_sha256 = '${"b".repeat(64)}' where id = 1`), /immutable/);
    });

    it("requires a well-formed fingerprint and a reason for rejection", async () => {
      await expectBlocked(run(`insert into playbook_snapshots (spreadsheet_id, fetched_via, trigger, request_ranges, request_fields, raw_response_gzip, raw_response_bytes, raw_sha256, parser_version)
                        values ('s', 'f', 't', array['A1'], 'f', '\\x00'::bytea, 1, 'not-hex', 'v')`), /sha256_format/);
      await expectBlocked(run(`update playbook_snapshots set status = 'rejected' where id = 1`), /rejected_has_reason/);
    });
  });

  describe("publishing and retention", () => {
    beforeAll(async () => {
      await snapshot(10);
    });

    it("refuses to publish a snapshot that was only fetched", async () => {
      await expectBlocked(run(`insert into playbook_published (domain, snapshot_id, updated_by) values ('Health', 10, 't')`), /only verified snapshots/);
    });

    it("refuses to publish a verified snapshot without recorded check reports", async () => {
      await run(`update playbook_snapshots set status = 'verified' where id = 10`);
      await expectBlocked(run(`insert into playbook_published (domain, snapshot_id, updated_by) values ('Health', 10, 't')`), /no recorded structure\/reconciliation report/);
    });

    it("refuses to publish into another domain", async () => {
      await run(`update playbook_snapshots set structure_report = '{"ok":true}', reconciliation_report = '{"differences":0}' where id = 10`);
      await expectBlocked(run(`insert into playbook_published (domain, snapshot_id, updated_by) values ('Term', 10, 't')`), /belongs to domain Health/);
    });

    it("publishes a verified, checked snapshot and then protects it", async () => {
      await run(`insert into playbook_published (domain, snapshot_id, updated_by) values ('Health', 10, 't')`);
      await run(`update playbook_snapshots set status = 'published', published_at = now(), published_by = 't' where id = 10`);
      await expectBlocked(run(`delete from playbook_snapshots where id = 10`), /must be kept for rollback/);
      await expectBlocked(run(`update playbook_snapshots set published_at = now() - interval '1 day' where id = 10`), /cannot be changed once set/);
    });

    it("keeps a superseded (previously published) snapshot for rollback", async () => {
      await snapshot(11, "verified");
      await run(`update playbook_snapshots set structure_report = '{}', reconciliation_report = '{}' where id = 11`);
      await run(`update playbook_published set snapshot_id = 11 where domain = 'Health'`);
      await run(`update playbook_snapshots set status = 'superseded' where id = 10`);
      await expectBlocked(run(`delete from playbook_snapshots where id = 10`), /must be kept for rollback/);
    });

    it("lets retention delete a never-published rejected snapshot together with its cells", async () => {
      await snapshot(12);
      await run(`update playbook_snapshots set status = 'rejected', rejected_reason = 'structure mismatch' where id = 12`);
      await tab(12);
      await run(`insert into playbook_cells (snapshot_id, sheet_gid, row_num, col_num, a1, value_kind, raw_text) values (12, 0, 1, 1, 'A1', 'text', 'x')`);
      await run(`delete from playbook_snapshots where id = 12`);
      const rows = await db.execute(sql`select count(*)::int as n from playbook_cells where snapshot_id = 12`);
      expect((rows.rows[0] as { n: number }).n).toBe(0);
    });
  });

  describe("read-only Google grant", () => {
    it("refuses a grant that includes write access to spreadsheets", async () => {
      await expectBlocked(grant(["openid", READONLY, "https://www.googleapis.com/auth/spreadsheets"]), /readonly_scopes/);
    });
    it("refuses a grant that includes Apps Script access", async () => {
      await expectBlocked(grant([READONLY, "https://www.googleapis.com/auth/script.processes"]), /readonly_scopes/);
    });
    it("refuses a grant without spreadsheets.readonly", async () => {
      await expectBlocked(grant(["openid", "email"]), /readonly_scopes/);
    });
    it("accepts a read-only grant", async () => {
      await grant(["openid", "email", READONLY]);
    });
  });

  describe("plans and source issues", () => {
    it("never shows a plan to advisors before its status is confirmed by a named person", async () => {
      await expectBlocked(run(`insert into playbook_plans (plan_key, insurer, display_name, expected_header, status, show_to_advisors, updated_by)
                        values ('synthetic_a', 'Insurer', 'A', 'Header A', 'active', true, 't')`), /visible_needs_confirmation/);
      await run(`insert into playbook_plans (plan_key, insurer, display_name, expected_header, status, updated_by)
                 values ('synthetic_b', 'Insurer', 'B', 'Header B', 'hidden', 't')`);
      await expectBlocked(run(`insert into playbook_plans (plan_key, insurer, display_name, expected_header, status, updated_by)
                        values ('synthetic_c', 'Insurer', 'C', 'Header B', 'active', 't')`), /playbook_plans_header_unique/);
    });

    it("seeds the AD46 picture gap (open, warning on) and the Excel G29 discrepancy (recorded)", async () => {
      const rows = await db.execute(sql`select issue_key, kind, status, show_warning from playbook_source_issues order by issue_key`);
      expect(rows.rows).toEqual([
        { issue_key: "ad46_picture", kind: "source_gap", status: "open", show_warning: true },
        { issue_key: "excel_copy_g29", kind: "excel_copy_discrepancy", status: "recorded", show_warning: false },
      ]);
    });

    it("keeps the AD46 warning until a second person verifies the fix", async () => {
      await expectBlocked(run(`update playbook_source_issues set show_warning = false where issue_key = 'ad46_picture'`), /warning_until_verified/);
      await expectBlocked(run(`update playbook_source_issues set status = 'verified', resolved_by = 'a', resolved_at = now(), verified_by = 'a', verified_at = now()
                        where issue_key = 'ad46_picture'`), /verified_by_other/);
      await run(`update playbook_source_issues set status = 'verified', resolved_by = 'a', resolved_at = now(), verified_by = 'b', verified_at = now()
                 where issue_key = 'ad46_picture'`);
    });
  });
});
