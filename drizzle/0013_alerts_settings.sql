-- Idempotent: these objects were first applied to the live DB under an earlier number.
CREATE TABLE IF NOT EXISTS "alert_states" (
	"alert_key" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_state" CHECK ("alert_states"."state" in ('read', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"workspace_name" text DEFAULT 'IT Ops' NOT NULL,
	"usd_aed_rate" numeric(10, 4) DEFAULT 3.6725 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_single" CHECK ("workspace_settings"."id" = 1),
	CONSTRAINT "workspace_settings_rate" CHECK ("workspace_settings"."usd_aed_rate" > 0)
);
--> statement-breakpoint
INSERT INTO "workspace_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON public.workspace_settings;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.alert_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS allowed_user_all ON public.alert_states;
--> statement-breakpoint
CREATE POLICY allowed_user_all ON public.alert_states FOR ALL TO authenticated
  USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--> statement-breakpoint
REVOKE ALL ON public.alert_states FROM anon;
--> statement-breakpoint
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS allowed_user_all ON public.workspace_settings;
--> statement-breakpoint
CREATE POLICY allowed_user_all ON public.workspace_settings FOR ALL TO authenticated
  USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--> statement-breakpoint
REVOKE ALL ON public.workspace_settings FROM anon;
