CREATE TABLE "ped_mapping_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"ped_text" text NOT NULL,
	"category" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ped_mapping_overrides_ped_text_unique" UNIQUE("ped_text")
);
--> statement-breakpoint
CREATE TABLE "plan_configs" (
	"plan_name" text PRIMARY KEY NOT NULL,
	"insurer_name" text NOT NULL,
	"questions" jsonb NOT NULL,
	"category_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"any_other" text NOT NULL,
	"has_umbrella" boolean DEFAULT false NOT NULL,
	"umbrella_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overrides" jsonb,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
