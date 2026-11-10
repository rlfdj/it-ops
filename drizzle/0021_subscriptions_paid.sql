-- Subscriptions: expected cost is optional, invoices carry seat counts, pro-rated invoices
-- list their seats. Additive and backward compatible: DROP NOT NULL and new nullable columns
-- or a new table are ignored by the previous code (every existing row keeps its values; the
-- notice_days column stays, unused). Idempotent, so a re-run is harmless.
CREATE TABLE IF NOT EXISTS "prorated_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"tier" text NOT NULL,
	"project" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prorated_seats_tier" CHECK ("prorated_seats"."tier" in ('standard', 'premium'))
);
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ALTER COLUMN "amount_original" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ALTER COLUMN "amount_aed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "cost_original" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "cost_aed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "seats_standard" integer;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "seats_premium" integer;--> statement-breakpoint
ALTER TABLE "prorated_seats" DROP CONSTRAINT IF EXISTS "prorated_seats_invoice_id_subscription_invoices_id_fk";--> statement-breakpoint
ALTER TABLE "prorated_seats" ADD CONSTRAINT "prorated_seats_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prorated_seats_invoice_id_index" ON "prorated_seats" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "subscription_invoices" DROP CONSTRAINT IF EXISTS "subscription_invoices_seat_counts_range";--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_seat_counts_range" CHECK (("subscription_invoices"."seats_standard" is null or "subscription_invoices"."seats_standard" >= 0) and ("subscription_invoices"."seats_premium" is null or "subscription_invoices"."seats_premium" >= 0));--> statement-breakpoint
ALTER TABLE public.prorated_seats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS allowed_user_all ON public.prorated_seats;
--> statement-breakpoint
CREATE POLICY allowed_user_all ON public.prorated_seats FOR ALL TO authenticated
  USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--> statement-breakpoint
REVOKE ALL ON public.prorated_seats FROM anon;
--> statement-breakpoint

-- Activity log. Same function as before, plus the seats of pro-rated invoices (module
-- "Subscriptions", labelled "Subscription · Person").
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
DROP TRIGGER IF EXISTS log_activity ON public.prorated_seats;
--> statement-breakpoint
CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON public.prorated_seats
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();
