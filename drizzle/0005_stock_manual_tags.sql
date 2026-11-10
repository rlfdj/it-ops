ALTER TABLE "stock_items" DROP CONSTRAINT "stock_items_tag_format";--> statement-breakpoint
ALTER TABLE "stock_items" DROP COLUMN "type";--> statement-breakpoint
DROP TYPE "public"."asset_type";