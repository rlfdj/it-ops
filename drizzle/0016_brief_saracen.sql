-- Board: sticky notes. Additive and backward compatible: the previous code ignores the new
-- table and the new document owner type. Idempotent, so a re-run is harmless.
ALTER TYPE "public"."doc_owner_type" ADD VALUE IF NOT EXISTS 'note';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"colour" text DEFAULT 'yellow' NOT NULL,
	"x" integer DEFAULT 24 NOT NULL,
	"y" integer DEFAULT 24 NOT NULL,
	"width" integer DEFAULT 240 NOT NULL,
	"height" integer DEFAULT 220 NOT NULL,
	"z_index" integer DEFAULT 1 NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"person_id" uuid,
	"po_id" uuid,
	"subscription_id" uuid,
	"task_id" uuid,
	"made_task_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_colour" CHECK ("notes"."colour" in ('yellow', 'pink', 'blue', 'green', 'orange')),
	CONSTRAINT "notes_size" CHECK ("notes"."width" between 120 and 1200 and "notes"."height" between 80 and 1600),
	CONSTRAINT "notes_position" CHECK ("notes"."x" between 0 and 20000 and "notes"."y" between 0 and 20000),
	CONSTRAINT "notes_z_index" CHECK ("notes"."z_index" between 0 and 1000000),
	CONSTRAINT "notes_text_length" CHECK (char_length("notes"."text") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_person_id_people_id_fk";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_po_id_purchase_orders_id_fk";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_subscription_id_subscriptions_id_fk";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_made_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_made_task_id_tasks_id_fk" FOREIGN KEY ("made_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_deleted_at_index" ON "notes" USING btree ("deleted_at");--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON public.notes;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS allowed_user_all ON public.notes;
--> statement-breakpoint
CREATE POLICY allowed_user_all ON public.notes FOR ALL TO authenticated
  USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--> statement-breakpoint
REVOKE ALL ON public.notes FROM anon;
--> statement-breakpoint

-- Activity log. Same function as before, plus the Board:
--  * notes and their attached files count as the "Board" module;
--  * moving or resizing a note (x, y, width, height, z_index) is not logged.
-- (The Board's clean-up of notes already logged as deleted turns logging off for its own
-- transaction with app.skip_activity_log, so removing them is not logged a second time.)
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
DROP TRIGGER IF EXISTS log_activity ON public.notes;
--> statement-breakpoint
CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();
