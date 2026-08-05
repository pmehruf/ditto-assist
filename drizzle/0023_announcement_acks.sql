-- Mandatory read-and-acknowledge layer for announcements.
--
-- 1) announcement_acks — one row per (announcement, advisor) acknowledgement.
--    ON DELETE CASCADE: deleting an announcement silently clears its acks so
--    it can never keep (or start) blocking anyone after removal.
--
-- 2) announcements.requires_ack — whether this announcement participates in
--    the blocking read-and-acknowledge flow at all. Existing rows are
--    explicitly grandfathered to FALSE (the feature only applies to
--    announcements posted after this migration ships); the column default
--    TRUE makes every announcement created from now on gate the app until
--    each user acknowledges it. Per-user "new joiners skip history" is NOT
--    modeled here — that's the runtime comparison of announcements.created_at
--    against users.created_at in the unacknowledged query.

CREATE TABLE "announcement_acks" (
  "id" serial PRIMARY KEY NOT NULL,
  "announcement_id" integer NOT NULL,
  "user_email" varchar(320) NOT NULL,
  "acked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "announcement_acks_announcement_user_unique" UNIQUE("announcement_id","user_email")
);
--> statement-breakpoint
ALTER TABLE "announcement_acks" ADD CONSTRAINT "announcement_acks_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "announcement_acks_user_email_idx" ON "announcement_acks" ("user_email");
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "requires_ack" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "announcements" SET "requires_ack" = false;
