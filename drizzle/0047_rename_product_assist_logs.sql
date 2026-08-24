-- Renames query_assist_logs / query_assist_log_export_connection to their
-- Product Assist name (2026-08 internal naming cleanup — "Query Assist"
-- was legacy naming from before the advisor-facing feature was renamed to
-- "Product Assist" everywhere else in the app; see server.ts's
-- /api/product-assist/* routes and src/server/knowledgeBase/productAssist.ts).
--
-- Pure ALTER TABLE ... RENAME TO — no columns/data touched, both tables
-- keep every existing row exactly as-is. Reversible by running the inverse
-- RENAME (product_assist_logs -> query_assist_logs, etc.) if ever needed.

ALTER TABLE "query_assist_logs" RENAME TO "product_assist_logs";
--> statement-breakpoint

ALTER TABLE "query_assist_log_export_connection" RENAME TO "product_assist_log_export_connection";
