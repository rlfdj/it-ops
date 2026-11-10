CREATE TYPE "public"."asset_event_type" AS ENUM('received', 'assigned', 'returned', 'sent_to_repair', 'back_from_repair', 'retired');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('in_stock', 'assigned', 'in_repair', 'retired');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('laptop', 'monitor', 'phone', 'tablet', 'network', 'accessory');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."checklist_kind" AS ENUM('onboarding', 'offboarding');--> statement-breakpoint
CREATE TYPE "public"."checklist_section" AS ENUM('accounts', 'assets', 'licences', 'sim');--> statement-breakpoint
CREATE TYPE "public"."checklist_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."doc_kind" AS ENUM('invoice', 'delivery_note', 'approval', 'other');--> statement-breakpoint
CREATE TYPE "public"."doc_owner_type" AS ENUM('purchase_order', 'subscription_invoice');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('upcoming', 'missing', 'on_file');--> statement-breakpoint
CREATE TYPE "public"."log_action" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."person_status" AS ENUM('active', 'leaving', 'left');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('requested', 'approved', 'ordered', 'delivered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."sub_kind" AS ENUM('subscription', 'contract');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('manual', 'checklist', 'subscription', 'system');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'waiting', 'done');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" "log_action" NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"record_label" text,
	"module" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"event_type" "asset_event_type" NOT NULL,
	"person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"type" "asset_type" NOT NULL,
	"model" text NOT NULL,
	"serial_number" text,
	"status" "asset_status" DEFAULT 'in_stock' NOT NULL,
	"po_id" uuid,
	"current_person_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_tag_unique" UNIQUE("tag"),
	CONSTRAINT "assets_tag_format" CHECK ("assets"."tag" ~ '^DP-(LT|MN|PH|TB|NW|AC)-[0-9]{4}$'),
	CONSTRAINT "assets_holder_requires_assigned" CHECK ("assets"."current_person_id" is null or "assets"."status" = 'assigned')
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"section" "checklist_section" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"asset_id" uuid,
	"subscription_id" uuid,
	"due_date" date,
	"done_at" timestamp with time zone,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "checklist_kind" NOT NULL,
	"target_date" date NOT NULL,
	"status" "checklist_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "doc_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "doc_kind" NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storagePath_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "id_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"department" text,
	"manager_name" text,
	"status" "person_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_aed" numeric(12, 2) NOT NULL,
	"asset_type" "asset_type",
	"registered_qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_lines_qty_positive" CHECK ("po_lines"."qty" > 0),
	CONSTRAINT "po_lines_registered_qty_range" CHECK ("po_lines"."registered_qty" >= 0 and "po_lines"."registered_qty" <= "po_lines"."qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" "po_status" DEFAULT 'requested' NOT NULL,
	"requested_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_poNumber_unique" UNIQUE("po_number"),
	CONSTRAINT "purchase_orders_po_number_format" CHECK ("purchase_orders"."po_number" ~ '^PO-[0-9]{4}-[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_label" text NOT NULL,
	"invoice_number" text,
	"amount_original" numeric(12, 2) NOT NULL,
	"amount_aed" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'upcoming' NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"kind" "sub_kind" DEFAULT 'subscription' NOT NULL,
	"plan" text,
	"seats" integer,
	"billing_cycle" "billing_cycle" NOT NULL,
	"billing_day" smallint,
	"cost_original" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"cost_aed" numeric(12, 2) NOT NULL,
	"paid_by" text,
	"next_charge_date" date,
	"renewal_date" date,
	"contract_end_date" date,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_billing_day_range" CHECK ("subscriptions"."billing_day" between 1 and 31),
	CONSTRAINT "subscriptions_currency_format" CHECK ("subscriptions"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"priority" smallint DEFAULT 2 NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"source" "task_source" DEFAULT 'manual' NOT NULL,
	"checklist_item_id" uuid,
	"person_id" uuid,
	"asset_id" uuid,
	"po_id" uuid,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_checklistItemId_unique" UNIQUE("checklist_item_id"),
	CONSTRAINT "tasks_priority_range" CHECK ("tasks"."priority" between 1 and 3),
	CONSTRAINT "tasks_done_at_matches_status" CHECK (("tasks"."status" = 'done') = ("tasks"."done_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_person_id_people_id_fk" FOREIGN KEY ("current_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_module_at_index" ON "activity_log" USING btree ("module","at");--> statement-breakpoint
CREATE INDEX "activity_log_record_id_index" ON "activity_log" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "asset_events_asset_id_occurred_at_index" ON "asset_events" USING btree ("asset_id","occurred_at");--> statement-breakpoint
CREATE INDEX "assets_status_index" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_current_person_id_index" ON "assets" USING btree ("current_person_id");--> statement-breakpoint
CREATE INDEX "assets_po_id_index" ON "assets" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "checklist_items_checklist_id_section_sort_index" ON "checklist_items" USING btree ("checklist_id","section","sort");--> statement-breakpoint
CREATE INDEX "checklist_items_asset_id_index" ON "checklist_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "checklists_person_id_index" ON "checklists" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "checklists_status_index" ON "checklists" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_owner_type_owner_id_index" ON "documents" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "people_status_index" ON "people" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_lines_po_id_index" ON "po_lines" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_index" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoices_subscription_id_period_start_index" ON "subscription_invoices" USING btree ("subscription_id","period_start");--> statement-breakpoint
CREATE INDEX "subscription_invoices_status_index" ON "subscription_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_next_charge_date_index" ON "subscriptions" USING btree ("next_charge_date");--> statement-breakpoint
CREATE INDEX "tasks_status_due_date_index" ON "tasks" USING btree ("status","due_date");