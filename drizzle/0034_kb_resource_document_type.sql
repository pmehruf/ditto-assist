-- kb_resources.document_type — classifies what KIND of document a resource
-- is (as opposed to kb_categories, which is WHICH insurer, and plan_tags,
-- which is WHICH plan). Added as part of the "clean Knowledge Base" rebuild:
-- insurers are now being re-ingested as dedicated single-purpose resources
-- (one Brochure PDF, one Policy Wording PDF, one Prospectus PDF per plan)
-- instead of one merged multi-document PDF per plan — this column is what
-- lets queryAssist.ts tell those apart at retrieval time and apply the
-- authority precedence Policy Wording > Prospectus > Brochure that a
-- merged file made impossible to express.
--
-- 'other' is the default so every pre-existing resource (merged PDFs,
-- claim-process articles, glossaries, the Playbook resource, etc.) keeps
-- working unchanged — this migration does not touch any existing row's
-- meaning, it only adds a column new ingests can set going forward. Per
-- the "clean fresh start" decision, legacy merged resources are being
-- phased out via replacement, not backfilled with a document_type.

CREATE TYPE "kb_document_type" AS ENUM ('brochure', 'policy_wording', 'prospectus', 'addon', 'other');
--> statement-breakpoint
ALTER TABLE "kb_resources" ADD COLUMN "document_type" "kb_document_type" NOT NULL DEFAULT 'other';
