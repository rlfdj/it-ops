ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_notes_length" CHECK (char_length("tasks"."notes") <= 5000);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
