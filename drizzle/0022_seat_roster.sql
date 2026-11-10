-- Seat roster for the tiered subscriptions (Standard / Premium seats): who holds
-- which seat, with history. Additive and backward compatible: a new table, a new nullable
-- checklist column and a new flag with a default; the previous code ignores all of them. The
-- flag is set from the subscription form. Idempotent, so a re-run is harmless.
CREATE TABLE IF NOT EXISTS "seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"person_id" uuid,
	"tier" text NOT NULL,
	"project" text,
	"since" date NOT NULL,
	"until" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_assignments_tier" CHECK ("seat_assignments"."tier" in ('standard', 'premium')),
	CONSTRAINT "seat_assignments_source" CHECK ("seat_assignments"."source" in ('manual', 'prorated', 'import'))
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN IF NOT EXISTS "seat_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "tiered_seats" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seat_assignments" DROP CONSTRAINT IF EXISTS "seat_assignments_subscription_id_subscriptions_id_fk";--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" DROP CONSTRAINT IF EXISTS "seat_assignments_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" DROP CONSTRAINT IF EXISTS "seat_assignments_source_invoice_id_subscription_invoices_id_fk";--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_source_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" DROP CONSTRAINT IF EXISTS "checklist_items_seat_assignment_id_seat_assignments_id_fk";--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_seat_assignment_id_seat_assignments_id_fk" FOREIGN KEY ("seat_assignment_id") REFERENCES "public"."seat_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seat_assignments_subscription_id_index" ON "seat_assignments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seat_assignments_person_id_index" ON "seat_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seat_assignments_one_active" ON "seat_assignments" USING btree ("subscription_id",lower("person_name")) WHERE "seat_assignments"."until" is null;--> statement-breakpoint
ALTER TABLE public.seat_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS allowed_user_all ON public.seat_assignments;
--> statement-breakpoint
CREATE POLICY allowed_user_all ON public.seat_assignments FOR ALL TO authenticated
  USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--> statement-breakpoint
REVOKE ALL ON public.seat_assignments FROM anon;
--> statement-breakpoint

-- Activity log. Same function as before, plus the seat roster (module "Subscriptions",
-- labelled "Subscription · Person").
create or replace function public.log_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['id', 'created_at', 'updated_at'];
  v_key text;
  v_label text;
  v_module text;
begin
  -- Escape hatch used by the seed script, which writes curated history itself.
  if coalesce(current_setting('app.skip_activity_log', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'notes' then
    v_ignore := v_ignore || array['x', 'y', 'width', 'height', 'z_index'];
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignore)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    -- Nothing but timestamps (or a note's position and size) changed: don't log.
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    for v_key in select jsonb_object_keys(v_row) loop
      if not (v_key = any (v_ignore)) and jsonb_typeof(v_row -> v_key) <> 'null' then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when tg_op = 'INSERT'
            then jsonb_build_object('old', null, 'new', v_row -> v_key)
            else jsonb_build_object('old', v_row -> v_key, 'new', null)
          end);
      end if;
    end loop;
  end if;

  v_module := case tg_table_name
    when 'purchase_orders' then 'Procurement'
    when 'po_lines' then 'Procurement'
    when 'vendors' then 'Procurement'
    when 'subscriptions' then 'Subscriptions'
    when 'subscription_invoices' then 'Subscriptions'
    when 'prorated_seats' then 'Subscriptions'
    when 'seat_assignments' then 'Subscriptions'
    when 'tasks' then 'Tasks'
    when 'people' then 'People'
    when 'checklists' then 'People'
    when 'checklist_items' then 'People'
    when 'notes' then 'Board'
    when 'documents' then
      case v_row ->> 'owner_type'
        when 'purchase_order' then 'Procurement'
        when 'note' then 'Board'
        else 'Subscriptions'
      end
    else 'Settings'
  end;

  v_label := case tg_table_name
    when 'vendors' then v_row ->> 'name'
    when 'people' then v_row ->> 'full_name'
    when 'purchase_orders' then v_row ->> 'po_number'
    when 'po_lines' then
      concat_ws(' · ',
        (select po.po_number from public.purchase_orders po where po.id = (v_row ->> 'po_id')::uuid),
        v_row ->> 'description')
    when 'documents' then v_row ->> 'file_name'
    when 'subscriptions' then v_row ->> 'name'
    when 'subscription_invoices' then
      concat_ws(' · ',
        (select s.name from public.subscriptions s where s.id = (v_row ->> 'subscription_id')::uuid),
        v_row ->> 'period_label')
    when 'prorated_seats' then
      concat_ws(' · ',
        (select s.name from public.subscription_invoices i
           join public.subscriptions s on s.id = i.subscription_id
          where i.id = (v_row ->> 'invoice_id')::uuid),
        v_row ->> 'person_name')
    when 'seat_assignments' then
      concat_ws(' · ',
        (select s.name from public.subscriptions s where s.id = (v_row ->> 'subscription_id')::uuid),
        v_row ->> 'person_name')
    when 'checklists' then
      concat_ws(' · ',
        (select p.full_name from public.people p where p.id = (v_row ->> 'person_id')::uuid),
        v_row ->> 'kind')
    when 'checklist_items' then v_row ->> 'label'
    when 'tasks' then v_row ->> 'title'
    when 'notes' then left(
      coalesce(nullif(btrim(split_part(btrim(v_row ->> 'text', E' \n\r\t'), E'\n', 1)), ''), 'Empty note'),
      80)
  end;

  insert into public.activity_log (actor, action, table_name, record_id, record_label, module, changes)
  values (
    coalesce(nullif(current_setting('app.actor', true), ''), 'system'),
    lower(tg_op)::public.log_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_label,
    v_module,
    v_changes
  );

  return null;
end;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS log_activity ON public.seat_assignments;
--> statement-breakpoint
CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON public.seat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON public.seat_assignments;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.seat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
