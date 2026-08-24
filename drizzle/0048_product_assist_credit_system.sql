-- Product Assist Credit & Usage Management (2026-08). Purely additive: a
-- new administrative quota layer sitting around the existing Product Assist
-- AI call. Does not touch product_assist_logs, product_assist_log_export_
-- connection, or any Product Assist retrieval/answer table. See schema.ts's
-- doc comment above each table below for the full reasoning.

-- 1. Global, single-row settings (defaults, conversion rate, budget,
--    pricing). Seeded with one row so every read can assume it exists.
CREATE TABLE "product_assist_quota_settings" (
    "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
    "default_daily_credits" integer DEFAULT 30 NOT NULL,
    "default_monthly_credits" integer DEFAULT 250 NOT NULL,
    "trial_monthly_credits" integer DEFAULT 10 NOT NULL,
    "tokens_per_credit" integer DEFAULT 1000 NOT NULL,
    "warning_threshold_percent" integer DEFAULT 80 NOT NULL,
    "monthly_budget" numeric(12, 2) DEFAULT '2000' NOT NULL,
    "budget_warning_threshold_percent" integer DEFAULT 80 NOT NULL,
    "currency" text DEFAULT 'INR' NOT NULL,
    "model_name" text DEFAULT 'gemini-2.5-flash' NOT NULL,
    "input_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
    "output_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
    "updated_by" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. Sparse per-user overrides. No row for a user = use their computed
--    eligibility-bucket default (see productAssistQuota.ts).
CREATE TABLE "product_assist_user_quota_overrides" (
    "user_email" varchar(320) PRIMARY KEY NOT NULL,
    "custom_daily_credits" integer,
    "custom_monthly_credits" integer,
    "limits_enabled" boolean DEFAULT true NOT NULL,
    "unlimited_access" boolean DEFAULT false NOT NULL,
    "updated_by" text NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_assist_user_quota_overrides" ADD CONSTRAINT "product_assist_user_quota_overrides_user_email_users_email_fk"
    FOREIGN KEY ("user_email") REFERENCES "public"."users"("email")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- 3. Append-only extra-credit grant/removal ledger. Never expires, never
--    mutated after insert — a removal is a new negative-amount row.
CREATE TABLE "product_assist_extra_credit_grants" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_email" varchar(320) NOT NULL,
    "amount" integer NOT NULL,
    "reason" text,
    "granted_by" text NOT NULL,
    "granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_assist_extra_credit_grants" ADD CONSTRAINT "product_assist_extra_credit_grants_user_email_users_email_fk"
    FOREIGN KEY ("user_email") REFERENCES "public"."users"("email")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "product_assist_extra_credit_grants_user_email_idx" ON "product_assist_extra_credit_grants" USING btree ("user_email");
--> statement-breakpoint

-- 4. The dedicated, always-on usage ledger — the actual quota-enforcement
--    source of truth. Written synchronously right after every successful
--    Product Assist AI call, independent of PRODUCT_ASSIST_LOG_ENABLED.
CREATE TABLE "product_assist_usage_ledger" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_email" varchar(320) NOT NULL,
    "input_tokens" integer NOT NULL,
    "output_tokens" integer NOT NULL,
    "total_tokens" integer NOT NULL,
    "credits" numeric(10, 3) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_assist_usage_ledger_user_created_idx" ON "product_assist_usage_ledger" USING btree ("user_email", "created_at");
--> statement-breakpoint

-- 5. Seed the single settings row so every read can assume it exists
--    without a null-check fallback scattered through the code.
INSERT INTO "product_assist_quota_settings" ("id") VALUES ('default');
