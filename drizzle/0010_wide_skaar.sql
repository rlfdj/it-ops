-- Idempotent: these objects were first applied to the live DB as an earlier-numbered migration.
DO $$ BEGIN
  CREATE TYPE "public"."stock_status" AS ENUM('in_stock', 'deployed', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "status" "stock_status" DEFAULT 'in_stock' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "issued_to_name" text;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "assigned_person_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "issued_on" date;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "issue_note" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_assigned_person_id_people_id_fk" FOREIGN KEY ("assigned_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
