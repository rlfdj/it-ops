-- Assets are tracked in another system; this app keeps only a stock list (0002).
-- Drops the asset register, its assignment history and the asset links.

-- po_totals reads po_lines columns that are dropped below; recreated at the end.
drop view if exists public.po_totals;
--> statement-breakpoint
ALTER TABLE "asset_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "asset_events" CASCADE;--> statement-breakpoint
DROP TABLE "assets" CASCADE;--> statement-breakpoint
ALTER TABLE "po_lines" DROP CONSTRAINT IF EXISTS "po_lines_registered_qty_range";--> statement-breakpoint
ALTER TABLE "checklist_items" DROP CONSTRAINT IF EXISTS "checklist_items_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_asset_id_assets_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "checklist_items_asset_id_index";--> statement-breakpoint
ALTER TABLE "checklist_items" DROP COLUMN "asset_id";--> statement-breakpoint
ALTER TABLE "po_lines" DROP COLUMN "asset_type";--> statement-breakpoint
ALTER TABLE "po_lines" DROP COLUMN "registered_qty";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "asset_id";--> statement-breakpoint
DROP TYPE "public"."asset_event_type";--> statement-breakpoint
DROP TYPE "public"."asset_status";
--> statement-breakpoint
create view public.po_totals with (security_invoker = true) as
select
  po.id as po_id,
  coalesce(sum(l.qty * l.unit_price_aed), 0)::numeric(12, 2) as total_aed,
  count(l.id)::integer as line_count,
  coalesce(sum(l.qty), 0)::integer as unit_count
from public.purchase_orders po
left join public.po_lines l on l.po_id = po.id
group by po.id;
