-- Idempotent: the enum and columns were first applied to the live DB by an earlier draft
-- of this migration, which also (wrongly) made the unique index partial. That index is
-- put back to the plain unique index the running code relies on.
DO $$ BEGIN
  CREATE TYPE "public"."invoice_kind" AS ENUM('renewal', 'prorated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "kind" "invoice_kind" DEFAULT 'renewal' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "user_name" text;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "project" text;--> statement-breakpoint
-- Remove only the e2e test pro-rated rows (invoice number PR-<digits>) that share a date with another row.
DELETE FROM "documents" WHERE "owner_type" = 'subscription_invoice' AND "owner_id" IN (
  SELECT p."id" FROM "subscription_invoices" p WHERE p."kind" = 'prorated' AND p."invoice_number" ~ '^PR-[0-9]+$'
  AND EXISTS (SELECT 1 FROM "subscription_invoices" r WHERE r."subscription_id" = p."subscription_id" AND r."period_start" = p."period_start" AND r."id" <> p."id")
);--> statement-breakpoint
DELETE FROM "subscription_invoices" p WHERE p."kind" = 'prorated' AND p."invoice_number" ~ '^PR-[0-9]+$'
  AND EXISTS (SELECT 1 FROM "subscription_invoices" r WHERE r."subscription_id" = p."subscription_id" AND r."period_start" = p."period_start" AND r."id" <> p."id");--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_invoices_subscription_id_period_start_index";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_subscription_id_period_start_index" ON "subscription_invoices" USING btree ("subscription_id","period_start");
