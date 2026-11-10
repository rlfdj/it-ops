-- Additive and backward compatible: the previous code ignores the new columns.
ALTER TABLE "workspace_settings" ADD COLUMN IF NOT EXISTS "base_currency" text DEFAULT 'AED' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN IF NOT EXISTS "time_zone" text DEFAULT 'Asia/Dubai' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN IF NOT EXISTS "logo_path" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP CONSTRAINT IF EXISTS "workspace_settings_currency";--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_currency" CHECK ("workspace_settings"."base_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
-- Logos may be SVG: allow it in the documents bucket (the app limits SVG use to the logo).
UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
WHERE id = 'documents' AND allowed_mime_types IS NOT NULL AND NOT ('image/svg+xml' = ANY (allowed_mime_types));
