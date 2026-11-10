-- Purchases: discount, 5% VAT and invoice date. Additive and backward compatible (the
-- previous code ignores the new columns; defaults keep every existing purchase's total the
-- same). Idempotent, so a re-run is harmless.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "vat_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "discount_aed" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "invoice_date" date;--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_discount_nonneg";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_discount_nonneg" CHECK ("purchase_orders"."discount_aed" >= 0);
