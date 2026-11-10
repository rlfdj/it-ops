ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "seats_standard" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "seats_premium" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_seat_tiers_range";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_seat_tiers_range" CHECK (("subscriptions"."seats_standard" is null or "subscriptions"."seats_standard" >= 0) and ("subscriptions"."seats_premium" is null or "subscriptions"."seats_premium" >= 0));
