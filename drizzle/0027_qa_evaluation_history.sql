CREATE TABLE "qa_evaluation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"checked_date" text NOT NULL,
	"mistake_date" text,
	"tact_id" text NOT NULL,
	"advisor_name" text NOT NULL,
	"chat_id" text NOT NULL,
	"domain" text NOT NULL,
	"score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "qa_evaluation_history_tact_id_idx" ON "qa_evaluation_history" USING btree ("tact_id");
--> statement-breakpoint
CREATE INDEX "qa_evaluation_history_checked_date_idx" ON "qa_evaluation_history" USING btree ("checked_date");
