-- Pro-rated invoices may share a date (with each other and with a renewal). Only renewal rows
-- stay one per (subscription, date), which keeps ensureInvoicePeriods() idempotent.
-- Apply after the code that sends `ON CONFLICT ... WHERE kind = 'renewal'` is live: that code
-- matches both the old full index and this partial one; older code needs the full index.
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_renewal_period_unique" ON "subscription_invoices" USING btree ("subscription_id","period_start") WHERE "subscription_invoices"."kind" = 'renewal';--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_invoices_subscription_id_period_start_index";
